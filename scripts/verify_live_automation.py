"""실제 PostgreSQL에서 확장 API를 실행하고 최상위 트랜잭션을 되돌립니다.

이 검증 프로세스의 repository 의존성만 교체합니다. 실행 중인 API와 JWT 검증에는
영향을 주지 않으며, 사용자 데이터와 임시 규칙·수집 기록을 commit하지 않습니다.
"""
import argparse
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/api"))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.api.dependencies import repository  # noqa: E402
from app.core.database import get_engine  # noqa: E402
from app.main import app  # noqa: E402
from app.repositories.items import ItemRepository  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=UUID, required=True)
    user_id = parser.parse_args().user_id
    active_id = [user_id]
    connection = get_engine().connect()
    transaction = connection.begin()

    def test_repository():
        with Session(bind=connection, join_transaction_mode="create_savepoint") as session, session.begin():
            session.execute(text("SELECT set_config('app.user_id',:id,true)"), {"id": str(active_id[0])})
            yield ItemRepository(session, active_id[0])

    app.dependency_overrides[repository] = test_repository
    try:
        with TestClient(app) as client:
            def call(method, path, body=None, expected=200):
                response = client.request(method, "/api/v1/" + path, json=body)
                assert response.status_code == expected, (method, path, response.status_code, response.text[:800])
                return response.json() if response.content else None

            original = call("GET", "me/space")
            assert original["is_default"]
            a = call("POST", "spaces", {"name": "확장 검증 학교", "type": "personal"}, 201)
            b = call("POST", "spaces", {"name": "확장 검증 개발", "type": "personal"}, 201)
            shared = call("POST", "spaces", {"name": "확장 검증 공유", "type": "shared"}, 201)
            assert len(call("GET", "spaces")) >= 4
            call("PATCH", f"spaces/{a['id']}", {"is_default": True})
            assert call("GET", "me/space")["id"] == a["id"]
            item = call("POST", "items", {"title": "확장 검증 수동"}, 201)
            assert item["space_id"] == a["id"]
            call("DELETE", f"spaces/{a['id']}", expected=409)
            copied = call("POST", f"items/{item['id']}/copy", {"space_id": b["id"]}, 201)
            assert copied["id"] != item["id"]
            moved = call("PATCH", f"items/{item['id']}", {"space_id": b["id"]})
            assert moved["space_id"] == b["id"]
            assert call("GET", f"items?space_id={b['id']}&q=확장 검증")["total"] == 2
            call("PATCH", f"spaces/{original['id']}", {"is_default": True})
            call("DELETE", f"spaces/{b['id']}", expected=409)
            call("PATCH", f"items/{item['id']}", {"space_id": None}, 422)
            call("PATCH", f"spaces/{shared['id']}", {"is_default": True}, 422)
            assert call("GET", "automation/settings")["level"] == "suggest"

            def rule(name, trigger, actions, priority=0, conditions=None, scope_type="global", scope_id=None):
                return call("POST", "automation/rules", {"name": name, "trigger_type": trigger, "priority": priority,
                    "conditions": conditions or [], "actions": actions, "scope_type": scope_type, "scope_id": scope_id}, 201)

            route = rule("확장 검증 학교 분류", "candidate_created", [{"type": "move_to_space", "value": a["id"]}], 100)
            lower = rule("확장 검증 낮은 우선순위", "candidate_created", [{"type": "move_to_space", "value": b["id"]}], 50)
            notify = rule("확장 검증 결제 알림", "item_created", [{"type": "create_notification", "days_before": 2}], conditions=[{"field": "type", "operator": "equals", "value": "payment"}])
            due = (datetime.now(UTC) + timedelta(days=15)).date().isoformat()
            share = {"external_id": "verify-" + str(uuid4()), "title": "확장 검증 결제", "content": f"{due}까지 35,000원 입금", "source_type": "email", "sender": "notice@school.kr"}
            event = call("POST", "automation/events", share, 201)
            assert event["status"] == "processed", event
            assert call("POST", "automation/events", share, 201)["id"] == event["id"]
            candidates = call("GET", "automation/candidates")
            candidate = next(c for c in candidates if c["inbound_event_id"] == event["id"])
            assert candidate["suggested_space_id"] == a["id"]
            assert candidate["confidence"] == 0.92 and candidate["item_id"] is None
            edited = call("PATCH", f"automation/candidates/{candidate['id']}", {"fields": {"title": "확장 검증 수정 후보"}})
            assert edited["corrections"] and edited["original_payload"]["title"] == share["title"]
            accepted = call("POST", f"automation/candidates/{candidate['id']}/accept", {})
            assert call("POST", f"automation/candidates/{candidate['id']}/accept", {})["item_id"] == accepted["item_id"]
            assert call("GET", f"items/{accepted['item_id']}")["source_text"] == share["content"]
            call("PATCH", "automation/settings", {"level": "auto_action", "capture_threshold": 0.90, "review_threshold": 0.70})
            bad = rule("확장 검증 실패 격리", "candidate_created", [{"type": "set_type", "value": "note"}, {"type": "assign_user", "value": str(uuid4())}], 200)
            share["external_id"] = "verify-" + str(uuid4())
            automatic_event = call("POST", "automation/events", share, 201)
            assert automatic_event["status"] == "processed", automatic_event
            automatic = next(c for c in call("GET", "automation/candidates?status=auto_accepted") if c["inbound_event_id"] == automatic_event["id"])
            assert automatic["payload"]["type"] == "payment" and automatic["suggested_space_id"] == a["id"]
            assert automatic["item_id"]
            history = call("GET", "automation/runs")
            assert any(r["rule_id"] == bad["id"] and r["status"] == "failed" for r in history)
            assert any("우선순위" in str(r["output_snapshot"]) for r in history)
            assert any(r["rule_name"] == "후보 처리 기준" and r["status"] == "success" for r in history)
            assert any(r["rule_id"] == lower["id"] and r["status"] == "skipped" for r in history)
            # Integration 목적지와 사용자 Default fallback은 규칙과 별도로 동작합니다.
            for r in (route, lower, bad):
                call("PATCH", f"automation/rules/{r['id']}", {key: value for key, value in r.items() if key not in ("id", "created_at", "updated_at")} | {"is_enabled": False})
            integration = call("GET", "automation/integrations")[0]
            call("PATCH", f"automation/integrations/{integration['id']}/destination", {"space_id": b["id"]})
            assert call("GET", "automation/integrations")[0]["default_space_id"] == b["id"]
            fallback_event = call("POST", "automation/events", {"content": "확장 검증 모호한 기록", "external_id": str(uuid4())}, 201)
            fallback = next(c for c in call("GET", "automation/candidates") if c["inbound_event_id"] == fallback_event["id"])
            assert fallback["suggested_space_id"] == b["id"] and fallback["item_id"] is None
            call("PATCH", f"automation/integrations/{integration['id']}/destination", {"space_id": None})
            default_event = call("POST", "automation/events", {"content": "확장 검증 기본 기록", "external_id": str(uuid4())}, 201)
            default_candidate = next(c for c in call("GET", "automation/candidates") if c["inbound_event_id"] == default_event["id"])
            assert default_candidate["suggested_space_id"] == original["id"]
            call("POST", f"automation/candidates/{default_candidate['id']}/reject", {})
            notifications = call("GET", "notifications")
            planned = [n for n in notifications if n["item_id"] == automatic["item_id"] and n["status"] == "scheduled"]
            assert len(planned) == 1
            new_due = (datetime.now(UTC) + timedelta(days=20)).date().isoformat()
            call("PATCH", f"items/{automatic['item_id']}", {"deadline": new_due})
            notifications = call("GET", "notifications")
            assert sum(n["item_id"] == automatic["item_id"] and n["status"] == "scheduled" for n in notifications) == 1
            assert any(n["id"] == planned[0]["id"] and n["status"] == "cancelled" for n in notifications)
            call("PATCH", f"items/{automatic['item_id']}", {"title": "확장 검증 제목 변경"})
            assert sum(n["item_id"] == automatic["item_id"] and n["status"] == "scheduled" for n in call("GET", "notifications")) == 1
            call("PATCH", f"items/{automatic['item_id']}", {"status": "completed"})
            assert not any(n["item_id"] == automatic["item_id"] and n["status"] == "scheduled" for n in call("GET", "notifications"))
            immediate_rule = rule("확장 검증 즉시 알림", "item_created", [{"type": "create_notification", "days_before": 0}], conditions=[{"field": "title", "operator": "contains", "value": "즉시"}])
            immediate = call("POST", "items", {"title": "확장 검증 즉시 알림"}, 201)
            delivered = next(n for n in call("GET", "notifications") if n["item_id"] == immediate["id"] and n["rule_id"] == immediate_rule["id"])
            assert delivered["status"] == "delivered"
            call("PATCH", f"notifications/{delivered['id']}/read", {})
            assert next(n for n in call("GET", "notifications") if n["id"] == delivered["id"])["read_at"]
            call("DELETE", f"items/{immediate['id']}", expected=204)
            assert next(n for n in call("GET", "notifications") if n["id"] == delivered["id"])["item_id"] is None
            call("POST", "automation/rules", {"name": "검증", "trigger_type": "item_created", "actions": [{"type": "delete"}]}, 422)
            call("PATCH", "automation/settings", {"capture_threshold": 0.7, "review_threshold": 0.8}, 422)

            # Phase 1: 전체 신뢰도가 높아도 공간 제안은 확인해야 합니다.
            call("PATCH", "automation/settings", {"level": "auto_action", "capture_threshold": .95, "review_threshold": .70})
            precise = {"title": "Phase 1 분류 검증", "type": "note"}
            uncertain_event = call("POST", "automation/events", {"title": precise["title"], "content": a["name"] + " 공지",
                "fields": {**precise, "description": a["name"] + " 공지"}, "external_id": str(uuid4())}, 201)
            uncertain = next(c for c in call("GET", "automation/candidates") if c["inbound_event_id"] == uncertain_event["id"])
            assert uncertain["confidence"] == .99 and uncertain["review_fields"] == ["space"]
            assert uncertain["field_confidences"]["space"]["confidence"] == .8
            fixed = call("PATCH", f"automation/candidates/{uncertain['id']}", {"suggested_space_id": a["id"], "fields": {"type": "task"}})
            assert fixed["review_fields"] == [] and fixed["routing_source"] == "user"
            assert fixed["original_field_confidences"]["space"]["confidence"] == .8
            assert fixed["original_payload"]["type"] == "note" and fixed["corrections"]
            call("POST", f"automation/candidates/{uncertain['id']}/accept", {})

            # 원본 하나에서 두 후보를 만들고, 원본 재처리·각 후보 재승인에도 중복하지 않습니다.
            multi_body = {"content": "내일까지 포스터 제출\n금요일 18:00 회의", "external_id": str(uuid4())}
            multi_event = call("POST", "automation/events", multi_body, 201)
            multi = [c for c in call("GET", "automation/candidates") if c["inbound_event_id"] == multi_event["id"]]
            assert len(multi) == 2 and {c["candidate_index"] for c in multi} == {0, 1}
            assert call("POST", f"automation/events/{multi_event['id']}/retry", {})["id"] == multi_event["id"]
            created = [call("POST", f"automation/candidates/{c['id']}/accept", {}) for c in multi]
            assert len({c["item_id"] for c in created}) == 2
            for c in created:
                assert call("POST", f"automation/candidates/{c['id']}/accept", {})["item_id"] == c["item_id"]

            # 동일 우선순위에서는 공간 > 수집 경로 > 전역, 다른 트리거 사이에도 첫 분류를 유지합니다.
            call("PATCH", f"automation/integrations/{integration['id']}/destination", {"space_id": b["id"]})
            condition = [{"field": "title", "operator": "contains", "value": "Phase 1 충돌"}]
            global_rule = rule("Phase 1 전역", "candidate_created", [{"type": "move_to_space", "value": a["id"]}], 30, condition)
            integration_rule = rule("Phase 1 경로", "inbound_received", [{"type": "move_to_space", "value": a["id"]}], 30, condition, "integration", integration["id"])
            space_rule = rule("Phase 1 공간", "integration_sync", [{"type": "move_to_space", "value": shared["id"]}], 30, condition, "space", b["id"])
            def routed_event():
                event = call("POST", "automation/events", {"content": "분류 검증", "external_id": str(uuid4()),
                    "fields": {"title": "Phase 1 충돌", "type": "note"}}, 201)
                assert event["status"] == "processed", event
                return next(c for c in call("GET", "automation/candidates?status=auto_accepted") if c["inbound_event_id"] == event["id"])
            assert routed_event()["suggested_space_id"] == shared["id"]
            integration_rule = call("PATCH", f"automation/rules/{integration_rule['id']}", {key: value for key, value in integration_rule.items() if key not in ("id", "created_at", "updated_at")} | {"priority": 31})
            assert routed_event()["suggested_space_id"] == a["id"]
            for scoped in (global_rule, integration_rule, space_rule):
                call("PATCH", f"automation/rules/{scoped['id']}", {key: value for key, value in scoped.items() if key not in ("id", "created_at", "updated_at")} | {"is_enabled": False})
            call("PATCH", f"automation/integrations/{integration['id']}/destination", {"space_id": None})

            # 학교 메일, GitHub 입력, Shared 공간 분류를 같은 명시적 규칙 방식으로 검증합니다.
            for label, sender, target in (("학교", "notice@school.kr", a), ("GitHub", "notice@github.com", b), ("SnapPocket", "notice@snappocket.kr", shared)):
                r = rule(f"Phase 1 {label}", "inbound_received", [{"type": "move_to_space", "value": target["id"]}], 50,
                    [{"field": "sender", "operator": "equals", "value": sender}])
                e = call("POST", "automation/events", {"content": label + " 원본", "sender": sender, "source_type": "email",
                    "fields": {"title": label + " 일정", "type": "note"}, "external_id": str(uuid4())}, 201)
                c = next(c for c in call("GET", "automation/candidates?status=auto_accepted") if c["inbound_event_id"] == e["id"])
                assert c["suggested_space_id"] == target["id"] and c["routing_source"] == "rule"
                call("DELETE", f"automation/rules/{r['id']}", expected=204)

            ignore = rule("Phase 1 뉴스레터 무시", "inbound_received", [{"type": "ignore"}], conditions=[{"field": "text", "operator": "contains", "value": "뉴스레터"}])
            ignored = call("POST", "automation/events", {"content": "뉴스레터\n" + "\n".join("회의" for _ in range(21)), "external_id": str(uuid4())}, 201)
            assert ignored["status"] == "ignored" and ignored["raw_content"]["content"].startswith("뉴스레터")
            assert not any(c["inbound_event_id"] == ignored["id"] for c in call("GET", "automation/candidates"))
            assert call("POST", f"automation/events/{ignored['id']}/retry", {})["status"] == "ignored"
            call("DELETE", f"automation/rules/{ignore['id']}", expected=204)
            # 실패 후 재시도는 원본을 보존하며 후보를 중복하지 않습니다.
            failed = call("POST", "automation/events", {"content": "\n".join("회의" for _ in range(21)), "external_id": str(uuid4())}, 201)
            assert failed["status"] == "failed"
            retried = call("POST", f"automation/events/{failed['id']}/retry", {})
            assert retried["status"] == "failed" and retried["attempts"] == 2
            call("POST", "automation/rules", {"name": "타인 경로", "scope_type": "integration", "scope_id": str(uuid4()),
                "trigger_type": "inbound_received", "actions": [{"type": "ignore"}]}, 404)
            call("PATCH", f"automation/candidates/{default_candidate['id']}", {"suggested_space_id": str(uuid4())}, 409)
            all_runs = []
            for page in range(1, 20):
                rows = call("GET", f"automation/runs?page={page}")
                all_runs.extend(rows)
                if len(rows) < 20:
                    break
            assert len(all_runs) < 150, "규칙 실행이 재귀적으로 반복되었습니다."
            assert any(r["rule_id"] is None and "분석 전에" in str(r["output_snapshot"]) for r in all_runs)
            active_id[0] = uuid4()
            call("GET", f"items/{item['id']}", expected=404)
            call("PATCH", f"automation/candidates/{candidate['id']}", {"fields": {"title": "위조"}}, 404)
            assert call("GET", "automation/events") == []
            assert call("GET", "notifications") == []
            active_id[0] = user_id
            assert call("GET", "me/space")["id"] == original["id"]
            assert route["id"] and notify["id"]
            print("Live PostgreSQL API checks passed: Phase 1 field confidence, multiple candidates, scope conflict order, preparse ignore, source routing, retries, notifications and RLS.")
    finally:
        app.dependency_overrides.clear()
        transaction.rollback()
        connection.close()
        print("Verification transaction rolled back; existing user data and settings preserved.")


if __name__ == "__main__":
    main()
