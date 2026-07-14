from __future__ import annotations

import json
from datetime import UTC, datetime

from app.models import Job
from app.services.output_filter import markdown_to_text


def export_markdown(job: Job) -> str:
    parts: list[str] = []
    for page in job.pages:
        if not page.markdown:
            continue
        if parts:
            parts.append("\n\n---\n\n")
        parts.append(f"<!-- Seite {page.page} -->\n\n{page.markdown.strip()}")
    return "".join(parts).strip() + "\n"


def export_text(job: Job) -> str:
    pages = [markdown_to_text(page.markdown) for page in job.pages if page.markdown]
    return "\n\n\f\n\n".join(pages).strip() + "\n"


def export_json(job: Job) -> str:
    payload = {
        "schema_version": 1,
        "job_id": job.id,
        "source_filename": job.filename,
        "created_at": job.created_at.isoformat(),
        "exported_at": datetime.now(UTC).isoformat(),
        "status": job.status.value,
        "options": job.options.model_dump(),
        "pages": [page.model_dump() for page in job.pages],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
