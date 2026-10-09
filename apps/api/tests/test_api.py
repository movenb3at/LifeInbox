from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.dependencies import repository
from app.main import app
from tests.test_items import MemoryRepository


def test_api_auth_and_crud_contract():
    with TestClient(app) as client:
        assert client.get("/api/v1/items").status_code == 401
    repo = MemoryRepository()
    app.dependency_overrides[repository] = lambda: repo
    try:
        with TestClient(app) as client:
            invalid = client.post("/api/v1/items", json={"title": "항목", "creator_id": str(repo.user_id)})
            assert invalid.status_code == 422
            response = client.post("/api/v1/items", json={"title": "치과 예약", "type": "reservation", "deadline": "2026-10-21"})
            assert response.status_code == 201
            item_id = response.json()["id"]
            assert response.headers["cache-control"] == "private, no-store"
            assert client.patch(f"/api/v1/items/{item_id}", json={"status": "completed"}).json()["completed_at"]
            assert client.patch(f"/api/v1/items/{item_id}", json={"title": None}).status_code == 422
            assert client.delete(f"/api/v1/items/{item_id}").status_code == 204
            assert client.get(f"/api/v1/items/{item_id}").status_code == 404
            assert client.get("/api/v1/calendar?month=2026-99").status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_api_other_persons_item_is_not_disclosed():
    repo = MemoryRepository()
    app.dependency_overrides[repository] = lambda: repo
    try:
        with TestClient(app) as client:
            item_id = client.post("/api/v1/items", json={"title": "개인 기록"}).json()["id"]
            # Simulate the other user's personal Space; the same storage contains both users.
            repo.user_id = uuid4()
            repo.space_row.id = uuid4()
            repo.space_row.owner_id = repo.user_id
            assert client.get(f"/api/v1/items/{item_id}").status_code == 404
            assert client.patch(f"/api/v1/items/{item_id}", json={"title": "변조"}).status_code == 404
            assert client.delete(f"/api/v1/items/{item_id}").status_code == 404
    finally:
        app.dependency_overrides.clear()
