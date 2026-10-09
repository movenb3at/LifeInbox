import io
from datetime import datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError

from app.automation.images import MAX_IMAGE_BYTES, validate_image
from app.automation.integrations.base import NormalizedContent
from app.automation.parsing.service import parse_many
from app.schemas.automation import ScreenshotResult, ScreenshotText


def image_bytes(format="PNG", size=(20, 20)):
    buffer = io.BytesIO()
    Image.new("RGB", size, "white").save(buffer, format=format)
    return buffer.getvalue()


@pytest.mark.parametrize("format,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
def test_image_preserves_original_and_checks_actual_format(format, mime):
    original = image_bytes(format)
    result = validate_image(original, mime)
    assert result.data == original and result.mime == mime
    assert result.width == result.height == 20 and len(result.digest) == 64


@pytest.mark.parametrize("data,mime,status", [
    (b"", "image/png", 413), (b"x" * (MAX_IMAGE_BYTES + 1), "image/png", 413),
    (b"<svg></svg>", "image/svg+xml", 415), (b"not an image", "image/png", 422),
    (image_bytes(), "image/jpeg", 415),
], ids=["empty", "oversized", "unsupported", "corrupt", "mismatched"])
def test_invalid_image_rejected(data, mime, status):
    with pytest.raises(HTTPException) as error:
        validate_image(data, mime)
    assert error.value.status_code == status


def test_large_dimensions_and_animated_image_rejected():
    with pytest.raises(HTTPException) as error:
        validate_image(image_bytes(size=(5001, 5000)), "image/png")
    assert error.value.status_code == 422
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(buffer, format="PNG", save_all=True,
        append_images=[Image.new("RGB", (20, 20), "black")], duration=100)
    with pytest.raises(HTTPException) as error:
        validate_image(buffer.getvalue(), "image/png")
    assert error.value.status_code == 422


def test_ocr_output_validation_and_corrected_text_limit():
    token = uuid4()
    for payload in [{"text": "   ", "confidence": 50}, {"text": "입금", "confidence": 101},
                    {"text": "입금", "confidence": float("nan")}, {"text": "x" * 50001, "confidence": 50}]:
        with pytest.raises(ValidationError):
            ScreenshotResult(claim_token=token, **payload)
    with pytest.raises(ValidationError):
        ScreenshotText(text="x" * 10001)


def test_screenshot_layout_lines_remain_one_document():
    source = NormalizedContent("screenshot", "", "", "학교 납부 안내\n10월 20일까지 35,000원 입금해주세요.",
        datetime.fromisoformat("2026-10-06T10:00:00+09:00"), {})
    candidates = parse_many(source)
    assert len(candidates) == 1
    assert candidates[0].fields.title == "학교 납부 안내"
    assert candidates[0].fields.deadline.isoformat() == "2026-10-20"
    assert str(candidates[0].fields.amount) == "35000"
