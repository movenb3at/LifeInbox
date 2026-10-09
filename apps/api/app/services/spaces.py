from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import Item, Space, SpaceMember
from app.repositories.items import ItemRepository
from app.schemas.items import SpaceOut
from app.schemas.spaces import MemberInput, SpaceCreate, SpacePatch


class SpaceService:
    def __init__(self, repo: ItemRepository):
        self.repo = repo

    def require(self, space_id: UUID, write: bool = False, owner: bool = False):
        role = self.repo.space_role(space_id)
        if role is None:
            raise HTTPException(404, "저장 공간을 찾을 수 없습니다.")
        if (write and role == "viewer") or (owner and role != "owner"):
            raise HTTPException(403, "이 저장 공간에 필요한 권한이 없습니다.")
        return self.repo.session.get(Space, space_id)

    def list(self):
        spaces = self.repo.session.scalars(self.repo.accessible_spaces().order_by(Space.is_default.desc(), Space.created_at, Space.id))
        return [SpaceOut(id=s.id, name=s.name, type=s.type, is_default=s.is_default, role=self.repo.space_role(s.id)) for s in spaces]

    def create(self, data: SpaceCreate):
        space = Space(id=uuid4(), owner_id=self.repo.user_id, name=data.name, type=data.type, is_default=False)
        self.repo.session.add(space)
        self.repo.session.flush()
        self.repo.session.add(SpaceMember(space_id=space.id, user_id=self.repo.user_id, role="owner"))
        self.repo.session.flush()
        return SpaceOut.model_validate(space)

    def update(self, space_id: UUID, data: SpacePatch):
        space = self.require(space_id, owner=True)
        if data.is_default:
            if space.type != "personal":
                raise HTTPException(422, "기본 Inbox는 본인의 Personal Space만 지정할 수 있습니다.")
            rows = list(self.repo.session.scalars(select(Space).where(
                Space.owner_id == self.repo.user_id, Space.type == "personal",
            ).order_by(Space.id).with_for_update()))
            for row in rows:
                if row.is_default:
                    row.is_default = False
            self.repo.session.flush()
            space.is_default = True
        if data.name is not None:
            space.name = data.name
        self.repo.session.flush()
        return SpaceOut.model_validate(space)

    def delete(self, space_id: UUID):
        space = self.require(space_id, owner=True)
        if space.is_default:
            raise HTTPException(409, "다른 Personal Space를 기본 Inbox로 지정한 후 삭제해주세요.")
        count = self.repo.session.scalar(select(func.count()).select_from(Item).where(Item.space_id == space_id))
        if count:
            raise HTTPException(409, "항목을 다른 저장 공간으로 이동한 후 삭제해주세요.")
        # 자동화의 대상 참조도 보존합니다. 관련 규칙·후보가 있으면 DB의 FK가 삭제를 막습니다.
        from app.models.automation import AutomationRule, ItemCandidate

        if self.repo.session.scalar(select(AutomationRule.id).where(AutomationRule.space_id == space_id).limit(1)) or self.repo.session.scalar(
            select(ItemCandidate.id).where(ItemCandidate.suggested_space_id == space_id).limit(1)
        ):
            raise HTTPException(409, "이 공간을 참조하는 자동화 규칙·후보의 저장 위치를 먼저 변경해주세요.")
        self.repo.session.delete(space)
        try:
            self.repo.session.flush()
        except IntegrityError as exc:
            raise HTTPException(409, "이 공간을 참조하는 자동화 데이터가 있어 삭제할 수 없습니다.") from exc

    def members(self, space_id: UUID):
        self.require(space_id)
        return list(self.repo.session.scalars(select(SpaceMember).where(SpaceMember.space_id == space_id)))

    def set_member(self, space_id: UUID, data: MemberInput):
        space = self.require(space_id, owner=True)
        if space.type != "shared" or data.user_id == space.owner_id:
            raise HTTPException(422, "공유 공간의 다른 사용자만 Member·Viewer로 지정할 수 있습니다.")
        member = self.repo.session.get(SpaceMember, (space_id, data.user_id))
        if member:
            member.role = data.role
            if data.role == "viewer":
                for item in self.repo.session.scalars(select(Item).where(Item.space_id == space_id, Item.assignee_id == data.user_id)):
                    item.assignee_id = None
        else:
            member = SpaceMember(space_id=space_id, user_id=data.user_id, role=data.role)
            self.repo.session.add(member)
        self.repo.session.flush()
        return member

    def remove_member(self, space_id: UUID, user_id: UUID):
        space = self.require(space_id, owner=True)
        if space.type != "shared" or user_id == space.owner_id:
            raise HTTPException(422, "Owner 멤버십은 제거할 수 없습니다.")
        member = self.repo.session.get(SpaceMember, (space_id, user_id))
        if member:
            for item in self.repo.session.scalars(select(Item).where(Item.space_id == space_id, Item.assignee_id == user_id)):
                item.assignee_id = None
            self.repo.session.flush()
            self.repo.session.delete(member)
            self.repo.session.flush()
