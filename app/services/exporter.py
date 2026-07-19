from __future__ import annotations

import json
import os
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from app.models import Batch, Job
from app.services.output_filter import markdown_to_text


def export_markdown(job: Job) -> str:
    parts: list[str] = []
    for page in job.pages:
        markdown = page.raw_markdown or page.markdown
        if not markdown:
            continue
        if parts:
            parts.append("\n\n---\n\n")
        parts.append(f"<!-- Page {page.page} -->\n\n{markdown.strip()}")
    return "".join(parts).strip() + "\n"


def export_complete_markdown(job: Job) -> str:
    parts: list[str] = []
    for page in job.pages:
        if not page.markdown:
            continue
        if parts:
            parts.append("\n\n---\n\n")
        portable = _portable_markdown(job, page.markdown)
        parts.append(f"<!-- Page {page.page} -->\n\n{portable.strip()}")
    return "".join(parts).strip() + "\n"


def export_text(job: Job) -> str:
    pages = [
        markdown_to_text(page.raw_markdown or page.markdown)
        for page in job.pages
        if page.raw_markdown or page.markdown
    ]
    return "\n\n\f\n\n".join(pages).strip() + "\n"


def export_json(job: Job, *, portable: bool = False) -> str:
    pages = []
    for page in job.pages:
        page_payload = page.model_dump()
        if portable:
            page_payload["markdown"] = _portable_markdown(job, page.markdown)
        pages.append(page_payload)
    payload = {
        "schema_version": 1,
        "job_id": job.id,
        "source_filename": job.filename,
        "created_at": job.created_at.isoformat(),
        "exported_at": datetime.now(UTC).isoformat(),
        "status": job.status.value,
        "options": job.options.model_dump(),
        "pages": pages,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def write_job_archive(job: Job, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            _write_job_directory(archive, job, "")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def write_batch_archive(batch: Batch, jobs: list[Job], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    used_names: set[str] = set()
    manifest_jobs: list[dict[str, object]] = []
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            for index, job in enumerate(jobs, start=1):
                folder = _unique_name(_safe_stem(job.filename) or f"document-{index}", used_names)
                manifest_jobs.append(
                    {
                        "id": job.id,
                        "filename": job.filename,
                        "folder": folder,
                        "status": job.status.value,
                        "error": job.error,
                    }
                )
                if any(page.raw_markdown or page.markdown for page in job.pages):
                    _write_job_directory(archive, job, f"{folder}/")
                else:
                    archive.writestr(
                        f"{folder}/error.txt",
                        (job.error or "No exportable OCR result was produced.") + "\n",
                    )
            manifest = {
                "schema_version": 1,
                "batch_id": batch.id,
                "created_at": batch.created_at.isoformat(),
                "exported_at": datetime.now(UTC).isoformat(),
                "status": batch.status.value,
                "jobs": manifest_jobs,
            }
            archive.writestr(
                "manifest.json",
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _write_job_directory(archive: ZipFile, job: Job, prefix: str) -> None:
    archive.writestr(f"{prefix}document.md", export_complete_markdown(job))
    archive.writestr(f"{prefix}document.txt", export_text(job))
    archive.writestr(f"{prefix}result.json", export_json(job, portable=True))
    known_assets = {asset.filename for page in job.pages for asset in page.assets}
    for filename in sorted(known_assets):
        source = job.work_dir / "assets" / filename
        if source.is_file():
            archive.write(source, f"{prefix}assets/{filename}")


def _portable_markdown(job: Job, markdown: str) -> str:
    prefix = f"/api/jobs/{job.id}/assets/"
    return markdown.replace(prefix, "assets/")


def _safe_stem(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", "_", stem).strip(" .")
    return stem[:100]


def _unique_name(value: str, used: set[str]) -> str:
    candidate = value
    counter = 2
    while candidate.casefold() in used:
        candidate = f"{value}-{counter}"
        counter += 1
    used.add(candidate.casefold())
    return candidate
