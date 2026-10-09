from datetime import UTC, datetime, timedelta
from urllib.parse import unquote
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import defer

from app.automation.images import ValidImage
from app.automation.service import AutomationService
from app.models.automation import InboundEvent, Integration, ScreenshotInput
from app.schemas.automation import ScreenshotResult


class ScreenshotService:
    def __init__(self, repo):
        self.repo = repo
        self.session = repo.session
        self.automation = AutomationService(repo)

    def owned(self, screenshot_id, lock=False):
        return self.automation.owned(ScreenshotInput, screenshot_id, lock)

    def upload(self, image: ValidImage, file_name: str):
        self.session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": f"screenshot-upload:{self.repo.user_id}"})
        existing = self.session.scalar(select(ScreenshotInput).where(
            ScreenshotInput.user_id == self.repo.user_id, ScreenshotInput.image_sha256 == image.digest))
        if existing and existing.ocr_status != "deleted":
            return existing
        count = self.session.scalar(select(func.count()).select_from(ScreenshotInput).where(
            ScreenshotInput.user_id == self.repo.user_id, ScreenshotInput.image_bytes.is_not(None)))
        if count >= 50:
            raise HTTPException(409, "원본 이미지는 최대 50개 보관합니다. 사용하지 않는 원본을 삭제한 뒤 추가해주세요.")
        self.automation.settings()
        if existing:
            existing.image_bytes = image.data
            existing.error_message = None
            event = self.automation.owned(InboundEvent, existing.inbound_event_id)
            if existing.ocr_text:
                existing.ocr_status = "completed" if event.status != "failed" else "failed"
            else:
                existing.ocr_status = "pending"
                event.status = "pending"
                event.error_message = None
            self.session.flush()
            return existing
        self.session.execute(insert(Integration).values(user_id=self.repo.user_id, provider="screenshot", status="active", settings={}).on_conflict_do_nothing())
        integration = self.session.scalar(select(Integration).where(Integration.user_id == self.repo.user_id, Integration.provider == "screenshot"))
        name = unquote(file_name).replace("\\", "/").rsplit("/", 1)[-1]
        name = "".join(c for c in name if c.isprintable())[:200] or "스크린샷"
        event = InboundEvent(id=uuid4(), user_id=self.repo.user_id, integration_id=integration.id, source_type="screenshot",
            external_id=image.digest, raw_content={"title": "", "content": "", "source_type": "screenshot", "timestamp": datetime.now(UTC).isoformat(), "metadata": {"image_sha256": image.digest}})
        self.session.add(event)
        self.session.flush()
        row = ScreenshotInput(id=uuid4(), user_id=self.repo.user_id, inbound_event_id=event.id,
            image_bytes=image.data, image_sha256=image.digest, mime_type=image.mime, width=image.width,
            height=image.height, file_name=name, provider="tesseract", ocr_status="pending")
        self.session.add(row)
        self.session.flush()
        return row

    def rows(self, page=1):
        return list(self.session.scalars(select(ScreenshotInput).options(defer(ScreenshotInput.image_bytes)).where(
            ScreenshotInput.user_id == self.repo.user_id, ScreenshotInput.ocr_status != "deleted"
        ).order_by(ScreenshotInput.created_at.desc(), ScreenshotInput.id).offset((page - 1) * 20).limit(20)))

    def claim(self, screenshot_id):
        row = self.owned(screenshot_id, lock=True)
        if row.image_bytes is None:
            raise HTTPException(404, "원본 이미지가 삭제되었습니다.")
        if row.ocr_status == "completed":
            raise HTTPException(409, "이미 판독한 이미지입니다.")
        if row.ocr_status == "processing" and row.last_attempt_at and row.last_attempt_at > datetime.now(UTC) - timedelta(minutes=5):
            raise HTTPException(409, "이 이미지는 다른 화면에서 판독 중입니다. 잠시 후 다시 시도해주세요.")
        row.claim_token = uuid4()
        row.last_attempt_at = datetime.now(UTC)
        row.attempts += 1
        row.ocr_status = "processing"
        row.error_message = None
        self.session.flush()
        return row.claim_token

    def result(self, screenshot_id, result: ScreenshotResult):
        row = self.owned(screenshot_id, lock=True)
        if row.claim_token != result.claim_token or row.image_bytes is None:
            raise HTTPException(409, "이전 판독 결과입니다. 현재 작업을 다시 확인해주세요.")
        if row.ocr_status == "completed":
            return row
        if row.ocr_status != "processing":
            raise HTTPException(409, "판독 작업이 종료되었습니다. 다시 시도해주세요.")
        row.ocr_text = result.text
        row.ocr_confidence = result.confidence / 100
        row.ocr_details = {"engine": "tesseract", "languages": ["kor", "eng"], "review_required": True}
        event = self.automation.owned(InboundEvent, row.inbound_event_id, lock=True)
        event.raw_content = {**event.raw_content, "content": result.text}
        self.parse(row, event)
        return row

    def parse(self, row, event):
        # OCR 텍스트를 먼저 flush하여 파서의 SAVEPOINT 실패 후에도 다시 사용할 수 있습니다.
        self.session.flush()
        event.status = "pending"
        event = self.automation.process(event)
        row.ocr_status = "failed" if event.status == "failed" else "completed"
        row.error_message = event.error_message
        row.processed_at = datetime.now(UTC)
        self.session.flush()

    def retry(self, screenshot_id):
        row = self.owned(screenshot_id, lock=True)
        if row.image_bytes is None:
            raise HTTPException(404, "원본 이미지가 삭제되었습니다.")
        if row.ocr_status == "failed" and row.ocr_text:
            event = self.automation.owned(InboundEvent, row.inbound_event_id, lock=True)
            self.parse(row, event)
        return row

    def correct_text(self, screenshot_id, content: str):
        row = self.owned(screenshot_id, lock=True)
        if row.image_bytes is None:
            raise HTTPException(404, "원본 이미지가 삭제되었습니다.")
        if row.ocr_status != "failed" or not row.ocr_text:
            raise HTTPException(409, "분석에 실패한 텍스트만 다시 분석할 수 있습니다.")
        event = self.automation.owned(InboundEvent, row.inbound_event_id, lock=True)
        if event.status != "failed":
            raise HTTPException(409, "이미 분석된 텍스트입니다. 후보 화면에서 내용을 수정해주세요.")
        event.raw_content = {**event.raw_content, "content": content}
        row.ocr_details = {**row.ocr_details, "text_corrected": True}
        self.parse(row, event)
        return row

    def fail(self, screenshot_id, claim_token: UUID):
        row = self.owned(screenshot_id, lock=True)
        if row.claim_token == claim_token and row.ocr_status == "processing":
            row.ocr_status = "failed"
            row.error_message = "이미지 판독을 완료하지 못했습니다. 원본을 보존했습니다. 다시 시도해주세요."
            event = self.automation.owned(InboundEvent, row.inbound_event_id, lock=True)
            event.status = "failed"
            event.error_message = row.error_message
            self.session.flush()
        return row

    def delete_image(self, screenshot_id):
        row = self.owned(screenshot_id, lock=True)
        row.image_bytes = None
        row.ocr_status = "deleted"
        row.claim_token = None
        event = self.automation.owned(InboundEvent, row.inbound_event_id, lock=True)
        if event.status in ("pending", "processing") or (event.status == "failed" and not row.ocr_text):
            event.status = "ignored"
        self.session.flush()
