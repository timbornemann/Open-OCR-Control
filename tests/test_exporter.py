from pathlib import Path
from zipfile import ZipFile

from app.models import Job, JobOptions, JobStatus, PageAsset, PageResult
from app.services.exporter import (
    export_json,
    export_markdown,
    export_text,
    write_job_archive,
)


def make_job(tmp_path: Path) -> Job:
    return Job(
        id="job-1",
        filename="beispiel.pdf",
        source_path=tmp_path / "source.pdf",
        work_dir=tmp_path,
        options=JobOptions(),
        status=JobStatus.COMPLETED,
        pages=[
            PageResult(
                page=1,
                status="completed",
                raw_markdown="# Eins\n\nText",
                markdown=(
                    "# Eins\n\nText\n\n![Image](/api/jobs/job-1/assets/page-0001-image-001.jpg)"
                ),
                assets=[
                    PageAsset(
                        filename="page-0001-image-001.jpg",
                        width=10,
                        height=10,
                    )
                ],
            ),
            PageResult(
                page=2,
                status="completed",
                raw_markdown="## Zwei",
                markdown="## Zwei",
            ),
        ],
    )


def test_exports_supported_formats(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    assert "<!-- Page 1 -->" in export_markdown(job)
    assert "/api/jobs/" not in export_markdown(job)
    assert "\f" in export_text(job)
    assert '"schema_version": 1' in export_json(job)


def test_complete_archive_contains_portable_markdown_and_assets(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "page-0001-image-001.jpg").write_bytes(b"jpeg")
    destination = tmp_path / "complete.zip"

    write_job_archive(job, destination)

    with ZipFile(destination) as archive:
        assert set(archive.namelist()) == {
            "document.md",
            "document.txt",
            "result.json",
            "assets/page-0001-image-001.jpg",
        }
        markdown = archive.read("document.md").decode()
        assert "![Image](assets/page-0001-image-001.jpg)" in markdown
        assert "/api/jobs/" not in markdown
