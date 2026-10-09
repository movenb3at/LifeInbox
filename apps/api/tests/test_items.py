from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models import Space
from app.schemas.items import ItemCreate, ItemPatch
from app.services.items import ItemService
from app.services.views import schedule_overlaps, summarize


class MemoryRepository:
    def __init__(self):
        self.user_id = uuid4()
        self.space_row = Space(id=uuid4(), name="개인 Inbox", type="personal", owner_id=self.user_id, is_default=True)
        self.extra_spaces = {}
        self.rows = {}

    def default_space(self):
        return self.space_row

    def space_role(self, space_id):
        space = self.space_row if space_id == self.space_row.id else self.extra_spaces.get(space_id)
        return "owner" if space and space.owner_id == self.user_id else None

    def get(self, item_id, space_id=None):
        item = self.rows.get(item_id)
        return item if item and self.space_role(item.space_id) and (not space_id or item.space_id == space_id) else None

    def save(self, item):
        now = datetime.now(UTC)
        item.id = item.id or uuid4()
        item.created_at = item.created_at or now
        item.updated_at = now
        item.source_type = item.source_type or "manual"
        self.rows[item.id] = item
        return item

    def delete(self, item):
        del self.rows[item.id]


@pytest.mark.parametrize("currency,amount", [("KRW", "0.1"), ("JPY", "2.5"), ("USD", "1.234"), ("EUR", "-1"), ("GBP", "1000000000000")])
def test_invalid_money(currency, amount):
    with pytest.raises(ValidationError):
        ItemCreate(title="결제", currency=currency, amount=amount)


def test_money_serialization_and_precision():
    data = ItemCreate(title="결제", amount="0.10", currency="USD")
    assert data.amount + Decimal("0.20") == Decimal("0.30")
    assert data.model_dump(mode="json")["amount"] == "0.10"
    assert ItemCreate(title="  메모  ", amount="0", currency="KRW").title == "메모"


@pytest.mark.parametrize("value", [0.1, 100, True])
def test_money_requires_a_decimal_string(value):
    with pytest.raises(ValidationError):
        ItemCreate(title="결제", amount=value, currency="USD")
    with pytest.raises(ValidationError):
        ItemPatch(amount=value)


@pytest.mark.parametrize("fields", [
    {"title": " "}, {"title": "x", "creator_id": str(uuid4())},
    {"title": "x", "start_datetime": "2026-10-05T12:00:00"},
    {"title": "x", "end_datetime": "2026-10-05T12:00:00+09:00"},
    {"title": "x", "start_datetime": "2026-10-05T12:00:00+09:00", "end_datetime": "2026-10-05T11:00:00+09:00"},
])
def test_invalid_input(fields):
    with pytest.raises(ValidationError):
        ItemCreate(**fields)


def test_status_history_and_source_preservation():
    repo = MemoryRepository()
    service = ItemService(repo)
    item = service.create(ItemCreate(title="원문", source_text="처음 저장한 내용"))
    assert item.status == "inbox"
    service.update(item.id, ItemPatch(status="completed"))
    completed = item.completed_at
    service.update(item.id, ItemPatch(status="completed"))
    assert item.completed_at == completed
    service.update(item.id, ItemPatch(status="archived"))
    assert item.completed_at == completed
    service.update(item.id, ItemPatch(status="todo", title="수정한 제목"))
    assert item.completed_at is None
    assert item.source_text == "처음 저장한 내용"
    service.delete(item.id)
    with pytest.raises(HTTPException) as exc:
        service.get(item.id)
    assert exc.value.status_code == 404


def test_patch_validates_merged_fields():
    service = ItemService(MemoryRepository())
    item = service.create(ItemCreate(title="결제", currency="USD", amount="1.25"))
    with pytest.raises(ValidationError):
        service.update(item.id, ItemPatch(currency="KRW"))
    assert item.currency == "USD"
    with pytest.raises(ValidationError):
        ItemPatch(title=None)


def test_dashboard_currency_date_and_status_rules():
    service = ItemService(MemoryRepository())
    today = date(2026, 10, 5)
    def make(**kwargs):
        return service.create(ItemCreate(title="항목", **kwargs))
    usd1 = make(type="payment", deadline=today, amount="0.10", currency="USD")
    usd2 = make(type="payment", deadline=date(2026, 10, 11), amount="0.20", currency="USD")
    yen = make(type="payment", start_datetime="2026-10-04T15:00:00Z", amount="1200", currency="JPY")
    missing = make(type="payment", deadline=today)
    overdue = make(deadline=date(2026, 10, 4))
    multi = make(start_datetime="2026-10-04T20:00:00+09:00", end_datetime="2026-10-06T01:00:00+09:00", deadline=today)
    done = make(type="payment", deadline=today, amount="999", currency="USD")
    service.update(done.id, ItemPatch(status="completed"))
    archived = make(deadline=today)
    service.update(archived.id, ItemPatch(status="archived"))
    next_week = make(type="payment", deadline=date(2026, 10, 12), amount="88", currency="USD")
    result = summarize([usd1, usd2, yen, missing, overdue, multi, done, archived, next_week], today)
    assert result.payments == {"USD": Decimal("0.30"), "JPY": Decimal("1200")}
    assert result.payment_missing_amount_count == 1
    assert result.today_count == 4
    assert result.overdue_count == 1
    assert result.week_deadline_count == 4
    assert result.inbox_count == 7


def test_schedule_exclusive_end():
    left = datetime.fromisoformat("2026-10-05T00:00:00+09:00")
    right = datetime.fromisoformat("2026-10-06T00:00:00+09:00")
    assert not schedule_overlaps(left.replace(day=4), left, left, right)
    assert schedule_overlaps(left, None, left, right)
    assert not schedule_overlaps(right, None, left, right)
