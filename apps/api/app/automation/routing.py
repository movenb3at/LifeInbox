from uuid import UUID

from fastapi import HTTPException

from app.automation.confidence import field_result
from app.services.spaces import SpaceService


def initial_route(repo, integration, text):
    default = repo.default_space()
    if default is None:
        raise ValueError("기본 Personal Space를 찾을 수 없습니다.")
    target = integration.settings.get("default_space_id")
    if target:
        try:
            space = SpaceService(repo).require(UUID(target), write=True)
            reason = "수집 경로의 기본 저장 공간을 적용했습니다."
            return space.id, "integration", field_result(str(space.id), 1, reason, "integration")
        except (HTTPException, ValueError):
            reason = "수집 경로의 대상 공간에 쓸 수 없어 개인 기본 공간에 보존했습니다. 저장 위치를 확인해주세요."
            return default.id, "default", field_result(str(default.id), 0, reason, "default", True)
    spaces = [space for space in repo.session.scalars(repo.accessible_spaces())
              if repo.space_role(space.id) != "viewer" and not space.is_default
              and len(space.name.strip()) >= 2 and space.name.casefold() in text.casefold()]
    if spaces:
        if len(spaces) == 1:
            space = spaces[0]
            reason = "본문에서 저장 공간 이름을 발견했습니다. 분류를 확인해주세요."
            return space.id, "parser", field_result(str(space.id), .8, reason)
        reason = "여러 저장 공간 이름이 일치하여 개인 기본 공간에 보존했습니다."
        return default.id, "default", field_result(str(default.id), .4, reason, "parser", True)
    reason = "사용자의 기본 Personal Space를 적용했습니다."
    return default.id, "default", field_result(str(default.id), 1, reason, "default")
