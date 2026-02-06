from __future__ import annotations

import json
import logging
import shutil
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from pluto_duck_backend.app.services.projects.analysis_ownership import (
    resolve_owned_and_shared_analysis_ids,
)
from pluto_duck_backend.app.services.source import get_source_service
from pluto_duck_backend.app.services.workzone import get_work_zone_service

logger = logging.getLogger(__name__)


def _quote_identifier(name: str) -> str:
    escaped = name.replace('"', '""')
    return f'"{escaped}"'


class ProjectRepository:
    def __init__(self, warehouse_path: Path) -> None:
        self.warehouse_path = warehouse_path

    def _connect(self):
        return connect_warehouse(self.warehouse_path)

    def _generate_uuid(self) -> str:
        from uuid import uuid4
        return str(uuid4())

    def _table_exists(self, con: Any, schema_name: str, table_name: str) -> bool:
        row = con.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = ? AND table_name = ?
            """,
            [schema_name, table_name],
        ).fetchone()
        return bool(row and row[0])

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get project details by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, name, description, created_at, updated_at, settings, is_default
                FROM projects
                WHERE id = ?
                """,
                [project_id]
            ).fetchone()
            
            if not row:
                return None
            
            return {
                "id": str(row[0]),
                "name": row[1],
                "description": row[2],
                "created_at": row[3].isoformat() if row[3] else None,
                "updated_at": row[4].isoformat() if row[4] else None,
                "settings": json.loads(row[5]) if row[5] else {},
                "is_default": row[6],
            }

    def list_projects(self) -> List[Dict[str, Any]]:
        """List all projects with metadata."""
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT 
                    p.id, p.name, p.description, p.created_at, p.updated_at, 
                    p.settings, p.is_default,
                    COUNT(DISTINCT b.id) as board_count,
                    COUNT(DISTINCT c.id) as conversation_count
                FROM projects p
                LEFT JOIN boards b ON b.project_id = p.id
                LEFT JOIN agent_conversations c ON c.project_id = p.id
                GROUP BY
                    p.id,
                    p.name,
                    p.description,
                    p.created_at,
                    p.updated_at,
                    p.settings,
                    p.is_default
                ORDER BY p.is_default DESC, p.updated_at DESC
                """
            ).fetchall()
            
            return [
                {
                    "id": str(row[0]),
                    "name": row[1],
                    "description": row[2],
                    "created_at": row[3].isoformat() if row[3] else None,
                    "updated_at": row[4].isoformat() if row[4] else None,
                    "settings": json.loads(row[5]) if row[5] else {},
                    "is_default": row[6],
                    "board_count": row[7] or 0,
                    "conversation_count": row[8] or 0,
                }
                for row in rows
            ]

    def create_project(self, name: str, description: Optional[str] = None) -> str:
        """Create a new project and return its ID."""
        project_id = self._generate_uuid()
        now = datetime.now(UTC)
        
        with self._connect() as con:
            con.execute(
                """
                INSERT INTO projects (
                    id,
                    name,
                    description,
                    is_default,
                    created_at,
                    updated_at,
                    settings
                )
                VALUES (?, ?, ?, FALSE, ?, ?, ?)
                """,
                [
                    project_id,
                    name,
                    description,
                    now,
                    now,
                    json.dumps({}),
                ]
            )
        
        return project_id

    def update_project_settings(self, project_id: str, settings: Dict[str, Any]) -> None:
        """Update project settings (merges with existing settings)."""
        with self._connect() as con:
            # Get existing settings
            row = con.execute(
                "SELECT settings FROM projects WHERE id = ?",
                [project_id]
            ).fetchone()
            
            if not row:
                raise ValueError(f"Project {project_id} not found")
            
            existing_settings = json.loads(row[0]) if row[0] else {}
            
            # Merge settings (deep merge for ui_state)
            if "ui_state" in settings and "ui_state" in existing_settings:
                existing_settings["ui_state"].update(settings["ui_state"])
            else:
                existing_settings.update(settings)
            
            # Update
            now = datetime.now(UTC)
            con.execute(
                """
                UPDATE projects 
                SET settings = ?, updated_at = ?
                WHERE id = ?
                """,
                [json.dumps(existing_settings), now, project_id]
            )

    def delete_project(self, project_id: str) -> None:
        """Delete a project and all associated data (except default project)."""
        warehouse_data_dir = self.warehouse_path.parent
        analyses_root = warehouse_data_dir / "analyses"
        analyses_dir = analyses_root / project_id
        owned_analysis_ids, shared_analysis_ids = resolve_owned_and_shared_analysis_ids(
            project_id=project_id,
            analyses_root=analyses_root,
        )

        conversation_ids: List[str] = []

        with self._connect() as con:
            # Check if it's the default project
            row = con.execute(
                "SELECT is_default FROM projects WHERE id = ?",
                [project_id]
            ).fetchone()
            
            if not row:
                raise ValueError(f"Project {project_id} not found")
            
            if row[0]:
                raise ValueError("Cannot delete the default project")

            conversation_ids = [
                str(item[0])
                for item in con.execute(
                    "SELECT id FROM agent_conversations WHERE project_id = ?",
                    [project_id],
                ).fetchall()
            ]

            # Board data
            con.execute(
                """
                DELETE FROM board_item_assets
                WHERE board_item_id IN (
                    SELECT id FROM board_items
                    WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
                )
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM board_queries
                WHERE board_item_id IN (
                    SELECT id FROM board_items
                    WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
                )
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM board_items
                WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
                """,
                [project_id]
            )
            con.execute("DELETE FROM boards WHERE project_id = ?", [project_id])

            # Conversations and dependent artifacts
            con.execute(
                """
                DELETE FROM agent_tool_approvals
                WHERE conversation_id IN (
                    SELECT id FROM agent_conversations WHERE project_id = ?
                )
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM agent_checkpoints
                WHERE run_id IN (
                    SELECT run_id
                    FROM agent_messages
                    WHERE conversation_id IN (
                        SELECT id FROM agent_conversations WHERE project_id = ?
                    )
                    AND run_id IS NOT NULL
                    UNION
                    SELECT run_id
                    FROM agent_conversations
                    WHERE project_id = ?
                    AND run_id IS NOT NULL
                )
                """,
                [project_id, project_id],
            )
            con.execute(
                """
                DELETE FROM agent_messages
                WHERE conversation_id IN (SELECT id FROM agent_conversations WHERE project_id = ?)
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM agent_events
                WHERE conversation_id IN (SELECT id FROM agent_conversations WHERE project_id = ?)
                """,
                [project_id]
            )
            con.execute("DELETE FROM agent_conversations WHERE project_id = ?", [project_id])

            # Data sources metadata
            con.execute(
                """
                DELETE FROM data_source_tables
                WHERE data_source_id IN (SELECT id FROM data_sources WHERE project_id = ?)
                """,
                [project_id]
            )
            con.execute("DELETE FROM data_sources WHERE project_id = ?", [project_id])

            # File metadata schema is created lazily by file service.
            if self._table_exists(con, "_file_assets", "files"):
                con.execute(
                    "DELETE FROM _file_assets.files WHERE project_id = ?",
                    [project_id],
                )

            # Duckpipe history/state for analysis files in this project.
            # Shared IDs are skipped to avoid cross-project data loss.
            if owned_analysis_ids and self._table_exists(con, "_duckpipe", "run_history"):
                placeholders = ", ".join(["?"] * len(owned_analysis_ids))
                con.execute(
                    f"DELETE FROM _duckpipe.run_history WHERE analysis_id IN ({placeholders})",
                    owned_analysis_ids,
                )
            if owned_analysis_ids and self._table_exists(con, "_duckpipe", "run_state"):
                placeholders = ", ".join(["?"] * len(owned_analysis_ids))
                con.execute(
                    f"DELETE FROM _duckpipe.run_state WHERE analysis_id IN ({placeholders})",
                    owned_analysis_ids,
                )
            for analysis_id in owned_analysis_ids:
                safe_id = _quote_identifier(analysis_id)
                try:
                    con.execute(f"DROP VIEW IF EXISTS analysis.{safe_id}")
                except Exception:
                    pass
                try:
                    con.execute(f"DROP TABLE IF EXISTS analysis.{safe_id}")
                except Exception:
                    pass
            for analysis_id in shared_analysis_ids:
                logger.warning(
                    "Project delete: skipping shared analysis cleanup for id='%s' (project_id=%s)",
                    analysis_id,
                    project_id,
                )

            # Project row
            con.execute("DELETE FROM projects WHERE id = ?", [project_id])

        # Runtime work zones
        if conversation_ids:
            workzone_service = get_work_zone_service()
            for conversation_id in conversation_ids:
                workzone_service.delete(conversation_id)

        # Project warehouse directory
        project_dir = warehouse_data_dir / "projects" / project_id
        if project_dir.exists():
            shutil.rmtree(project_dir)

        # Analysis definitions directory
        if analyses_dir.exists():
            shutil.rmtree(analyses_dir)

        # Ensure future source requests start from fresh cache.
        try:
            get_source_service.cache_clear()
        except Exception as exc:
            logger.debug("Failed to clear source service cache: %s", exc)


@lru_cache(maxsize=1)
def get_project_repository() -> ProjectRepository:
    settings = get_settings()
    return ProjectRepository(settings.duckdb.path)
