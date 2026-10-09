from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.items import ItemFields, ItemPatch, ItemType, SpaceOut

Trigger = Literal["inbound_received", "candidate_created", "item_created", "item_updated", "deadline_approaching", "integration_sync"]
Level = Literal["suggest", "auto_capture", "auto_action"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, from_attributes=True)


class SettingsInput(StrictModel):
    level: Level = "suggest"
    capture_threshold: float = Field(default=0.95, ge=0, le=1)
    review_threshold: float = Field(default=0.70, ge=0, le=1)

    @model_validator(mode="after")
    def ordered_thresholds(self):
        if self.review_threshold > self.capture_threshold:
            raise ValueError("확인 기준은 자동 저장 기준 이하로 설정해주세요.")
        return self


class Condition(StrictModel):
    field: Literal["source_type", "sender", "sender_domain", "title", "text", "type", "status", "confidence", "amount", "space_id", "delivery_status"]
    operator: Literal["equals", "contains", "greater_than", "greater_or_equal", "less_than"]
    value: str = Field(max_length=300)

    @model_validator(mode="after")
    def valid_operator(self):
        from decimal import Decimal, InvalidOperation

        if self.operator in ("greater_than", "greater_or_equal", "less_than"):
            if self.field not in ("confidence", "amount"):
                raise ValueError("숫자 비교는 신뢰도·금액에만 사용할 수 있습니다.")
        if self.field in ("confidence", "amount"):
            if self.operator == "contains":
                raise ValueError("숫자 조건에는 포함 비교를 사용할 수 없습니다.")
            try:
                if not Decimal(self.value).is_finite():
                    raise InvalidOperation
            except InvalidOperation as exc:
                raise ValueError("숫자 조건 값을 확인해주세요.") from exc
        return self


class Action(StrictModel):
    type: Literal["create_item", "move_to_space", "assign_user", "set_type", "set_deadline", "create_notification", "archive", "ignore", "complete_item"]
    value: str | None = Field(default=None, max_length=200)
    days_before: int = Field(default=0, ge=0, le=365)

    @model_validator(mode="after")
    def valid_action(self):
        from datetime import date

        if self.type in ("move_to_space", "assign_user"):
            if self.value is None:
                raise ValueError("대상 ID가 필요합니다.")
            UUID(self.value)
        if self.type == "set_type":
            ItemType(self.value)
        if self.type == "set_deadline":
            if self.value is None:
                raise ValueError("마감일이 필요합니다.")
            date.fromisoformat(self.value)
        if self.type != "create_notification" and self.days_before:
            raise ValueError("알림 Action에만 알림 일수를 설정할 수 있습니다.")
        return self


class RuleInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=2000)
    space_id: UUID | None = None
    scope_type: Literal["global", "space", "integration"] | None = None
    scope_id: UUID | None = None
    version: Literal[1] = 1
    trigger_type: Trigger
    conditions: list[Condition] = Field(default_factory=list, max_length=16)
    actions: list[Action] = Field(min_length=1, max_length=12)
    priority: int = Field(default=0, ge=-10000, le=10000)
    is_enabled: bool = True

    @model_validator(mode="after")
    def valid_scope(self):
        if self.scope_type is None:
            self.scope_type = "space" if self.space_id else "global"
        if self.scope_type == "space":
            if self.scope_id and self.space_id and self.scope_id != self.space_id:
                raise ValueError("공간 범위 ID가 일치하지 않습니다.")
            self.scope_id = self.scope_id or self.space_id
            self.space_id = self.scope_id
        elif self.space_id:
            raise ValueError("공간 ID는 공간 범위에서만 지정해주세요.")
        if (self.scope_type == "global" and self.scope_id) or (self.scope_type != "global" and not self.scope_id):
            raise ValueError("규칙 범위의 대상을 확인해주세요.")
        return self


class RuleOut(RuleInput):
    id: UUID
    created_at: datetime
    updated_at: datetime


