"""실제 제한 DB 역할에서 이미지 수집 API를 검사하고 모든 임시 데이터를 되돌립니다."""
import argparse
import io
import json
import sys
from pathlib import Path
from uuid import UUID, uuid4

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/api"))

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
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
                response = client.request(method, "/api/v1/automation/" + path, json=body)
                assert response.status_code == expected, (method, path, response.status_code, response.text[:800])
                return response.json() if response.content else None

            png = (root / "e2e/fixtures/ocr-korean.png").read_bytes()
            recognized = json.loads((root / ".local/ocr-sample-result.json").read_text(encoding="utf8"))
            assert "10월 20일" in recognized["text"] and "35,000원" in recognized["text"]

            def upload(data=png, expected=202):
                response = client.post("/api/v1/automation/screenshots", content=data,
                    headers={"Content-Type": "image/png", "X-File-Name": "%EC%8A%A4%ED%81%AC%EB%A6%B0%EC%83%B7.png"})
                assert response.status_code == expected, response.text[:800]
                return response.json()

            call("PATCH", "settings", {"level": "auto_action", "capture_threshold": 0, "review_threshold": 0})
            uploaded = upload()
            source = uploaded["id"]
            assert upload()["id"] == source
            assert uploaded["ocr_status"] == "pending" and "image_bytes" not in uploaded
            preview = client.get(f"/api/v1/automation/screenshots/{source}/image")
            assert preview.content == png and preview.headers["cache-control"] == "private, no-store"
            assert preview.headers["x-content-type-options"] == "nosniff"
            token = call("POST", f"screenshots/{source}/claim", {})["claim_token"]
            call("POST", f"screenshots/{source}/claim", {}, 409)
            call("POST", f"screenshots/{source}/result", {"claim_token": str(uuid4()), **recognized}, 409)
            call("POST", f"screenshots/{source}/result", {"claim_token": token, "text": " ", "confidence": 50}, 422)
            call("POST", f"screenshots/{source}/failure", {"claim_token": token})
            assert call("GET", "screenshots")["inputs"][0]["ocr_status"] == "failed"
            call("POST", f"events/{uploaded['inbound_event_id']}/retry", {}, 409)
            assert client.get(f"/api/v1/automation/screenshots/{source}/image").content == png
            token = call("POST", f"screenshots/{source}/claim", {})["claim_token"]
            # 브라우저 종료 뒤 새 작업이 이전 작업 결과를 거부하는지 검사합니다.
            connection.execute(text("UPDATE app.screenshot_inputs SET last_attempt_at=now()-interval '6 minutes' WHERE id=:id"), {"id": source})
            reclaimed = call("POST", f"screenshots/{source}/claim", {})["claim_token"]
            assert reclaimed != token
            call("POST", f"screenshots/{source}/result", {"claim_token": token, **recognized}, 409)
            payload = {"claim_token": reclaimed, **recognized}
            completed = call("POST", f"screenshots/{source}/result", payload)
            assert completed["ocr_status"] == "completed", completed
            assert call("POST", f"screenshots/{source}/result", payload)["id"] == source
            call("POST", f"screenshots/{source}/failure", {"claim_token": reclaimed})
            assert call("GET", "screenshots")["inputs"][0]["ocr_status"] == "completed"
            candidates = [row for row in call("GET", "candidates") if row["inbound_event_id"] == uploaded["inbound_event_id"]]
            assert len(candidates) == 1, candidates
            candidate = candidates[0]
            assert candidate["source_image_id"] == source and candidate["status"] == "pending"
            assert "ocr" in candidate["review_fields"] and candidate["item_id"] is None
            assert candidate["payload"]["amount"] == "35000" and candidate["payload"]["deadline"].endswith("10-20")

            other_id = uuid4()
            active_id[0] = other_id
            assert call("GET", "screenshots")["inputs"] == []
            for method, suffix, body in [("GET", "image", None), ("POST", "claim", {}),
                ("POST", "result", payload), ("POST", "retry", {}), ("PATCH", "text", {"text": "변조"}), ("DELETE", "", None)]:
                call(method, f"screenshots/{source}" + (f"/{suffix}" if suffix else ""), body, 404)
            assert connection.execute(text("SELECT count(*) FROM app.screenshot_inputs WHERE id=:id"), {"id": source}).scalar() == 0
            active_id[0] = user_id
            accepted = call("POST", f"candidates/{candidate['id']}/accept", {})
            item_id = accepted["item_id"]
            assert item_id and call("POST", f"candidates/{candidate['id']}/accept", {})["item_id"] == item_id
            call("DELETE", f"screenshots/{source}", expected=204)
            call("GET", f"screenshots/{source}/image", expected=404)
            saved = client.get(f"/api/v1/items/{item_id}").json()
            assert saved["source_type"] == "screenshot" and "35,000원" in saved["source_text"]
            assert call("GET", "candidates?status=accepted")[0]["source_image_id"] is None
            assert upload()["id"] == source
            assert call("POST", f"screenshots/{source}/retry", {})["ocr_status"] == "completed"

            # 분석에 실패한 긴 OCR 결과도 저장하고, 필요한 부분만 선택해 복구합니다.
            buffer = io.BytesIO()
            Image.new("RGB", (50, 40), "white").save(buffer, "PNG")
            failed = upload(buffer.getvalue())
            token = call("POST", f"screenshots/{failed['id']}/claim", {})["claim_token"]
            content = "입금 안내 " * 2500
            result = call("POST", f"screenshots/{failed['id']}/result", {"claim_token": token, "text": content, "confidence": 80})
            assert result["ocr_status"] == "failed" and result["ocr_text"] == content.strip()
            assert call("POST", f"events/{failed['inbound_event_id']}/retry", {})["status"] == "failed"
            recovered = call("PATCH", f"screenshots/{failed['id']}/text", {"text": "10월 20일까지 35,000원 입금해주세요."})
            assert recovered["ocr_status"] == "completed" and recovered["ocr_text"] == content.strip()
            call("PATCH", f"screenshots/{failed['id']}/text", {"text": "중복"}, 409)
            assert len([c for c in call("GET", "candidates") if c["inbound_event_id"] == failed["inbound_event_id"]]) == 1
            upload(b"not a png", 422)
            print("Live OCR API checks passed: original bytes, actual Korean OCR text, review gating, dedupe, stale claim, retries, RLS, text recovery and image-only deletion.")
    finally:
        app.dependency_overrides.clear()
        transaction.rollback()
        connection.close()
        print("Verification transaction rolled back; existing data preserved.")


if __name__ == "__main__":
    main()
