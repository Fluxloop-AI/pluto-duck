import importlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pluto_duck_backend.app.api.router import api_router
from pluto_duck_backend.app.services.boards import BoardsRepository, BoardsService
from pluto_duck_backend.app.services.chat.repository import ChatRepository

boards_router_module = importlib.import_module(
    "pluto_duck_backend.app.api.v1.boards.boards.router"
)
items_router_module = importlib.import_module(
    "pluto_duck_backend.app.api.v1.boards.items.router"
)
queries_router_module = importlib.import_module(
    "pluto_duck_backend.app.api.v1.boards.queries.router"
)


def create_app(warehouse: Path) -> tuple[FastAPI, str, BoardsRepository]:
    app = FastAPI()
    chat_repo = ChatRepository(warehouse)
    boards_repo = BoardsRepository(warehouse)
    boards_service = BoardsService(boards_repo)
    boards_service.warehouse_path = warehouse

    def override_repo() -> BoardsRepository:
        return boards_repo

    def override_service() -> BoardsService:
        return boards_service

    app.dependency_overrides = {}
    app.dependency_overrides[boards_router_module.get_repo] = override_repo
    app.dependency_overrides[items_router_module.get_repo] = override_repo
    app.dependency_overrides[queries_router_module.get_repo] = override_repo
    app.dependency_overrides[items_router_module.get_service] = override_service
    app.dependency_overrides[queries_router_module.get_service] = override_service
    app.include_router(api_router)
    return app, chat_repo._default_project_id, boards_repo


def _parse_aware_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    assert parsed.tzinfo is not None
    return parsed.astimezone(UTC)


def test_rename_board_returns_timezone_aware_recent_updated_at(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, project_id, _ = create_app(warehouse)
    client = TestClient(app)

    created = client.post(
        f"/api/v1/boards/projects/{project_id}/boards",
        json={"name": "Board A", "description": None, "settings": {}},
    )
    assert created.status_code == 201
    created_body = created.json()
    board_id = created_body["id"]

    before_updated_at = _parse_aware_iso(created_body["updated_at"])

    renamed = client.patch(f"/api/v1/boards/{board_id}", json={"name": "Board B"})
    assert renamed.status_code == 200
    renamed_body = renamed.json()
    after_updated_at = _parse_aware_iso(renamed_body["updated_at"])

    assert after_updated_at >= before_updated_at
    assert (datetime.now(UTC) - after_updated_at).total_seconds() < 5


def test_reorder_and_query_updates_keep_timestamp_monotonic_and_recent(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, project_id, repo = create_app(warehouse)
    client = TestClient(app)

    board_a = client.post(
        f"/api/v1/boards/projects/{project_id}/boards",
        json={"name": "Board A"},
    ).json()
    board_b = client.post(
        f"/api/v1/boards/projects/{project_id}/boards",
        json={"name": "Board B"},
    ).json()

    board_a_before = repo.get_board(board_a["id"])
    assert board_a_before is not None

    assert repo.reorder_boards(project_id, [(board_a["id"], 1), (board_b["id"], 0)]) is True

    board_a_after = repo.get_board(board_a["id"])
    assert board_a_after is not None
    assert board_a_after.updated_at >= board_a_before.updated_at
    assert (datetime.now(UTC) - board_a_after.updated_at).total_seconds() < 5

    item_response = client.post(
        f"/api/v1/boards/{board_a['id']}/items",
        json={"item_type": "table", "payload": {}},
    )
    assert item_response.status_code == 201
    item_id = item_response.json()["id"]

    query_response = client.post(
        f"/api/v1/boards/items/{item_id}/query",
        json={"query_text": "SELECT 1", "data_source_tables": []},
    )
    assert query_response.status_code == 201
    query_id = query_response.json()["query_id"]

    query_before = repo.get_query(query_id)
    assert query_before is not None

    assert repo.update_query(query_id, query_text="SELECT 2") is True
    query_after_update = repo.get_query(query_id)
    assert query_after_update is not None
    assert query_after_update.updated_at >= query_before.updated_at
    assert (datetime.now(UTC) - query_after_update.updated_at).total_seconds() < 5

    assert repo.update_query_result(
        query_id=query_id,
        result={"columns": ["n"], "data": [{"n": 1}], "row_count": 1, "executed_at": "now"},
        rows=1,
        status="success",
    ) is True
    query_after_result = repo.get_query(query_id)
    assert query_after_result is not None
    assert query_after_result.updated_at >= query_after_update.updated_at
    assert query_after_result.last_executed_at is not None
    assert query_after_result.last_executed_at.tzinfo is not None
    assert (datetime.now(UTC) - query_after_result.updated_at).total_seconds() < 5


def test_list_boards_orders_by_effective_updated_at_desc(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    app, project_id, repo = create_app(warehouse)
    client = TestClient(app)

    board_a = client.post(
        f"/api/v1/boards/projects/{project_id}/boards",
        json={"name": "Board A"},
    ).json()
    board_b = client.post(
        f"/api/v1/boards/projects/{project_id}/boards",
        json={"name": "Board B"},
    ).json()

    item_response = client.post(
        f"/api/v1/boards/{board_a['id']}/items",
        json={"item_type": "table", "payload": {}},
    )
    assert item_response.status_code == 201
    item_id = item_response.json()["id"]

    updated_item_response = client.patch(
        f"/api/v1/boards/items/{item_id}",
        json={"title": "fresh"},
    )
    assert updated_item_response.status_code == 200
    item_updated_at = _parse_aware_iso(updated_item_response.json()["updated_at"])

    listed = client.get(f"/api/v1/boards/projects/{project_id}/boards")
    assert listed.status_code == 200
    boards: list[dict[str, Any]] = listed.json()
    assert len(boards) == 2
    assert boards[0]["id"] == board_a["id"]
    assert boards[1]["id"] == board_b["id"]

    first_updated_at = _parse_aware_iso(boards[0]["updated_at"])
    second_updated_at = _parse_aware_iso(boards[1]["updated_at"])
    assert first_updated_at >= second_updated_at
    assert first_updated_at >= item_updated_at

    board_a_loaded = repo.get_board(board_a["id"])
    assert board_a_loaded is not None
    assert board_a_loaded.updated_at <= first_updated_at
