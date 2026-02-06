import importlib
import json
from pathlib import Path
from uuid import uuid4

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

    assert response.status_code == 409
    assert response.json()["detail"] == "Cannot delete the default project"


def test_delete_project_permanently_cleans_related_data_and_directories(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, _, project_repo = create_app(warehouse)
    client = TestClient(app)

    project_id = project_repo.create_project(name="Sales Project", description=None)
    analysis_id = "sales-report"
    board_id = str(uuid4())
    board_item_id = str(uuid4())
    board_query_id = str(uuid4())
    board_asset_id = str(uuid4())
    data_source_id = str(uuid4())
    data_source_table_id = str(uuid4())
    conversation_id = str(uuid4())
    run_id = str(uuid4())
    message_id = str(uuid4())
    event_id = str(uuid4())
    approval_id = str(uuid4())
    checkpoint_id = str(uuid4())

    analyses_dir = warehouse.parent / "analyses" / project_id
    analyses_dir.mkdir(parents=True, exist_ok=True)
    (analyses_dir / f"{analysis_id}.yaml").write_text("id: sales-report\n", encoding="utf-8")

    project_dir = warehouse.parent / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "warehouse.duckdb").write_text("temp", encoding="utf-8")

    with project_repo._connect() as con:
        con.execute(
            """
            INSERT INTO boards (id, project_id, name, description, position, settings)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [board_id, project_id, "Board A", None, 0, json.dumps({})],
        )
        con.execute(
            """
            INSERT INTO board_items (id, board_id, item_type, title, payload, render_config)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [board_item_id, board_id, "table", "Item A", json.dumps({}), json.dumps({})],
        )
        con.execute(
            """
            INSERT INTO board_queries (id, board_item_id, query_text, data_source_tables)
            VALUES (?, ?, ?, ?)
            """,
            [board_query_id, board_item_id, "select 1", json.dumps([])],
        )
        con.execute(
            """
            INSERT INTO board_item_assets (id, board_item_id, asset_type, file_name, file_path)
            VALUES (?, ?, ?, ?, ?)
            """,
            [board_asset_id, board_item_id, "image", "a.png", "/tmp/a.png"],
        )
        con.execute(
            """
            INSERT INTO data_sources (id, project_id, name, connector_type, source_config)
            VALUES (?, ?, ?, ?, ?)
            """,
            [data_source_id, project_id, "Sales Source", "duckdb", json.dumps({})],
        )
        con.execute(
            """
            INSERT INTO data_source_tables (id, data_source_id, target_table)
            VALUES (?, ?, ?)
            """,
            [data_source_table_id, data_source_id, "sales_table"],
        )
        con.execute(
            """
            INSERT INTO agent_conversations (id, project_id, title, status, run_id, metadata)
            VALUES (?, ?, ?, 'active', ?, ?)
            """,
            [conversation_id, project_id, "Sales Chat", run_id, json.dumps({})],
        )
        con.execute(
            """
            INSERT INTO agent_messages (id, conversation_id, role, content, seq, run_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [message_id, conversation_id, "user", json.dumps({"text": "hi"}), 1, run_id],
        )
        con.execute(
            """
            INSERT INTO agent_events (id, conversation_id, type, payload, metadata)
            VALUES (?, ?, ?, ?, ?)
            """,
            [event_id, conversation_id, "message", json.dumps({}), json.dumps({})],
        )
        con.execute(
            """
            INSERT INTO agent_tool_approvals (
                id,
                conversation_id,
                run_id,
                status,
                tool_name,
                request_args,
                request_preview,
                policy
            )
            VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
            """,
            [
                approval_id,
                conversation_id,
                run_id,
                "list_tables",
                json.dumps({}),
                json.dumps({}),
                json.dumps({}),
            ],
        )
        con.execute(
            """
            INSERT INTO agent_checkpoints (id, run_id, checkpoint_key, payload)
            VALUES (?, ?, ?, ?)
            """,
            [checkpoint_id, run_id, "k1", json.dumps({})],
        )
        con.execute(
            """
            INSERT INTO _duckpipe.run_history (run_id, analysis_id, started_at, status)
            VALUES (?, ?, CURRENT_TIMESTAMP, 'success')
            """,
            [str(uuid4()), analysis_id],
        )
        con.execute(
            """
            INSERT INTO _duckpipe.run_state (analysis_id, last_run_id, last_run_at, last_run_status)
            VALUES (?, ?, CURRENT_TIMESTAMP, 'success')
            """,
            [analysis_id, run_id],
        )

    response = client.post(
        f"/api/v1/projects/{project_id}/delete-permanently",
        json={
            "confirmation": expected_confirmation_phrase("Sales Project", "delete"),
        },
    )
    assert response.status_code == 200
    assert response.json()["success"] is True

    with project_repo._connect() as con:
        project_row = con.execute("SELECT id FROM projects WHERE id = ?", [project_id]).fetchone()
        boards_count = con.execute(
            "SELECT COUNT(*) FROM boards WHERE project_id = ?",
            [project_id],
        ).fetchone()[0]
        conversations_count = con.execute(
            "SELECT COUNT(*) FROM agent_conversations WHERE project_id = ?",
            [project_id],
        ).fetchone()[0]
        approvals_count = con.execute(
            """
            SELECT COUNT(*) FROM agent_tool_approvals
            WHERE conversation_id = ?
            """,
            [conversation_id],
        ).fetchone()[0]
        checkpoints_count = con.execute(
            "SELECT COUNT(*) FROM agent_checkpoints WHERE run_id = ?",
            [run_id],
        ).fetchone()[0]
        run_history_count = con.execute(
            "SELECT COUNT(*) FROM _duckpipe.run_history WHERE analysis_id = ?",
            [analysis_id],
        ).fetchone()[0]

    assert project_row is None
    assert boards_count == 0
    assert conversations_count == 0
    assert approvals_count == 0
    assert checkpoints_count == 0
    assert run_history_count == 0
    assert not project_dir.exists()
    assert not analyses_dir.exists()
