import hashlib
import io
import warnings
from dataclasses import dataclass

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 25_000_000
MIMES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


@dataclass
class ValidImage:
    data: bytes
    digest: str
    mime: str
    width: int
    height: int


def validate_image(data: bytes, mime: str) -> ValidImage:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "이미지는 5 MiB 이하로 선택해주세요.")
    if mime not in MIMES.values():
        raise HTTPException(415, "PNG·JPEG·WebP 이미지만 지원합니다.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                actual = MIMES.get(image.format)
                width, height = image.size
                if actual != mime:
                    raise HTTPException(415, "파일 내용과 이미지 형식이 일치하지 않습니다.")
                if width * height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                    raise HTTPException(422, "단일 이미지와 25백만 픽셀 이하의 이미지만 지원합니다.")
                image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(422, "손상되었거나 지원하지 않는 이미지입니다.") from exc
    return ValidImage(data, hashlib.sha256(data).hexdigest(), actual, width, height)
