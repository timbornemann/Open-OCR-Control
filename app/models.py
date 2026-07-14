from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class JobStatus(StrEnum):
    QUEUED = "queued"
    PREPARING = "preparing"
    WAITING_FOR_OCR = "waiting_for_ocr"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


class PageResult(BaseModel):
    page: int
    status: str = "pending"
    markdown: str = ""
    error: str | None = None
    elapsed_seconds: float | None = None


class JobOptions(BaseModel):
    dpi: int = Field(default=200, ge=150, le=300)
    page_concurrency: int = Field(default=2, ge=1, le=4)
    max_tokens: int = Field(default=8192, ge=1024, le=32768)


class JobPublic(BaseModel):
    id: str
    filename: str
    status: JobStatus
    message: str
    progress: float
    created_at: datetime
    updated_at: datetime
    total_pages: int
    completed_pages: int
    failed_pages: int
    pages: list[PageResult]
    options: JobOptions
    error: str | None = None


class OcrStatus(BaseModel):
    state: str
    ready: bool
    managed: bool
    message: str
    model: str
    container_status: str | None = None


class EventRecord(BaseModel):
    id: int
    event: str
    data: dict[str, Any]


@dataclass(slots=True)
class Job:
    id: str
    filename: str
    source_path: Path
    work_dir: Path
    options: JobOptions
    status: JobStatus = JobStatus.QUEUED
    message: str = "Auftrag angenommen"
    progress: float = 0.0
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    total_pages: int = 0
    completed_pages: int = 0
    failed_pages: int = 0
    pages: list[PageResult] = field(default_factory=list)
    error: str | None = None
    events: list[EventRecord] = field(default_factory=list)
    next_event_id: int = 1

    def public(self) -> JobPublic:
        return JobPublic(
            id=self.id,
            filename=self.filename,
            status=self.status,
            message=self.message,
            progress=self.progress,
            created_at=self.created_at,
            updated_at=self.updated_at,
            total_pages=self.total_pages,
            completed_pages=self.completed_pages,
            failed_pages=self.failed_pages,
            pages=self.pages,
            options=self.options,
            error=self.error,
        )
