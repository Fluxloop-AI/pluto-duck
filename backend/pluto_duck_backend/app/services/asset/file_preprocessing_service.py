"""File preprocessing service - Readiness status + events tracking.

Stores agent/user-facing preprocessing readiness under the _file_assets schema.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, Optional

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse


@dataclass
class FilePreprocessingStatus:
    file_asset_id: str
    project_id: str
    status: str
    reason: Optional[str]
    last_diagnosis_id: Optional[str]
    updated_at: Optional[datetime]
    updated_by: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_asset_id": self.file_asset_id,
            "project_id": self.project_id,
            "status": self.status,
            "reason": self.reason,
            "last_diagnosis_id": self.last_diagnosis_id,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "updated_by": self.updated_by,
        }


@dataclass
class EffectivePreprocessingStatus:
    file_asset_id: str
    status: str
    reason: Optional[str]
    stale: bool
    last_diagnosis_id: Optional[str]
    updated_at: Optional[datetime]
    updated_by: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_asset_id": self.file_asset_id,
            "status": self.status,
            "reason": self.reason,
            "stale": self.stale,
            "last_diagnosis_id": self.last_diagnosis_id,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "updated_by": self.updated_by,
        }


@dataclass
class FilePreprocessingEvent:
    id: str
    project_id: str
    file_asset_id: str
    event_type: str
    message: Optional[str]
    actor: Optional[str]
    created_at: Optional[datetime]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "file_asset_id": self.file_asset_id,
            "event_type": self.event_type,
            "message": self.message,
            "actor": self.actor,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class FilePreprocessingService:
    """Service for managing preprocessing readiness and events."""

    METADATA_SCHEMA = "_file_assets"
    METADATA_TABLE = "file_preprocessing"
    EVENTS_TABLE = "file_preprocessing_events"

    def __init__(self, project_id: str, warehouse_path: Path):
        self.project_id = project_id
        self.warehouse_path = warehouse_path
        self._ensure_metadata_tables()

    @contextmanager
    def _get_connection(self):
        with connect_warehouse(self.warehouse_path) as conn:
            yield conn

    def _ensure_metadata_tables(self) -> None:
        with self._get_connection() as conn:
            conn.execute(f"CREATE SCHEMA IF NOT EXISTS {self.METADATA_SCHEMA}")
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (
                    file_asset_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reason TEXT,
                    last_diagnosis_id TEXT,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_by TEXT
                )
                """
            )
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.METADATA_SCHEMA}.{self.EVENTS_TABLE} (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    file_asset_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    message TEXT,
                    actor TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            try:
                conn.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.METADATA_TABLE}_project
                    ON {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (project_id)
                    """
                )
                conn.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.METADATA_TABLE}_file_asset
                    ON {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (file_asset_id)
                    """
                )
                conn.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.EVENTS_TABLE}_file_asset
                    ON {self.METADATA_SCHEMA}.{self.EVENTS_TABLE} (file_asset_id)
                    """
                )
            except Exception:
                pass

    def _row_to_status(self, row: tuple[Any, ...]) -> FilePreprocessingStatus:
        return FilePreprocessingStatus(
            file_asset_id=row[0],
            project_id=row[1],
            status=row[2],
            reason=row[3],
            last_diagnosis_id=row[4],
            updated_at=row[5],
            updated_by=row[6],
        )

    def _row_to_event(self, row: tuple[Any, ...]) -> FilePreprocessingEvent:
        return FilePreprocessingEvent(
            id=row[0],
            project_id=row[1],
            file_asset_id=row[2],
            event_type=row[3],
            message=row[4],
            actor=row[5],
            created_at=row[6],
        )

    def set_status(
        self,
        *,
        file_asset_id: str,
        status: str,
        reason: Optional[str] = None,
        actor: Optional[str] = None,
        last_diagnosis_id: Optional[str] = None,
    ) -> FilePreprocessingStatus:
        now = datetime.now(UTC)
        with self._get_connection() as conn:
            existing = conn.execute(
                f"""
                SELECT file_asset_id
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ? AND file_asset_id = ?
                """,
                [self.project_id, file_asset_id],
            ).fetchone()
            if existing:
                conn.execute(
                    f"""
                    UPDATE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                    SET status = ?,
                        reason = ?,
                        last_diagnosis_id = ?,
                        updated_at = ?,
                        updated_by = ?
                    WHERE project_id = ? AND file_asset_id = ?
                    """,
                    [
                        status,
                        reason,
                        last_diagnosis_id,
                        now,
                        actor,
                        self.project_id,
                        file_asset_id,
                    ],
                )
            else:
                conn.execute(
                    f"""
                    INSERT INTO {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (
                        file_asset_id,
                        project_id,
                        status,
                        reason,
                        last_diagnosis_id,
                        updated_at,
                        updated_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        file_asset_id,
                        self.project_id,
                        status,
                        reason,
                        last_diagnosis_id,
                        now,
                        actor,
                    ],
                )
        return FilePreprocessingStatus(
            file_asset_id=file_asset_id,
            project_id=self.project_id,
            status=status,
            reason=reason,
            last_diagnosis_id=last_diagnosis_id,
            updated_at=now,
            updated_by=actor,
        )

    def get_status(self, file_asset_id: str) -> Optional[FilePreprocessingStatus]:
        with self._get_connection() as conn:
            row = conn.execute(
                f"""
                SELECT file_asset_id, project_id, status, reason,
                       last_diagnosis_id, updated_at, updated_by
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ? AND file_asset_id = ?
                """,
                [self.project_id, file_asset_id],
            ).fetchone()
        if not row:
            return None
        return self._row_to_status(row)

    def get_effective_status(
        self,
        *,
        file_asset_id: str,
        current_diagnosis_id: Optional[str],
    ) -> EffectivePreprocessingStatus:
        status = self.get_status(file_asset_id)
        if not status:
            return EffectivePreprocessingStatus(
                file_asset_id=file_asset_id,
                status="unknown",
                reason=None,
                stale=False,
                last_diagnosis_id=None,
                updated_at=None,
                updated_by=None,
            )

        if status.last_diagnosis_id != current_diagnosis_id:
            return EffectivePreprocessingStatus(
                file_asset_id=file_asset_id,
                status="unknown",
                reason=None,
                stale=True,
                last_diagnosis_id=status.last_diagnosis_id,
                updated_at=status.updated_at,
                updated_by=status.updated_by,
            )

        return EffectivePreprocessingStatus(
            file_asset_id=file_asset_id,
            status=status.status,
            reason=status.reason,
            stale=False,
            last_diagnosis_id=status.last_diagnosis_id,
            updated_at=status.updated_at,
            updated_by=status.updated_by,
        )

    def get_readiness_summary(self, project_id: Optional[str] = None) -> Dict[str, Any]:
        target_project_id = project_id or self.project_id
        with self._get_connection() as conn:
            total = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ?
                """,
                [target_project_id],
            ).fetchone()
            ready_count = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ? AND status = 'ready'
                """,
                [target_project_id],
            ).fetchone()
            not_ready_rows = conn.execute(
                f"""
                SELECT file_asset_id, project_id, status, reason,
                       last_diagnosis_id, updated_at, updated_by
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ? AND status = 'not_ready'
                ORDER BY updated_at DESC
                """,
                [target_project_id],
            ).fetchall()

        not_ready = [self._row_to_status(row).to_dict() for row in not_ready_rows]

        return {
            "project_id": target_project_id,
            "total": int(total[0] if total else 0),
            "ready_count": int(ready_count[0] if ready_count else 0),
            "not_ready": not_ready,
        }

    def append_event(
        self,
        *,
        file_asset_id: str,
        event_type: str,
        message: Optional[str] = None,
        actor: Optional[str] = None,
    ) -> FilePreprocessingEvent:
        event_id = _generate_event_id()
        now = datetime.now(UTC)
        with self._get_connection() as conn:
            conn.execute(
                f"""
                INSERT INTO {self.METADATA_SCHEMA}.{self.EVENTS_TABLE} (
                    id,
                    project_id,
                    file_asset_id,
                    event_type,
                    message,
                    actor,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    event_id,
                    self.project_id,
                    file_asset_id,
                    event_type,
                    message,
                    actor,
                    now,
                ],
            )
        return FilePreprocessingEvent(
            id=event_id,
            project_id=self.project_id,
            file_asset_id=file_asset_id,
            event_type=event_type,
            message=message,
            actor=actor,
            created_at=now,
        )

    def list_events(
        self,
        *,
        file_asset_id: str,
        limit: Optional[int] = None,
    ) -> list[FilePreprocessingEvent]:
        params: list[object] = [self.project_id, file_asset_id]
        limit_sql = ""
        if limit is not None:
            limit_sql = "LIMIT ?"
            params.append(limit)

        with self._get_connection() as conn:
            rows = conn.execute(
                f"""
                SELECT id, project_id, file_asset_id, event_type, message, actor, created_at
                FROM {self.METADATA_SCHEMA}.{self.EVENTS_TABLE}
                WHERE project_id = ? AND file_asset_id = ?
                ORDER BY created_at DESC
                {limit_sql}
                """,
                params,
            ).fetchall()

        return [self._row_to_event(row) for row in rows]


def _generate_event_id() -> str:
    import uuid
    return f"prep_evt_{uuid.uuid4().hex[:12]}"


# =============================================================================
# Singleton factory
# =============================================================================


_file_preprocessing_services: Dict[str, FilePreprocessingService] = {}


def get_file_preprocessing_service(project_id: Optional[str] = None) -> FilePreprocessingService:
    """Get a FilePreprocessingService instance for a project."""
    from pluto_duck_backend.app.services.chat import get_chat_repository

    settings = get_settings()

    if project_id is None:
        chat_repo = get_chat_repository()
        project_id = chat_repo._default_project_id

    if project_id not in _file_preprocessing_services:
        _file_preprocessing_services[project_id] = FilePreprocessingService(
            project_id=project_id,
            warehouse_path=settings.duckdb.path,
        )

    return _file_preprocessing_services[project_id]
