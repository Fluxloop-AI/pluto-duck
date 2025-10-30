from __future__ import annotations

import json
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import duckdb

from pluto_duck_backend.app.core.config import get_settings


class ProjectRepository:
    def __init__(self, warehouse_path: Path) -> None:
        self.warehouse_path = warehouse_path

    def _connect(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(self.warehouse_path))

    def _generate_uuid(self) -> str:
        from uuid import uuid4
        return str(uuid4())

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
                GROUP BY p.id, p.name, p.description, p.created_at, p.updated_at, p.settings, p.is_default
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
                INSERT INTO projects (id, name, description, is_default, created_at, updated_at, settings)
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
            
            # Delete associated data (cascade)
            # Delete board items first
            con.execute(
                """
                DELETE FROM board_items 
                WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
                """,
                [project_id]
            )
            
            # Delete boards
            con.execute("DELETE FROM boards WHERE project_id = ?", [project_id])
            
            # Delete conversations and messages
            con.execute(
                """
                DELETE FROM agent_messages 
                WHERE conversation_id IN (SELECT id FROM agent_conversations WHERE project_id = ?)
                """,
                [project_id]
            )
            con.execute(
                """
                DELETE FROM agent_events 
                WHERE conversation_id IN (SELECT id FROM agent_conversations WHERE project_id = ?)
                """,
                [project_id]
            )
            con.execute("DELETE FROM agent_conversations WHERE project_id = ?", [project_id])
            
            # Delete data sources
            con.execute(
                """
                DELETE FROM data_source_tables 
                WHERE data_source_id IN (SELECT id FROM data_sources WHERE project_id = ?)
                """,
                [project_id]
            )
            con.execute("DELETE FROM data_sources WHERE project_id = ?", [project_id])
            
            # Finally delete the project
            con.execute("DELETE FROM projects WHERE id = ?", [project_id])


@lru_cache(maxsize=1)
def get_project_repository() -> ProjectRepository:
    settings = get_settings()
    return ProjectRepository(settings.duckdb.path)

