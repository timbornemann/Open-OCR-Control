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
    BATCH_TERMINAL_STATUSES,
    TERMINAL_STATUSES,
    Batch,
    BatchPublic,
    BatchStatus,
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
from app.services.ocr_output import process_ocr_output
from app.services.output_filter import GroundingTokenFilter


class JobNotFoundError(KeyError):
    pass


class BatchNotFoundError(KeyError):
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
        self._batches: dict[str, Batch] = {}
        self._batch_conditions: dict[str, asyncio.Condition] = {}
        self._batch_tasks: dict[str, asyncio.Task[None]] = {}

    async def start(self) -> None:
        await asyncio.to_thread(self.settings.data_dir.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(self._remove_expired_directories)

    async def shutdown(self) -> None:
        tasks = {*self._tasks.values(), *self._batch_tasks.values()}
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def create(self, upload: UploadFile, options: JobOptions) -> JobPublic:
        self._validate_options(options)
        job, _size = await self._store_upload(upload, options)
        self._schedule_job(job)
        return job.public()

    async def create_batch(
        self,
        uploads: list[UploadFile],
        options: JobOptions,
    ) -> BatchPublic:
        self._validate_options(options)
        if not uploads:
            raise UploadValidationError("Mindestens eine Datei ist erforderlich.")
        if len(uploads) > self.settings.max_batch_files:
            raise UploadValidationError(
                f"Ein Batch darf höchstens {self.settings.max_batch_files} Dateien enthalten."
            )

        batch_id = uuid.uuid4().hex
        work_dir = self.settings.data_dir / f"batch-{batch_id}"
        work_dir.mkdir(parents=True, exist_ok=False)
        created_jobs: list[Job] = []
        total_size = 0
        try:
            for upload in uploads:
                job, size = await self._store_upload(upload, options, batch_id=batch_id)
                created_jobs.append(job)
                total_size += size
                if total_size > self.settings.max_batch_upload_bytes:
                    raise UploadValidationError(
                        "Die Batch-Dateien sind zusammen größer als "
                        f"{self.settings.max_batch_upload_mb} MB."
                    )
        except Exception:
            for upload in uploads:
                await upload.close()
            for job in created_jobs:
                self._jobs.pop(job.id, None)
                self._conditions.pop(job.id, None)
                shutil.rmtree(job.work_dir, ignore_errors=True)
            shutil.rmtree(work_dir, ignore_errors=True)
            raise

        batch = Batch(
            id=batch_id,
            job_ids=[job.id for job in created_jobs],
            work_dir=work_dir,
        )
        self._batches[batch_id] = batch
        self._batch_conditions[batch_id] = asyncio.Condition()
        await self._emit_batch(batch, "batch_status", self._batch_status_data(batch))
        task = asyncio.create_task(self._run_batch(batch), name=f"ocr-batch-{batch_id}")
        self._batch_tasks[batch_id] = task

        def discard_batch_task(_task: asyncio.Task[None]) -> None:
            self._batch_tasks.pop(batch_id, None)

        task.add_done_callback(discard_batch_task)
        return self._batch_public(batch)

    async def _store_upload(
        self,
        upload: UploadFile,
        options: JobOptions,
        *,
        batch_id: str | None = None,
    ) -> tuple[Job, int]:
        filename = Path(upload.filename or "upload").name.replace("\x00", "").strip()
        if not filename:
            filename = "upload"
        extension = Path(filename).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise UploadValidationError(
                f"Dateityp {extension or '(ohne Endung)'} wird nicht unterstützt."
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
            batch_id=batch_id,
        )
        self._jobs[job_id] = job
        self._conditions[job_id] = asyncio.Condition()
        await self._emit(job, "job_status", self._status_data(job))
        return job, size

    def _schedule_job(self, job: Job) -> None:
        task = asyncio.create_task(self._run(job), name=f"ocr-job-{job.id}")
        self._tasks[job.id] = task

        def discard_job_task(_task: asyncio.Task[None]) -> None:
            self._tasks.pop(job.id, None)

        task.add_done_callback(discard_job_task)

    def _validate_options(self, options: JobOptions) -> None:
        if options.page_concurrency > self.settings.max_page_concurrency:
            raise UploadValidationError(
                f"Höchstens {self.settings.max_page_concurrency} Seiten dürfen parallel laufen."
            )
        if options.max_tokens > self.settings.max_output_tokens:
            raise UploadValidationError(
                f"Höchstens {self.settings.max_output_tokens} Ausgabetokens sind erlaubt."
            )

    def get(self, job_id: str) -> JobPublic:
        return self._job(job_id).public()

    def get_internal(self, job_id: str) -> Job:
        return self._job(job_id)

    def get_batch(self, batch_id: str) -> BatchPublic:
        return self._batch_public(self._batch(batch_id))

    def get_batch_internal(self, batch_id: str) -> Batch:
        return self._batch(batch_id)

    def get_batch_jobs(self, batch_id: str) -> list[Job]:
        batch = self._batch(batch_id)
        return [self._job(job_id) for job_id in batch.job_ids]

    async def cancel(self, job_id: str) -> JobPublic:
        job = self._job(job_id)
        if job.batch_id is not None:
            await self.cancel_batch(job.batch_id)
            return job.public()
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        return job.public()

    async def cancel_batch(self, batch_id: str) -> BatchPublic:
        batch = self._batch(batch_id)
        task = self._batch_tasks.get(batch_id)
        if task and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        return self._batch_public(batch)

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

    async def batch_events(
        self, batch_id: str, after_event_id: int = 0
    ) -> AsyncIterator[EventRecord | None]:
        batch = self._batch(batch_id)
        condition = self._batch_conditions[batch_id]
        cursor = after_event_id
        while True:
            records = [record for record in batch.events if record.id > cursor]
            if records:
                for record in records:
                    cursor = record.id
                    yield record
                continue
            if batch.status in BATCH_TERMINAL_STATUSES:
                return
            async with condition:
                records = [record for record in batch.events if record.id > cursor]
                if records:
                    continue
                try:
                    await asyncio.wait_for(condition.wait(), timeout=15)
                except TimeoutError:
                    yield None

    async def _run_batch(self, batch: Batch) -> None:
        try:
            await self._set_batch_status(
                batch,
                BatchStatus.PROCESSING,
                f"{len(batch.job_ids)} Datei(en) warten auf sequenzielle Verarbeitung",
            )
            for index, job_id in enumerate(batch.job_ids, start=1):
                job = self._job(job_id)
                batch.current_job_id = job.id
                batch.message = f"Datei {index} von {len(batch.job_ids)} wird verarbeitet"
                batch.updated_at = datetime.now(UTC)
                await self._emit_batch(
                    batch,
                    "batch_progress",
                    self._batch_status_data(batch),
                )
                await self._run(job)
                if job.status == JobStatus.COMPLETED:
                    batch.completed_files += 1
                else:
                    batch.failed_files += 1
                finished = batch.completed_files + batch.failed_files
                batch.progress = finished / max(len(batch.job_ids), 1)
                batch.updated_at = datetime.now(UTC)
                await self._emit_batch(
                    batch,
                    "batch_progress",
                    self._batch_status_data(batch),
                )

            batch.current_job_id = None
            if batch.completed_files == 0:
                await self._set_batch_status(
                    batch,
                    BatchStatus.FAILED,
                    "Keine Datei konnte erfolgreich verarbeitet werden",
                )
            else:
                message = f"{batch.completed_files} Datei(en) erfolgreich verarbeitet"
                if batch.failed_files:
                    message += f", {batch.failed_files} fehlgeschlagen"
                await self._set_batch_status(batch, BatchStatus.COMPLETED, message)
            await self._emit_batch(batch, "completed", self._batch_status_data(batch))
        except asyncio.CancelledError:
            batch.current_job_id = None
            for job_id in batch.job_ids:
                job = self._job(job_id)
                if job.status not in TERMINAL_STATUSES:
                    job.status = JobStatus.CANCELLED
                    job.message = "Verarbeitung abgebrochen"
                    job.updated_at = datetime.now(UTC)
                    await self._emit(job, "cancelled", self._status_data(job))
            await self._set_batch_status(
                batch,
                BatchStatus.CANCELLED,
                "Batch-Verarbeitung abgebrochen",
            )
            await self._emit_batch(batch, "cancelled", self._batch_status_data(batch))
            raise
        except Exception as exc:
            batch.current_job_id = None
            await self._set_batch_status(
                batch,
                BatchStatus.FAILED,
                f"Batch-Verarbeitung fehlgeschlagen: {exc}",
            )
            await self._emit_batch(
                batch,
                "failed",
                {**self._batch_status_data(batch), "error": str(exc)},
            )

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
            raw_chunks: list[str] = []
            cleaner = GroundingTokenFilter()
            pending: list[str] = []
            pending_length = 0
            try:
                async for delta in self.ocr_client.stream_page(image_path, job.options.max_tokens):
                    raw_chunks.append(delta)
                    cleaned = cleaner.feed(delta)
                    if not cleaned:
                        continue
                    pending.append(cleaned)
                    pending_length += len(cleaned)
                    if pending_length >= 96:
                        text = "".join(pending)
                        page.markdown += text
                        await self._emit(job, "page_delta", {"page": page.page, "delta": text})
                        pending.clear()
                        pending_length = 0
                remainder = cleaner.finish()
                if remainder:
                    pending.append(remainder)
                if pending:
                    text = "".join(pending)
                    page.markdown += text
                    await self._emit(job, "page_delta", {"page": page.page, "delta": text})
                processed = await asyncio.to_thread(
                    process_ocr_output,
                    "".join(raw_chunks),
                    image_path,
                    job.work_dir / "assets",
                    job.id,
                    page.page,
                )
                page.raw_markdown = processed.raw_markdown
                page.markdown = processed.markdown
                page.assets = processed.assets
                page.status = "completed"
                job.completed_pages += 1
                page.elapsed_seconds = round(time.monotonic() - started, 2)
                await self._emit(
                    job,
                    "page_completed",
                    {
                        "page": page.page,
                        "markdown": page.markdown,
                        "raw_markdown": page.raw_markdown,
                        "assets": [asset.model_dump() for asset in page.assets],
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

    async def _set_batch_status(
        self,
        batch: Batch,
        status: BatchStatus,
        message: str,
    ) -> None:
        batch.status = status
        batch.message = message
        if status == BatchStatus.COMPLETED:
            batch.progress = 1.0
        batch.updated_at = datetime.now(UTC)
        await self._emit_batch(batch, "batch_status", self._batch_status_data(batch))

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
        if job.batch_id is not None:
            batch = self._batches.get(job.batch_id)
            if batch is not None:
                await self._emit_batch(
                    batch,
                    "job_event",
                    {"job_id": job.id, "event": event, "data": data},
                )

    async def _emit_batch(
        self,
        batch: Batch,
        event: str,
        data: dict[str, object],
    ) -> None:
        record = EventRecord(id=batch.next_event_id, event=event, data=data)
        batch.next_event_id += 1
        batch.events.append(record)
        if len(batch.events) > self.settings.event_history_limit:
            del batch.events[: len(batch.events) - self.settings.event_history_limit]
        condition = self._batch_conditions.get(batch.id)
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

    @staticmethod
    def _batch_status_data(batch: Batch) -> dict[str, object]:
        return {
            "status": batch.status.value,
            "message": batch.message,
            "progress": round(batch.progress, 4),
            "total_files": len(batch.job_ids),
            "completed_files": batch.completed_files,
            "failed_files": batch.failed_files,
            "current_job_id": batch.current_job_id,
        }

    def _job(self, job_id: str) -> Job:
        try:
            return self._jobs[job_id]
        except KeyError as exc:
            raise JobNotFoundError(job_id) from exc

    def _batch(self, batch_id: str) -> Batch:
        try:
            return self._batches[batch_id]
        except KeyError as exc:
            raise BatchNotFoundError(batch_id) from exc

    def _batch_public(self, batch: Batch) -> BatchPublic:
        return batch.public([self._job(job_id).public() for job_id in batch.job_ids])

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
