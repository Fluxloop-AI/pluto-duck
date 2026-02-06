from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pluto_duck_backend.app.api.router import api_router
from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.chat.repository import get_chat_repository
from pluto_duck_backend.app.services.projects.danger_operations import expected_confirmation_phrase


def create_client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(tmp_path / "root"))
    get_settings.cache_clear()
    get_chat_repository.cache_clear()
    app = FastAPI()
    app.include_router(api_router)
    return TestClient(app)


def test_settings_language_default_and_update(tmp_path, monkeypatch) -> None:
    client = create_client(tmp_path, monkeypatch)

    response = client.get("/api/v1/settings")
    assert response.status_code == 200
    assert response.json()["language"] == "en"

    update = client.put("/api/v1/settings", json={"language": "ko"})
    assert update.status_code == 200

    updated = client.get("/api/v1/settings")
    assert updated.status_code == 200
    assert updated.json()["language"] == "ko"


def test_settings_language_validation(tmp_path, monkeypatch) -> None:
    client = create_client(tmp_path, monkeypatch)

    response = client.put("/api/v1/settings", json={"language": "jp"})
    assert response.status_code == 400


def test_reset_workspace_data_alias_keeps_behavior_and_logs_warning(
    tmp_path,
    monkeypatch,
    caplog,
) -> None:
    client = create_client(tmp_path, monkeypatch)
    settings_response = client.get("/api/v1/settings")
    assert settings_response.status_code == 200
    project_id = settings_response.json()["default_project_id"]

    with caplog.at_level("WARNING"):
        response = client.post(f"/api/v1/settings/reset-workspace-data?project_id={project_id}")

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert any("Deprecated endpoint used" in record.message for record in caplog.records)


def test_settings_default_project_id_remains_valid_after_project_delete(
    tmp_path,
    monkeypatch,
) -> None:
    client = create_client(tmp_path, monkeypatch)
    bootstrap = client.get("/api/v1/settings")
    assert bootstrap.status_code == 200

    create_response = client.post(
        "/api/v1/projects",
        json={"name": "Sales Project", "description": None},
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    delete_response = client.post(
        f"/api/v1/projects/{project_id}/delete-permanently",
        json={"confirmation": expected_confirmation_phrase("Sales Project", "delete")},
    )
    assert delete_response.status_code == 200

    settings_response = client.get("/api/v1/settings")
    assert settings_response.status_code == 200
    default_project_id = settings_response.json()["default_project_id"]
    assert default_project_id is not None

    default_project_response = client.get(f"/api/v1/projects/{default_project_id}")
    assert default_project_response.status_code == 200
    assert default_project_response.json()["is_default"] is True
