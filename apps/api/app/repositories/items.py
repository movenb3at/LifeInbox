from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Item, Space, SpaceMember, User


class ItemRepository:
    def __init__(self, session: Session, user_id: UUID):
        self.session = session
        self.user_id = user_id

    def user(self):
        return self.session.get(User, self.user_id)

    def default_space(self):
        return self.session.scalar(select(Space).where(Space.owner_id == self.user_id, Space.is_default.is_(True)))

    def accessible_spaces(self):
        member = select(SpaceMember.space_id).where(SpaceMember.user_id == self.user_id)
        return select(Space).where(or_(Space.owner_id == self.user_id, (Space.type == "shared") & Space.id.in_(member)))

    def space_role(self, space_id: UUID):
        space = self.session.scalar(self.accessible_spaces().where(Space.id == space_id))
        if space is None:
            return None
        if space.owner_id == self.user_id:
            return "owner"
        return self.session.scalar(select(SpaceMember.role).where(SpaceMember.space_id == space_id, SpaceMember.user_id == self.user_id))

    def scoped(self, space_id: UUID | None = None):
        query = select(Item).where(Item.space_id.in_(self.accessible_spaces().with_only_columns(Space.id)))
        return query.where(Item.space_id == space_id) if space_id else query

    def get(self, item_id: UUID, space_id: UUID | None = None):
        return self.session.scalar(self.scoped(space_id).where(Item.id == item_id))

    def list(self, space_id: UUID, q: str, status: str | None, item_type: str | None, page: int, size: int):
        query = self.scoped(space_id)
        if status:
            query = query.where(Item.status == status)
        if item_type:
            query = query.where(Item.type == item_type)
        if q:
            escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            query = query.where(or_(
                Item.title.ilike(pattern, escape="\\"),
                Item.description.ilike(pattern, escape="\\"),
                Item.source_text.ilike(pattern, escape="\\"),
            ))
        total = self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.session.scalars(
            query.order_by(Item.created_at.desc(), Item.id.desc()).offset((page - 1) * size).limit(size)
        ).all()
        return rows, total

    def save(self, item: Item):
        self.session.add(item)
        self.session.flush()
        self.session.refresh(item)
        return item

    def delete(self, item: Item):
        self.session.delete(item)
        self.session.flush()
