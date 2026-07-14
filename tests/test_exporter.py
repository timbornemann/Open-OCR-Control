from pathlib import Path

from app.models import Job, JobOptions, JobStatus, PageResult
from app.services.exporter import export_json, export_markdown, export_text


def make_job(tmp_path: Path) -> Job:
    return Job(
        id="job-1",
        filename="beispiel.pdf",
        source_path=tmp_path / "source.pdf",
        work_dir=tmp_path,
        options=JobOptions(),
        status=JobStatus.COMPLETED,
        pages=[
            PageResult(page=1, status="completed", markdown="# Eins\n\nText"),
            PageResult(page=2, status="completed", markdown="## Zwei"),
        ],
    )


def test_exports_supported_formats(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    assert "<!-- Seite 1 -->" in export_markdown(job)
    assert "\f" in export_text(job)
    assert '"schema_version": 1' in export_json(job)
