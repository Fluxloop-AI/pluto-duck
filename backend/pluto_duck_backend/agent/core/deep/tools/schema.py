"""Schema/metadata tools for the DuckDB warehouse."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import duckdb
from langchain_core.tools import StructuredTool

from .project_scope import (
    normalize_identifier_part,
    normalize_table_identifier,
    resolve_project_table_scope,
)

# Keep this set in sync with backend metadata DDL tables.
# When a new internal metadata table is introduced, add its canonical
# "schema.table" identifier here so schema tools keep hiding it.
_INTERNAL_TABLES = frozenset(
    {
        "main.projects",
        "main.agent_conversations",
        "main.agent_messages",
        "main.agent_events",
        "main.agent_tool_approvals",
        "main.agent_checkpoints",
        "main.user_settings",
        "main.data_sources",
        "main.data_source_tables",
        "main.boards",
        "main.board_items",
        "main.board_queries",
        "main.board_item_assets",
        "main.query_history",
        "_file_assets.files",
        "_file_assets.file_sources",
        "_sources.attached",
        "_sources.cached_tables",
        "_duckpipe.run_history",
        "_duckpipe.run_state",
    }
)
_MAIN_INTERNAL_TABLES = frozenset(
    qualified.split(".", 1)[1] for qualified in _INTERNAL_TABLES if qualified.startswith("main.")
)
_INTERNAL_TABLE_ACCESS_ERROR = (
    "Access to internal metadata table '{table}' is blocked in schema tools. "
    "Use run_sql for explicit inspection."
)
_UNAUTHORIZED_TABLE_ACCESS_ERROR = "Access to table '{table}' is not allowed for this project."


def _quote_identifier(identifier: str) -> str:
    parts = [part for part in identifier.split(".") if part]
    return ".".join(f'"{part.replace("\"", "\"\"")}"' for part in parts)


def _is_internal_table_identifier(table: str, schema: Optional[str] = None) -> bool:
    normalized = normalize_table_identifier(table, schema=schema)
    if not normalized:
        return False

    if normalized in _INTERNAL_TABLES:
        return True

    if "." not in normalized:
        return normalized in _MAIN_INTERNAL_TABLES

    normalized_schema, normalized_table = normalized.split(".", 1)
    return normalized_schema == "main" and normalized_table in _MAIN_INTERNAL_TABLES


def _build_internal_table_access_error(table: str, schema: Optional[str] = None) -> str:
    normalized = normalize_table_identifier(table, schema=schema)
    if normalized and "." in normalized:
        table_name = normalized
    elif normalized:
        table_name = f"main.{normalized}"
    else:
        table_name = table
    return _INTERNAL_TABLE_ACCESS_ERROR.format(table=table_name)


def _blocked_table_response(table: str, schema: Optional[str] = None) -> Dict[str, Any]:
    normalized = normalize_table_identifier(table, schema=schema)
    if normalized and "." in normalized:
        table_name = normalized
    elif normalized:
        schema_part = normalize_identifier_part(schema) if schema else "main"
        table_name = f"{schema_part}.{normalized}"
    else:
        table_name = table
    return {
        "status": "error",
        "table": table_name,
        "error": _build_internal_table_access_error(table, schema=schema),
    }


def _unauthorized_table_response(table: str, schema: Optional[str] = None) -> Dict[str, Any]:
    normalized = normalize_table_identifier(table, schema=schema)
    if normalized and "." in normalized:
        table_name = normalized
    elif normalized:
        schema_part = normalize_identifier_part(schema) if schema else "main"
        table_name = f"{schema_part}.{normalized}"
    else:
        table_name = table
    return {
        "status": "error",
        "table": table_name,
        "error": _UNAUTHORIZED_TABLE_ACCESS_ERROR.format(table=table_name),
    }


def _jsonable(value: Any) -> Any:
    # duckdb returns Python primitives usually; keep best-effort fallback.
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def build_schema_tools(
    *,
    warehouse_path: Path,
    project_id: Optional[str] = None,
) -> List[StructuredTool]:
    """Return schema tools bound to a specific DuckDB warehouse."""

    def _resolve_project_allowlist() -> Optional[set[str]]:
        if project_id is None:
            return None
        return resolve_project_table_scope(
            warehouse_path=warehouse_path,
            project_id=project_id,
        )

    def _is_project_table_allowed(qualified: str) -> bool:
        allowlist = _resolve_project_allowlist()
        if allowlist is None:
            return True
        return normalize_table_identifier(qualified) in allowlist

    def resolve_table_identifier(
        con: duckdb.DuckDBPyConnection, table: str, schema: Optional[str]
    ) -> str:
        if "." in table or not schema:
            return table

        row = con.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = ? AND table_name = ?
            LIMIT 1
            """,
            [schema, table],
        ).fetchone()
        if row:
            return f"{schema}.{table}"

        if schema == "main":
            fallback_schema = "analysis"
            fallback_row = con.execute(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = ? AND table_name = ?
                LIMIT 1
                """,
                [fallback_schema, table],
            ).fetchone()
            if fallback_row:
                return f"{fallback_schema}.{table}"

        return f"{schema}.{table}"

    def list_tables(
        schema: str = "main",
        limit: int = 200,
        include_views: bool = False,
    ) -> Dict[str, Any]:
        with duckdb.connect(str(warehouse_path)) as con:
            table_types = ["BASE TABLE"]
            if include_views:
                table_types.append("VIEW")
            rows = con.execute(
                """
                SELECT table_name, table_type
                FROM information_schema.tables
                WHERE table_schema = ? AND table_type IN ?
                ORDER BY table_name
                LIMIT ?
                """,
                [schema, table_types, int(limit)],
            ).fetchall()
        visible_rows = [
            (name, ttype)
            for (name, ttype) in rows
            if not _is_internal_table_identifier(name, schema=schema)
        ]
        allowlist = _resolve_project_allowlist()
        if allowlist is not None:
            visible_rows = [
                (name, ttype)
                for (name, ttype) in visible_rows
                if normalize_table_identifier(name, schema=schema) in allowlist
            ]
        return {
            "schema": schema,
            "tables": [{"name": name, "type": ttype} for (name, ttype) in visible_rows],
        }

    def describe_table(table: str, schema: str = "main") -> Dict[str, Any]:
        with duckdb.connect(str(warehouse_path)) as con:
            qualified = resolve_table_identifier(con, table, schema)
            if _is_internal_table_identifier(qualified):
                return _blocked_table_response(qualified)
            if not _is_project_table_allowed(qualified):
                return _unauthorized_table_response(qualified)
            info = con.execute("SELECT * FROM pragma_table_info(?)", [qualified]).fetchall()
            # (cid, name, type, notnull, dflt_value, pk)
            columns = [
                {
                    "name": row[1],
                    "type": row[2],
                    "not_null": bool(row[3]),
                    "default": _jsonable(row[4]),
                    "primary_key": bool(row[5]),
                }
                for row in info
            ]
            try:
                table_ref = _quote_identifier(qualified)
                row = con.execute(f"SELECT COUNT(*) FROM {table_ref}").fetchone()
                row_count = row[0] if row else None
            except Exception:
                row_count = None
        return {"table": qualified, "columns": columns, "row_count": row_count}

    def sample_rows(table: str, schema: str = "main", limit: int = 5) -> Dict[str, Any]:
        with duckdb.connect(str(warehouse_path)) as con:
            qualified = resolve_table_identifier(con, table, schema)
            if _is_internal_table_identifier(qualified):
                return _blocked_table_response(qualified)
            if not _is_project_table_allowed(qualified):
                return _unauthorized_table_response(qualified)
            table_ref = _quote_identifier(qualified)
            cur = con.execute(f"SELECT * FROM {table_ref} LIMIT ?", [int(limit)])
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall()
        return {
            "table": qualified,
            "rows": [{cols[i]: _jsonable(row[i]) for i in range(len(cols))} for row in rows],
        }

    return [
        StructuredTool.from_function(
            name="list_tables",
            func=list_tables,
            description="List tables in DuckDB warehouse.",
        ),
        StructuredTool.from_function(
            name="describe_table",
            func=describe_table,
            description="Describe a DuckDB table (columns, types, row count).",
        ),
        StructuredTool.from_function(
            name="sample_rows",
            func=sample_rows,
            description="Fetch sample rows from a DuckDB table.",
        ),
    ]
