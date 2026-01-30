from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from pluto_duck_backend.app.api.router import api_router
from pluto_duck_backend.app.services.chat.repository import ChatRepository
from pluto_duck_backend.app.services.projects import ProjectRepository, get_project_repository


def create_app(warehouse: Path) -> tuple[FastAPI, str]:
    app = FastAPI()

    chat_repo = ChatRepository(warehouse)
    project_repo = ProjectRepository(warehouse)

    def override_repo() -> ProjectRepository:
        return project_repo

    app.dependency_overrides = {}
    app.dependency_overrides[get_project_repository] = override_repo
    app.include_router(api_router)
    return app, chat_repo._default_project_id


def test_get_project_invalid_id_returns_422(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, _ = create_app(warehouse)
    client = TestClient(app)

    response = client.get("/api/v1/projects/__nonexistent__")

    assert response.status_code == 422


def test_get_project_valid_id_returns_200(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, default_project_id = create_app(warehouse)
    client = TestClient(app)

    response = client.get(f"/api/v1/projects/{default_project_id}")

    assert response.status_code == 200
    assert response.json()["id"] == default_project_id
