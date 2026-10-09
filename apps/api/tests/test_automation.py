from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.automation.confidence import can_capture, confirm_field, field_result, review_fields
from app.automation.integrations.base import NormalizedContent
from app.automation.parsing.service import parse, parse_many
from app.automation.routing import initial_route
from app.automation.rules.conditions import evaluate, match_conditions
from app.automation.rules.engine import preparse_ignore, rule_order
from app.automation.scheduler.service import notification_time
from app.models import Space
from app.models.automation import AutomationRule, AutomationSettings, ItemCandidate
from app.schemas.automation import CandidatePatch, Condition, RuleInput, SettingsInput
from app.schemas.items import ItemCreate, ItemPatch
from app.services.items import ItemService
from tests.test_items import MemoryRepository


def normalized(text):
    return NormalizedContent("manual_share", "", "", text, datetime.fromisoformat("2026-10-05T10:00:00+09:00"), {})


def test_korean_parser_and_conservative_confidence():
    result = parse(normalized("10월 20일까지 35,000원 입금해주세요."))
    assert result.fields.deadline.isoformat() == "2026-10-20"
    assert result.fields.amount == Decimal("35000")
    assert result.fields.type == "payment"
    assert result.confidence == Decimal("0.92")
    assert result.explanations
    assert parse(normalized("2026-10-17 수행평가 제출")).fields.deadline.isoformat() == "2026-10-17"


@pytest.mark.parametrize("text", ["2월 30일까지 제출", "10월 17일과 10월 20일 제출"])
def test_ambiguous_dates_are_not_guessed(text):
    assert parse(normalized(text)).fields.deadline is None


def test_invalid_money_is_preserved_in_description():
    result = parse(normalized("1.25원 결제"))
    assert result.fields.amount is None
    assert "1.25원" in result.fields.description


def test_and_conditions_are_numeric_and_case_insensitive():
    condition = Condition(field="amount", operator="greater_than", value="100000")
    assert evaluate(condition, {"amount": "100000.01"})
    assert not evaluate(condition, {"amount": None})
    assert not evaluate(condition, {"amount": "NaN"})
    matches, results = match_conditions([
        {"field": "sender_domain", "operator": "equals", "value": "SCHOOL.KR"},
        {"field": "confidence", "operator": "greater_or_equal", "value": "0.90"},
    ], {"sender_domain": "school.kr", "confidence": "0.90"})
    assert matches and all(entry["matched"] for entry in results)


@pytest.mark.parametrize("action", ["delete", "external_payment", "send_message", "send_email", "cancel_reservation"])
def test_external_and_destructive_actions_are_rejected(action):
    with pytest.raises(ValidationError):
        RuleInput(name="위험한 동작", trigger_type="item_created", actions=[{"type": action}])


def test_settings_order_and_default_suggest():
    assert SettingsInput().level == "suggest"
    with pytest.raises(ValidationError):
        SettingsInput(capture_threshold=0.7, review_threshold=0.8)
    with pytest.raises(ValidationError):
        Condition(field="title", operator="greater_than", value="3")


def test_multiple_spaces_capture_move_copy_and_default():
    repo = MemoryRepository()
    second = Space(id=uuid4(), name="학교", type="personal", owner_id=repo.user_id, is_default=False)
    repo.extra_spaces[second.id] = second
    service = ItemService(repo)
    original = service.create(ItemCreate(title="기록"))
    assert original.space_id == repo.space_row.id
    other = service.create(ItemCreate(title="학교 기록", space_id=second.id))
    assert service.get(other.id).space_id == second.id
    copied = service.copy(original.id, second.id)
    assert copied.id != original.id and copied.space_id == second.id
    service.update(original.id, ItemPatch(space_id=second.id))
    assert service.get(original.id).space_id == second.id
    assert copied.source_text == "기록"


def test_notification_time_uses_seoul_deadline():
    repo = MemoryRepository()
    item = ItemService(repo).create(ItemCreate(title="결제", deadline="2026-10-20"))
    assert notification_time(item, 2).isoformat() == "2026-10-18T09:00:00+09:00"


def test_editing_same_space_preserves_assignee_and_move_clears_it():
    repo = MemoryRepository()
    service = ItemService(repo)
    item = service.create(ItemCreate(title="담당 업무"))
    item.assignee_id = repo.user_id
    service.update(item.id, ItemPatch(title="업무 수정", space_id=item.space_id))
    assert item.assignee_id == repo.user_id
    other = Space(id=uuid4(), name="학교", type="personal", owner_id=repo.user_id)
    repo.extra_spaces[other.id] = other
    service.update(item.id, ItemPatch(space_id=other.id))
    assert item.assignee_id is None


def test_space_patch_validation_does_not_silently_ignore_targets():
    with pytest.raises(ValidationError):
        ItemPatch(space_id=None)
    with pytest.raises(ValidationError):
        CandidatePatch(fields={"space_id": uuid4()})


