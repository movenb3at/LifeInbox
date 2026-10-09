"""Exercise production API services against the configured database using a test identity.

JWT verification is replaced only inside this temporary TestClient process. The running
API is untouched. All item IDs created here are tracked and removed before exiting.
"""

import argparse
import sys
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))


def main():
    from app.api.dependencies import current_user
    from app.core.database import get_engine
    from app.main import app

    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True, type=UUID)
    args = parser.parse_args()
    user_id = args.user_id
    marker = f"연결 검증 {uuid4().hex[:8]}"
    created = []
    app.dependency_overrides[current_user] = lambda: user_id
    try:
        with TestClient(app) as client:
            profile = client.get("/api/v1/me")
            assert profile.status_code == 200 and profile.json()["id"] == str(user_id)
            assert client.get("/api/v1/me/space").status_code == 200
            today = client.get("/api/v1/dashboard").json()["today"]
            response = client.post("/api/v1/items", json={
                "title": marker, "description": "한국어 부분 검색과 실제 저장 검증",
                "type": "payment", "currency": "USD", "amount": "0.10", "deadline": today,
                "start_datetime": f"{today}T14:00:00+09:00", "end_datetime": f"{today}T15:00:00+09:00",
            })
            assert response.status_code == 201, response.status_code
            item_id = response.json()["id"]
            created.append(item_id)
            # Each HTTP request opens and commits a separate real database transaction.
            reread = client.get(f"/api/v1/items/{item_id}")
            assert reread.status_code == 200 and reread.json()["amount"] == "0.10"
            assert client.patch(f"/api/v1/items/{item_id}", json={"title": f"{marker} 수정", "status": "in_progress"}).status_code == 200
            found = client.get("/api/v1/items", params={"q": marker, "type": "payment", "status": "in_progress"})
            assert found.json()["total"] == 1 and found.json()["items"][0]["source_text"] == marker
            month = date.fromisoformat(today).strftime("%Y-%m")
            entries = client.get("/api/v1/calendar", params={"month": month}).json()["entries"]
            assert {e["kind"] for e in entries if e["item"]["id"] == item_id} == {"deadline", "schedule"}
            assert client.patch(f"/api/v1/items/{item_id}", json={"currency": "KRW"}).status_code == 422
            complete = client.patch(f"/api/v1/items/{item_id}", json={"status": "completed"}).json()
            assert complete["completed_at"]
            assert client.patch(f"/api/v1/items/{item_id}", json={"status": "archived"}).status_code == 200
            assert client.get("/api/v1/items", params={"q": marker}).json()["total"] == 1
            assert not any(e["item"]["id"] == item_id for e in client.get("/api/v1/calendar", params={"month": month}).json()["entries"])
            restore = client.patch(f"/api/v1/items/{item_id}", json={"status": "todo"}).json()
            assert restore["completed_at"] is None
            with get_engine().connect() as connection, connection.begin():
                connection.execute(text("SELECT set_config('app.user_id', :id, true)"), {"id": str(uuid4())})
                assert connection.execute(text("SELECT count(*) FROM app.items WHERE id=:id"), {"id": item_id}).scalar() == 0
                assert connection.execute(text("UPDATE app.items SET title='변경 불가' WHERE id=:id RETURNING id"), {"id": item_id}).first() is None
            assert client.get(f"/api/v1/items/{item_id}").json()["title"] == f"{marker} 수정"
    finally:
        with TestClient(app) as client:
            for item_id in created:
                assert client.delete(f"/api/v1/items/{item_id}").status_code == 204
                assert client.get(f"/api/v1/items/{item_id}").status_code == 404
        app.dependency_overrides.clear()
    print("Live database API checks passed; temporary items removed. JWT login was verified separately.")


if __name__ == "__main__":
    main()
