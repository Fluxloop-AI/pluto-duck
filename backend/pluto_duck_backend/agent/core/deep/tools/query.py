"""Query execution tools (DuckDB)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import duckdb
from langchain_core.tools import StructuredTool

from pluto_duck_backend.app.services.execution.manager import get_execution_manager


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def build_query_tools(
    *,
    warehouse_path: Path,
    project_id: Optional[str] = None,
) -> List[StructuredTool]:
    def run_sql(sql: str, timeout: float = 30.0, preview_limit: int = 20) -> Dict[str, Any]:
        manager = get_execution_manager()
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
