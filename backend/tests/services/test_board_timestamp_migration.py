import logging
from pathlib import Path
from uuid import uuid4

import duckdb
from pluto_duck_backend.app.services.chat.repository import ChatRepository

_TIMESTAMPTZ_TYPE = "TIMESTAMP WITH TIME ZONE"


def _column_type(warehouse: Path, table_name: str, column_name: str) -> str:
    with duckdb.connect(str(warehouse)) as con:
        row = con.execute(
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_schema = CURRENT_SCHEMA()
              AND table_name = ?
              AND column_name = ?
            """,
            [table_name, column_name],
        ).fetchone()
    assert row is not None
    return str(row[0])


def _create_legacy_board_tables(warehouse: Path, *, with_board_row: bool = False) -> None:
    with duckdb.connect(str(warehouse)) as con:
        con.execute(
            """
            CREATE TABLE boards (
                id UUID PRIMARY KEY,
                project_id UUID NOT NULL,
                name VARCHAR NOT NULL,
                description VARCHAR,
                position INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                settings JSON
            )
            """
        )
        con.execute(
            """
            CREATE TABLE board_items (
                id UUID PRIMARY KEY,
                board_id UUID NOT NULL,
                item_type VARCHAR NOT NULL,
                title VARCHAR,
                position_x INTEGER DEFAULT 0,
                position_y INTEGER DEFAULT 0,
                width INTEGER DEFAULT 1,
                height INTEGER DEFAULT 1,
                payload JSON NOT NULL,
                render_config JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        con.execute(
            """
            CREATE TABLE board_queries (
                id UUID PRIMARY KEY,
                board_item_id UUID NOT NULL,
                query_text VARCHAR NOT NULL,
                data_source_tables JSON,
                refresh_mode VARCHAR DEFAULT 'manual',
                refresh_interval_seconds INTEGER,
                last_executed_at TIMESTAMP,
                last_result_snapshot JSON,
                last_result_rows INTEGER,
                execution_status VARCHAR DEFAULT 'pending',
                error_message VARCHAR,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        if with_board_row:
            con.execute(
                """
                INSERT INTO boards (id, project_id, name, description, position, settings)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [str(uuid4()), str(uuid4()), "Legacy Board", None, 0, "{}"],
            )


def test_new_warehouse_uses_timestamptz_for_board_columns(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"

    ChatRepository(warehouse)

    assert _column_type(warehouse, "boards", "created_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "boards", "updated_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_items", "created_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_items", "updated_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_queries", "last_executed_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_queries", "created_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_queries", "updated_at") == _TIMESTAMPTZ_TYPE


def test_empty_legacy_board_tables_auto_migrate_to_timestamptz(tmp_path):
    warehouse = tmp_path / "warehouse.duckdb"
    _create_legacy_board_tables(warehouse)

    ChatRepository(warehouse)

    assert _column_type(warehouse, "boards", "created_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "boards", "updated_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_items", "created_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_items", "updated_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_queries", "last_executed_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_queries", "created_at") == _TIMESTAMPTZ_TYPE
    assert _column_type(warehouse, "board_queries", "updated_at") == _TIMESTAMPTZ_TYPE


def test_non_empty_legacy_board_table_skips_auto_migration_and_logs_warning(tmp_path, caplog):
    warehouse = tmp_path / "warehouse.duckdb"
    _create_legacy_board_tables(warehouse, with_board_row=True)
    caplog.set_level(logging.WARNING)

    ChatRepository(warehouse)

    assert _column_type(warehouse, "boards", "created_at") == "TIMESTAMP"
    assert _column_type(warehouse, "boards", "updated_at") == "TIMESTAMP"
    assert any(
        "Skipped TIMESTAMPTZ migration for 'boards'" in record.message
        for record in caplog.records
    )
