import hashlib
import json
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.automation.confidence import can_capture, confirm_field, field_result, review_fields
from app.automation.integrations.manual_share import ManualShareIntegration
from app.automation.parsing.service import parse_many
from app.automation.routing import initial_route
from app.automation.rules.engine import RuleEngine, error_text, snapshot
from app.automation.scheduler.service import cancel_notifications, deliver_due
from app.models import Item, Space, SpaceMember
from app.models.automation import (
    AutomationRule,
    AutomationRun,
    AutomationSettings,
    InboundEvent,
    Integration,
    ItemCandidate,
    Notification,
    ScreenshotInput,
)
from app.schemas.automation import (
    CandidateOut,
    CandidatePatch,
    RuleInput,
    SettingsInput,
    ShareInput,
    SummaryOut,
)
from app.schemas.items import ItemFields
from app.services.spaces import SpaceService

TZ = ZoneInfo("Asia/Seoul")


class AutomationService:
    def __init__(self, repo):
        self.repo = repo
        self.session = repo.session

    def settings(self):
        self.session.execute(insert(AutomationSettings).values(user_id=self.repo.user_id).on_conflict_do_nothing())
        return self.session.get(AutomationSettings, self.repo.user_id)

    def update_settings(self, data: SettingsInput):
        row = self.settings()
        for key, value in data.model_dump().items():
            setattr(row, key, value)
        self.session.flush()
        return row

    def owned(self, model, entity_id: UUID, lock: bool = False):
        query = select(model).where(model.id == entity_id, model.user_id == self.repo.user_id)
        if lock:
            query = query.with_for_update()
        row = self.session.scalar(query)
        if row is None:
            raise HTTPException(404, "자동화 데이터를 찾을 수 없습니다.")
        return row

    def rows(self, model, page: int = 1, status: str | None = None):
        owner = model.user_id == self.repo.user_id
        if model is AutomationRun:
            owner = or_(owner, and_(model.trigger_type.in_(("item_created", "item_updated", "deadline_approaching")),
                                  model.input_snapshot["entity"]["actor_id"].astext == str(self.repo.user_id)))
        query = select(model).where(owner)
        if status:
            query = query.where(model.status == status)
        order = model.executed_at if model is AutomationRun else model.received_at if model is InboundEvent else model.created_at
        return list(self.session.scalars(query.order_by(order.desc(), model.id.desc()).offset((page - 1) * 20).limit(20)))

    def integrations(self):
        self.ensure_manual_integration()
        return list(self.session.scalars(select(Integration).where(Integration.user_id == self.repo.user_id)))

    def ensure_manual_integration(self):
        self.session.execute(insert(Integration).values(user_id=self.repo.user_id, provider="manual_share", status="active", settings={}).on_conflict_do_nothing())
        return self.session.scalar(select(Integration).where(Integration.user_id == self.repo.user_id, Integration.provider == "manual_share"))

    def integration_destination(self, integration_id: UUID, space_id: UUID | None):
        integration = self.owned(Integration, integration_id)
        if space_id:
            SpaceService(self.repo).require(space_id, write=True)
        integration.settings = {**integration.settings, "default_space_id": str(space_id) if space_id else None}
        self.session.flush()
        return integration

    def ingest(self, data: ShareInput):
        self.settings()
        integration = self.ensure_manual_integration()
        raw = data.model_dump(mode="json")
        external_id = data.external_id or hashlib.sha256(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        lock_key = f"{self.repo.user_id}:{integration.id}:{external_id}"
        self.session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": lock_key})
        existing = self.session.scalar(select(InboundEvent).where(
            InboundEvent.user_id == self.repo.user_id, InboundEvent.integration_id == integration.id,
            InboundEvent.external_id == external_id,
        ))
        if existing:
            return existing
        event = InboundEvent(id=uuid4(), user_id=self.repo.user_id, integration_id=integration.id,
                             source_type=data.source_type, external_id=external_id, raw_content=raw)
        self.session.add(event)
        self.session.flush()
        return self.process(event)

    def process(self, event: InboundEvent):
        if event.status in ("processed", "ignored"):
            return event
        event.attempts += 1
        self.session.flush()
        try:
            with self.session.begin_nested():
                event.status = "processing"
                normalized = ManualShareIntegration().normalize({**event.raw_content, "timestamp": event.raw_content.get("timestamp") or event.received_at.isoformat()})
                event.normalized_content = json.loads(json.dumps(asdict(normalized), default=str, ensure_ascii=False))
                settings = self.settings()
                integration = self.owned(Integration, event.integration_id)
                engine = RuleEngine(self.repo, settings)
                extra = {"source_type": normalized.source, "sender": normalized.sender,
                         "delivery_status": normalized.metadata.get("delivery_status"), "integration_id": str(integration.id)}
                triggers = ("integration_sync", "inbound_received", "candidate_created")
                route_id, _, _ = initial_route(self.repo, integration, normalized.content)
                ignored_rules = engine.run(triggers, event, {**extra, "space_id": str(route_id)}, preparse=True)
                candidates = []
                if event.status != "ignored":
                    for index, parsed in enumerate(parse_many(normalized)):
                        target, source, space_confidence = initial_route(self.repo, integration, parsed.fields.description)
                        candidate = self.session.scalar(select(ItemCandidate).where(
                            ItemCandidate.inbound_event_id == event.id, ItemCandidate.candidate_index == index))
                        if candidate is None:
                            confidence = {**parsed.field_confidences, "space": space_confidence}
                            if normalized.source == "screenshot":
                                image = self.session.scalar(select(ScreenshotInput).where(ScreenshotInput.inbound_event_id == event.id,
                                    ScreenshotInput.user_id == self.repo.user_id))
                                confidence["ocr"] = field_result(str(image.id) if image else "screenshot",
                                    image.ocr_confidence if image and image.ocr_confidence is not None else 0,
                                    "이미지에서 읽은 내용입니다. 원본과 날짜·금액을 확인한 뒤 추가해주세요.", "ocr", True)
                            payload = parsed.fields.model_dump(mode="json")
                            candidate = ItemCandidate(id=uuid4(), user_id=self.repo.user_id, inbound_event_id=event.id,
                                candidate_index=index, suggested_space_id=target, payload=payload, original_payload=payload,
                                confidence=parsed.confidence, explanations=parsed.explanations, field_confidences=confidence,
                                original_field_confidences=confidence, routing_source=source, routing_reason=space_confidence["reason"])
                            self.session.add(candidate)
                            self.session.flush()
                        engine.run(triggers, candidate, extra, exclude_rules=ignored_rules)
                        if candidate.status == "pending" and can_capture(candidate, settings):
                            self.accept(candidate.id, automatic=True)
                        self.record_capture(candidate, settings)
                        candidates.append(candidate)
                    event.status = "ignored" if all(c.status == "rejected" for c in candidates) else "processed"
                event.processed_at = datetime.now(UTC)
                event.error_message = None
                integration.last_synced_at = event.processed_at
                self.session.flush()
        except Exception as exc:
            event.status = "failed"
            event.error_message = error_text(exc)
            self.session.flush()
        return event

    def candidate_out(self, candidate):
        result = CandidateOut.model_validate(candidate)
        result.source_image_id = self.session.scalar(select(ScreenshotInput.id).where(
            ScreenshotInput.inbound_event_id == candidate.inbound_event_id, ScreenshotInput.user_id == self.repo.user_id,
            ScreenshotInput.image_bytes.is_not(None)))
        if candidate.status == "pending":
            settings = self.settings()
            result.review_fields = review_fields(candidate, settings.capture_threshold)
            reasons = []
            if settings.level == "suggest":
                reasons.append("현재 자동화 수준은 확인 후 추가입니다.")
            if candidate.confidence < settings.review_threshold:
                reasons.append("전체 신뢰도가 확인 권장 기준보다 낮습니다. 원문을 함께 확인해주세요.")
            elif candidate.confidence < settings.capture_threshold:
                reasons.append("전체 신뢰도가 자동 저장 기준보다 낮습니다.")
            if self.repo.space_role(candidate.suggested_space_id) not in ("owner", "member"):
                if "space" not in result.review_fields:
                    result.review_fields.append("space")
                reasons.append("저장 공간에 작성 권한이 없어 다른 공간을 선택해야 합니다.")
            result.review_reason = " ".join(reasons)
        return result

    def record_capture(self, candidate, settings):
        key = f"capture:{candidate.id}"
        if self.session.scalar(select(AutomationRun.id).where(AutomationRun.user_id == self.repo.user_id, AutomationRun.execution_key == key)):
            return
        automatic = candidate.status == "auto_accepted"
        fields = review_fields(candidate, settings.capture_threshold)
        reason = "전체·필드별 신뢰도 기준을 충족하여 자동으로 추가했습니다." if automatic else "사용자 확인이 필요하여 후보를 유지했습니다."
        if candidate.status == "rejected":
            reason = "무시 규칙으로 후보를 무시했습니다."
        self.session.add(AutomationRun(user_id=self.repo.user_id, rule_name="후보 처리 기준",
            trigger_type="candidate_created", trigger_entity_id=candidate.id, execution_key=key,
            status="success" if automatic else "skipped", input_snapshot={"entity": snapshot(candidate),
            "conditions": [{"field": "confidence", "operator": "greater_or_equal", "value": str(settings.capture_threshold), "matched": candidate.confidence >= settings.capture_threshold}],
            "field_confidences": candidate.field_confidences}, output_snapshot={"entity": snapshot(candidate),
            "actions": [reason], "review_fields": fields, "item_id": str(candidate.item_id) if candidate.item_id else None}))

    def retry(self, event_id: UUID):
        return self.process(self.owned(InboundEvent, event_id, lock=True))

    def patch_candidate(self, candidate_id: UUID, data: CandidatePatch):
        candidate = self.owned(ItemCandidate, candidate_id, lock=True)
        if candidate.status != "pending":
            raise HTTPException(409, "처리된 후보는 수정할 수 없습니다.")
        before = {**candidate.payload, "space_id": str(candidate.suggested_space_id)}
        fields = ItemFields.model_validate({**candidate.payload, **data.fields.model_dump(exclude_unset=True)})
        if data.suggested_space_id:
            SpaceService(self.repo).require(data.suggested_space_id, write=True)
            candidate.suggested_space_id = data.suggested_space_id
            candidate.suggested_assignee_id = None
        SpaceService(self.repo).require(candidate.suggested_space_id, write=True)
        candidate.payload = fields.model_dump(mode="json")
        for field in data.fields.model_fields_set:
            if field != "description":
                confirm_field(candidate, field, candidate.payload[field], "사용자가 값을 확인하고 수정했습니다.")
        if data.suggested_space_id:
            candidate.routing_source = "user"
            candidate.routing_reason = "사용자가 저장 공간을 직접 지정했습니다."
            confirm_field(candidate, "space", str(candidate.suggested_space_id), candidate.routing_reason)
            confirm_field(candidate, "assignee", None, "공간 확인으로 담당자 지정을 해제했습니다.")
        candidate.corrections = [*candidate.corrections, {
            "at": datetime.now(UTC).isoformat(), "before": before,
            "after": {**candidate.payload, "space_id": str(candidate.suggested_space_id)},
        }]
        self.session.flush()
        return candidate

    def accept(self, candidate_id: UUID, automatic: bool = False):
        candidate = self.owned(ItemCandidate, candidate_id, lock=True)
        if candidate.status in ("accepted", "auto_accepted"):
            if candidate.item_id:
                return candidate
            raise HTTPException(410, "이 후보에서 추가했던 항목은 삭제되었습니다.")
        if candidate.status != "pending":
            raise HTTPException(409, "이미 무시하거나 만료된 후보입니다.")
        SpaceService(self.repo).require(candidate.suggested_space_id, write=True)
        if candidate.suggested_assignee_id:
            member = self.session.get(SpaceMember, (candidate.suggested_space_id, candidate.suggested_assignee_id))
            if member is None or member.role == "viewer":
                candidate.suggested_assignee_id = None
                confirm_field(candidate, "assignee", None, "담당자의 작성 권한이 없어 지정을 해제했습니다.", "rule")
                candidate.explanations = [*candidate.explanations, "담당자의 작성 권한이 없어 담당자 지정을 해제했습니다."]
        fields = ItemFields.model_validate(candidate.payload)
        event = self.owned(InboundEvent, candidate.inbound_event_id)
        item = Item(id=uuid4(), **fields.model_dump(), space_id=candidate.suggested_space_id,
                    assignee_id=candidate.suggested_assignee_id, creator_id=self.repo.user_id, status="inbox",
                    source_type=event.source_type, source_text=event.raw_content["content"])
        self.repo.save(item)
        candidate.item_id = item.id
        candidate.status = "auto_accepted" if automatic else "accepted"
        if not automatic:
            for field, entry in list(candidate.field_confidences.items()):
                confirm_field(candidate, field, entry["value"], "사용자가 후보를 확인하고 추가했습니다.")
        self.session.flush()
        self.on_item(item, "item_created")
        return candidate

    def reject(self, candidate_id: UUID):
        candidate = self.owned(ItemCandidate, candidate_id, lock=True)
        if candidate.status != "pending" and candidate.status != "rejected":
            raise HTTPException(409, "추가한 후보는 무시할 수 없습니다.")
        candidate.status = "rejected"
        self.session.flush()
        return candidate

    def rules(self):
        return list(self.session.scalars(select(AutomationRule).where(AutomationRule.user_id == self.repo.user_id)
                                        .order_by(AutomationRule.priority.desc(), AutomationRule.created_at)))

    def save_rule(self, data: RuleInput, rule_id: UUID | None = None):
        if data.space_id:
            SpaceService(self.repo).require(data.space_id, owner=True)
        if data.scope_type == "integration":
            self.owned(Integration, data.scope_id)
        for action in data.actions:
            if action.type == "move_to_space":
                SpaceService(self.repo).require(UUID(action.value), write=True)
        self.settings()
        row = self.owned(AutomationRule, rule_id, lock=True) if rule_id else AutomationRule(id=uuid4(), user_id=self.repo.user_id)
        if row.space_id:
            SpaceService(self.repo).require(row.space_id, owner=True)
        for key, value in data.model_dump(mode="json", exclude={"scope_id"}).items():
            setattr(row, key, UUID(value) if key == "space_id" and value else value)
        row.integration_id = data.scope_id if data.scope_type == "integration" else None
        self.session.add(row)
        self.session.flush()
        if not row.is_enabled:
            self.session.execute(update(Notification).where(Notification.rule_id == row.id, Notification.status == "scheduled").values(status="cancelled"))
        return row

    def delete_rule(self, rule_id: UUID):
        row = self.owned(AutomationRule, rule_id, lock=True)
        if row.space_id:
            SpaceService(self.repo).require(row.space_id, owner=True)
        self.session.execute(update(Notification).where(Notification.rule_id == row.id, Notification.status == "scheduled").values(status="cancelled"))
        self.session.delete(row)
        self.session.flush()

    def on_item(self, item: Item, trigger: str, reschedule: bool = False):
        source_context = {**self.item_source_context(item), "actor_id": str(self.repo.user_id)}
        space = self.session.get(Space, item.space_id)
        if space.type == "shared" and space.owner_id != self.repo.user_id:
            from app.repositories.items import ItemRepository
            actor = self.repo.user_id
            try:
                self.session.flush()
                self.session.execute(text("SELECT set_config('app.user_id',:id,true)"), {"id": str(space.owner_id)})
                owner_repo = ItemRepository(self.session, space.owner_id)
                AutomationService(owner_repo)._run_item(item, trigger, reschedule, required_scope=space.id, source_context=source_context)
            finally:
                self.session.execute(text("SELECT set_config('app.user_id',:id,true)"), {"id": str(actor)})
        else:
            self._run_item(item, trigger, reschedule, source_context=source_context)

    def item_source_context(self, item):
        candidate = self.session.scalar(select(ItemCandidate).where(ItemCandidate.item_id == item.id, ItemCandidate.user_id == self.repo.user_id))
        if candidate is None:
            return {}
        event = self.owned(InboundEvent, candidate.inbound_event_id)
        normalized = event.normalized_content or {}
        return {"sender": normalized.get("sender", ""), "delivery_status": normalized.get("metadata", {}).get("delivery_status"),
                "integration_id": str(event.integration_id)}

    def _run_item(self, item: Item, trigger: str, reschedule: bool, required_scope=None, source_context=None):
        settings = self.session.get(AutomationSettings, self.repo.user_id)
        if settings is None:
            return
        extra = {"source_type": item.source_type, "source_text": item.source_text, **(source_context or {})}
        if trigger == "item_updated" and reschedule:
            # 오래된 일정은 취소하고 해당 항목의 생성 알림 규칙을 새 날짜로 다시 평가합니다.
            cancel_notifications(self.session, item.id)
            RuleEngine(self.repo, settings).run("item_created", item, extra, revision=str(item.updated_at), only_notifications=True, required_scope=required_scope)
        RuleEngine(self.repo, settings).run(trigger, item, extra, required_scope=required_scope)
        if item.status in ("completed", "archived"):
            cancel_notifications(self.session, item.id)
        self.session.flush()

    def tick(self):
        locked = self.session.scalar(text("SELECT pg_try_advisory_xact_lock(hashtextextended(:key,0))"), {"key": f"automation-tick:{self.repo.user_id}"})
        if not locked:
            return 0
        settings = self.session.get(AutomationSettings, self.repo.user_id)
        if settings:
            today = datetime.now(TZ).date()
            items = self.session.scalars(self.repo.scoped().where(Item.status.in_(("inbox", "todo", "in_progress")),
                                                                  Item.deadline >= today, Item.deadline <= today + timedelta(days=7)))
            for item in list(items):
                if self.repo.space_role(item.space_id) == "owner":
                    RuleEngine(self.repo, settings).run("deadline_approaching", item,
                        {"source_type": item.source_type, **self.item_source_context(item)}, revision=today.isoformat())
        return deliver_due(self.session)

    def summary(self):
        self.settings()
        today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        def count(model, *conditions):
            return self.session.scalar(select(func.count()).select_from(model).where(model.user_id == self.repo.user_id, *conditions)) or 0
        return SummaryOut(
            active_rules=count(AutomationRule, AutomationRule.is_enabled.is_(True)),
            today_processed=count(ItemCandidate, ItemCandidate.status == "auto_accepted", ItemCandidate.updated_at >= today),
            review_count=count(ItemCandidate, ItemCandidate.status == "pending"),
            failed_count=count(InboundEvent, InboundEvent.status == "failed") + count(AutomationRun, AutomationRun.status == "failed"),
            unread_notifications=count(Notification, Notification.status == "delivered", Notification.read_at.is_(None)),
        )
