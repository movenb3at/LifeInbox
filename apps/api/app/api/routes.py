from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.dependencies import Repo
from app.schemas.items import (
    CalendarOut,
    DashboardOut,
    ItemCreate,
    ItemOut,
    ItemPage,
    ItemPatch,
    ItemType,
    SpaceOut,
    Status,
    UserOut,
)
from app.schemas.spaces import CopyInput, MemberInput, MemberOut, SpaceCreate, SpacePatch
from app.services.items import ItemService
from app.services.spaces import SpaceService
from app.services.views import ViewService

router = APIRouter(prefix="/api/v1")


@router.get("/me", response_model=UserOut)
def me(repo: Repo):
    user = repo.user()
    if user is None:
        raise HTTPException(401, "사용자 계정을 찾을 수 없습니다.")
    return user


@router.get("/me/space", response_model=SpaceOut)
def personal_space(repo: Repo):
    return ItemService(repo).space()


@router.get("/items", response_model=ItemPage)
def items(
    repo: Repo, q: Annotated[str, Query(max_length=200)] = "",
    status: Status | None = None, type: ItemType | None = None,
    page: Annotated[int, Query(ge=1, le=100000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    space_id: UUID | None = None,
):
    if space_id:
        SpaceService(repo).require(space_id)
    rows, total = repo.list(space_id, q.strip(), status, type, page, page_size)
    return ItemPage(items=[ItemOut.model_validate(item) for item in rows], total=total, page=page, page_size=page_size)


@router.post("/items", response_model=ItemOut, status_code=201)
def create_item(data: ItemCreate, repo: Repo):
    return ItemService(repo).create(data)


@router.get("/items/{item_id}", response_model=ItemOut)
def get_item(item_id: UUID, repo: Repo):
    return ItemService(repo).get(item_id)


@router.patch("/items/{item_id}", response_model=ItemOut)
def update_item(item_id: UUID, data: ItemPatch, repo: Repo):
    return ItemService(repo).update(item_id, data)


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: UUID, repo: Repo):
    ItemService(repo).delete(item_id)
    return Response(status_code=204)


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(repo: Repo, space_id: UUID | None = None):
    return ViewService(repo, space_id).dashboard()


@router.get("/calendar", response_model=CalendarOut)
def calendar(repo: Repo, month: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")], space_id: UUID | None = None):
    try:
        return ViewService(repo, space_id).calendar(month)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, "올바른 연월을 입력해주세요.") from exc


@router.post("/items/{item_id}/copy", response_model=ItemOut, status_code=201)
def copy_item(item_id: UUID, data: CopyInput, repo: Repo):
    return ItemService(repo).copy(item_id, data.space_id)


@router.get("/spaces", response_model=list[SpaceOut])
def spaces(repo: Repo):
    return SpaceService(repo).list()


@router.post("/spaces", response_model=SpaceOut, status_code=201)
def create_space(data: SpaceCreate, repo: Repo):
    return SpaceService(repo).create(data)


@router.patch("/spaces/{space_id}", response_model=SpaceOut)
def update_space(space_id: UUID, data: SpacePatch, repo: Repo):
    return SpaceService(repo).update(space_id, data)


@router.delete("/spaces/{space_id}", status_code=204)
def delete_space(space_id: UUID, repo: Repo):
    SpaceService(repo).delete(space_id)
    return Response(status_code=204)


@router.get("/spaces/{space_id}/members", response_model=list[MemberOut])
def members(space_id: UUID, repo: Repo):
    return SpaceService(repo).members(space_id)


@router.post("/spaces/{space_id}/members", response_model=MemberOut)
def add_member(space_id: UUID, data: MemberInput, repo: Repo):
    from sqlalchemy.exc import IntegrityError
    try:
        return SpaceService(repo).set_member(space_id, data)
    except IntegrityError as exc:
        raise HTTPException(422, "가입된 사용자 ID인지 확인해주세요.") from exc


@router.delete("/spaces/{space_id}/members/{user_id}", status_code=204)
def remove_member(space_id: UUID, user_id: UUID, repo: Repo):
    SpaceService(repo).remove_member(space_id, user_id)
    return Response(status_code=204)
