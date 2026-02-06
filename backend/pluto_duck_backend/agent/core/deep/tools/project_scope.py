"""Project-scoped table allowlist resolver for agent tools."""

from __future__ import annotations

import time
from pathlib import Path
from threading import Lock
from typing import Dict, FrozenSet, Optional, Set, Tuple

import duckdb

_CACHE_TTL_SECONDS = 5.0
_SCOPE_CACHE: Dict[Tuple[str, Optional[str], bool], Tuple[float, FrozenSet[str]]] = {}
_SCOPE_CACHE_LOCK = Lock()

_MAIN_INTERNAL_TABLES = frozenset(
    {
        "projects",
        "agent_conversations",
        "agent_messages",
        "agent_events",
        "agent_tool_approvals",
        "agent_checkpoints",
        "user_settings",
        "data_sources",
        "data_source_tables",
        "boards",
        "board_items",
        "board_queries",
        "board_item_assets",
        "query_history",
    }
)


def normalize_identifier_part(value: str) -> str:
    return value.strip().strip('"').strip("'").strip("`").lower()


def normalize_table_identifier(table: str, schema: Optional[str] = None) -> str:
    """Normalize any table expression to canonical 'schema.table' form."""
    raw = table.strip()
    if not raw:
        return ""

    parts = [part for part in raw.split(".") if part]
    if len(parts) >= 2:
        resolved_schema = normalize_identifier_part(parts[-2])
        resolved_table = normalize_identifier_part(parts[-1])
        return f"{resolved_schema}.{resolved_table}"

    resolved_table = normalize_identifier_part(parts[0])
    resolved_schema = normalize_identifier_part(schema) if schema else ""
    return f"{resolved_schema}.{resolved_table}" if resolved_schema else resolved_table


def _is_internal_table_identifier(qualified: str) -> bool:
    if not qualified:
        return True

    if "." not in qualified:
        return True

    schema, table = qualified.split(".", 1)
    if schema.startswith("_"):
        return True
    if schema == "main" and table in _MAIN_INTERNAL_TABLES:
        return True
    return False


def _table_exists(con: duckdb.DuckDBPyConnection, schema: str, table: str) -> bool:
    row = con.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
        LIMIT 1
        """,
        [schema, table],
    ).fetchone()
    return row is not None


def _load_project_owned_tables(
    con: duckdb.DuckDBPyConnection,
    *,
    project_id: Optional[str],
) -> Set[str]:
    if not project_id:
        return set()

    if not _table_exists(con, "_file_assets", "files"):
        return set()

    rows = con.execute(
        """
        SELECT DISTINCT table_name
        FROM _file_assets.files
        WHERE project_id = ?
          AND table_name IS NOT NULL
        """,
        [project_id],
    ).fetchall()

    resolved: Set[str] = set()
    for (table_name,) in rows:
        if not table_name:
            continue
        normalized = normalize_table_identifier(str(table_name), schema="main")
        if normalized and not _is_internal_table_identifier(normalized):
            resolved.add(normalized)
    return resolved


def _load_analysis_tables(con: duckdb.DuckDBPyConnection) -> Set[str]:
    rows = con.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'analysis'
          AND table_type IN ('BASE TABLE', 'VIEW')
        """,
    ).fetchall()

    resolved: Set[str] = set()
    for (table_name,) in rows:
        if not table_name:
            continue
        normalized = normalize_table_identifier(str(table_name), schema="analysis")
        if normalized and not _is_internal_table_identifier(normalized):
            resolved.add(normalized)
    return resolved


def _compute_project_table_scope(
    *,
    warehouse_path: Path,
    project_id: Optional[str],
    include_analysis_schema: bool,
) -> Set[str]:
    with duckdb.connect(str(warehouse_path)) as con:
        allowlist = _load_project_owned_tables(con, project_id=project_id)
        if include_analysis_schema:
            allowlist.update(_load_analysis_tables(con))
        return allowlist


def clear_project_table_scope_cache() -> None:
    with _SCOPE_CACHE_LOCK:
        _SCOPE_CACHE.clear()


def resolve_project_table_scope(
    *,
    warehouse_path: Path,
    project_id: Optional[str],
    include_analysis_schema: bool = True,
    cache_ttl_seconds: float = _CACHE_TTL_SECONDS,
) -> Set[str]:
    """Resolve project-visible table allowlist as normalized 'schema.table' identifiers."""
    cache_key = (str(warehouse_path), project_id, include_analysis_schema)
    now = time.monotonic()

    if cache_ttl_seconds > 0:
        with _SCOPE_CACHE_LOCK:
            cached = _SCOPE_CACHE.get(cache_key)
            if cached is not None:
                expires_at, payload = cached
                if expires_at > now:
                    return set(payload)

    scope = _compute_project_table_scope(
        warehouse_path=warehouse_path,
        project_id=project_id,
        include_analysis_schema=include_analysis_schema,
    )

    if cache_ttl_seconds > 0:
        with _SCOPE_CACHE_LOCK:
            _SCOPE_CACHE[cache_key] = (now + cache_ttl_seconds, frozenset(scope))

    return scope
