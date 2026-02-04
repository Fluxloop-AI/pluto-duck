from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from pluto_duck_backend.app.api.router import api_router
from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.chat.repository import get_chat_repository


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
