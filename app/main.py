from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import create_api_router
from app.config import Settings, get_settings
from app.services.docker_manager import DockerManager
from app.services.document_processor import DocumentProcessor
from app.services.job_manager import JobManager
from app.services.ocr_client import OcrClient


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or get_settings()
    ocr_client = OcrClient(config)
    docker_manager = DockerManager(config, ocr_client)
    document_processor = DocumentProcessor(config)
    jobs = JobManager(config, document_processor, ocr_client, docker_manager)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await jobs.start()
        try:
            yield
        finally:
            await jobs.shutdown()
            await docker_manager.shutdown()

    app = FastAPI(
        title=config.app_name,
        version=config.app_version,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = config
    app.state.jobs = jobs
    app.state.docker_manager = docker_manager

    if config.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.allowed_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Content-Type", "Last-Event-ID"],
        )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; object-src 'none'; "
            "base-uri 'self'; frame-ancestors 'none'",
        )
        return response

    app.include_router(create_api_router(config, jobs, docker_manager))

    assets_dir = config.static_dir / "assets"
    app.mount("/assets", StaticFiles(directory=assets_dir, check_dir=False), name="assets")

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon():  # type: ignore[no-untyped-def]
        icon = config.static_dir / "favicon.svg"
        if icon.is_file():
            return FileResponse(icon, media_type="image/svg+xml")
        return JSONResponse(status_code=404, content={"detail": "Favicon not found"})

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):  # type: ignore[no-untyped-def]
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Nicht gefunden"})
        index = config.static_dir / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse(
            status_code=503,
            content={"detail": "Frontend wurde noch nicht gebaut. Führe `npm run build` aus."},
        )

    return app


app = create_app()
