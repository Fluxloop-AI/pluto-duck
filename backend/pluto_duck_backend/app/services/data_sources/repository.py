"""Repository for managing data sources."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import duckdb

from pluto_duck_backend.app.core.config import get_settings


@dataclass
class DataSource:
    """Data source connection entity."""

    id: str
    project_id: Optional[str]
    name: str
    description: Optional[str]
    connector_type: str
    source_config: Dict[str, Any]
    status: str
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    metadata: Optional[Dict[str, Any]]
    table_count: int


@dataclass
class DataSourceTable:
    """Table imported from a data source."""

    id: str
    data_source_id: str
    source_table: Optional[str]
    source_query: Optional[str]
    target_table: str
    rows_count: Optional[int]
    status: str
    last_imported_at: Optional[datetime]
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    metadata: Optional[Dict[str, Any]]


class DataSourceRepository:
    """Repository for data source CRUD operations."""

    def __init__(self, warehouse_path: Path, default_project_id: str) -> None:
        self.warehouse_path = warehouse_path
        self.default_project_id = default_project_id

    def _connect(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(self.warehouse_path))

    def create(
        self,
        name: str,
        connector_type: str,
        source_config: Dict[str, Any],
        *,
        description: Optional[str] = None,
        project_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Create a new data source connection."""
        source_id = str(uuid4())
        now = datetime.now(UTC)

        with self._connect() as con:
            con.execute(
                """
                INSERT INTO data_sources (
                    id, project_id, name, description, connector_type,
                    source_config, status, created_at, updated_at, metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
                """,
                [
                    source_id,
                    project_id or self.default_project_id,
                    name,
                    description,
                    connector_type,
                    json.dumps(source_config),
                    now,
                    now,
                    json.dumps(metadata or {}),
                ],
            )

        return source_id

    def list_all(self, project_id: Optional[str] = None) -> List[DataSource]:
        """List all data sources, optionally filtered by project."""
        with self._connect() as con:
            if project_id:
                rows = con.execute(
                    """
                    SELECT ds.id, ds.project_id, ds.name, ds.description, ds.connector_type,
                           ds.source_config, ds.status, ds.error_message, ds.created_at,
                           ds.updated_at, ds.metadata, dst.table_count
                    FROM data_sources ds
                    LEFT JOIN (
                        SELECT data_source_id, COUNT(*) AS table_count
                        FROM data_source_tables
                        GROUP BY data_source_id
                    ) dst ON ds.id = dst.data_source_id
                    WHERE ds.project_id = ?
                    ORDER BY ds.updated_at DESC
                    """,
                    [project_id],
                ).fetchall()
            else:
                rows = con.execute(
                    """
                    SELECT ds.id, ds.project_id, ds.name, ds.description, ds.connector_type,
                           ds.source_config, ds.status, ds.error_message, ds.created_at,
                           ds.updated_at, ds.metadata, dst.table_count
                    FROM data_sources ds
                    LEFT JOIN (
                        SELECT data_source_id, COUNT(*) AS table_count
                        FROM data_source_tables
                        GROUP BY data_source_id
                    ) dst ON ds.id = dst.data_source_id
                    ORDER BY ds.updated_at DESC
                    """
                ).fetchall()

        return [self._row_to_entity(row) for row in rows]

    def get(self, source_id: str) -> Optional[DataSource]:
        """Get a single data source by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT ds.id, ds.project_id, ds.name, ds.description, ds.connector_type,
                       ds.source_config, ds.status, ds.error_message, ds.created_at,
                       ds.updated_at, ds.metadata,
                       COALESCE(dst.table_count, 0)
                FROM data_sources ds
                LEFT JOIN (
                    SELECT data_source_id, COUNT(*) AS table_count
                    FROM data_source_tables
                    GROUP BY data_source_id
                ) dst ON ds.id = dst.data_source_id
                WHERE ds.id = ?
                """,
                [source_id],
            ).fetchone()

        if not row:
            return None

        return self._row_to_entity(row)

    def update_status(
        self,
        source_id: str,
        *,
        status: str,
        error_message: Optional[str] = None,
    ) -> None:
        """Update status/error for a data source."""
        now = datetime.now(UTC)

        with self._connect() as con:
            con.execute(
                """
                UPDATE data_sources
                SET status = ?, error_message = ?, updated_at = ?
                WHERE id = ?
                """,
                [status, error_message, now, source_id],
            )

    def list_tables(self, source_id: str) -> List[DataSourceTable]:
        """List tables associated with a data source."""
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT id, data_source_id, source_table, source_query,
                       target_table, rows_count, status, last_imported_at,
                       error_message, created_at, updated_at, metadata
                FROM data_source_tables
                WHERE data_source_id = ?
                ORDER BY updated_at DESC
                """,
                [source_id],
            ).fetchall()

        return [self._table_row_to_entity(row) for row in rows]

    def get_table(self, table_id: str) -> Optional[DataSourceTable]:
        """Get a single data source table by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, data_source_id, source_table, source_query,
                       target_table, rows_count, status, last_imported_at,
                       error_message, created_at, updated_at, metadata
                FROM data_source_tables
                WHERE id = ?
                """,
                [table_id],
            ).fetchone()

        if not row:
            return None

        return self._table_row_to_entity(row)

    def create_table(
        self,
        data_source_id: str,
        target_table: str,
        *,
        source_table: Optional[str] = None,
        source_query: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        status: str = "pending",
    ) -> str:
        """Create a new data source table record."""
        table_id = str(uuid4())
        now = datetime.now(UTC)

        with self._connect() as con:
            con.execute(
                """
                INSERT INTO data_source_tables (
                    id, data_source_id, source_table, source_query,
                    target_table, rows_count, status, last_imported_at,
                    error_message, created_at, updated_at, metadata
                )
                VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?)
                """,
                [
                    table_id,
                    data_source_id,
                    source_table,
                    source_query,
                    target_table,
                    status,
                    now,
                    now,
                    json.dumps(metadata or {}),
                ],
            )

        return table_id

    def update_table_status(
        self,
        table_id: str,
        *,
        status: str,
        rows_count: Optional[int] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Update status/info for a data source table."""
        now = datetime.now(UTC)

        with self._connect() as con:
            if metadata is not None:
                con.execute(
                    """
                    UPDATE data_source_tables
                    SET status = ?, rows_count = ?, last_imported_at = ?,
                        error_message = ?, updated_at = ?, metadata = ?
                    WHERE id = ?
                    """,
                    [
                        status,
                        rows_count,
                        now,
                        error_message,
                        now,
                        json.dumps(metadata),
                        table_id,
                    ],
                )
            else:
                con.execute(
                    """
                    UPDATE data_source_tables
                    SET status = ?, rows_count = ?, last_imported_at = ?,
                        error_message = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    [status, rows_count, now, error_message, now, table_id],
                )

    def delete_table(self, table_id: str) -> bool:
        """Delete a data source table record."""
        with self._connect() as con:
            exists = con.execute(
                "SELECT 1 FROM data_source_tables WHERE id = ?",
                [table_id],
            ).fetchone()

            if not exists:
                return False

            con.execute("DELETE FROM data_source_tables WHERE id = ?", [table_id])

        return True

    def delete(self, source_id: str) -> bool:
        """Delete a data source record."""
        with self._connect() as con:
            exists = con.execute(
                "SELECT 1 FROM data_sources WHERE id = ?",
                [source_id],
            ).fetchone()
            
            if not exists:
                return False
            
            con.execute("DELETE FROM data_sources WHERE id = ?", [source_id])
        
        return True

    def _row_to_entity(self, row: tuple) -> DataSource:
        """Convert database row to DataSource entity."""
        return DataSource(
            id=str(row[0]),
            project_id=str(row[1]) if row[1] else None,
            name=row[2],
            description=row[3],
            connector_type=row[4],
            source_config=json.loads(row[5]) if row[5] else {},
            status=row[6],
            error_message=row[7],
            created_at=self._ensure_utc(row[8]),
            updated_at=self._ensure_utc(row[9]),
            metadata=json.loads(row[10]) if row[10] else None,
            table_count=int(row[11] or 0),
        )

    def _table_row_to_entity(self, row: tuple) -> DataSourceTable:
        """Convert database row to DataSourceTable entity."""
        return DataSourceTable(
            id=str(row[0]),
            data_source_id=str(row[1]),
            source_table=row[2],
            source_query=row[3],
            target_table=row[4],
            rows_count=row[5],
            status=row[6],
            last_imported_at=self._ensure_utc(row[7]) if row[7] else None,
            error_message=row[8],
            created_at=self._ensure_utc(row[9]),
            updated_at=self._ensure_utc(row[10]),
            metadata=json.loads(row[11]) if row[11] else None,
        )

    def _ensure_utc(self, value: datetime) -> datetime:
        """Ensure datetime has UTC timezone."""
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


@lru_cache(maxsize=1)
def get_data_source_repository() -> DataSourceRepository:
    """Get singleton data source repository instance."""
    from pluto_duck_backend.app.services.chat import get_chat_repository
    
    settings = get_settings()
    chat_repo = get_chat_repository()
    
    return DataSourceRepository(
        warehouse_path=settings.duckdb.path,
        default_project_id=chat_repo._default_project_id,
    )

