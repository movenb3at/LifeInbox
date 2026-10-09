from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_

from app.models import Item
from app.repositories.items import ItemRepository
from app.schemas.items import CalendarEntry, CalendarOut, DashboardOut, ItemOut
from app.services.spaces import SpaceService

ACTIVE = ("inbox", "todo", "in_progress")
TZ = ZoneInfo("Asia/Seoul")


def schedule_overlaps(start: datetime, end: datetime | None, left: datetime, right: datetime) -> bool:
    return start < right and (end > left if end else start >= left)


def summarize(items: list[Item], today: date) -> DashboardOut:
    active = [item for item in items if item.status in ACTIVE]
    left = datetime.combine(today, time.min, TZ)
    right = left + timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=7)
    today_items = [item for item in active if item.deadline == today or (
        item.start_datetime and schedule_overlaps(item.start_datetime, item.end_datetime, left, right)
    )]
    overdue = [item for item in active if item.deadline and item.deadline < today]
    overdue.sort(key=lambda item: (item.deadline, str(item.id)))
    payments: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    missing = 0
    for item in active:
        payment_date = item.deadline or (
            item.start_datetime.astimezone(TZ).date() if item.start_datetime else None
        )
        if item.type == "payment" and payment_date and today <= payment_date < week_end:
            if item.amount is None:
                missing += 1
            else:
                payments[item.currency] += item.amount
    return DashboardOut(
        today=today, inbox_count=sum(item.status == "inbox" for item in active),
        overdue_count=len(overdue), today_count=len(today_items),
        week_deadline_count=sum(bool(item.deadline and week_start <= item.deadline < week_end) for item in active),
        today_items=[ItemOut.model_validate(item) for item in today_items[:20]],
        overdue_items=[ItemOut.model_validate(item) for item in overdue[:20]],
        payments=dict(payments), payment_missing_amount_count=missing,
    )


class ViewService:
    def __init__(self, repo: ItemRepository, space_id=None):
        self.repo = repo
        self.space_id = space_id
        if space_id:
            SpaceService(repo).require(space_id)

    def dashboard(self):
        today = datetime.now(TZ).date()
        start = today - timedelta(days=today.weekday())
        end = datetime.combine(start + timedelta(days=7), time.min, TZ)
        left = datetime.combine(today, time.min, TZ)
        relevant = self.repo.scoped(self.space_id).where(
            Item.status.in_(ACTIVE), or_(
                Item.status == "inbox", Item.deadline < end.date(),
                and_(Item.start_datetime < end, or_(
                    Item.end_datetime > left,
                    and_(Item.end_datetime.is_(None), Item.start_datetime >= left),
                )),
            ),
        ).order_by(Item.created_at.desc())
        return summarize(list(self.repo.session.scalars(relevant)), today)

    def calendar(self, month: str):
        first = date.fromisoformat(f"{month}-01")
        next_month = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
        left = datetime.combine(first, time.min, TZ)
        right = datetime.combine(next_month, time.min, TZ)
        query = self.repo.scoped(self.space_id).where(Item.status != "archived", or_(
            and_(Item.deadline >= first, Item.deadline < next_month),
            and_(Item.start_datetime < right, or_(
                Item.end_datetime > left,
                and_(Item.end_datetime.is_(None), Item.start_datetime >= left),
            )),
        )).order_by(Item.created_at.desc())
        entries = []
        for item in self.repo.session.scalars(query):
            if item.deadline and first <= item.deadline < next_month:
                entries.append(CalendarEntry(id=f"{item.id}:deadline", kind="deadline", item=ItemOut.model_validate(item)))
            if item.start_datetime and schedule_overlaps(item.start_datetime, item.end_datetime, left, right):
                entries.append(CalendarEntry(id=f"{item.id}:schedule", kind="schedule", item=ItemOut.model_validate(item)))
        return CalendarOut(month=month, entries=entries)
