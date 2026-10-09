from datetime import UTC, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Item
from app.models.automation import Notification

TZ = ZoneInfo("Asia/Seoul")


def notification_time(item: Item, days_before: int) -> datetime:
    basis = datetime.combine(item.deadline, time(9), TZ) if item.deadline else item.start_datetime
    if basis is None:
        if days_before:
            raise ValueError("미리 알림에는 마감일 또는 일정 시작이 필요합니다.")
        return datetime.now(UTC)
    return basis - timedelta(days=days_before)


def cancel_notifications(session: Session, item_id: UUID):
    session.execute(update(Notification).where(Notification.item_id == item_id, Notification.status == "scheduled").values(status="cancelled"))


def schedule_notification(session: Session, user_id: UUID, item: Item, rule, days_before: int):
    if item.status in ("completed", "archived"):
        return "완료·보관된 항목의 알림은 생성하지 않았습니다."
    when = notification_time(item, days_before)
    # 시각 없는 일반 알림은 재실행해도 하나만 생성합니다.
    basis = when.isoformat() if item.deadline or item.start_datetime else "immediate"
    key = f"{rule.id}:{item.id}:{days_before}:{basis}"
    now = datetime.now(UTC)
    session.execute(insert(Notification).values(
        user_id=user_id, item_id=item.id, rule_id=rule.id, title=item.title,
        message=f"{rule.name}: {'마감·일정 '+str(days_before)+'일 전' if days_before else '항목 확인'} 알림",
        dedupe_key=key, scheduled_for=when, status="delivered" if when <= now else "scheduled",
        delivered_at=now if when <= now else None,
    ).on_conflict_do_update(index_elements=[Notification.user_id, Notification.dedupe_key],
        set_={"status": "delivered" if when <= now else "scheduled", "title": item.title,
              "delivered_at": now if when <= now else None}, where=Notification.status == "cancelled"))
    return f"앱 내 알림을 {when.astimezone(TZ).strftime('%Y-%m-%d %H:%M')}에 예약했습니다."


def deliver_due(session: Session, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    rows = session.scalars(select(Notification).where(
        Notification.status == "scheduled", Notification.scheduled_for <= now,
    ).order_by(Notification.scheduled_for).limit(200).with_for_update(skip_locked=True))
    count = 0
    for notification in rows:
        item = session.get(Item, notification.item_id) if notification.item_id else None
        if item is None or item.status in ("completed", "archived"):
            notification.status = "cancelled"
        else:
            notification.status = "delivered"
            notification.delivered_at = now
            count += 1
    session.flush()
    return count
