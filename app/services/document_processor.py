from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path

import fitz
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
OFFICE_EXTENSIONS = {
    ".doc",
    ".docx",
    ".odt",
    ".rtf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".ods",
}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | OFFICE_EXTENSIONS | {".pdf"}


class DocumentError(ValueError):
    pass


class DocumentProcessor:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def prepare(self, source: Path, work_dir: Path, dpi: int) -> list[Path]:
        return await asyncio.to_thread(self._prepare_sync, source, work_dir, dpi)

    def _prepare_sync(self, source: Path, work_dir: Path, dpi: int) -> list[Path]:
        extension = source.suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            supported = ", ".join(sorted(ALLOWED_EXTENSIONS))
            raise DocumentError(
                f"Dateityp {extension or '(ohne Endung)'} wird nicht unterstützt. "
                f"Erlaubt: {supported}"
            )
        if not source.is_file() or source.stat().st_size == 0:
            raise DocumentError("Die hochgeladene Datei ist leer.")

        pages_dir = work_dir / "pages"
        pages_dir.mkdir(parents=True, exist_ok=True)

        if extension == ".pdf":
            self._validate_pdf_signature(source)
            return self._render_pdf(source, pages_dir, dpi)
        if extension in IMAGE_EXTENSIONS:
            return self._render_image(source, pages_dir)

        pdf_path = self._convert_office(source, work_dir / "converted")
        return self._render_pdf(pdf_path, pages_dir, dpi)

    @staticmethod
    def _validate_pdf_signature(source: Path) -> None:
        with source.open("rb") as handle:
            if handle.read(5) != b"%PDF-":
                raise DocumentError(
                    "Die Datei hat eine .pdf-Endung, ist aber keine gültige PDF-Datei."
                )

    def _render_pdf(self, source: Path, pages_dir: Path, dpi: int) -> list[Path]:
        try:
            document = fitz.open(source)
        except Exception as exc:
            raise DocumentError("Die PDF-Datei konnte nicht geöffnet werden.") from exc

        try:
            if document.needs_pass:
                raise DocumentError("Passwortgeschützte PDF-Dateien werden nicht unterstützt.")
            if document.page_count == 0:
                raise DocumentError("Die PDF-Datei enthält keine Seiten.")
            if document.page_count > self.settings.max_pages:
                raise DocumentError(
                    f"Die Datei hat {document.page_count} Seiten; maximal erlaubt sind "
                    f"{self.settings.max_pages}."
                )

            matrix = fitz.Matrix(dpi / 72, dpi / 72)
            output: list[Path] = []
            for page_number, page in enumerate(document, start=1):
                projected_pixels = page.rect.width * (dpi / 72) * page.rect.height * (dpi / 72)
                self._ensure_pixel_limit(projected_pixels, page_number)
                target = pages_dir / f"page-{page_number:04d}.jpg"
                pixmap = page.get_pixmap(matrix=matrix, alpha=False, colorspace=fitz.csRGB)
                pixmap.save(target, jpg_quality=92)
                output.append(target)
            return output
        finally:
            document.close()

    def _render_image(self, source: Path, pages_dir: Path) -> list[Path]:
        try:
            image = Image.open(source)
        except (UnidentifiedImageError, OSError) as exc:
            raise DocumentError(
                "Die Bilddatei ist beschädigt oder hat ein unbekanntes Format."
            ) from exc

        output: list[Path] = []
        try:
            frames = getattr(image, "n_frames", 1)
            if frames > self.settings.max_pages:
                raise DocumentError(
                    f"Das Bild hat {frames} Frames; maximal erlaubt sind {self.settings.max_pages}."
                )
            for frame_index in range(frames):
                image.seek(frame_index)
                self._ensure_pixel_limit(image.width * image.height, frame_index + 1)
                frame = ImageOps.exif_transpose(image.copy())
                if frame.mode in {"RGBA", "LA"}:
                    background = Image.new("RGB", frame.size, "white")
                    alpha = frame.getchannel("A")
                    background.paste(frame.convert("RGB"), mask=alpha)
                    frame = background
                else:
                    frame = frame.convert("RGB")
                target = pages_dir / f"page-{frame_index + 1:04d}.jpg"
                frame.save(target, format="JPEG", quality=94, optimize=True)
                output.append(target)
        except (OSError, Image.DecompressionBombError) as exc:
            raise DocumentError("Das Bild konnte nicht sicher verarbeitet werden.") from exc
        finally:
            image.close()
        return output

    def _ensure_pixel_limit(self, pixels: float, page_number: int) -> None:
        limit = self.settings.max_render_megapixels * 1_000_000
        if pixels > limit:
            megapixels = round(pixels / 1_000_000, 1)
            raise DocumentError(
                f"Seite {page_number} würde {megapixels} Megapixel erzeugen; "
                f"erlaubt sind {self.settings.max_render_megapixels}."
            )

    def _convert_office(self, source: Path, output_dir: Path) -> Path:
        executable = shutil.which("soffice") or shutil.which("libreoffice")
        if executable is None:
            raise DocumentError(
                "Office-Konvertierung ist nicht installiert. Verwende das App-Container-Image "
                "oder lade eine PDF hoch."
            )
        output_dir.mkdir(parents=True, exist_ok=True)
        profile = output_dir / "lo-profile"
        profile.mkdir(exist_ok=True)
        environment = os.environ.copy()
        environment.update({"HOME": str(output_dir), "TMPDIR": str(output_dir)})
        command = [
            executable,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nolockcheck",
            f"-env:UserInstallation={profile.resolve().as_uri()}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(source),
        ]
        try:
            result = subprocess.run(  # noqa: S603 - fixed executable and argument vector, no shell
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=self.settings.office_timeout_seconds,
                env=environment,
            )
        except subprocess.TimeoutExpired as exc:
            raise DocumentError(
                "Die Office-Konvertierung hat das Zeitlimit überschritten."
            ) from exc

        candidates = [path for path in output_dir.glob("*.pdf") if path.is_file()]
        if result.returncode != 0 or not candidates:
            detail = (result.stderr or result.stdout).strip()[-300:]
            suffix = f" ({detail})" if detail else ""
            raise DocumentError(
                f"Das Office-Dokument konnte nicht in PDF konvertiert werden{suffix}."
            )
        return candidates[0]
