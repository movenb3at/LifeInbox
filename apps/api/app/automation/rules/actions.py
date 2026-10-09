from datetime import UTC, date, datetime
from uuid import UUID

from app.automation.confidence import can_capture, confirm_field
from app.automation.scheduler.service import schedule_notification
from app.models import SpaceMember
from app.models.automation import InboundEvent, ItemCandidate
from app.schemas.items import ItemFields
from app.services.spaces import SpaceService

FIELD = {"move_to_space": "space_id", "assign_user": "assignee_id", "set_type": "type", "set_deadline": "deadline", "archive": "status", "complete_item": "status", "ignore": "status"}
LABEL = {"move_to_space": "공간 분류", "assign_user": "담당자 지정", "set_type": "종류 변경", "set_deadline": "마감일 지정", "archive": "보관", "complete_item": "완료 처리", "ignore": "후보 무시"}


def apply_action(repo, settings, rule, entity, action: dict, claimed: set[str], actor_id=None) -> tuple[str, bool, bool]:
    kind = action["type"]
    field = FIELD.get(kind)
    candidate = isinstance(entity, ItemCandidate)
    if isinstance(entity, InboundEvent):
        if kind != "ignore" or settings.level != "auto_action":
            return "원본 무시는 자동 실행 수준에서 적용합니다.", False, False
        entity.status = "ignored"
        return "분석 전에 원본을 무시했습니다. 원본과 실행 기록은 보존합니다.", True, True
    if field and field in claimed:
        return f"{LABEL[kind]}: 높은 우선순위 규칙이 같은 필드를 먼저 변경하여 건너뛰었습니다.", False, False
    if kind == "create_item":
        eligible = candidate and can_capture(entity, settings)
        return "후보의 자동 저장은 사용자의 수준·신뢰도 기준에 따라 결정합니다.", False, eligible
    if (not candidate or kind == "ignore") and settings.level != "auto_action":
        return f"{LABEL.get(kind, '알림 생성')}: 자동 실행 수준에서만 적용합니다.", False, False
    if kind == "create_notification":
        if candidate:
            return "알림은 항목 생성·수정 규칙에서 생성해주세요.", False, False
        if entity.status in ("completed", "archived"):
            return "완료·보관된 항목의 알림은 생성하지 않았습니다.", False, False
        return schedule_notification(repo.session, repo.user_id, entity, rule, action["days_before"]), False, True
    payload = dict(entity.payload) if candidate else {key: getattr(entity, key) for key in ItemFields.model_fields}
    if kind == "move_to_space":
        target = UUID(action["value"])
        target_space = SpaceService(repo).require(target, write=True)
        if actor_id and UUID(actor_id) != repo.user_id:
            actor = UUID(actor_id)
            member = repo.session.get(SpaceMember, (target, actor))
            allowed = target_space.owner_id == actor or (target_space.type == "shared" and member and member.role != "viewer")
            if not allowed:
                raise ValueError("항목을 작성한 사용자가 대상 공간에 쓸 수 없어 분류를 적용하지 않았습니다.")
        if candidate:
            entity.suggested_space_id = target
            entity.suggested_assignee_id = None
            entity.routing_source = "rule"
            entity.routing_reason = f"명시적 규칙 '{rule.name}'의 저장 공간을 적용했습니다."
            confirm_field(entity, "space", str(target), entity.routing_reason, "rule")
            confirm_field(entity, "assignee", None, "공간 변경으로 담당자 지정을 해제했습니다.", "rule")
        else:
            entity.space_id = target
            entity.assignee_id = None
    elif kind == "assign_user":
        target = UUID(action["value"])
        space_id = entity.suggested_space_id if candidate else entity.space_id
        member = repo.session.get(SpaceMember, (space_id, target))
        if member is None or member.role == "viewer":
            raise ValueError("담당자는 대상 Space의 작성 가능한 멤버여야 합니다.")
        if candidate:
            entity.suggested_assignee_id = target
            confirm_field(entity, "assignee", str(target), f"규칙 '{rule.name}'이 지정했습니다.", "rule")
        else:
            entity.assignee_id = target
    elif kind in ("set_type", "set_deadline"):
        payload[field] = action["value"] if kind == "set_type" else date.fromisoformat(action["value"])
        validated = ItemFields.model_validate(payload)
        if candidate:
            entity.payload = validated.model_dump(mode="json")
            confirm_field(entity, field, entity.payload[field], f"규칙 '{rule.name}'이 지정했습니다.", "rule")
        else:
            setattr(entity, field, getattr(validated, field))
    elif kind == "ignore":
        if candidate:
            entity.status = "rejected"
        else:
            return "기존 항목을 무시하지 않았습니다. 보관 규칙을 사용해주세요.", False, False
    elif kind in ("archive", "complete_item"):
        if candidate:
            return "후보는 추가·무시로 처리합니다.", False, False
        entity.status = "archived" if kind == "archive" else "completed"
        if kind == "complete_item" and entity.completed_at is None:
            entity.completed_at = datetime.now(UTC)
    if field:
        claimed.add(field)
    message = f"{LABEL[kind]}을 적용했습니다."
    if kind == "move_to_space":
        message = f"{target_space.name} 공간으로 분류했습니다."
    elif kind == "assign_user":
        message = f"담당자 {target}을 지정했습니다."
    elif kind == "set_deadline":
        message = f"마감일을 {action['value']}로 지정했습니다."
    return message, kind == "ignore", True
