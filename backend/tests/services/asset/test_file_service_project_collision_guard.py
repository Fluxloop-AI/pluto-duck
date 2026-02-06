from __future__ import annotations

import logging
from pathlib import Path
from uuid import uuid4

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


def test_reset_project_data_skips_shared_analysis_cleanup(
    configured_workspace: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = get_settings()
    repo = get_chat_repository()
    project_a = repo._default_project_id
    project_repo = get_project_repository()
    project_b = project_repo.create_project("project-b")
    project_a_name = project_repo.get_project(project_a)["name"]
    shared_analysis_id = "sales"

    analyses_dir_a = settings.duckdb.path.parent / "analyses" / project_a
    analyses_dir_b = settings.duckdb.path.parent / "analyses" / project_b
    analyses_dir_a.mkdir(parents=True, exist_ok=True)
    analyses_dir_b.mkdir(parents=True, exist_ok=True)
    (analyses_dir_a / f"{shared_analysis_id}.yaml").write_text("id: sales\n", encoding="utf-8")
    (analyses_dir_b / f"{shared_analysis_id}.yaml").write_text("id: sales\n", encoding="utf-8")

    with duckdb.connect(str(settings.duckdb.path)) as con:
        con.execute("CREATE SCHEMA IF NOT EXISTS analysis")
        con.execute("CREATE TABLE IF NOT EXISTS analysis.sales (amount INTEGER)")
        con.execute(
            """
            INSERT INTO _duckpipe.run_history (run_id, analysis_id, started_at, status)
            VALUES (?, ?, CURRENT_TIMESTAMP, 'success')
            """,
            [str(uuid4()), shared_analysis_id],
        )
        con.execute(
            """
            INSERT INTO _duckpipe.run_state (analysis_id, last_run_id, last_run_at, last_run_status)
            VALUES (?, ?, CURRENT_TIMESTAMP, 'success')
            ON CONFLICT (analysis_id) DO UPDATE SET
                last_run_id = EXCLUDED.last_run_id,
                last_run_at = EXCLUDED.last_run_at,
                last_run_status = EXCLUDED.last_run_status
            """,
            [shared_analysis_id, str(uuid4())],
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
    assert "skipping shared analysis cleanup for id='sales'" in caplog.text.lower()

    with duckdb.connect(str(settings.duckdb.path)) as con:
        run_history_count = con.execute(
            "SELECT COUNT(*) FROM _duckpipe.run_history WHERE analysis_id = ?",
            [shared_analysis_id],
        ).fetchone()[0]
        run_state_count = con.execute(
            "SELECT COUNT(*) FROM _duckpipe.run_state WHERE analysis_id = ?",
            [shared_analysis_id],
        ).fetchone()[0]
        analysis_table_exists = con.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = 'analysis' AND table_name = ?
            """,
            [shared_analysis_id],
        ).fetchone()[0]

    assert run_history_count == 1
    assert run_state_count == 1
    assert analysis_table_exists == 1
    assert not analyses_dir_a.exists()
    assert analyses_dir_b.exists()
