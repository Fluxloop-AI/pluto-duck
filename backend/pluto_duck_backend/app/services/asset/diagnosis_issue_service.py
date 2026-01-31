"""Diagnosis Issue service - LLM Issues storage and lifecycle management."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict, List, Optional

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse

logger = logging.getLogger(__name__)


@dataclass
class DiagnosisIssue:
    """Represents a single LLM-detected data quality issue."""

    id: str
    diagnosis_id: str
    file_asset_id: str
    issue: str
    issue_type: str
    suggestion: Optional[str]
    example: Optional[str]
    status: str
    user_response: Optional[str]
    confirmed_at: Optional[datetime]
    resolved_at: Optional[datetime]
    resolved_by: Optional[str]
    deleted_at: Optional[datetime]
    deleted_by: Optional[str]
    delete_reason: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    def to_dict(self) -> Dict[str, Optional[str]]:
        return {
            "id": self.id,
            "diagnosis_id": self.diagnosis_id,
            "file_asset_id": self.file_asset_id,
            "issue": self.issue,
            "issue_type": self.issue_type,
            "suggestion": self.suggestion,
            "example": self.example,
            "status": self.status,
            "user_response": self.user_response,
            "confirmed_at": self.confirmed_at.isoformat() if self.confirmed_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "resolved_by": self.resolved_by,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at else None,
            "deleted_by": self.deleted_by,
            "delete_reason": self.delete_reason,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


def _generate_issue_id() -> str:
    import uuid
    return f"issue_{uuid.uuid4().hex[:12]}"


class DiagnosisIssueService:
    """Service for managing Diagnosis Issues."""

    METADATA_SCHEMA = "_file_assets"
    METADATA_TABLE = "diagnosis_issues"

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
            conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    diagnosis_id TEXT NOT NULL,
                    file_asset_id TEXT NOT NULL,
                    issue TEXT NOT NULL,
                    issue_type TEXT NOT NULL,
                    suggestion TEXT,
                    example TEXT,
                    status TEXT DEFAULT 'open',
                    user_response TEXT,
                    confirmed_at TIMESTAMP WITH TIME ZONE,
                    resolved_at TIMESTAMP WITH TIME ZONE,
                    resolved_by TEXT,
                    deleted_at TIMESTAMP WITH TIME ZONE,
                    deleted_by TEXT,
                    delete_reason TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            try:
                conn.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.METADATA_TABLE}_file_asset
                    ON {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (file_asset_id)
                """)
                conn.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.METADATA_TABLE}_diagnosis
                    ON {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (diagnosis_id)
                """)
                conn.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{self.METADATA_TABLE}_file_asset_deleted
                    ON {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (file_asset_id, deleted_at)
                """)
            except Exception:
                pass

    def create_issues(
        self,
        *,
        diagnosis_id: str,
        file_asset_id: str,
        issues: List[Dict[str, Optional[str]]],
    ) -> List[DiagnosisIssue]:
        if not issues:
            return []

        now = datetime.now(UTC)
        created: List[DiagnosisIssue] = []
        with self._get_connection() as conn:
            for issue in issues:
                issue_id = _generate_issue_id()
                issue_text = issue.get("issue") or ""
                issue_type = issue.get("issue_type") or "general"
                suggestion = issue.get("suggestion")
                example = issue.get("example")
                conn.execute(
                    f"""
                    INSERT INTO {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (
                        id, project_id, diagnosis_id, file_asset_id,
                        issue, issue_type, suggestion, example,
                        status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        issue_id,
                        self.project_id,
                        diagnosis_id,
                        file_asset_id,
                        issue_text,
                        issue_type,
                        suggestion,
                        example,
                        "open",
                        now,
                        now,
                    ],
                )
                created.append(
                    DiagnosisIssue(
                        id=issue_id,
                        diagnosis_id=diagnosis_id,
                        file_asset_id=file_asset_id,
                        issue=issue_text,
                        issue_type=issue_type,
                        suggestion=suggestion,
                        example=example,
                        status="open",
                        user_response=None,
                        confirmed_at=None,
                        resolved_at=None,
                        resolved_by=None,
                        deleted_at=None,
                        deleted_by=None,
                        delete_reason=None,
                        created_at=now,
                        updated_at=now,
                    )
                )
        return created

    def list_issues(
        self,
        *,
        file_asset_id: str,
        include_deleted: bool = False,
        status: Optional[str] = None,
    ) -> List[DiagnosisIssue]:
        where = ["project_id = ?", "file_asset_id = ?"]
        params: List[object] = [self.project_id, file_asset_id]

        if not include_deleted:
            where.append("deleted_at IS NULL")
        if status:
            where.append("status = ?")
            params.append(status)

        sql = f"""
            SELECT id, diagnosis_id, file_asset_id, issue, issue_type,
                   suggestion, example, status, user_response, confirmed_at,
                   resolved_at, resolved_by, deleted_at, deleted_by,
                   delete_reason, created_at, updated_at
            FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
        """

        with self._get_connection() as conn:
            rows = conn.execute(sql, params).fetchall()

        return [self._row_to_issue(row) for row in rows]

    def delete_all(self) -> int:
        """Delete all diagnosis issues for this project.

        Returns:
            Number of issues removed (best effort).
        """
        with self._get_connection() as conn:
            before = conn.execute(
                f"""
                SELECT COUNT(*) FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ?
                """,
                [self.project_id],
            ).fetchone()[0]
            conn.execute(
                f"""
                DELETE FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ?
                """,
                [self.project_id],
            )
        return int(before or 0)

    def update_issue(
        self,
        *,
        issue_id: str,
        status: Optional[str] = None,
        user_response: Optional[str] = None,
        resolved_by: Optional[str] = None,
    ) -> Optional[DiagnosisIssue]:
        now = datetime.now(UTC)
        updates = ["updated_at = ?"]
        params: List[object] = [now]

        if status is not None:
            updates.append("status = ?")
            params.append(status)
            if status == "confirmed":
                updates.append("confirmed_at = COALESCE(confirmed_at, ?)")
                params.append(now)
            if status == "resolved":
                updates.append("resolved_at = COALESCE(resolved_at, ?)")
                params.append(now)
            if status == "resolved" and resolved_by is not None:
                updates.append("resolved_by = ?")
                params.append(resolved_by)

        if user_response is not None:
            updates.append("user_response = ?")
            params.append(user_response)
            if status is None:
                updates.append("status = ?")
                params.append("confirmed")
                updates.append("confirmed_at = COALESCE(confirmed_at, ?)")
                params.append(now)

        if not updates:
            return self.get_issue(issue_id)

        params.extend([issue_id, self.project_id])

        with self._get_connection() as conn:
            conn.execute(
                f"""
                UPDATE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                SET {', '.join(updates)}
                WHERE id = ? AND project_id = ?
                """,
                params,
            )

        return self.get_issue(issue_id)

    def soft_delete_issue(
        self,
        *,
        issue_id: str,
        deleted_by: Optional[str] = None,
        delete_reason: Optional[str] = None,
    ) -> Optional[DiagnosisIssue]:
        now = datetime.now(UTC)
        with self._get_connection() as conn:
            conn.execute(
                f"""
                UPDATE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                SET deleted_at = ?, deleted_by = ?, delete_reason = ?, updated_at = ?
                WHERE id = ? AND project_id = ?
                """,
                [now, deleted_by, delete_reason, now, issue_id, self.project_id],
            )
        return self.get_issue(issue_id, include_deleted=True)

    def get_issue(self, issue_id: str, *, include_deleted: bool = True) -> Optional[DiagnosisIssue]:
        where = ["id = ?", "project_id = ?"]
        params: List[object] = [issue_id, self.project_id]
        if not include_deleted:
            where.append("deleted_at IS NULL")

        with self._get_connection() as conn:
            row = conn.execute(
                f"""
                SELECT id, diagnosis_id, file_asset_id, issue, issue_type,
                       suggestion, example, status, user_response, confirmed_at,
                       resolved_at, resolved_by, deleted_at, deleted_by,
                       delete_reason, created_at, updated_at
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE {' AND '.join(where)}
                """,
                params,
            ).fetchone()
        return self._row_to_issue(row) if row else None

    def _row_to_issue(self, row) -> DiagnosisIssue:
        return DiagnosisIssue(
            id=row[0],
            diagnosis_id=row[1],
            file_asset_id=row[2],
            issue=row[3],
            issue_type=row[4],
            suggestion=row[5],
            example=row[6],
            status=row[7],
            user_response=row[8],
            confirmed_at=row[9],
            resolved_at=row[10],
            resolved_by=row[11],
            deleted_at=row[12],
            deleted_by=row[13],
            delete_reason=row[14],
            created_at=row[15],
            updated_at=row[16],
        )


_diagnosis_issue_services: Dict[str, DiagnosisIssueService] = {}


def get_diagnosis_issue_service(project_id: Optional[str] = None) -> DiagnosisIssueService:
    from pluto_duck_backend.app.services.chat import get_chat_repository

    settings = get_settings()

    if project_id is None:
        chat_repo = get_chat_repository()
        project_id = chat_repo._default_project_id

    if project_id not in _diagnosis_issue_services:
        _diagnosis_issue_services[project_id] = DiagnosisIssueService(
            project_id=project_id,
            warehouse_path=settings.duckdb.path,
        )

    return _diagnosis_issue_services[project_id]
