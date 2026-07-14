from __future__ import annotations

import asyncio
import contextlib
import shutil
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import UploadFile

from app.config import Settings
from app.models import (
    TERMINAL_STATUSES,
    EventRecord,
    Job,
    JobOptions,
    JobPublic,
    JobStatus,
    PageResult,
)
from app.services.docker_manager import DockerManager
from app.services.document_processor import ALLOWED_EXTENSIONS, DocumentProcessor
from app.services.ocr_client import OcrClient


class JobNotFoundError(KeyError):
    pass


class UploadValidationError(ValueError):
    pass


class JobManager:
    def __init__(
        self,
        settings: Settings,
        document_processor: DocumentProcessor,
        ocr_client: OcrClient,
        docker_manager: DockerManager,
    ) -> None:
        self.settings = settings
        self.document_processor = document_processor
        self.ocr_client = ocr_client
        self.docker_manager = docker_manager
        self._jobs: dict[str, Job] = {}
        self._conditions: dict[str, asyncio.Condition] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def start(self) -> None:
        await asyncio.to_thread(self.settings.data_dir.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(self._remove_expired_directories)

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    async def create(self, upload: UploadFile, options: JobOptions) -> JobPublic:
        filename = Path(upload.filename or "upload").name.replace("\x00", "").strip()
        if not filename:
            filename = "upload"
        extension = Path(filename).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise UploadValidationError(
                f"Dateityp {extension or '(ohne Endung)'} wird nicht unterstützt."
            )
        if options.page_concurrency > self.settings.max_page_concurrency:
            raise UploadValidationError(
                f"Höchstens {self.settings.max_page_concurrency} Seiten dürfen parallel laufen."
            )
        if options.max_tokens > self.settings.max_output_tokens:
            raise UploadValidationError(
                f"Höchstens {self.settings.max_output_tokens} Ausgabetokens sind erlaubt."
            )

        job_id = uuid.uuid4().hex
        work_dir = self.settings.data_dir / job_id
        work_dir.mkdir(parents=True, exist_ok=False)
        source_path = work_dir / f"source{extension}"
        size = 0
        try:
            with source_path.open("wb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.settings.max_upload_bytes:
                        raise UploadValidationError(
                            f"Die Datei ist größer als {self.settings.max_upload_mb} MB."
                        )
                    target.write(chunk)
        except Exception:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise
        finally:
            await upload.close()
        if size == 0:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise UploadValidationError("Die hochgeladene Datei ist leer.")

        job = Job(
            id=job_id,
            filename=filename[:255],
            source_path=source_path,
            work_dir=work_dir,
            options=options,
        )
        self._jobs[job_id] = job
        self._conditions[job_id] = asyncio.Condition()
        await self._emit(job, "job_status", self._status_data(job))
        task = asyncio.create_task(self._run(job), name=f"ocr-job-{job_id}")
        self._tasks[job_id] = task
        task.add_done_callback(lambda _task: self._tasks.pop(job_id, None))
        return job.public()

    def get(self, job_id: str) -> JobPublic:
        return self._job(job_id).public()

    def get_internal(self, job_id: str) -> Job:
        return self._job(job_id)

    async def cancel(self, job_id: str) -> JobPublic:
        job = self._job(job_id)
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        return job.public()

    async def events(
        self, job_id: str, after_event_id: int = 0
    ) -> AsyncIterator[EventRecord | None]:
        job = self._job(job_id)
        condition = self._conditions[job_id]
        cursor = after_event_id
        while True:
            records = [record for record in job.events if record.id > cursor]
            if records:
                for record in records:
                    cursor = record.id
                    yield record
                continue
            if job.status in TERMINAL_STATUSES:
                return
            async with condition:
                records = [record for record in job.events if record.id > cursor]
                if records:
                    continue
                try:
                    await asyncio.wait_for(condition.wait(), timeout=15)
                except TimeoutError:
                    yield None

    async def _run(self, job: Job) -> None:
        model_task: asyncio.Task[None] | None = None
        try:
            await self._set_status(
                job,
                JobStatus.PREPARING,
                "Dokument wird vorbereitet und OCR-Modell geprüft",
                0.02,
            )
            pages_task = asyncio.create_task(
                self.document_processor.prepare(
                    job.source_path,
                    job.work_dir,
                    job.options.dpi,
                )
            )
            model_task = asyncio.create_task(self.docker_manager.ensure_ready())

            pages = await pages_task
            job.total_pages = len(pages)
            job.pages = [PageResult(page=index + 1) for index in range(len(pages))]
            await self._set_status(
                job,
                JobStatus.WAITING_FOR_OCR,
                f"{len(pages)} Seite(n) vorbereitet; OCR-Modell wird geladen",
                0.08,
            )
            await model_task
            await self._set_status(
                job,
                JobStatus.PROCESSING,
                f"OCR läuft für {len(pages)} Seite(n)",
                0.1,
            )

            semaphore = asyncio.Semaphore(job.options.page_concurrency)
            page_tasks = [
                asyncio.create_task(self._process_page(job, index, path, semaphore))
                for index, path in enumerate(pages)
            ]
            await asyncio.gather(*page_tasks)

            if job.failed_pages == job.total_pages:
                raise RuntimeError("Keine Seite konnte erfolgreich verarbeitet werden.")
            message = f"{job.completed_pages} Seite(n) erfolgreich verarbeitet"
            if job.failed_pages:
                message += f", {job.failed_pages} fehlgeschlagen"
            await self._set_status(job, JobStatus.COMPLETED, message, 1.0)
            await self._emit(job, "completed", self._status_data(job))
        except asyncio.CancelledError:
            await self._settle_background_task(model_task)
            await self._set_status(
                job, JobStatus.CANCELLED, "Verarbeitung abgebrochen", job.progress
            )
            await self._emit(job, "cancelled", self._status_data(job))
            raise
        except Exception as exc:
            await self._settle_background_task(model_task)
            job.error = str(exc)
            await self._set_status(
                job, JobStatus.FAILED, "Verarbeitung fehlgeschlagen", job.progress
            )
            await self._emit(job, "failed", {**self._status_data(job), "error": str(exc)})

    @staticmethod
    async def _settle_background_task(task: asyncio.Task[None] | None) -> None:
        if task is None:
            return
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def _process_page(
        self,
        job: Job,
        index: int,
        image_path: Path,
        semaphore: asyncio.Semaphore,
    ) -> None:
        page = job.pages[index]
        async with semaphore:
            page.status = "processing"
            started = time.monotonic()
            await self._emit(job, "page_started", {"page": page.page})
            chunks: list[str] = []
            pending: list[str] = []
            pending_length = 0
            try:
                async for delta in self.ocr_client.stream_page(image_path, job.options.max_tokens):
                    chunks.append(delta)
                    pending.append(delta)
                    pending_length += len(delta)
                    if pending_length >= 96:
                        text = "".join(pending)
                        page.markdown += text
                        await self._emit(job, "page_delta", {"page": page.page, "delta": text})
                        pending.clear()
                        pending_length = 0
                if pending:
                    text = "".join(pending)
                    page.markdown += text
                    await self._emit(job, "page_delta", {"page": page.page, "delta": text})
                page.markdown = "".join(chunks).strip()
                page.status = "completed"
                job.completed_pages += 1
                page.elapsed_seconds = round(time.monotonic() - started, 2)
                await self._emit(
                    job,
                    "page_completed",
                    {
                        "page": page.page,
                        "markdown": page.markdown,
                        "elapsed_seconds": page.elapsed_seconds,
                    },
                )
            except asyncio.CancelledError:
                page.status = "cancelled"
                raise
            except Exception as exc:
                page.status = "failed"
                page.error = str(exc)
                page.elapsed_seconds = round(time.monotonic() - started, 2)
                job.failed_pages += 1
                await self._emit(
                    job,
                    "page_failed",
                    {"page": page.page, "error": str(exc)},
                )
            finally:
                finished = job.completed_pages + job.failed_pages
                job.progress = 0.1 + (finished / max(job.total_pages, 1)) * 0.9
                job.updated_at = datetime.now(UTC)
                job.message = f"{finished} von {job.total_pages} Seite(n) abgeschlossen"
                await self._emit(job, "job_progress", self._status_data(job))

    async def _set_status(
        self,
        job: Job,
        status: JobStatus,
        message: str,
        progress: float,
    ) -> None:
        job.status = status
        job.message = message
        job.progress = progress
        job.updated_at = datetime.now(UTC)
        await self._emit(job, "job_status", self._status_data(job))

    async def _emit(self, job: Job, event: str, data: dict[str, object]) -> None:
        record = EventRecord(id=job.next_event_id, event=event, data=data)
        job.next_event_id += 1
        job.events.append(record)
        if len(job.events) > self.settings.event_history_limit:
            del job.events[: len(job.events) - self.settings.event_history_limit]
        condition = self._conditions.get(job.id)
        if condition is not None:
            async with condition:
                condition.notify_all()

    @staticmethod
    def _status_data(job: Job) -> dict[str, object]:
        return {
            "status": job.status.value,
            "message": job.message,
            "progress": round(job.progress, 4),
            "total_pages": job.total_pages,
            "completed_pages": job.completed_pages,
            "failed_pages": job.failed_pages,
        }

    def _job(self, job_id: str) -> Job:
        try:
            return self._jobs[job_id]
        except KeyError as exc:
            raise JobNotFoundError(job_id) from exc

    def _remove_expired_directories(self) -> None:
        if not self.settings.data_dir.exists():
            return
        cutoff = datetime.now(UTC) - timedelta(hours=self.settings.job_retention_hours)
        for path in self.settings.data_dir.iterdir():
            if not path.is_dir():
                continue
            modified = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            if modified < cutoff:
                shutil.rmtree(path, ignore_errors=True)
