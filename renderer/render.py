"""Independent, app-agnostic image-led slideshow renderer.

Input contract:
  {"slides": [{"headline": str, "body": str, "image_path": path,
               "source_ref": optional str, "image_sha256": optional hex,
               "crop": "cover", "text_position": "center"}],
   "width": 1080, "height": 1920}

Returns PNG byte strings and per-slide image provenance. No campaign strategy,
copy generation, external fetching, or app-specific assumptions are included.
"""

import hashlib
import io
import json
import re
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

DEFAULT_WIDTH = 1080
DEFAULT_HEIGHT = 1920
MIN_WIDTH = 320
MIN_HEIGHT = 480
MAX_DIMENSION = 4096
MIN_HEADLINE_FONT = 42
MIN_BODY_FONT = 30
TEXT_POSITIONS = {"center", "top", "bottom"}


def _font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    candidates = ["/usr/share/fonts/truetype/dejavu/" + name, name]
    try:
        from PIL import __file__ as pil_file
        candidates.append(str(Path(pil_file).parent / "fonts" / name))
    except (ImportError, NameError):
        pass
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    raise RuntimeError("A usable DejaVu Sans font is required for rendering.")


def _require_text(value, field, slide_number):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Slide {slide_number} {field} must be non-empty text.")
    return value.strip()


def _validate_dimensions(payload):
    width, height = payload.get("width", DEFAULT_WIDTH), payload.get("height", DEFAULT_HEIGHT)
    if (isinstance(width, bool) or isinstance(height, bool)
            or not isinstance(width, int) or not isinstance(height, int)
            or not MIN_WIDTH <= width <= MAX_DIMENSION
            or not MIN_HEIGHT <= height <= MAX_DIMENSION):
        raise ValueError(
            f"width and height must be integers between {MIN_WIDTH} and {MAX_DIMENSION} "
            f"(minimum height {MIN_HEIGHT})."
        )
    return width, height


def _wrap(draw, text, font, max_width):
    lines = []
    for paragraph in text.splitlines() or [""]:
        current = ""
        for word in paragraph.split():
            candidate = (current + " " + word).strip()
            if draw.textbbox((0, 0), candidate, font=font)[2] <= max_width:
                current = candidate
                continue
            if current:
                lines.append(current)
            if draw.textbbox((0, 0), word, font=font)[2] <= max_width:
                current = word
                continue
            part = ""
            for char in word:
                if part and draw.textbbox((0, 0), part + char, font=font)[2] > max_width:
                    lines.append(part)
                    part = char
                else:
                    part += char
            current = part
        if current:
            lines.append(current)
    return lines


def _fit_text(draw, text, max_width, max_height, start_size, min_size, bold):
    for size in range(start_size, min_size - 1, -2):
        font = _font(size, bold=bold)
        lines = _wrap(draw, text, font, max_width)
        bbox = font.getbbox("Ag")
        line_height = max(int(size * 1.28), bbox[3] - bbox[1])
        if len(lines) * line_height <= max_height:
            return font, lines, line_height
    raise ValueError("Text would overflow at the minimum readable font; shorten the copy.")


def _load_source_image(slide, slide_number):
    image_path = slide.get("image_path")
    if not isinstance(image_path, (str, Path)) or not str(image_path).strip():
        raise ValueError(f"Slide {slide_number} requires an image_path.")
    path = Path(image_path)
    try:
        raw = path.read_bytes()
    except (OSError, ValueError) as exc:
        raise ValueError(f"Slide {slide_number} image could not be read: {path}") from exc
    digest = hashlib.sha256(raw).hexdigest()
    expected = slide.get("image_sha256")
    if expected is not None:
        if not isinstance(expected, str) or re.fullmatch(r"[0-9a-fA-F]{64}", expected) is None:
            raise ValueError(f"Slide {slide_number} image_sha256 must be a 64-character SHA-256 hex digest.")
        if digest.lower() != expected.lower():
            raise ValueError(f"Slide {slide_number} image SHA-256 does not match the supplied file.")
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            opened.load()
            image = ImageOps.exif_transpose(opened).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Slide {slide_number} image is not a valid supported image.") from exc
    return image, digest


