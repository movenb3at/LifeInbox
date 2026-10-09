import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from app.automation.confidence import field_result
from app.automation.rules.actions import apply_action
from app.automation.rules.conditions import match_conditions
from app.models.automation import AutomationRule, AutomationRun, InboundEvent, ItemCandidate
from app.schemas.items import ItemFields


def snapshot(entity) -> dict:
    if isinstance(entity, InboundEvent):
        content = entity.raw_content.get("content", "")
        title = entity.raw_content.get("title") or (content.splitlines()[0][:200] if content else "")
        return {"title": title, "description": content,
                "status": entity.status, "source_type": entity.source_type}
    if isinstance(entity, ItemCandidate):
        return {**entity.payload, "space_id": str(entity.suggested_space_id), "status": entity.status, "confidence": str(entity.confidence)}
    return {**ItemFields.model_validate(entity, from_attributes=True).model_dump(mode="json"), "space_id": str(entity.space_id), "status": entity.status}


def rule_order(rule):
    return (-rule.priority, -{"space": 2, "integration": 1, "global": 0}[rule.scope_type], rule.created_at, str(rule.id))


def preparse_ignore(rule):
    available = {"source_type", "sender", "sender_domain", "title", "text", "space_id", "delivery_status"}
    return bool(rule.actions) and all(action["type"] == "ignore" for action in rule.actions) and all(condition["field"] in available for condition in rule.conditions)


def error_text(error: Exception) -> str:
    if isinstance(error, HTTPException):
        return str(error.detail)[:500]
    if isinstance(error, ValueError):
        return str(error).split("\n")[0][:500]
    return "규칙 실행을 완료하지 못했습니다. 입력과 대상 공간의 권한을 확인해주세요."


class RuleEngine:
    def __init__(self, repo, settings):
        self.repo = repo
        self.settings = settings

    def run(self, trigger, entity, extra: dict | None = None, revision: str = "", only_notifications: bool = False, required_scope=None, preparse=False, exclude_rules=None):
        context = {**snapshot(entity), **(extra or {})}
        context["text"] = f"{context.get('title', '')}\n{context.get('description', '')}\n{context.get('source_text', '')}"
        context["sender_domain"] = context.get("sender", "").rsplit("@", 1)[-1].casefold()
        query = select(AutomationRule).where(
            AutomationRule.user_id == self.repo.user_id, AutomationRule.trigger_type.in_((trigger,) if isinstance(trigger, str) else trigger),
            AutomationRule.is_enabled.is_(True),
        )
        if required_scope:
            query = query.where(AutomationRule.space_id == required_scope)
        rules = self.repo.session.scalars(query)
        claimed: set[str] = set()
        stopped = False
        processed = set()
        for rule in sorted(rules, key=rule_order):
            if (exclude_rules and rule.id in exclude_rules) or (preparse and not preparse_ignore(rule)):
                continue
            if rule.space_id and str(rule.space_id) != context["space_id"]:
                continue
            if rule.scope_type == "integration" and str(rule.integration_id) != context.get("integration_id"):
                continue
            processed.add(rule.id)
            signature = json.dumps([context, rule.conditions, rule.actions, revision], sort_keys=True, default=str)
            digest = hashlib.sha256(signature.encode()).hexdigest()
            key = f"{rule.id}:{rule.trigger_type}:{entity.id}:{digest}"
            if self.repo.session.scalar(select(AutomationRun.id).where(AutomationRun.execution_key == key, AutomationRun.user_id == self.repo.user_id)):
                continue
            outcomes, conditions = [], []
            status, error = "skipped", None
            previous_claims = set(claimed)
            previous_stop = stopped
            try:
                with self.repo.session.begin_nested():
                    matches, conditions = match_conditions(rule.conditions, context)
                    if stopped:
                        outcomes.append("이전 ignore 규칙이 처리를 종료했습니다.")
                    elif not matches:
                        outcomes.append("AND 조건이 일치하지 않았습니다.")
                    else:
                        actions = [action for action in rule.actions if not only_notifications or action["type"] == "create_notification"]
                        applied = False
                        for action in sorted(actions, key=lambda action: action["type"] == "create_notification"):
                            outcome, stop, changed = apply_action(self.repo, self.settings, rule, entity, action, claimed, context.get("actor_id"))
                            applied = applied or changed
                            outcomes.append(outcome)
                            if stop:
                                stopped = True
                                break
                        self.repo.session.flush()
                        status = "success" if applied else "skipped"
                        if isinstance(entity, ItemCandidate):
                            entity.explanations = [*entity.explanations, f"규칙 {rule.name}: {' · '.join(outcomes)}"]
            except Exception as exc:
                claimed = previous_claims
                stopped = previous_stop
                status, error = "failed", error_text(exc)
                if isinstance(entity, ItemCandidate) and any(a["type"] == "move_to_space" for a in rule.actions) and "space_id" not in claimed:
                    entity.field_confidences = {**entity.field_confidences, "space": field_result(str(entity.suggested_space_id), 0, error, "rule", True)}
            self.repo.session.add(AutomationRun(
                user_id=self.repo.user_id, rule_id=rule.id, rule_name=rule.name, trigger_type=rule.trigger_type,
                trigger_entity_id=entity.id, execution_key=key, status=status,
                input_snapshot={"entity": context, "conditions": conditions},
                output_snapshot={"entity": snapshot(entity), "actions": outcomes}, error_message=error,
            ))
            self.repo.session.flush()
        return processed
