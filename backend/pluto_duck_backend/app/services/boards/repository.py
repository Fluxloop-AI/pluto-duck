"""Repository for board operations."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse


@dataclass
class Board:
    """Board entity."""

    id: str
    project_id: str
    name: str
    description: Optional[str]
    position: int
    created_at: datetime
    updated_at: datetime
    settings: Dict[str, Any]


@dataclass
class BoardItem:
    """Board item entity (widget/card on a board)."""

    id: str
    board_id: str
    item_type: str
    title: Optional[str]
    position_x: int
    position_y: int
    width: int
    height: int
    payload: Dict[str, Any]
    render_config: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


@dataclass
class BoardQuery:
    """Board query entity for chart/table/metric items."""

    id: str
    board_item_id: str
    query_text: str
    data_source_tables: List[str]
    refresh_mode: str
    refresh_interval_seconds: Optional[int]
    last_executed_at: Optional[datetime]
    last_result_snapshot: Optional[Dict[str, Any]]
    last_result_rows: Optional[int]
    execution_status: str
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime


@dataclass
class BoardAsset:
    """Board item asset entity (images/files)."""

    id: str
    board_item_id: str
    asset_type: str
    file_name: str
    file_path: str
    file_size: Optional[int]
    mime_type: Optional[str]
    thumbnail_path: Optional[str]
    created_at: datetime


class BoardsRepository:
    """Repository for board operations."""

    def __init__(self, warehouse_path: Path) -> None:
        self.warehouse_path = warehouse_path

    def _connect(self):
        """Create database connection."""
        return connect_warehouse(self.warehouse_path)

    def _generate_uuid(self) -> str:
        """Generate UUID string."""
        from uuid import uuid4
        return str(uuid4())

    def _now_utc_iso(self) -> str:
        """Return current UTC timestamp in ISO 8601 format."""
        return datetime.now(UTC).isoformat()

    def _ensure_utc(self, value: datetime) -> datetime:
        """Ensure datetime has UTC timezone.

        Defensive path for legacy rows saved without timezone metadata.
        """
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    # ========== Board CRUD ==========

    def create_board(
        self,
        project_id: str,
        name: str,
        description: Optional[str] = None,
        settings: Optional[Dict[str, Any]] = None,
        ) -> str:
        """Create a new board."""
        board_id = self._generate_uuid()
        now = self._now_utc_iso()
        settings_json = json.dumps(settings or {})

        with self._connect() as con:
            # Get max position for project
            max_pos_row = con.execute(
                "SELECT COALESCE(MAX(position), -1) FROM boards WHERE project_id = ?",
                [project_id],
            ).fetchone()
            position = (max_pos_row[0] if max_pos_row else -1) + 1

            con.execute(
                """
                INSERT INTO boards (id, project_id, name, description, position, created_at, updated_at, settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [board_id, project_id, name, description, position, now, now, settings_json],
            )

        return board_id

    def get_board(self, board_id: str) -> Optional[Board]:
        """Get board by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, project_id, name, description, position, created_at, updated_at, settings
                FROM boards
                WHERE id = ?
                """,
                [board_id],
            ).fetchone()

        if not row:
            return None

        return Board(
            id=str(row[0]),
            project_id=str(row[1]),
            name=row[2],
            description=row[3],
            position=row[4],
            created_at=self._ensure_utc(row[5]),
            updated_at=self._ensure_utc(row[6]),
            settings=json.loads(row[7]) if row[7] else {},
        )

    def list_boards(self, project_id: str) -> List[Board]:
        """List all boards for a project, ordered by most recently updated first (based on items)."""
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT 
                    b.id, 
                    b.project_id, 
                    b.name, 
                    b.description, 
                    b.position, 
                    b.created_at, 
                    b.updated_at, 
                    b.settings,
                    COALESCE(MAX(bi.updated_at), b.updated_at) as effective_updated_at
                FROM boards b
                LEFT JOIN board_items bi ON b.id = bi.board_id
                WHERE b.project_id = ?
                GROUP BY b.id, b.project_id, b.name, b.description, b.position, b.created_at, b.updated_at, b.settings
                ORDER BY effective_updated_at DESC
                """,
                [project_id],
            ).fetchall()

        return [
            Board(
                id=str(row[0]),
                project_id=str(row[1]),
                name=row[2],
                description=row[3],
                position=row[4],
                created_at=self._ensure_utc(row[5]),
                updated_at=self._ensure_utc(row[8]),  # Use effective_updated_at
                settings=json.loads(row[7]) if row[7] else {},
            )
            for row in rows
        ]

    def update_board(
        self,
        board_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        settings: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Update board fields."""
        updates = []
        params = []

        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if settings is not None:
            updates.append("settings = ?")
            params.append(json.dumps(settings))

        if not updates:
            return False

        now = self._now_utc_iso()
        updates.append("updated_at = ?")
        params.append(now)
        params.append(board_id)

        with self._connect() as con:
            con.execute(
                f"UPDATE boards SET {', '.join(updates)} WHERE id = ?",
                params,
            )

        return True

    def delete_board(self, board_id: str) -> bool:
        """Delete a board and all its items (manual cascade since DuckDB doesn't support CASCADE)."""
        with self._connect() as con:
            exists = con.execute(
                "SELECT 1 FROM boards WHERE id = ?",
                [board_id],
            ).fetchone()

            if not exists:
                return False

            # Get all items for this board
            items = con.execute(
                "SELECT id FROM board_items WHERE board_id = ?",
                [board_id],
            ).fetchall()

            # Delete related data for each item
            for (item_id,) in items:
                # Delete assets
                con.execute("DELETE FROM board_item_assets WHERE board_item_id = ?", [str(item_id)])
                # Delete queries
                con.execute("DELETE FROM board_queries WHERE board_item_id = ?", [str(item_id)])

            # Delete all items
            con.execute("DELETE FROM board_items WHERE board_id = ?", [board_id])
            
            # Finally delete the board
            con.execute("DELETE FROM boards WHERE id = ?", [board_id])

        return True

    def reorder_boards(self, project_id: str, board_positions: List[Tuple[str, int]]) -> bool:
        """Reorder boards by updating positions."""
        now = self._now_utc_iso()
        with self._connect() as con:
            for board_id, position in board_positions:
                con.execute(
                    "UPDATE boards SET position = ?, updated_at = ? WHERE id = ? AND project_id = ?",
                    [position, now, board_id, project_id],
                )

        return True

    # ========== BoardItem CRUD ==========

    def create_item(
        self,
        board_id: str,
        item_type: str,
        payload: Dict[str, Any],
        title: Optional[str] = None,
        position_x: int = 0,
        position_y: int = 0,
        width: int = 1,
        height: int = 1,
        render_config: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Create a board item."""
        item_id = self._generate_uuid()
        now = self._now_utc_iso()
        payload_json = json.dumps(payload)
        render_config_json = json.dumps(render_config) if render_config else None

        with self._connect() as con:
            con.execute(
                """
                INSERT INTO board_items (
                    id, board_id, item_type, title, position_x, position_y, width, height,
                    payload, render_config, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    item_id,
                    board_id,
                    item_type,
                    title,
                    position_x,
                    position_y,
                    width,
                    height,
                    payload_json,
                    render_config_json,
                    now,
                    now,
                ],
            )

        return item_id

    def get_item(self, item_id: str) -> Optional[BoardItem]:
        """Get board item by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, board_id, item_type, title, position_x, position_y, width, height,
                       payload, render_config, created_at, updated_at
                FROM board_items
                WHERE id = ?
                """,
                [item_id],
            ).fetchone()

        if not row:
            return None

        return BoardItem(
            id=str(row[0]),
            board_id=str(row[1]),
            item_type=row[2],
            title=row[3],
            position_x=row[4],
            position_y=row[5],
            width=row[6],
            height=row[7],
            payload=json.loads(row[8]) if row[8] else {},
            render_config=json.loads(row[9]) if row[9] else None,
            created_at=self._ensure_utc(row[10]),
            updated_at=self._ensure_utc(row[11]),
        )

    def list_items(self, board_id: str) -> List[BoardItem]:
        """List all items for a board."""
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT id, board_id, item_type, title, position_x, position_y, width, height,
                       payload, render_config, created_at, updated_at
                FROM board_items
                WHERE board_id = ?
                ORDER BY position_y ASC, position_x ASC
                """,
                [board_id],
            ).fetchall()

        return [
            BoardItem(
                id=str(row[0]),
                board_id=str(row[1]),
                item_type=row[2],
                title=row[3],
                position_x=row[4],
                position_y=row[5],
                width=row[6],
                height=row[7],
                payload=json.loads(row[8]) if row[8] else {},
                render_config=json.loads(row[9]) if row[9] else None,
                created_at=self._ensure_utc(row[10]),
                updated_at=self._ensure_utc(row[11]),
            )
            for row in rows
        ]

    def update_item(
        self,
        item_id: str,
        title: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        render_config: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Update item fields."""
        updates = []
        params = []

        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if payload is not None:
            updates.append("payload = ?")
            params.append(json.dumps(payload))
        if render_config is not None:
            updates.append("render_config = ?")
            params.append(json.dumps(render_config))

        if not updates:
            return False

        now = self._now_utc_iso()
        updates.append("updated_at = ?")
        params.append(now)
        params.append(item_id)

        with self._connect() as con:
            con.execute(
                f"UPDATE board_items SET {', '.join(updates)} WHERE id = ?",
                params,
            )

        return True

    def delete_item(self, item_id: str) -> bool:
        """Delete a board item (manual cascade to queries/assets)."""
        with self._connect() as con:
            exists = con.execute(
                "SELECT 1 FROM board_items WHERE id = ?",
                [item_id],
            ).fetchone()

            if not exists:
                return False

            # Delete related data first
            con.execute("DELETE FROM board_item_assets WHERE board_item_id = ?", [item_id])
            con.execute("DELETE FROM board_queries WHERE board_item_id = ?", [item_id])
            
            # Then delete the item
            con.execute("DELETE FROM board_items WHERE id = ?", [item_id])

        return True

    def update_item_position(
        self,
        item_id: str,
        position_x: int,
        position_y: int,
        width: int,
        height: int,
    ) -> bool:
        """Update item position and size."""
        now = self._now_utc_iso()
        
        with self._connect() as con:
            con.execute(
                """
                UPDATE board_items
                SET position_x = ?, position_y = ?, width = ?, height = ?, updated_at = ?
                WHERE id = ?
                """,
                [position_x, position_y, width, height, now, item_id],
            )

        return True

    # ========== BoardQuery CRUD ==========

    def create_query(
        self,
        item_id: str,
        query_text: str,
        data_source_tables: Optional[List[str]] = None,
        refresh_mode: str = "manual",
        refresh_interval_seconds: Optional[int] = None,
    ) -> str:
        """Create a query for a board item."""
        query_id = self._generate_uuid()
        now = self._now_utc_iso()
        tables_json = json.dumps(data_source_tables or [])

        with self._connect() as con:
            con.execute(
                """
                INSERT INTO board_queries (
                    id, board_item_id, query_text, data_source_tables, refresh_mode,
                    refresh_interval_seconds, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [query_id, item_id, query_text, tables_json, refresh_mode, refresh_interval_seconds, now, now],
            )

        return query_id

    def get_query(self, query_id: str) -> Optional[BoardQuery]:
        """Get query by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, board_item_id, query_text, data_source_tables, refresh_mode,
                       refresh_interval_seconds, last_executed_at, last_result_snapshot,
                       last_result_rows, execution_status, error_message, created_at, updated_at
                FROM board_queries
                WHERE id = ?
                """,
                [query_id],
            ).fetchone()

        if not row:
            return None

        return BoardQuery(
            id=row[0],
            board_item_id=row[1],
            query_text=row[2],
            data_source_tables=json.loads(row[3]) if row[3] else [],
            refresh_mode=row[4],
            refresh_interval_seconds=row[5],
            last_executed_at=self._ensure_utc(row[6]) if row[6] else None,
            last_result_snapshot=json.loads(row[7]) if row[7] else None,
            last_result_rows=row[8],
            execution_status=row[9],
            error_message=row[10],
            created_at=self._ensure_utc(row[11]),
            updated_at=self._ensure_utc(row[12]),
        )

    def get_query_by_item(self, item_id: str) -> Optional[BoardQuery]:
        """Get query by board item ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, board_item_id, query_text, data_source_tables, refresh_mode,
                       refresh_interval_seconds, last_executed_at, last_result_snapshot,
                       last_result_rows, execution_status, error_message, created_at, updated_at
                FROM board_queries
                WHERE board_item_id = ?
                """,
                [item_id],
            ).fetchone()

        if not row:
            return None

        return BoardQuery(
            id=str(row[0]),
            board_item_id=str(row[1]),
            query_text=row[2],
            data_source_tables=json.loads(row[3]) if row[3] else [],
            refresh_mode=row[4],
            refresh_interval_seconds=row[5],
            last_executed_at=self._ensure_utc(row[6]) if row[6] else None,
            last_result_snapshot=json.loads(row[7]) if row[7] else None,
            last_result_rows=row[8],
            execution_status=row[9],
            error_message=row[10],
            created_at=self._ensure_utc(row[11]),
            updated_at=self._ensure_utc(row[12]),
        )

    def update_query(
        self,
        query_id: str,
        query_text: Optional[str] = None,
        refresh_mode: Optional[str] = None,
        refresh_interval_seconds: Optional[int] = None,
    ) -> bool:
        """Update query fields."""
        updates = []
        params = []

        if query_text is not None:
            updates.append("query_text = ?")
            params.append(query_text)
        if refresh_mode is not None:
            updates.append("refresh_mode = ?")
            params.append(refresh_mode)
        if refresh_interval_seconds is not None:
            updates.append("refresh_interval_seconds = ?")
            params.append(refresh_interval_seconds)

        if not updates:
            return False

        now = self._now_utc_iso()
        updates.append("updated_at = ?")
        params.append(now)
        params.append(query_id)

        with self._connect() as con:
            con.execute(
                f"UPDATE board_queries SET {', '.join(updates)} WHERE id = ?",
                params,
            )

        return True

    def update_query_result(
        self,
        query_id: str,
        result: Optional[Dict[str, Any]],
        rows: int,
        status: str,
        error_message: Optional[str] = None,
    ) -> bool:
        """Update query execution result and status."""
        now = self._now_utc_iso()
        result_json = json.dumps(result) if result else None

        with self._connect() as con:
            con.execute(
                """
                UPDATE board_queries
                SET last_executed_at = ?,
                    last_result_snapshot = ?,
                    last_result_rows = ?,
                    execution_status = ?,
                    error_message = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                [now, result_json, rows, status, error_message, now, query_id],
            )

        return True

    # ========== BoardAsset CRUD ==========

    def create_asset(
        self,
        item_id: str,
        asset_type: str,
        file_name: str,
        file_path: str,
        file_size: Optional[int] = None,
        mime_type: Optional[str] = None,
        thumbnail_path: Optional[str] = None,
    ) -> str:
        """Create an asset record."""
        asset_id = self._generate_uuid()
        now = self._now_utc_iso()

        with self._connect() as con:
            con.execute(
                """
                INSERT INTO board_item_assets (
                    id, board_item_id, asset_type, file_name, file_path,
                    file_size, mime_type, thumbnail_path, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [asset_id, item_id, asset_type, file_name, file_path, file_size, mime_type, thumbnail_path, now],
            )

        return asset_id

    def get_asset(self, asset_id: str) -> Optional[BoardAsset]:
        """Get asset by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, board_item_id, asset_type, file_name, file_path,
                       file_size, mime_type, thumbnail_path, created_at
                FROM board_item_assets
                WHERE id = ?
                """,
                [asset_id],
            ).fetchone()

        if not row:
            return None

        return BoardAsset(
            id=str(row[0]),
            board_item_id=str(row[1]),
            asset_type=row[2],
            file_name=row[3],
            file_path=row[4],
            file_size=row[5],
            mime_type=row[6],
            thumbnail_path=row[7],
            created_at=self._ensure_utc(row[8]),
        )

    def list_assets(self, item_id: str) -> List[BoardAsset]:
        """List all assets for a board item."""
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT id, board_item_id, asset_type, file_name, file_path,
                       file_size, mime_type, thumbnail_path, created_at
                FROM board_item_assets
                WHERE board_item_id = ?
                ORDER BY created_at DESC
                """,
                [item_id],
            ).fetchall()

        return [
            BoardAsset(
                id=str(row[0]),
                board_item_id=str(row[1]),
                asset_type=row[2],
                file_name=row[3],
                file_path=row[4],
                file_size=row[5],
                mime_type=row[6],
                thumbnail_path=row[7],
                created_at=self._ensure_utc(row[8]),
            )
            for row in rows
        ]

    def delete_asset(self, asset_id: str) -> bool:
        """Delete an asset record."""
        with self._connect() as con:
            exists = con.execute(
                "SELECT 1 FROM board_item_assets WHERE id = ?",
                [asset_id],
            ).fetchone()

            if not exists:
                return False

            con.execute("DELETE FROM board_item_assets WHERE id = ?", [asset_id])

        return True


@lru_cache(maxsize=1)
def get_boards_repository() -> BoardsRepository:
    """Get boards repository singleton."""
    settings = get_settings()
    return BoardsRepository(settings.duckdb.path)
