from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


Table("users", Base.metadata, Column("id", PGUUID, primary_key=True), schema="auth")


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = {"schema": "app"}
    id: Mapped[UUID] = mapped_column(ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(100), server_default="")
    timezone: Mapped[str] = mapped_column(String(64), server_default="Asia/Seoul")


class Space(Timestamps, Base):
    __tablename__ = "spaces"
    __table_args__ = (
        CheckConstraint("type IN ('personal','shared')"),
        UniqueConstraint("id", "owner_id", name="uq_spaces_owner_pair"),
        CheckConstraint("NOT is_default OR type='personal'"),
        Index("uq_default_personal_owner", "owner_id", unique=True, postgresql_where=text("is_default")),
        Index("ix_spaces_owner", "owner_id"),
        {"schema": "app"},
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(20))
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("app.users.id", ondelete="CASCADE"))
    is_default: Mapped[bool] = mapped_column(default=False, server_default="false")


class SpaceMember(Base):
    __tablename__ = "space_members"
    __table_args__ = (CheckConstraint("role IN ('owner','member','viewer')"), Index("ix_members_user", "user_id"), {"schema": "app"})
    space_id: Mapped[UUID] = mapped_column(ForeignKey("app.spaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("app.users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Item(Timestamps, Base):
    __tablename__ = "items"
    __table_args__ = (
        UniqueConstraint("id", "creator_id", name="uq_items_creator_pair"),
        ForeignKeyConstraint(["space_id", "assignee_id"], ["app.space_members.space_id", "app.space_members.user_id"]),
        CheckConstraint("status IN ('inbox','todo','in_progress','completed','archived')"),
        CheckConstraint("length(trim(title)) BETWEEN 1 AND 200"),
        CheckConstraint("amount IS NULL OR amount >= 0"),
        CheckConstraint("currency IN ('KRW','USD','JPY','EUR','GBP','CNY')"),
        CheckConstraint("amount IS NULL OR currency NOT IN ('KRW','JPY') OR amount = trunc(amount)"),
        CheckConstraint("end_datetime IS NULL OR (start_datetime IS NOT NULL AND end_datetime > start_datetime)"),
        Index("ix_items_status_deadline", "space_id", "status", "deadline"),
        Index("ix_items_start", "space_id", "start_datetime"),
        Index("ix_items_creator", "creator_id"),
        Index("ix_items_assignee", "space_id", "assignee_id"),
        {"schema": "app"},
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    space_id: Mapped[UUID] = mapped_column(ForeignKey("app.spaces.id", ondelete="CASCADE"))
    creator_id: Mapped[UUID] = mapped_column(ForeignKey("app.users.id"))
    assignee_id: Mapped[UUID | None] = mapped_column(nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, server_default="")
    type: Mapped[str] = mapped_column(String(32), server_default="other")
    status: Mapped[str] = mapped_column(String(20), server_default="inbox")
    deadline: Mapped[date | None]
    start_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_datetime: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), server_default="KRW")
    source_type: Mapped[str] = mapped_column(String(32), server_default="manual")
    source_text: Mapped[str] = mapped_column(Text, server_default="")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ItemUpdate(Base):
    __tablename__ = "item_updates"
    __table_args__ = (Index("ix_updates_item", "item_id", "created_at"), Index("ix_updates_user", "user_id"), {"schema": "app"})
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    item_id: Mapped[UUID] = mapped_column(ForeignKey("app.items.id", ondelete="CASCADE"))
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("app.users.id", ondelete="SET NULL"))
    type: Mapped[str] = mapped_column(String(32))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("size_bytes >= 0"), UniqueConstraint("storage_bucket", "storage_path"),
        Index("ix_attachments_item", "item_id"), Index("ix_attachments_uploaded_by", "uploaded_by"), {"schema": "app"},
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    item_id: Mapped[UUID] = mapped_column(ForeignKey("app.items.id", ondelete="CASCADE"))
    uploaded_by: Mapped[UUID | None] = mapped_column(ForeignKey("app.users.id", ondelete="SET NULL"))
    file_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128))
    size_bytes: Mapped[int]
    storage_bucket: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
