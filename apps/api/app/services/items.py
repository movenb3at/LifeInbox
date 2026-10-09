from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException

from app.models import Item
from app.repositories.items import ItemRepository
from app.schemas.items import ItemCreate, ItemFields, ItemPatch, Status


class ItemService:
    def __init__(self, repository: ItemRepository):
        self.repo = repository

    def space(self):
        space = self.repo.default_space()
        if space is None:
            raise HTTPException(503, "개인 Inbox가 준비되지 않았습니다. DB 설정을 확인해주세요.")
        return space

    def get(self, item_id: UUID):
        item = self.repo.get(item_id)
        if item is None:
            raise HTTPException(404, "항목을 찾을 수 없습니다.")
        return item

    def create(self, data: ItemCreate):
        values = data.model_dump()
        space_id = values.pop("space_id") or self.space().id
        self.require_write(space_id)
        values["source_text"] = data.source_text or data.title
        item = Item(**values, space_id=space_id, creator_id=self.repo.user_id, status="inbox")
        self.repo.save(item)
        self.automation(item, "item_created")
        return item

    def require_write(self, space_id: UUID):
        role = self.repo.space_role(space_id)
        if role is None:
            raise HTTPException(404, "저장 공간을 찾을 수 없습니다.")
        if role == "viewer":
            raise HTTPException(403, "읽기 전용 저장 공간입니다.")

    def automation(self, item: Item, trigger: str, reschedule: bool = False):
        if hasattr(self.repo, "session"):
            from app.automation.service import AutomationService
            AutomationService(self.repo).on_item(item, trigger, reschedule)

    def update(self, item_id: UUID, data: ItemPatch):
        item = self.get(item_id)
        self.require_write(item.space_id)
        changes = data.model_dump(exclude_unset=True)
        reschedule = any(key in changes and changes[key] != getattr(item, key) for key in ("deadline", "start_datetime", "status", "type", "space_id"))
        target = changes.pop("space_id", None)
        if target and target != item.space_id:
            self.require_write(target)
            item.space_id = target
            item.assignee_id = None
        merged = {key: changes.get(key, getattr(item, key)) for key in ItemFields.model_fields}
        ItemFields.model_validate(merged)
        if "status" in changes:
            new_status = changes["status"]
            if new_status == Status.completed and item.status != Status.completed:
                item.completed_at = datetime.now(UTC)
            elif new_status in (Status.inbox, Status.todo, Status.in_progress):
                item.completed_at = None
        for key, value in changes.items():
            setattr(item, key, value)
        self.repo.save(item)
        self.automation(item, "item_updated", reschedule)
        return item

    def copy(self, item_id: UUID, space_id: UUID):
        original = self.get(item_id)
        fields = {key: getattr(original, key) for key in ItemFields.model_fields}
        return self.create(ItemCreate(**fields, source_text=original.source_text, space_id=space_id))

    def delete(self, item_id: UUID):
        item = self.get(item_id)
        self.require_write(item.space_id)
        if hasattr(self.repo, "session"):
            from app.automation.scheduler.service import cancel_notifications
            cancel_notifications(self.repo.session, item.id)
        self.repo.delete(item)
