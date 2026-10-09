from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, LargeBinary, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.entities import Base, Timestamps


class Owned:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app.users.id", ondelete="CASCADE"))


class AutomationSettings(Timestamps, Base):
    __tablename__ = "automation_settings"
    __table_args__ = {"schema": "app"}
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app.users.id"), primary_key=True)
    level: Mapped[str] = mapped_column(String(20), default="suggest")
    capture_threshold: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.95"))
    review_threshold: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.70"))


class Integration(Owned, Timestamps, Base):
    __tablename__ = "integrations"
    __table_args__ = {"schema": "app"}
    provider: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(20), default="active")
    credentials_reference: Mapped[str | None] = mapped_column(Text)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def default_space_id(self):
        return self.settings.get("default_space_id")


class InboundEvent(Owned, Base):
    __tablename__ = "inbound_events"
    __table_args__ = {"schema": "app"}
    integration_id: Mapped[UUID] = mapped_column(ForeignKey("app.integrations.id"))
    source_type: Mapped[str] = mapped_column(String(32))
    external_id: Mapped[str] = mapped_column(String(200))
    raw_content: Mapped[dict] = mapped_column(JSONB)
    normalized_content: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(default=0)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScreenshotInput(Owned, Timestamps, Base):
    __tablename__ = "screenshot_inputs"
    __table_args__ = {"schema": "app"}
    inbound_event_id: Mapped[UUID] = mapped_column(ForeignKey("app.inbound_events.id"))
    image_bytes: Mapped[bytes | None] = mapped_column(LargeBinary)
    image_sha256: Mapped[str] = mapped_column(String(64))
    mime_type: Mapped[str] = mapped_column(String(32))
    file_name: Mapped[str] = mapped_column(String(200))
    width: Mapped[int]
    height: Mapped[int]
    ocr_status: Mapped[str] = mapped_column(String(24), default="pending")
    ocr_text: Mapped[str | None] = mapped_column(Text)
    ocr_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    ocr_details: Mapped[dict] = mapped_column(JSONB, default=dict)
    provider: Mapped[str | None] = mapped_column(String(32))
    attempts: Mapped[int] = mapped_column(default=0)
    claim_token: Mapped[UUID | None]
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)


class ItemCandidate(Owned, Timestamps, Base):
    __tablename__ = "item_candidates"
    __table_args__ = {"schema": "app"}
    inbound_event_id: Mapped[UUID] = mapped_column(ForeignKey("app.inbound_events.id"))
    candidate_index: Mapped[int] = mapped_column(default=0)
    field_confidences: Mapped[dict] = mapped_column(JSONB, default=dict)
    original_field_confidences: Mapped[dict] = mapped_column(JSONB, default=dict)
    routing_source: Mapped[str] = mapped_column(String(32), default="default")
    routing_reason: Mapped[str] = mapped_column(Text, default="")
    suggested_space_id: Mapped[UUID] = mapped_column(ForeignKey("app.spaces.id"))
    suggested_assignee_id: Mapped[UUID | None]
    payload: Mapped[dict] = mapped_column(JSONB)
    original_payload: Mapped[dict] = mapped_column(JSONB)
    corrections: Mapped[list] = mapped_column(JSONB, default=list)
    confidence: Mapped[Decimal] = mapped_column(Numeric(5, 4))
    explanations: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    item_id: Mapped[UUID | None] = mapped_column(ForeignKey("app.items.id"))


class AutomationRule(Owned, Timestamps, Base):
    __tablename__ = "automation_rules"
    __table_args__ = {"schema": "app"}
    space_id: Mapped[UUID | None] = mapped_column(ForeignKey("app.spaces.id"))
    scope_type: Mapped[str] = mapped_column(String(20), default="global")
    integration_id: Mapped[UUID | None] = mapped_column(ForeignKey("app.integrations.id"))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    trigger_type: Mapped[str] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(default=1)
    conditions: Mapped[list] = mapped_column(JSONB)
    actions: Mapped[list] = mapped_column(JSONB)
    priority: Mapped[int] = mapped_column(default=0)
    is_enabled: Mapped[bool] = mapped_column(default=True)

    @property
    def scope_id(self):
        return self.space_id if self.scope_type == "space" else self.integration_id


class AutomationRun(Owned, Base):
    __tablename__ = "automation_runs"
    __table_args__ = {"schema": "app"}
    rule_id: Mapped[UUID | None] = mapped_column(ForeignKey("app.automation_rules.id"))
    rule_name: Mapped[str] = mapped_column(String(100))
    trigger_type: Mapped[str] = mapped_column(String(40))
    trigger_entity_id: Mapped[UUID]
    execution_key: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20))
    input_snapshot: Mapped[dict] = mapped_column(JSONB)
    output_snapshot: Mapped[dict] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Owned, Base):
    __tablename__ = "notifications"
    __table_args__ = {"schema": "app"}
    item_id: Mapped[UUID | None] = mapped_column(ForeignKey("app.items.id"))
    rule_id: Mapped[UUID | None] = mapped_column(ForeignKey("app.automation_rules.id"))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    dedupe_key: Mapped[str] = mapped_column(String(250))
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