class ShareInput(StrictModel):
    title: str = Field(default="", max_length=200)
    content: str = Field(min_length=1, max_length=10000)
    source_type: Literal["manual_share", "email", "calendar", "webhook", "screenshot"] = "manual_share"
    sender: str = Field(default="", max_length=200)
    external_id: str | None = Field(default=None, min_length=1, max_length=200)
    timestamp: datetime | None = None
    fields: ItemFields | None = None
    metadata: dict[str, str] = Field(default_factory=dict, max_length=20)

    @model_validator(mode="after")
    def timestamp_timezone(self):
        if self.timestamp and self.timestamp.utcoffset() is None:
            raise ValueError("원본 시각에는 시간대가 필요합니다.")
        if any(len(key) > 100 or len(value) > 500 for key, value in self.metadata.items()):
            raise ValueError("원본 메타데이터가 너무 깁니다.")
        return self


class EventOut(StrictModel):
    id: UUID
    source_type: str
    external_id: str
    raw_content: dict
    normalized_content: dict | None
    status: str
    error_message: str | None
    attempts: int
    received_at: datetime
    processed_at: datetime | None


class CandidateOut(StrictModel):
    id: UUID
    inbound_event_id: UUID
    candidate_index: int
    field_confidences: dict[str, "FieldConfidence"]
    original_field_confidences: dict[str, "FieldConfidence"]
    review_fields: list[str] = Field(default_factory=list)
    review_reason: str = ""
    routing_source: str
    routing_reason: str
    source_image_id: UUID | None = None
    suggested_space_id: UUID
    suggested_assignee_id: UUID | None
    payload: ItemFields
    original_payload: dict
    corrections: list[dict]
    confidence: float
    explanations: list[str]
    status: str
    item_id: UUID | None
    created_at: datetime


class FieldConfidence(StrictModel):
    value: str | float | bool | None
    confidence: float = Field(ge=0, le=1)
    reason: str
    source: str
    needs_review: bool = False


class CandidatePatch(StrictModel):
    fields: ItemPatch = Field(default_factory=ItemPatch)
    suggested_space_id: UUID | None = None

    @model_validator(mode="after")
    def no_status(self):
        if "status" in self.fields.model_fields_set:
            raise ValueError("후보는 추가·무시 버튼으로 처리해주세요.")
        if "space_id" in self.fields.model_fields_set:
            raise ValueError("후보의 저장 공간은 suggested_space_id로 지정해주세요.")
        return self


class RunOut(StrictModel):
    id: UUID
    rule_id: UUID | None
    rule_name: str
    trigger_type: str
    trigger_entity_id: UUID
    status: str
    input_snapshot: dict
    output_snapshot: dict
    error_message: str | None
    executed_at: datetime


class NotificationOut(StrictModel):
    id: UUID
    item_id: UUID | None
    rule_id: UUID | None
    title: str
    message: str
    scheduled_for: datetime
    status: str
    read_at: datetime | None
    created_at: datetime


class IntegrationOut(StrictModel):
    id: UUID
    provider: str
    status: str
    last_synced_at: datetime | None
    default_space_id: UUID | None


class IntegrationDestination(StrictModel):
    space_id: UUID | None = None


class SummaryOut(StrictModel):
    active_rules: int
    today_processed: int
    review_count: int
    failed_count: int
    unread_notifications: int


class ScreenshotOut(StrictModel):
    id: UUID
    inbound_event_id: UUID
    file_name: str
    mime_type: str
    width: int
    height: int
    ocr_status: str
    ocr_text: str | None
    ocr_confidence: float | None
    provider: str | None
    error_message: str | None
    attempts: int
    created_at: datetime
    processed_at: datetime | None


class ScreenshotPage(StrictModel):
    provider: str
    inputs: list[ScreenshotOut]


class ScreenshotClaim(StrictModel):
    claim_token: UUID


class ScreenshotResult(StrictModel):
    claim_token: UUID
    text: str = Field(min_length=1, max_length=50000)
    confidence: float = Field(ge=0, le=100)


class ScreenshotFailure(StrictModel):
    claim_token: UUID


class ScreenshotText(StrictModel):
    text: str = Field(min_length=1, max_length=10000)


class SpaceCreate(StrictModel):
    name: str = Field(min_length=1, max_length=100)


class SpacePage(StrictModel):
    spaces: list[SpaceOut]
