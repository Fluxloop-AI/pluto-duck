"""Query execution tools (DuckDB)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import duckdb
import sqlglot
from langchain_core.tools import StructuredTool
from sqlglot import exp

from pluto_duck_backend.app.services.execution.manager import get_execution_manager

from .project_scope import normalize_table_identifier, resolve_project_table_scope

_READ_ONLY_SQL_ERROR = "Only read-only SQL queries (SELECT / WITH ... SELECT) are allowed."
_PARSE_VALIDATION_ERROR = "Failed to parse SQL for table access validation."
_UNAUTHORIZED_TABLE_ERROR = "SQL references unauthorized table(s): {tables}"
_READ_ONLY_ROOT_EXPRESSION_NAMES = (
    "Select",
    "Union",
    "Intersect",
    "Except",
)
_WRITE_EXPRESSION_NAMES = (
    "Insert",
    "Update",
    "Delete",
    "Create",
    "Drop",
    "Alter",
    "TruncateTable",
    "Merge",
    "Command",
    "Attach",
    "Detach",
    "Set",
)
_READ_ONLY_ROOT_TYPES = tuple(
    getattr(exp, name) for name in _READ_ONLY_ROOT_EXPRESSION_NAMES if hasattr(exp, name)
)
_WRITE_EXPRESSION_TYPES = tuple(
    getattr(exp, name) for name in _WRITE_EXPRESSION_NAMES if hasattr(exp, name)
)


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _is_read_only_sql(sql: str) -> bool:
    try:
        statements = sqlglot.parse(sql, dialect="duckdb")
    except Exception:
        return False

    if len(statements) != 1:
        return False

    statement = statements[0]
    if statement is None or not _READ_ONLY_ROOT_TYPES:
        return False
    if not isinstance(statement, _READ_ONLY_ROOT_TYPES):
        return False

    if _WRITE_EXPRESSION_TYPES:
        for write_expr in _WRITE_EXPRESSION_TYPES:
            if statement.find(write_expr):
                return False

    return True


def _extract_referenced_tables(sql: str) -> Optional[Set[str]]:
    try:
        statement = sqlglot.parse_one(sql, dialect="duckdb")
    except Exception:
        return None

    cte_names: Set[str] = set()
    for cte in statement.find_all(exp.CTE):
        alias = cte.alias_or_name
        if alias:
            cte_names.add(alias.lower())

    tables: Set[str] = set()
    for table in statement.find_all(exp.Table):
        table_name = table.name
        if not table_name:
            continue

        schema_name = table.db
        if table_name.lower() in cte_names and not schema_name:
            continue
        if schema_name:
            normalized = normalize_table_identifier(f"{schema_name}.{table_name}")
        else:
            normalized = normalize_table_identifier(table_name, schema="main")

        if normalized:
            tables.add(normalized)

    return tables


def build_query_tools(
    *,
    warehouse_path: Path,
    project_id: Optional[str] = None,
) -> List[StructuredTool]:
    def run_sql(sql: str, timeout: float = 30.0, preview_limit: int = 20) -> Dict[str, Any]:
        if not _is_read_only_sql(sql):
            return {
                "status": "error",
                "error": _READ_ONLY_SQL_ERROR,
            }

        referenced_tables = _extract_referenced_tables(sql)
        if referenced_tables is None:
            return {
                "status": "error",
                "error": _PARSE_VALIDATION_ERROR,
            }

        if project_id is not None:
            allowlist = resolve_project_table_scope(
                warehouse_path=warehouse_path,
                project_id=project_id,
            )
            unauthorized_tables = sorted(
                table_name
                for table_name in referenced_tables
                if table_name not in allowlist
            )
            if unauthorized_tables:
                return {
                    "status": "error",
                    "error": _UNAUTHORIZED_TABLE_ERROR.format(
                        tables=", ".join(unauthorized_tables)
                    ),
                }

        manager = get_execution_manager(warehouse_path=warehouse_path)
        run_id = manager.submit_sql(sql)
        job = manager.wait_for(run_id, timeout=float(timeout))
        if job is None:
            return {"run_id": run_id, "status": "failed", "error": "Job not found"}

        payload: Dict[str, Any] = {
            "run_id": job.run_id,
            "status": job.status.value if hasattr(job.status, "value") else str(job.status),
            "result_table": job.result_table,
            "error": job.error,
            "rows_affected": job.rows_affected,
        }

        if job.result_table and (job.error is None) and int(preview_limit) > 0:
            with duckdb.connect(str(warehouse_path)) as con:
                cur = con.execute(f"SELECT * FROM {job.result_table} LIMIT ?", [int(preview_limit)])
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchall()
            payload["preview"] = [
                {cols[i]: _jsonable(row[i]) for i in range(len(cols))}
                for row in rows
            ]

        return payload

    return [
        StructuredTool.from_function(
            name="run_sql",
            func=run_sql,
            description=(
                "Execute SQL against DuckDB warehouse for one-off exploration. "
                "Returns run_id/result_table and a small preview. "
                "⚠️ DO NOT use this for CREATE VIEW/TABLE - use save_analysis() instead! "
                "Views created with run_sql won't appear in the Asset Library."
            ),
        )
    ]
