"""DuckDB-backed query execution service."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Optional

import duckdb


class QueryJobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


@dataclass
class QueryJob:
    run_id: str
    sql: str
    submitted_at: datetime
    status: QueryJobStatus
    result_table: Optional[str] = None
    error: Optional[str] = None
    completed_at: Optional[datetime] = None
    rows_affected: Optional[int] = None


class QueryExecutionService:
    """Execute SQL queries against the local DuckDB warehouse."""

    def __init__(self, warehouse_path: Path):
        self.warehouse_path = warehouse_path
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        with duckdb.connect(str(self.warehouse_path)) as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS query_history (
                    job_id TEXT PRIMARY KEY,
                    sql TEXT,
                    status TEXT,
                    submitted_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    result_relation TEXT,
                    error TEXT,
                    rows_affected BIGINT
                )
                """
            )
            columns = {row[0] for row in con.execute("DESCRIBE query_history").fetchall()}
            if "rows_affected" not in columns:
                con.execute("ALTER TABLE query_history ADD COLUMN rows_affected BIGINT")

    def _sanitize_relation(self, run_id: str) -> str:
        sanitized = "".join(ch for ch in run_id if ch.isalnum() or ch == "_")
        if not sanitized:
            sanitized = "result"
        return f"query_result_{sanitized}"

    def _is_ddl_statement(self, sql: str) -> bool:
        """Check if the SQL is a DDL statement (CREATE, ALTER, DROP, etc.)."""
        normalized = sql.strip().upper()
        ddl_keywords = ('CREATE ', 'ALTER ', 'DROP ', 'TRUNCATE ', 'ATTACH ', 'DETACH ')
        return any(normalized.startswith(kw) for kw in ddl_keywords)

    def submit(self, run_id: str, sql: str) -> QueryJob:
        submitted_at = datetime.now(UTC)
        with duckdb.connect(str(self.warehouse_path)) as con:
            con.execute(
                "INSERT OR REPLACE INTO query_history (job_id, sql, status, submitted_at) VALUES (?, ?, ?, ?)",
                [run_id, sql, QueryJobStatus.PENDING.value, submitted_at],
            )
        return QueryJob(run_id=run_id, sql=sql, status=QueryJobStatus.PENDING, submitted_at=submitted_at)

    def execute(self, run_id: str) -> QueryJob:
        with duckdb.connect(str(self.warehouse_path)) as con:
            row = con.execute(
                "SELECT sql, submitted_at FROM query_history WHERE job_id = ?",
                [run_id],
            ).fetchone()
            if not row:
                raise ValueError(f"Unknown run_id {run_id}")
            sql, submitted_at = row
            submitted_at = submitted_at.replace(tzinfo=UTC) if submitted_at.tzinfo is None else submitted_at
            result_relation = self._sanitize_relation(run_id)
            try:
                # Check if this is a DDL statement (CREATE, ALTER, DROP, etc.)
                if self._is_ddl_statement(sql):
                    # Execute DDL directly without wrapping
                    con.execute(sql)
                    rows_affected = None
                    # For DDL, no result table is created
                    result_relation = None
                else:
                    # For SELECT queries, wrap in CREATE TABLE AS
                    con.execute(f"CREATE OR REPLACE TABLE {result_relation} AS {sql}")
                    rows_affected = con.execute(f"SELECT COUNT(*) FROM {result_relation}").fetchone()[0]
                
                completed_at = datetime.now(UTC)
                con.execute(
                    "UPDATE query_history SET status=?, completed_at=?, result_relation=?, error=NULL, rows_affected=? WHERE job_id=?",
                    [QueryJobStatus.SUCCESS.value, completed_at, result_relation, rows_affected, run_id],
                )
            except duckdb.Error as exc:
                completed_at = datetime.now(UTC)
                con.execute(
                    "UPDATE query_history SET status=?, completed_at=?, error=?, rows_affected=NULL WHERE job_id=?",
                    [QueryJobStatus.FAILED.value, completed_at, str(exc), run_id],
                )
                raise
        return self.fetch(run_id)  # type: ignore[return-value]

    def fetch(self, run_id: str) -> Optional[QueryJob]:
        with duckdb.connect(str(self.warehouse_path)) as con:
            row = con.execute(
                "SELECT job_id, sql, status, submitted_at, completed_at, result_relation, error, rows_affected FROM query_history WHERE job_id=?",
                [run_id],
            ).fetchone()
        if not row:
            return None
        submitted_at = row[3]
        if isinstance(submitted_at, datetime) and submitted_at.tzinfo is None:
            submitted_at = submitted_at.replace(tzinfo=UTC)
        completed_at = row[4]
        if isinstance(completed_at, datetime) and completed_at.tzinfo is None:
            completed_at = completed_at.replace(tzinfo=UTC)
        status = QueryJobStatus(row[2])
        return QueryJob(
            run_id=row[0],
            sql=row[1],
            status=status,
            submitted_at=submitted_at,
            completed_at=completed_at,
            result_table=row[5],
            error=row[6],
            rows_affected=row[7],
        )

    def cleanup(self, *, older_than_hours: int = 168) -> int:
        """Remove historical query artifacts older than the TTL.

        Drops result tables and deletes query history rows whose completion time
        is older than ``older_than_hours`` hours. Returns the number of rows
        removed from ``query_history``.
        """

        cutoff = datetime.now(UTC) - timedelta(hours=older_than_hours)
        removed_rows = 0
        with duckdb.connect(str(self.warehouse_path)) as con:
            stale_rows = con.execute(
                "SELECT job_id, result_relation FROM query_history WHERE completed_at IS NOT NULL AND completed_at < ?",
                [cutoff],
            ).fetchall()

            for job_id, relation in stale_rows:
                if relation:
                    try:
                        con.execute(f"DROP TABLE IF EXISTS {relation}")
                    except duckdb.Error:
                        # Ignore drop failures to avoid stopping the cleanup.
                        pass

            removed_rows = con.execute(
                "DELETE FROM query_history WHERE completed_at IS NOT NULL AND completed_at < ?",
                [cutoff],
            ).rowcount
        return removed_rows


