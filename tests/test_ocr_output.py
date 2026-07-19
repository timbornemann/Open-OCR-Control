from pathlib import Path

from PIL import Image

from app.services.ocr_output import process_ocr_output


def test_process_ocr_output_crops_image_regions_and_builds_preview_links(
    tmp_path: Path,
) -> None:
    page = tmp_path / "page.jpg"
    Image.new("RGB", (200, 100), "white").save(page)
    raw = (
        "Before\n"
        "<|ref|>image<|/ref|><|det|>[[100, 200, 600, 700]]<|/det|>\n"
        "<|det|>text [10, 10, 90, 40]<|/det|>After"
    )

    result = process_ocr_output(raw, page, tmp_path / "assets", "job-1", 3)

    assert result.raw_markdown == "Before\n\nAfter"
    assert "![Image from page 3](/api/jobs/job-1/assets/page-0003-image-001.jpg)" in (
        result.markdown
    )
    assert result.markdown.startswith("Before")
    assert result.markdown.endswith("After")
    assert len(result.assets) == 1
    assert result.assets[0].filename == "page-0003-image-001.jpg"
    crop = Image.open(tmp_path / "assets" / result.assets[0].filename)
    assert crop.size == (100, 50)
    crop.close()


def test_process_ocr_output_supports_bare_image_detections(tmp_path: Path) -> None:
    page = tmp_path / "page.jpg"
    Image.new("RGB", (100, 100), "white").save(page)

    result = process_ocr_output(
        "<|det|>image [0, 0, 999, 999]<|/det|>",
        page,
        tmp_path / "assets",
        "job-2",
        1,
    )

    assert len(result.assets) == 1
    assert result.raw_markdown == ""
    assert "page-0001-image-001.jpg" in result.markdown