def _place_text(image, headline, body, text_position, slide_number):
    width, height = image.size
    margin = max(32, int(width * .075))
    panel_width = width - 2 * margin
    pad, gap = max(24, int(width * .045)), max(18, int(width * .035))
    headline_font, headline_lines, headline_line_height = _fit_text(
        ImageDraw.Draw(image), headline, panel_width - 2 * pad, int(height * .33),
        max(48, int(width * .083)), MIN_HEADLINE_FONT, True,
    )
    body_font, body_lines, body_line_height = _fit_text(
        ImageDraw.Draw(image), body, panel_width - 2 * pad, int(height * .25),
        max(34, int(width * .047)), MIN_BODY_FONT, False,
    )
    panel_height = pad + len(headline_lines) * headline_line_height + gap
    panel_height += len(body_lines) * body_line_height + pad
    if panel_height > height * .72:
        raise ValueError(f"Slide {slide_number} text would overflow; shorten the copy.")
    if text_position == "top":
        panel_top = int(height * .055)
    elif text_position == "bottom":
        panel_top = height - int(height * .055) - panel_height
    else:
        panel_top = (height - panel_height) // 2
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle(
        (margin, panel_top, width - margin, panel_top + panel_height),
        radius=max(12, int(width * .025)), fill=(9, 15, 19, 190),
    )
    image.alpha_composite(panel)
    draw = ImageDraw.Draw(image)
    y = panel_top + pad
    for line in headline_lines:
        draw.text((margin + pad, y), line, font=headline_font, fill=(255, 255, 255, 255))
        y += headline_line_height
    y += gap
    for line in body_lines:
        draw.text((margin + pad, y), line, font=body_font, fill=(245, 247, 248, 255))
        y += body_line_height


def render_slideshow(payload):
    if not isinstance(payload, dict):
        raise ValueError("Payload must be an object.")
    slides = payload.get("slides")
    if isinstance(slides, list) and slides and all(isinstance(item, str) for item in slides):
        raise ValueError("Text-only slides are unsupported; each slide requires an image. Provide image_path.")
    if not isinstance(slides, list) or not 1 <= len(slides) <= 20:
        raise ValueError("Provide 1–20 ordered slides.")
    width, height = _validate_dimensions(payload)
    output = []
    for index, raw_slide in enumerate(slides, start=1):
        if isinstance(raw_slide, str):
            legacy_title = payload.get("title", "") if index == 1 else ""
            raw_slide = {"headline": legacy_title or raw_slide, "body": raw_slide}
        elif isinstance(raw_slide, dict) and "headline" not in raw_slide and raw_slide.get("title"):
            raw_slide = dict(raw_slide, headline=raw_slide["title"], body=raw_slide.get("body") or "Illustrative slide.")
        slide = raw_slide
        if not isinstance(slide, dict):
            raise ValueError(f"Slide {index} must be an object.")
        headline = _require_text(slide.get("headline"), "headline", index)
        body = _require_text(slide.get("body"), "body", index)
        crop = slide.get("crop", "cover")
        if crop != "cover":
            raise ValueError(f"Slide {index} has unsupported crop; only 'cover' is supported.")
        text_position = slide.get("text_position", "center")
        if text_position not in TEXT_POSITIONS:
            raise ValueError(f"Slide {index} text_position must be one of top, center, bottom.")
        source_image, digest = _load_source_image(slide, index)
        image = ImageOps.fit(source_image, (width, height), method=Image.Resampling.LANCZOS).convert("RGBA")
        _place_text(image, headline, body, text_position, index)
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG", optimize=True)
        source_ref = slide.get("source_ref")
        if source_ref is not None and (not isinstance(source_ref, str) or not source_ref.strip()):
            raise ValueError(f"Slide {index} source_ref must be a non-empty string when provided.")
        output.append({
            "index": index, "width": width, "height": height, "png": buffer.getvalue(),
            "source_ref": source_ref, "image_sha256": digest,
        })
    return {"dimensions": {"width": width, "height": height}, "slides": output}


def export_slideshow_zip(rendered, output_path, source=None):
    if not isinstance(rendered, dict) or not rendered.get("slides"):
        raise ValueError("Render slides before exporting.")
    files, provenance = [], []
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for slide in rendered["slides"]:
            name = f"slide-{slide['index']:02d}.png"
            archive.writestr(name, slide["png"])
            files.append(name)
            provenance.append({
                "index": slide["index"], "file": name,
                "source_ref": slide.get("source_ref"),
                "image_sha256": slide.get("image_sha256"),
            })
        manifest = {
            "format": "app-agnostic-image-text-slideshow", "version": 1,
            "dimensions": rendered["dimensions"], "source": source or {},
            "files": files, "slides": provenance,
        }
        archive.writestr("manifest.json", json.dumps(manifest, indent=2, sort_keys=True))
    return Path(output_path)
