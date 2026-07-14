import asyncio
from io import BytesIO
from pathlib import Path

import pytest
from starlette.datastructures import UploadFile

from app.config import Settings
from app.models import JobOptions, JobStatus
from app.services.job_manager import JobManager


class FakeProcessor:
    async def prepare(self, _source: Path, work_dir: Path, _dpi: int) -> list[Path]:
        pages = work_dir / "pages"
        pages.mkdir()
        result = []
        for number in range(2):
            path = pages / f"{number}.jpg"
            path.write_bytes(b"image")
            result.append(path)
        return result


class FakeOcr:
    async def stream_page(self, image: Path, _max_tokens: int):  # type: ignore[no-untyped-def]
        yield f"Text {image.stem}"


class FakeDocker:
    async def ensure_ready(self) -> None:
        return None


@pytest.mark.asyncio
async def test_job_runs_pages_and_emits_terminal_event(tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path, max_page_concurrency=2)
    manager = JobManager(
        settings,
        FakeProcessor(),  # type: ignore[arg-type]
        FakeOcr(),  # type: ignore[arg-type]
        FakeDocker(),  # type: ignore[arg-type]
    )
    await manager.start()
    upload = UploadFile(filename="scan.pdf", file=BytesIO(b"%PDF-test"))
    created = await manager.create(upload, JobOptions(dpi=200, page_concurrency=2, max_tokens=4096))

    for _ in range(100):
        result = manager.get(created.id)
        if result.status in {JobStatus.COMPLETED, JobStatus.FAILED}:
            break
        await asyncio.sleep(0.01)

    assert result.status == JobStatus.COMPLETED
    assert [page.markdown for page in result.pages] == ["Text 0", "Text 1"]
    assert result.completed_pages == 2
    assert any(event.event == "completed" for event in manager.get_internal(created.id).events)
    await manager.shutdown()
