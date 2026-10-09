from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import Repo
from app.automation.images import MAX_IMAGE_BYTES, validate_image
from app.automation.screenshots import ScreenshotService
from app.schemas.automation import (
    ScreenshotClaim,
    ScreenshotFailure,
    ScreenshotOut,
    ScreenshotPage,
    ScreenshotResult,
    ScreenshotText,
)

router = APIRouter(prefix="/api/v1/automation/screenshots")


@router.post("", response_model=ScreenshotOut, status_code=202)
async def upload(request: Request, repo: Repo):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "이미지는 5 MiB 이하로 선택해주세요.")
    image = await run_in_threadpool(validate_image, bytes(body), request.headers.get("content-type", ""))
    return await run_in_threadpool(ScreenshotService(repo).upload, image, request.headers.get("x-file-name", ""))


@router.get("", response_model=ScreenshotPage)
def rows(repo: Repo, page: Annotated[int, Query(ge=1, le=100000)] = 1):
    return {"provider": "tesseract", "inputs": ScreenshotService(repo).rows(page)}


@router.get("/{screenshot_id}/image")
def image(screenshot_id: UUID, repo: Repo):
    row = ScreenshotService(repo).owned(screenshot_id)
    if row.image_bytes is None:
        raise HTTPException(404, "원본 이미지가 삭제되었습니다.")
    return Response(row.image_bytes, media_type=row.mime_type,
                    headers={"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline"})


@router.post("/{screenshot_id}/claim", response_model=ScreenshotClaim)
def claim(screenshot_id: UUID, repo: Repo):
    return {"claim_token": ScreenshotService(repo).claim(screenshot_id)}


@router.post("/{screenshot_id}/result", response_model=ScreenshotOut)
def result(screenshot_id: UUID, data: ScreenshotResult, repo: Repo):
    return ScreenshotService(repo).result(screenshot_id, data)


@router.post("/{screenshot_id}/failure", response_model=ScreenshotOut)
def failure(screenshot_id: UUID, data: ScreenshotFailure, repo: Repo):
    return ScreenshotService(repo).fail(screenshot_id, data.claim_token)


@router.post("/{screenshot_id}/retry", response_model=ScreenshotOut)
def retry(screenshot_id: UUID, repo: Repo):
    return ScreenshotService(repo).retry(screenshot_id)


@router.delete("/{screenshot_id}", status_code=204)
def delete_image(screenshot_id: UUID, repo: Repo):
    ScreenshotService(repo).delete_image(screenshot_id)
    return Response(status_code=204)


@router.patch("/{screenshot_id}/text", response_model=ScreenshotOut)
def correct_text(screenshot_id: UUID, data: ScreenshotText, repo: Repo):
    return ScreenshotService(repo).correct_text(screenshot_id, data.text)
