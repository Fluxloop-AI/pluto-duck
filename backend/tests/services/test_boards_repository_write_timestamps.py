from datetime import UTC, datetime

from pluto_duck_backend.app.services.boards.repository import BoardsRepository
from pluto_duck_backend.app.services.chat.repository import ChatRepository


def test_update_board_writes_utc_aware_updated_at(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    chat_repo = ChatRepository(warehouse)
    boards_repo = BoardsRepository(warehouse)

    board_id = boards_repo.create_board(chat_repo._default_project_id, "Board A")
    before = boards_repo.get_board(board_id)
    assert before is not None

    assert boards_repo.update_board(board_id, name="Board B") is True
    after = boards_repo.get_board(board_id)

    assert after is not None
    assert after.updated_at.tzinfo is not None
    assert after.updated_at >= before.updated_at
    assert (datetime.now(UTC) - after.updated_at).total_seconds() < 5


def test_reorder_boards_writes_utc_aware_updated_at(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    chat_repo = ChatRepository(warehouse)
    boards_repo = BoardsRepository(warehouse)
    project_id = chat_repo._default_project_id

    first_id = boards_repo.create_board(project_id, "First")
    second_id = boards_repo.create_board(project_id, "Second")

    assert boards_repo.reorder_boards(project_id, [(first_id, 1), (second_id, 0)]) is True

    first = boards_repo.get_board(first_id)
    second = boards_repo.get_board(second_id)
    assert first is not None
    assert second is not None
    assert first.updated_at.tzinfo is not None
    assert second.updated_at.tzinfo is not None
    assert (datetime.now(UTC) - first.updated_at).total_seconds() < 5
    assert (datetime.now(UTC) - second.updated_at).total_seconds() < 5


def test_update_query_and_result_write_utc_aware_timestamps(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    chat_repo = ChatRepository(warehouse)
    boards_repo = BoardsRepository(warehouse)

    board_id = boards_repo.create_board(chat_repo._default_project_id, "Board A")
    item_id = boards_repo.create_item(board_id=board_id, item_type="table", payload={})
    query_id = boards_repo.create_query(item_id=item_id, query_text="SELECT 1")

    assert boards_repo.update_query(query_id, query_text="SELECT 2") is True
    assert boards_repo.update_query_result(
        query_id=query_id,
        result={"columns": ["n"], "rows": [[1]]},
        rows=1,
        status="success",
    ) is True

    query = boards_repo.get_query(query_id)
    assert query is not None
    assert query.updated_at.tzinfo is not None
    assert query.last_executed_at is not None
    assert query.last_executed_at.tzinfo is not None
    assert (datetime.now(UTC) - query.updated_at).total_seconds() < 5
    assert (datetime.now(UTC) - query.last_executed_at).total_seconds() < 5