def test_many_candidates_keep_each_action_and_relative_dates():
    results = parse_many(normalized("내일까지 포스터 제출\n금요일 18:00 회의"))
    assert len(results) == 2
    assert results[0].fields.deadline.isoformat() == "2026-10-06"
    assert results[1].fields.start_datetime.isoformat() == "2026-10-09T18:00:00+09:00"
    assert results[1].fields.deadline is None
    assert len(parse_many(normalized("학교 공지\n제출 방법을 확인해주세요."))) == 1
    with pytest.raises(ValueError):
        parse_many(normalized("\n".join("회의 일정" for _ in range(21))))


def test_field_confidence_blocks_only_uncertain_or_populated_fields():
    candidate = ItemCandidate(confidence=Decimal(".99"), field_confidences={
        "title": field_result("확실한 제목", .99, "구조화 입력"),
        "space": field_result(str(uuid4()), .8, "분류 확인"),
        "deadline": field_result(None, .2, "날짜 없음"),
    })
    settings = AutomationSettings(level="auto_capture", capture_threshold=Decimal(".95"))
    assert not can_capture(candidate, settings)
    assert review_fields(candidate, settings.capture_threshold) == ["space"]
    confirm_field(candidate, "space", candidate.field_confidences["space"]["value"], "직접 확인")
    assert can_capture(candidate, settings)
    candidate.field_confidences = {**candidate.field_confidences, "deadline": field_result(None, .2, "두 날짜", needs_review=True)}
    assert not can_capture(candidate, settings)
    assert parse(normalized("10월 17일과 10월 20일 제출")).field_confidences["deadline"]["needs_review"]


def test_rule_scopes_and_legacy_space_input():
    target = uuid4()
    common = {"name": "분류", "trigger_type": "candidate_created", "actions": [{"type": "ignore"}]}
    legacy = RuleInput(**common, space_id=target)
    assert legacy.scope_type == "space" and legacy.scope_id == target
    assert RuleInput(**common, scope_type="integration", scope_id=target).space_id is None
    for scope in ({"scope_type": "space"}, {"scope_type": "global", "scope_id": target},
                  {"scope_type": "integration", "scope_id": target, "space_id": target}):
        with pytest.raises(ValidationError):
            RuleInput(**common, **scope)


def test_conflict_order_and_preparse_ignore_eligibility():
    now = datetime.fromisoformat("2026-10-05T10:00:00+09:00")
    rules = [AutomationRule(id=uuid4(), scope_type=scope, priority=0, created_at=now) for scope in ("global", "space", "integration")]
    assert [r.scope_type for r in sorted(rules, key=rule_order)] == ["space", "integration", "global"]
    rules[0].priority = 1
    assert sorted(rules, key=rule_order)[0] is rules[0]
    rule = AutomationRule(actions=[{"type": "ignore"}], conditions=[{"field": "sender_domain"}])
    assert preparse_ignore(rule)
    rule.conditions = [{"field": "type"}]
    assert not preparse_ignore(rule)


def test_ambiguous_amount_and_invalid_time_require_review():
    result = parse(normalized("10월 20일 18:60 회의"))
    assert result.fields.start_datetime is None
    assert result.field_confidences["start_datetime"]["needs_review"]
    result = parse(normalized("10월 20일까지 35,000원과 10,000원 입금"))
    assert result.fields.amount is None
    assert result.field_confidences["amount"]["needs_review"]
    negative = parse(normalized("-35,000원 결제"))
    assert negative.fields.amount is None and negative.field_confidences["amount"]["needs_review"]


def test_revoked_integration_destination_retains_default_for_review():
    from types import SimpleNamespace

    default = Space(id=uuid4(), name="기본", is_default=True)
    repo = SimpleNamespace(default_space=lambda: default, space_role=lambda _: None)
    integration = SimpleNamespace(settings={"default_space_id": str(uuid4())})
    target, source, confidence = initial_route(repo, integration, "공유 원본")
    assert target == default.id and source == "default" and confidence["needs_review"]


def test_parser_route_never_suggests_viewer_space():
    from types import SimpleNamespace

    default = Space(id=uuid4(), name="기본", is_default=True)
    school = Space(id=uuid4(), name="학교", is_default=False)
    session = SimpleNamespace(scalars=lambda _: [school])
    repo = SimpleNamespace(default_space=lambda: default, session=session, accessible_spaces=lambda: None,
                           space_role=lambda _: "viewer")
    integration = SimpleNamespace(settings={})
    assert initial_route(repo, integration, "학교 공지")[0] == default.id
    repo.space_role = lambda _: "member"
    target, source, confidence = initial_route(repo, integration, "학교 공지")
    assert target == school.id and source == "parser" and confidence["confidence"] == .8
