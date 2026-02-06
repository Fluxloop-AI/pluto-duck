from __future__ import annotations

from typing import Dict, List, Sequence

import duckdb

_BOARD_TIMESTAMP_COLUMNS: Dict[str, Sequence[str]] = {
    "boards": ("created_at", "updated_at"),
    "board_items": ("created_at", "updated_at"),
    "board_queries": ("last_executed_at", "created_at", "updated_at"),
}

_BOARD_INDEXES: Dict[str, Sequence[str]] = {
    "boards": (
        "CREATE INDEX IF NOT EXISTS idx_boards_project "
        "ON boards(project_id, position ASC, updated_at DESC)",
    ),
    "board_items": (
        "CREATE INDEX IF NOT EXISTS idx_items_board "
        "ON board_items(board_id, position_y, position_x)",
    ),
    "board_queries": (
        "CREATE INDEX IF NOT EXISTS idx_queries_item ON board_queries(board_item_id)",
    ),
}

_TIMESTAMPTZ_TYPES = {"TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE"}


def ensure_board_timestamp_columns_timestamptz(
    connection: duckdb.DuckDBPyConnection,
) -> List[str]:
    """Normalize board timestamp columns to TIMESTAMPTZ when tables are empty."""
    warnings: List[str] = []
    for table_name, columns in _BOARD_TIMESTAMP_COLUMNS.items():
        column_types = _get_column_types(connection, table_name)
        columns_to_migrate = [
            column
            for column in columns
            if column in column_types and not _is_timestamptz(column_types[column])
        ]
        if not columns_to_migrate:
            continue

        row_count = _get_row_count(connection, table_name)
        if row_count > 0:
            warnings.append(
                f"[BoardTimestampMigration] Skipped TIMESTAMPTZ migration for '{table_name}' "
                f"(rows={row_count}). Manual migration required before type conversion."
            )
            continue

        _rebuild_indexes_around_alter(connection, table_name, columns_to_migrate)
    return warnings


def _get_column_types(
    connection: duckdb.DuckDBPyConnection, table_name: str
) -> Dict[str, str]:
    rows = connection.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = CURRENT_SCHEMA() AND table_name = ?
        """,
        [table_name],
    ).fetchall()
    return {str(column_name): str(data_type) for column_name, data_type in rows}


def _get_row_count(connection: duckdb.DuckDBPyConnection, table_name: str) -> int:
    row = connection.execute(
        f"SELECT COUNT(*) FROM {_quote_identifier(table_name)}"
    ).fetchone()
    return int(row[0]) if row else 0


def _is_timestamptz(data_type: str) -> bool:
    normalized = " ".join(data_type.upper().split())
    return normalized in _TIMESTAMPTZ_TYPES


def _rebuild_indexes_around_alter(
    connection: duckdb.DuckDBPyConnection, table_name: str, columns: Sequence[str]
) -> None:
    index_names = _index_names_for_table(connection, table_name)
    for index_name in index_names:
        connection.execute(f"DROP INDEX IF EXISTS {_quote_identifier(index_name)}")

    try:
        for column_name in columns:
            connection.execute(
                f"ALTER TABLE {_quote_identifier(table_name)} "
                f"ALTER COLUMN {_quote_identifier(column_name)} SET DATA TYPE TIMESTAMPTZ"
            )
    finally:
        for index_sql in _BOARD_INDEXES.get(table_name, ()):
            connection.execute(index_sql)


def _index_names_for_table(
    connection: duckdb.DuckDBPyConnection, table_name: str
) -> List[str]:
    rows = connection.execute(
        """
        SELECT index_name
        FROM duckdb_indexes()
        WHERE schema_name = CURRENT_SCHEMA() AND table_name = ?
        """,
        [table_name],
    ).fetchall()
    return [str(index_name) for (index_name,) in rows]


def _quote_identifier(identifier: str) -> str:
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'
