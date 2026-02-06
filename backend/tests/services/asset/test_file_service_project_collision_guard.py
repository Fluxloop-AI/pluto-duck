from __future__ import annotations

import logging
from pathlib import Path

import duckdb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pluto_duck_backend.app.api.router import api_router
from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.asset import FileAssetService
from pluto_duck_backend.app.services.asset import file_service as file_service_module
from pluto_duck_backend.app.services.asset.errors import AssetValidationError
from pluto_duck_backend.app.services.chat import get_chat_repository
from pluto_duck_backend.app.services.projects import get_project_repository
from pluto_duck_backend.app.services.projects.danger_operations import expected_confirmation_phrase


@pytest.fixture
def configured_workspace(tmp_path: Path, monkeypatch):
    root = tmp_path / "root"
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(root))

    get_settings.cache_clear()
    get_chat_repository.cache_clear()
    get_project_repository.cache_clear()
    file_service_module._file_asset_services.clear()

    yield root

    file_service_module._file_asset_services.clear()
    get_project_repository.cache_clear()
    get_chat_repository.cache_clear()
    get_settings.cache_clear()


def _write_csv(path: Path, rows: str) -> None:
    path.write_text(rows, encoding="utf-8")


@pytest.mark.parametrize(
    ("mode", "table_name", "extra_kwargs"),
    [
        ("replace", "orders", {}),
        ("append", "ignored_name", {"target_table": "orders"}),
        ("merge", "ignored_name", {"target_table": "orders", "merge_keys": ["id"]}),
    ],
)
def test_import_blocks_cross_project_table_collision(
    configured_workspace: Path,
    tmp_path: Path,
    mode: str,
    table_name: str,
    extra_kwargs: dict,
) -> None:
    settings = get_settings()
    repo = get_chat_repository()
    project_a = repo._default_project_id
    project_b = get_project_repository().create_project("project-b")

    file_a = tmp_path / "a.csv"
    file_b = tmp_path / "b.csv"
    _write_csv(file_a, "id,amount\n1,100\n")
    _write_csv(file_b, "id,amount\n2,200\n")

    service_a = FileAssetService(project_a, settings.duckdb.path)
    service_b = FileAssetService(project_b, settings.duckdb.path)

    service_a.import_file(
        file_path=str(file_a),
        file_type="csv",
        table_name="orders",
        mode="replace",
    )

    with pytest.raises(AssetValidationError, match="already used by another project"):
        service_b.import_file(
            file_path=str(file_b),
            file_type="csv",
            table_name=table_name,
            mode=mode,
            **extra_kwargs,
        )


def test_reset_project_data_skips_drop_for_shared_table_collision(
    configured_workspace: Path,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = get_settings()
    repo = get_chat_repository()
    project_a = repo._default_project_id
    project_repo = get_project_repository()
    project_b = project_repo.create_project("project-b")
    project_a_name = project_repo.get_project(project_a)["name"]

    file_a = tmp_path / "a.csv"
    _write_csv(file_a, "id,amount\n1,100\n")

    service_a = FileAssetService(project_a, settings.duckdb.path)
    service_a.import_file(
        file_path=str(file_a),
        file_type="csv",
        table_name="orders",
        mode="replace",
    )

    with duckdb.connect(str(settings.duckdb.path)) as con:
        con.execute(
            """
            INSERT INTO _file_assets.files (id, project_id, name, file_path, file_type, table_name)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                "file_collision_b",
                project_b,
                "Orders B",
                str(file_a),
                "csv",
                "orders",
            ],
        )

    app = FastAPI()
    app.include_router(api_router)
    client = TestClient(app)

    with caplog.at_level(logging.WARNING):
        response = client.post(
            f"/api/v1/projects/{project_a}/reset-data",
            json={
                "confirmation": expected_confirmation_phrase(project_a_name, "reset"),
            },
        )

    assert response.status_code == 200
    assert "skipping table drop for shared table 'orders'" in caplog.text.lower()

    with duckdb.connect(str(settings.duckdb.path)) as con:
        table_exists = con.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = 'main' AND table_name = 'orders'
            """
        ).fetchone()[0]
        assert table_exists == 1

        remaining_rows = con.execute(
            """
            SELECT project_id
            FROM _file_assets.files
            WHERE table_name = 'orders'
            ORDER BY project_id
            """
        ).fetchall()
        assert [row[0] for row in remaining_rows] == [project_b]
