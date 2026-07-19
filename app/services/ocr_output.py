from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from app.models import PageAsset
from app.services.output_filter import clean_markdown

REF_DETECTION_PATTERN = re.compile(
    r"<\|ref\|>(?P<label>.*?)<\|/ref\|>\s*<\|det\|>(?P<detection>.*?)<\|/det\|>",
    re.DOTALL,
)
BARE_DETECTION_PATTERN = re.compile(
    r"<\|det\|>\s*(?P<label>[A-Za-z_][\w-]*)\s*(?P<boxes>\[[^<]+\])\s*<\|/det\|>",
    re.DOTALL,
)


@dataclass(frozen=True, slots=True)
class ProcessedOcrPage:
    raw_markdown: str
    markdown: str
    assets: list[PageAsset]


def process_ocr_output(
    raw: str,
    image_path: Path,
    assets_dir: Path,
    job_id: str,
    page_number: int,
) -> ProcessedOcrPage:
    """Convert Unlimited-OCR grounding into local, portable image assets.

    Unlimited-OCR uses coordinates normalized to 0..999. This mirrors the
    upstream ``save_results`` behavior without loading model code in the app.
    """

    assets_dir.mkdir(parents=True, exist_ok=True)
    assets: list[PageAsset] = []
    page_image: Image.Image | None = None

    def image_links(boxes_text: str) -> str:
        nonlocal page_image
        boxes = _parse_boxes(boxes_text)
        if boxes and page_image is None:
            with Image.open(image_path) as source:
                page_image = source.convert("RGB")
        links: list[str] = []
        for box in boxes:
            if page_image is None:
                break
            crop = _crop_box(page_image, box)
            if crop is None:
                continue
            asset_index = len(assets) + 1
            filename = f"page-{page_number:04d}-image-{asset_index:03d}.jpg"
            target = assets_dir / filename
            crop.save(target, format="JPEG", quality=92, optimize=True)
            asset = PageAsset(
                filename=filename,
                width=crop.width,
                height=crop.height,
            )
            assets.append(asset)
            alt = f"Image from page {page_number}"
            links.append(f"![{alt}](/api/jobs/{job_id}/assets/{filename})")
        return "\n\n".join(links)

    def replace_ref(match: re.Match[str]) -> str:
        label = match.group("label").strip()
        detection = match.group("detection").strip()
        if label.casefold() == "image":
            return image_links(detection)
        return label

    rich = REF_DETECTION_PATTERN.sub(replace_ref, raw)

    def replace_bare(match: re.Match[str]) -> str:
        if match.group("label").casefold() == "image":
            return image_links(match.group("boxes"))
        return ""

    rich = BARE_DETECTION_PATTERN.sub(replace_bare, rich)
    rich = _normalize_markdown(clean_markdown(rich))

    def raw_ref(match: re.Match[str]) -> str:
        label = match.group("label").strip()
        return "" if label.casefold() == "image" else label

    raw_markdown = REF_DETECTION_PATTERN.sub(raw_ref, raw)
    raw_markdown = BARE_DETECTION_PATTERN.sub("", raw_markdown)
    raw_markdown = _normalize_markdown(clean_markdown(raw_markdown))
    return ProcessedOcrPage(
        raw_markdown=raw_markdown,
        markdown=rich,
        assets=assets,
    )


def _parse_boxes(value: str) -> list[tuple[float, float, float, float]]:
    start = value.find("[")
    if start < 0:
        return []
    try:
        parsed = ast.literal_eval(value[start:])
    except (SyntaxError, ValueError):
        return []
    if _is_box(parsed):
        parsed = [parsed]
    if not isinstance(parsed, list):
        return []
    boxes: list[tuple[float, float, float, float]] = []
    for candidate in parsed:
        if _is_box(candidate):
            boxes.append(tuple(float(number) for number in candidate))  # type: ignore[arg-type]
    return boxes


def _is_box(value: object) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) == 4
        and all(isinstance(number, (int, float)) for number in value)
    )


def _crop_box(
    image: Image.Image,
    box: tuple[float, float, float, float],
) -> Image.Image | None:
    x1, y1, x2, y2 = (max(0.0, min(999.0, value)) for value in box)
    left, right = sorted((round(x1 / 999 * image.width), round(x2 / 999 * image.width)))
    top, bottom = sorted((round(y1 / 999 * image.height), round(y2 / 999 * image.height)))
    left = max(0, min(image.width, left))
    right = max(0, min(image.width, right))
    top = max(0, min(image.height, top))
    bottom = max(0, min(image.height, bottom))
    if right - left < 4 or bottom - top < 4:
        return None
    return image.crop((left, top, right, bottom))


def _normalize_markdown(value: str) -> str:
    return value.replace("\\coloneqq", ":=").replace("\\eqqcolon", "=:").strip()
