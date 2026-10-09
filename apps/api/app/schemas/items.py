from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ItemType(StrEnum):
    task = "task"
    deadline = "deadline"
    event = "event"
    reservation = "reservation"
    payment = "payment"
    delivery = "delivery"
    purchase = "purchase"
    return_ = "return"
    document = "document"
    note = "note"
    other = "other"


class Status(StrEnum):
    inbox = "inbox"
    todo = "todo"
    in_progress = "in_progress"
    completed = "completed"
    archived = "archived"


class Currency(StrEnum):
    KRW = "KRW"
    USD = "USD"
    JPY = "JPY"
    EUR = "EUR"
    GBP = "GBP"
    CNY = "CNY"


def validate_amount_input(value):
    if value is not None and not isinstance(value, (str, Decimal)):
        raise ValueError("금액은 소수 정밀도를 유지하도록 문자열로 전달해주세요.")
    return value


class ItemFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    type: ItemType = ItemType.other
    deadline: date | None = None
    start_datetime: datetime | None = None
    end_datetime: datetime | None = None
    amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    currency: Currency = Currency.KRW

    @field_validator("amount", mode="before", json_schema_input_type=str | None)
    @classmethod
    def string_amount(cls, value):
        return validate_amount_input(value)

    @field_validator("start_datetime", "end_datetime")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("일정에는 시간대가 필요합니다.")
        return value

    @model_validator(mode="after")
    def validate_fields(self):
        if self.end_datetime and (not self.start_datetime or self.end_datetime <= self.start_datetime):
            raise ValueError("종료 시각은 시작 시각 이후여야 합니다.")
        if self.amount is not None and self.currency in (Currency.KRW, Currency.JPY):
            if self.amount != self.amount.to_integral_value():
                raise ValueError("원화와 엔화는 정수로 입력해주세요.")
        return self


class ItemCreate(ItemFields):
    source_text: str = Field(default="", max_length=10000)
    space_id: UUID | None = None


class ItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    type: ItemType | None = None
    status: Status | None = None
    deadline: date | None = None
    start_datetime: datetime | None = None
    end_datetime: datetime | None = None
    amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    currency: Currency | None = None
    space_id: UUID | None = None

    @field_validator("amount", mode="before", json_schema_input_type=str | None)
    @classmethod
    def string_amount(cls, value):
        return validate_amount_input(value)

    @model_validator(mode="after")
    def reject_null_required(self):
        for key in ("title", "description", "type", "status", "currency", "space_id"):
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError(f"{key} 값은 비워둘 수 없습니다.")
        return self


class ItemOut(ItemFields):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    space_id: UUID
    creator_id: UUID
    status: Status
    source_type: str
    source_text: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    assignee_id: UUID | None = None


class ItemPage(BaseModel):
    items: list[ItemOut]
    total: int
    page: int
    page_size: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str
    timezone: str


class SpaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    type: str
    is_default: bool = False
    role: str = "owner"


class DashboardOut(BaseModel):
    today: date
    inbox_count: int
    overdue_count: int
    week_deadline_count: int
    today_count: int
    today_items: list[ItemOut]
    overdue_items: list[ItemOut]
    payments: dict[str, Decimal]
    payment_missing_amount_count: int


class CalendarEntry(BaseModel):
    id: str
    kind: str
    item: ItemOut


class CalendarOut(BaseModel):
    month: str
    entries: list[CalendarEntry]
