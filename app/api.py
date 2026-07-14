from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse

from app.config import Settings
from app.models import JobOptions, JobPublic, OcrStatus
from app.services.docker_manager import ContainerManagementError, DockerManager
from app.services.exporter import export_json, export_markdown, export_text
from app.services.job_manager import JobManager, JobNotFoundError, UploadValidationError


def create_api_router(
    settings: Settings,
    jobs: JobManager,
    docker_manager: DockerManager,
) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "version": settings.app_version,
        }

    @router.get("/ocr/status", response_model=OcrStatus)
    async def ocr_status() -> OcrStatus:
        return await docker_manager.status()

    @router.post("/ocr/start", response_model=OcrStatus, status_code=status.HTTP_202_ACCEPTED)
    async def start_ocr() -> OcrStatus:
        try:
            return await docker_manager.start()
        except ContainerManagementError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.post("/ocr/stop", response_model=OcrStatus)
    async def stop_ocr() -> OcrStatus:
        try:
            return await docker_manager.stop()
        except ContainerManagementError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.post("/jobs", response_model=JobPublic, status_code=status.HTTP_202_ACCEPTED)
    async def create_job(
        file: Annotated[UploadFile, File(description="PDF, image, or Office document")],
        dpi: Annotated[int, Form(ge=150, le=300)] = settings.default_dpi,
        page_concurrency: Annotated[int, Form(ge=1, le=4)] = settings.default_page_concurrency,
        max_tokens: Annotated[int, Form(ge=1024, le=32768)] = settings.default_max_tokens,
    ) -> JobPublic:
        try:
            options = JobOptions(
                dpi=dpi,
                page_concurrency=page_concurrency,
                max_tokens=max_tokens,
            )
            return await jobs.create(file, options)
        except UploadValidationError as exc:
            raise HTTPException(
                status_code=413 if "größer" in str(exc) else 400, detail=str(exc)
            ) from exc

    @router.get("/jobs/{job_id}", response_model=JobPublic)
    async def get_job(job_id: str) -> JobPublic:
        try:
            return jobs.get(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="OCR-Auftrag nicht gefunden.") from exc

    @router.delete("/jobs/{job_id}", response_model=JobPublic)
    async def cancel_job(job_id: str) -> JobPublic:
        try:
            return await jobs.cancel(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="OCR-Auftrag nicht gefunden.") from exc

    @router.get("/jobs/{job_id}/events")
    async def job_events(
        request: Request,
        job_id: str,
        last_event_id: Annotated[str | None, Header()] = None,
    ) -> StreamingResponse:
        try:
            after = max(0, int(last_event_id or "0"))
            jobs.get(job_id)
        except ValueError:
            after = 0
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="OCR-Auftrag nicht gefunden.") from exc

        async def stream() -> AsyncIterator[str]:
            async for record in jobs.events(job_id, after):
                if await request.is_disconnected():
                    return
                if record is None:
                    yield ": keep-alive\n\n"
                    continue
                payload = json.dumps(record.data, ensure_ascii=False, separators=(",", ":"))
                yield f"id: {record.id}\nevent: {record.event}\ndata: {payload}\n\n"

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.get("/jobs/{job_id}/export")
    async def export_job(
        job_id: str,
        format: Literal["markdown", "text", "json"] = "markdown",
    ) -> Response:
        try:
            job = jobs.get_internal(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="OCR-Auftrag nicht gefunden.") from exc
        if not any(page.markdown for page in job.pages):
            raise HTTPException(
                status_code=409, detail="Es liegt noch kein exportierbares Ergebnis vor."
            )

        stem = quote((job.filename.rsplit(".", 1)[0] or "ocr-result")[:120])
        if format == "json":
            content, extension, media_type = export_json(job), "json", "application/json"
        elif format == "text":
            content, extension, media_type = export_text(job), "txt", "text/plain"
        else:
            content, extension, media_type = export_markdown(job), "md", "text/markdown"
        return Response(
            content=content.encode("utf-8"),
            media_type=f"{media_type}; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{stem}.{extension}"},
        )

    return router
