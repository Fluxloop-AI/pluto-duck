import importlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pluto_duck_backend.app.api.router import api_router
from pluto_duck_backend.app.services.chat.repository import ChatRepository
from pluto_duck_backend.app.services.projects import ProjectRepository, get_project_repository
from pluto_duck_backend.app.services.projects.danger_operations import expected_confirmation_phrase

projects_router_module = importlib.import_module("pluto_duck_backend.app.api.v1.projects.router")


def create_app(warehouse: Path) -> tuple[FastAPI, str, ProjectRepository]:
    app = FastAPI()

    chat_repo = ChatRepository(warehouse)
    project_repo = ProjectRepository(warehouse)

    def override_repo() -> ProjectRepository:
        return project_repo

    app.dependency_overrides = {}
    app.dependency_overrides[get_project_repository] = override_repo
    app.include_router(api_router)
    return app, chat_repo._default_project_id, project_repo


def test_get_project_invalid_id_returns_422(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, _, _ = create_app(warehouse)
    client = TestClient(app)

    response = client.get("/api/v1/projects/__nonexistent__")

    assert response.status_code == 422


def test_get_project_valid_id_returns_200(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, default_project_id, _ = create_app(warehouse)
    client = TestClient(app)

    response = client.get(f"/api/v1/projects/{default_project_id}")

    assert response.status_code == 200
    assert response.json()["id"] == default_project_id


def test_reset_project_data_phrase_mismatch_returns_400(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, default_project_id, _ = create_app(warehouse)
    client = TestClient(app)

    response = client.post(
        f"/api/v1/projects/{default_project_id}/reset-data",
        json={"confirmation": "wrong-phrase"},
    )

    assert response.status_code == 400
    assert "Confirmation phrase mismatch" in response.json()["detail"]


def test_reset_project_data_success_routes_to_service(tmp_path, monkeypatch):
    warehouse = tmp_path / "warehouse.duckdb"
    app, default_project_id, _ = create_app(warehouse)
    client = TestClient(app)

    project_response = client.get(f"/api/v1/projects/{default_project_id}")
    assert project_response.status_code == 200
    project_name = project_response.json()["name"]

    called: dict[str, str] = {}

    def _fake_reset(project_id: str) -> str:
        called["project_id"] = project_id
        return "reset-ok"

    monkeypatch.setattr(projects_router_module, "reset_project_data", _fake_reset)

    response = client.post(
        f"/api/v1/projects/{default_project_id}/reset-data",
        json={
            "confirmation": expected_confirmation_phrase(project_name, "reset"),
        },
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "message": "reset-ok"}
    assert called["project_id"] == default_project_id


def test_delete_project_permanently_success(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, _, project_repo = create_app(warehouse)
    client = TestClient(app)

    project_id = project_repo.create_project(name="Sales Project", description=None)

    response = client.post(
        f"/api/v1/projects/{project_id}/delete-permanently",
        json={
            "confirmation": expected_confirmation_phrase("Sales Project", "delete"),
        },
    )
    assert response.status_code == 200
    assert response.json()["success"] is True

    deleted = client.get(f"/api/v1/projects/{project_id}")
    assert deleted.status_code == 404


def test_delete_project_permanently_rejects_default_project(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, default_project_id, _ = create_app(warehouse)
    client = TestClient(app)

    project_response = client.get(f"/api/v1/projects/{default_project_id}")
    assert project_response.status_code == 200
    project_name = project_response.json()["name"]

    response = client.post(
        f"/api/v1/projects/{default_project_id}/delete-permanently",
        json={
            "confirmation": expected_confirmation_phrase(project_name, "delete"),
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot delete the default project"
