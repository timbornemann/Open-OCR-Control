from pathlib import Path

import fitz
from PIL import Image

from app.config import Settings
from app.services.document_processor import DocumentProcessor


def test_renders_pdf_pages(tmp_path: Path) -> None:
    source = tmp_path / "sample.pdf"
    document = fitz.open()
    document.new_page().insert_text((72, 72), "Seite eins")
    document.new_page().insert_text((72, 72), "Seite zwei")
    document.save(source)
    document.close()

    processor = DocumentProcessor(Settings(data_dir=tmp_path))
    pages = processor._prepare_sync(source, tmp_path / "work", 150)

    assert [page.name for page in pages] == ["page-0001.jpg", "page-0002.jpg"]
    assert all(page.stat().st_size > 0 for page in pages)


def test_normalizes_transparent_image(tmp_path: Path) -> None:
    source = tmp_path / "transparent.png"
    Image.new("RGBA", (40, 30), (0, 0, 0, 0)).save(source)

    processor = DocumentProcessor(Settings(data_dir=tmp_path))
    pages = processor._prepare_sync(source, tmp_path / "work", 200)

    with Image.open(pages[0]) as result:
        assert result.mode == "RGB"
        assert result.size == (40, 30)
