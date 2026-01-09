from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import duckdb
import threading
import time
from contextlib import contextmanager

from pluto_duck_backend.app.core.config import get_settings

_table_init_lock = threading.Lock()
_duckdb_write_lock = threading.RLock()

# Retry settings for occasional DuckDB write-write conflicts (e.g., concurrent writers)
_WRITE_RETRY_ATTEMPTS = 5
_WRITE_RETRY_BASE_SLEEP_SECONDS = 0.02


DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY,
        name VARCHAR NOT NULL,
        description VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        settings JSON,
        is_default BOOLEAN DEFAULT FALSE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS agent_conversations (
        id UUID PRIMARY KEY,
        project_id UUID,
        title VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR DEFAULT 'active',
        last_message_preview VARCHAR,
        run_id UUID,
        metadata JSON
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS agent_messages (
        id UUID PRIMARY KEY,
        conversation_id UUID,
        role VARCHAR NOT NULL,
        content JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        seq INTEGER,
        run_id UUID,
        UNIQUE(conversation_id, seq)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS agent_events (
        id UUID PRIMARY KEY,
        conversation_id UUID,
        type VARCHAR NOT NULL,
        subtype VARCHAR,
        payload JSON,
        metadata JSON,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        source VARCHAR DEFAULT 'backend'
    )
    """,
    """
    -- HITL approvals for tool calls (persisted; supports interrupt/resume)
    CREATE TABLE IF NOT EXISTS agent_tool_approvals (
        id UUID PRIMARY KEY,
        conversation_id UUID NOT NULL,
        run_id UUID NOT NULL,
        status VARCHAR NOT NULL, -- pending|approved|rejected|edited|expired|cancelled
        tool_name VARCHAR NOT NULL,
        tool_call_id VARCHAR,
        request_args JSON,
        request_preview JSON,
        policy JSON,
        decision VARCHAR, -- approve|reject|edit
        edited_args JSON,
        decided_at TIMESTAMP,
        decided_by VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_tool_approvals_run ON agent_tool_approvals(run_id, created_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_tool_approvals_conversation ON agent_tool_approvals(conversation_id, created_at DESC)
    """,
    """
    -- Checkpointer storage for interrupt/resume (implementation will define exact semantics)
    CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id UUID PRIMARY KEY,
        run_id UUID NOT NULL,
        checkpoint_key VARCHAR NOT NULL,
        payload JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON agent_checkpoints(run_id, created_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS user_settings (
        key VARCHAR PRIMARY KEY,
        value JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON agent_conversations(project_id, updated_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON agent_messages(conversation_id, seq)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_messages_run ON agent_messages(run_id, seq)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_events_conversation ON agent_events(conversation_id, timestamp)
    """,
    """
    CREATE TABLE IF NOT EXISTS data_sources (
        id UUID PRIMARY KEY,
        project_id UUID,
        name VARCHAR NOT NULL,
        description VARCHAR,
        connector_type VARCHAR NOT NULL,
        source_config JSON NOT NULL,
        status VARCHAR DEFAULT 'active',
        error_message VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSON
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS data_source_tables (
        id UUID PRIMARY KEY,
        data_source_id UUID NOT NULL,
        source_table VARCHAR,
        source_query VARCHAR,
        target_table VARCHAR NOT NULL,
        rows_count INTEGER,
        status VARCHAR DEFAULT 'active',
        last_imported_at TIMESTAMP,
        error_message VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSON
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_sources_project ON data_sources(project_id, updated_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_tables_source ON data_source_tables(data_source_id, updated_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_tables_target ON data_source_tables(target_table)
    """,
    # Board tables
    """
    CREATE TABLE IF NOT EXISTS boards (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL,
        name VARCHAR NOT NULL,
        description VARCHAR,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        settings JSON
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_boards_project ON boards(project_id, position ASC, updated_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS board_items (
        id UUID PRIMARY KEY,
        board_id UUID NOT NULL,
        item_type VARCHAR NOT NULL,
        title VARCHAR,
        position_x INTEGER DEFAULT 0,
        position_y INTEGER DEFAULT 0,
        width INTEGER DEFAULT 1,
        height INTEGER DEFAULT 1,
        payload JSON NOT NULL,
        render_config JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_items_board ON board_items(board_id, position_y, position_x)
    """,
    """
    CREATE TABLE IF NOT EXISTS board_queries (
        id UUID PRIMARY KEY,
        board_item_id UUID NOT NULL,
        query_text VARCHAR NOT NULL,
        data_source_tables JSON,
        refresh_mode VARCHAR DEFAULT 'manual',
        refresh_interval_seconds INTEGER,
        last_executed_at TIMESTAMP,
        last_result_snapshot JSON,
        last_result_rows INTEGER,
        execution_status VARCHAR DEFAULT 'pending',
        error_message VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_queries_item ON board_queries(board_item_id)
    """,
    """
    CREATE TABLE IF NOT EXISTS board_item_assets (
        id UUID PRIMARY KEY,
        board_item_id UUID NOT NULL,
        asset_type VARCHAR NOT NULL,
        file_name VARCHAR NOT NULL,
        file_path VARCHAR NOT NULL,
        file_size INTEGER,
        mime_type VARCHAR,
        thumbnail_path VARCHAR,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_assets_item ON board_item_assets(board_item_id)
    """,
    # =========================================================================
    # SourceService - Live Database Connections (ATTACH) & Cache
    # =========================================================================
    """
    CREATE SCHEMA IF NOT EXISTS _sources
    """,
    """
    CREATE SCHEMA IF NOT EXISTS cache
    """,
    """
    -- Attached external databases (Postgres, SQLite, MySQL, DuckDB)
    CREATE TABLE IF NOT EXISTS _sources.attached (
        id VARCHAR PRIMARY KEY,
        name VARCHAR UNIQUE NOT NULL,
        source_type VARCHAR NOT NULL,  -- postgres, sqlite, mysql, duckdb
        connection_config JSON NOT NULL,
        attached_at TIMESTAMP NOT NULL,
        status VARCHAR NOT NULL,  -- active, detached, error
        error_message VARCHAR,
        metadata JSON
    )
    """,
    """
    -- Cached tables from external sources
    CREATE TABLE IF NOT EXISTS _sources.cached_tables (
        id VARCHAR PRIMARY KEY,
        source_name VARCHAR NOT NULL,
        source_table VARCHAR NOT NULL,
        local_table VARCHAR UNIQUE NOT NULL,
        cached_at TIMESTAMP NOT NULL,
        row_count BIGINT,
        expires_at TIMESTAMP,
        filter_sql VARCHAR,
        metadata JSON
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_sources_cached_source 
        ON _sources.cached_tables(source_name, source_table)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_sources_cached_expires 
        ON _sources.cached_tables(expires_at)
    """,
    # =========================================================================
    # duckpipe - Pipeline Engine (Saved Analyses / Asset Library)
    # =========================================================================
    """
    CREATE SCHEMA IF NOT EXISTS _duckpipe
    """,
    """
    CREATE SCHEMA IF NOT EXISTS analysis
    """,
    """
    -- Execution history for all Analysis runs
    CREATE TABLE IF NOT EXISTS _duckpipe.run_history (
        run_id VARCHAR PRIMARY KEY,
        analysis_id VARCHAR NOT NULL,
        started_at TIMESTAMP NOT NULL,
        finished_at TIMESTAMP,
        status VARCHAR NOT NULL,  -- running, success, failed
        rows_affected BIGINT,
        error VARCHAR,
        duration_ms INTEGER,
        params JSON
    )
    """,
    """
    -- Latest state for each Analysis (for freshness checks)
    CREATE TABLE IF NOT EXISTS _duckpipe.run_state (
        analysis_id VARCHAR PRIMARY KEY,
        last_run_id VARCHAR,
        last_run_at TIMESTAMP,
        last_run_status VARCHAR,
        last_run_error VARCHAR
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_duckpipe_run_history_analysis 
        ON _duckpipe.run_history(analysis_id, started_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_duckpipe_run_history_status 
        ON _duckpipe.run_history(status, started_at DESC)
    """,
]

DEFAULT_SETTINGS: Dict[str, Any] = {
    "data_sources": None,
    "dbt_project": None,
    "ui_preferences": {"theme": "dark"},
    "llm_provider": "openai",
    "llm_model": "gpt-5-mini",
    "local_models": [],
}


@dataclass
class ConversationSummary:
    id: str
    title: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime
    last_message_preview: Optional[str]
    run_id: Optional[str]
    project_id: Optional[str] = None


class ChatRepository:
    def __init__(self, warehouse_path: Path) -> None:
        self.warehouse_path = warehouse_path
        # Ensure parent directory exists
        self.warehouse_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_tables()
        self._default_project_id = self._ensure_default_project()
        self.ensure_default_settings(DEFAULT_SETTINGS)

    def _connect(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(self.warehouse_path))

    @contextmanager
    def _write_connection(self) -> duckdb.DuckDBPyConnection:
        """Serialize DuckDB writes within a process and provide a connection."""
        with _duckdb_write_lock:
            with self._connect() as con:
                yield con

    def _is_write_conflict(self, exc: Exception) -> bool:
        msg = str(exc)
        return "write-write conflict" in msg or "Failed to commit" in msg

    def _ensure_tables(self) -> None:
        with _table_init_lock:
            with self._connect() as con:
                for statement in DDL_STATEMENTS:
                    con.execute(statement)

    def _ensure_default_project(self) -> str:
        """Ensure a default project exists and return its ID."""
        with self._write_connection() as con:
            # Check if default project exists
            row = con.execute(
                "SELECT id FROM projects WHERE is_default = TRUE"
            ).fetchone()
            
            if row:
                return str(row[0])
            
            # Create default project
            from uuid import uuid4
            project_id = str(uuid4())
            now = datetime.now(UTC)
            con.execute(
                """
                INSERT INTO projects (id, name, description, is_default, created_at, updated_at, settings)
                VALUES (?, ?, ?, TRUE, ?, ?, ?)
                """,
                [
                    project_id,
                    "Default Workspace",
                    "Your primary workspace for data analysis",
                    now,
                    now,
                    json.dumps({}),
                ]
            )
            
            # Migrate existing conversations to default project (if any)
            con.execute(
                "UPDATE agent_conversations SET project_id = ? WHERE project_id IS NULL",
                [project_id]
            )
            
            return project_id

    def new_conversation_id(self) -> str:
        from uuid import uuid4

        return str(uuid4())

    def create_conversation(
        self,
        conversation_id: str,
        question: Optional[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        snippet = (question or "").strip()
        title = snippet[:80] if snippet else None
        preview = snippet[:160] if snippet else None
        now = datetime.now(UTC)
        
        # Extract project_id from metadata if provided, otherwise use default
        project_id = self._default_project_id
        if metadata and 'project_id' in metadata:
            project_id = metadata['project_id']
        
        with self._write_connection() as con:
            # Check if conversation already exists
            existing = con.execute(
                "SELECT id FROM agent_conversations WHERE id = ?",
                [conversation_id],
            ).fetchone()
            
            if existing:
                # Conversation already exists, skip to avoid duplicate messages
                return
            
            con.execute(
                """
                INSERT INTO agent_conversations (id, project_id, title, created_at, updated_at, status, last_message_preview, run_id, metadata)
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
                """,
                [
                    conversation_id,
                    project_id,
                    title,
                    now,
                    now,
                    preview,
                    conversation_id,
                    json.dumps(metadata or {}),
                ],
            )

    def append_message(
        self,
        conversation_id: str,
        role: str,
        content: Dict[str, Any],
        *,
        run_id: Optional[str] = None,
        connection: Optional[duckdb.DuckDBPyConnection] = None,
    ) -> None:
        owns_connection = connection is None
        con = connection or None
        lock = _duckdb_write_lock if owns_connection else None
        if owns_connection:
            lock.acquire()
            con = self._connect()
        try:
            seq = self._next_seq(conversation_id, connection=con)
            message_id = self._generate_uuid()
            con.execute(
                """
                INSERT INTO agent_messages (id, conversation_id, role, content, created_at, seq, run_id)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
                """,
                [message_id, conversation_id, role, json.dumps(content), seq, run_id],
            )
            self._touch_conversation(
                conversation_id,
                last_message_preview=self._preview_from_content(content),
                connection=con,
            )
        finally:
            if owns_connection:
                con.close()
                lock.release()

    def log_event(self, conversation_id: str, event: Dict[str, Any]) -> None:
        event_id = self._generate_uuid()
        payload = json.dumps(event.get("content")) if event.get("content") is not None else None
        metadata_json = json.dumps(event.get("metadata") or {})
        timestamp_value = event.get("timestamp")
        if isinstance(timestamp_value, str):
            try:
                timestamp_obj = datetime.fromisoformat(timestamp_value)
            except ValueError:
                timestamp_obj = datetime.now(UTC)
        else:
            timestamp_obj = datetime.now(UTC)
        # High-frequency writes during streaming can create write-write conflicts in DuckDB
        # if multiple connections attempt to touch the same conversation row concurrently.
        # We serialize writes in-process and retry briefly on conflict.
        for attempt in range(_WRITE_RETRY_ATTEMPTS):
            try:
                with self._write_connection() as con:
                    con.execute(
                        """
                        INSERT INTO agent_events (id, conversation_id, type, subtype, payload, metadata, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            event_id,
                            conversation_id,
                            event.get("type"),
                            event.get("subtype"),
                            payload,
                            metadata_json,
                            timestamp_obj,
                        ],
                    )
                    self._touch_conversation(conversation_id, connection=con)
                break
            except duckdb.TransactionException as exc:
                if not self._is_write_conflict(exc) or attempt >= _WRITE_RETRY_ATTEMPTS - 1:
                    raise
                time.sleep(_WRITE_RETRY_BASE_SLEEP_SECONDS * (2**attempt))

    # ---------------------------------------------------------------------
    # HITL tool approvals (Phase 1 persistence primitives)
    # ---------------------------------------------------------------------

    def create_tool_approval(
        self,
        *,
        approval_id: str,
        conversation_id: str,
        run_id: str,
        tool_name: str,
        tool_call_id: str,
        request_args: Dict[str, Any],
        request_preview: Dict[str, Any],
        policy: Dict[str, Any],
    ) -> None:
        with self._write_connection() as con:
            con.execute(
                """
                INSERT INTO agent_tool_approvals (
                    id, conversation_id, run_id, status, tool_name, tool_call_id,
                    request_args, request_preview, policy, created_at
                )
                VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    approval_id,
                    conversation_id,
                    run_id,
                    tool_name,
                    tool_call_id,
                    json.dumps(request_args),
                    json.dumps(request_preview),
                    json.dumps(policy),
                ],
            )

    def list_tool_approvals(self, *, run_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT id, status, tool_name, tool_call_id, request_preview, created_at, decided_at
                FROM agent_tool_approvals
                WHERE run_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                [run_id, int(limit)],
            ).fetchall()
        approvals: List[Dict[str, Any]] = []
        for row in rows:
            approval_id, status, tool_name, tool_call_id, preview_json, created_at, decided_at = row
            approvals.append(
                {
                    "id": str(approval_id),
                    "status": str(status),
                    "tool_name": str(tool_name),
                    "tool_call_id": str(tool_call_id) if tool_call_id is not None else None,
                    "request_preview": json.loads(preview_json) if preview_json else None,
                    "created_at": created_at.isoformat() if created_at else None,
                    "decided_at": decided_at.isoformat() if decided_at else None,
                }
            )
        return approvals

    def get_tool_approval(self, *, approval_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as con:
            row = con.execute(
                """
                SELECT
                    id, conversation_id, run_id, status, tool_name, tool_call_id,
                    request_args, request_preview, policy, decision, edited_args,
                    created_at, decided_at, decided_by
                FROM agent_tool_approvals
                WHERE id = ?
                """,
                [approval_id],
            ).fetchone()
        if not row:
            return None
        (
            id_value,
            conversation_id,
            run_id,
            status,
            tool_name,
            tool_call_id,
            request_args,
            request_preview,
            policy,
            decision,
            edited_args,
            created_at,
            decided_at,
            decided_by,
        ) = row
        return {
            "id": str(id_value),
            "conversation_id": str(conversation_id),
            "run_id": str(run_id),
            "status": str(status),
            "tool_name": str(tool_name),
            "tool_call_id": str(tool_call_id) if tool_call_id is not None else None,
            "request_args": json.loads(request_args) if request_args else None,
            "request_preview": json.loads(request_preview) if request_preview else None,
            "policy": json.loads(policy) if policy else None,
            "decision": str(decision) if decision is not None else None,
            "edited_args": json.loads(edited_args) if edited_args else None,
            "created_at": created_at.isoformat() if created_at else None,
            "decided_at": decided_at.isoformat() if decided_at else None,
            "decided_by": str(decided_by) if decided_by is not None else None,
        }

    def decide_tool_approval(
        self,
        *,
        approval_id: str,
        decision: str,
        edited_args: Optional[Dict[str, Any]] = None,
        decided_by: str = "user",
    ) -> None:
        status_map = {"approve": "approved", "reject": "rejected", "edit": "edited"}
        status = status_map.get(decision, "approved")
        with self._write_connection() as con:
            con.execute(
                """
                UPDATE agent_tool_approvals
                SET status = ?, decision = ?, edited_args = ?, decided_at = CURRENT_TIMESTAMP, decided_by = ?
                WHERE id = ?
                """,
                [
                    status,
                    decision,
                    json.dumps(edited_args) if edited_args is not None else None,
                    decided_by,
                    approval_id,
                ],
            )

    def mark_run_completed(
        self,
        conversation_id: str,
        status: str,
        final_preview: Optional[str],
    ) -> None:
        with self._write_connection() as con:
            self._touch_conversation(
                conversation_id,
                status=status,
                last_message_preview=final_preview,
                connection=con,
            )

    def mark_run_started(
        self,
        conversation_id: str,
        *,
        last_message_preview: Optional[str] = None,
    ) -> None:
        with self._write_connection() as con:
            self._touch_conversation(
                conversation_id,
                status="active",
                last_message_preview=last_message_preview,
                connection=con,
            )

    def set_active_run(self, conversation_id: str, run_id: str) -> None:
        with self._write_connection() as con:
            con.execute(
                "UPDATE agent_conversations SET run_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [run_id, conversation_id],
            )

    def delete_conversation(self, conversation_id: str) -> bool:
        with self._write_connection() as con:
            exists = con.execute(
                "SELECT 1 FROM agent_conversations WHERE id = ?",
                [conversation_id],
            ).fetchone()
            if not exists:
                return False

            con.execute(
                "DELETE FROM agent_messages WHERE conversation_id = ?",
                [conversation_id],
            )
            con.execute(
                "DELETE FROM agent_events WHERE conversation_id = ?",
                [conversation_id],
            )
            con.execute(
                "DELETE FROM agent_conversations WHERE id = ?",
                [conversation_id],
            )

        return True

    def _next_seq(
        self,
        conversation_id: str,
        *,
        connection: Optional[duckdb.DuckDBPyConnection] = None,
    ) -> int:
        owns_connection = connection is None
        con = connection or self._connect()
        try:
            seq_row = con.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_messages WHERE conversation_id = ?",
                [conversation_id],
            ).fetchone()
            return seq_row[0] if seq_row else 1
        finally:
            if owns_connection:
                con.close()

    def _touch_conversation(
        self,
        conversation_id: str,
        *,
        status: Optional[str] = None,
        last_message_preview: Optional[str] = None,
        connection: Optional[duckdb.DuckDBPyConnection] = None,
    ) -> None:
        owns_connection = connection is None
        con = connection or self._connect()
        try:
            if status is not None and last_message_preview is not None:
                con.execute(
                    "UPDATE agent_conversations SET status = ?, last_message_preview = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [status, last_message_preview, conversation_id],
                )
            elif status is not None:
                con.execute(
                    "UPDATE agent_conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [status, conversation_id],
                )
            elif last_message_preview is not None:
                con.execute(
                    "UPDATE agent_conversations SET last_message_preview = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [last_message_preview, conversation_id],
                )
            else:
                try:
                    con.execute(
                        "UPDATE agent_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        [conversation_id],
                    )
                except duckdb.TransactionException as exc:
                    # This touch is non-critical and can conflict during high-frequency event logging.
                    if self._is_write_conflict(exc):
                        return
                    raise
        finally:
            if owns_connection:
                con.close()

    def list_conversations(self, limit: int = 50, offset: int = 0, project_id: Optional[str] = None) -> List[ConversationSummary]:
        with self._connect() as con:
            query = """
                SELECT id, title, status, created_at, updated_at, last_message_preview, run_id, project_id
                FROM agent_conversations
            """
            params = []
            
            # Add project_id filter if provided
            if project_id:
                query += " WHERE project_id = ?"
                params.append(project_id)
            
            query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            
            rows = con.execute(query, params).fetchall()
        return [
            ConversationSummary(
                id=row[0],
                title=row[1],
                status=row[2],
                created_at=self._ensure_utc(row[3]),
                updated_at=self._ensure_utc(row[4]),
                last_message_preview=self._normalize_preview_for_response(row[5]),
                run_id=row[6],
                project_id=str(row[7]) if row[7] else None,
            )
            for row in rows
        ]

    def get_conversation_summary(self, conversation_id: str) -> Optional[ConversationSummary]:
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, title, status, created_at, updated_at, last_message_preview, run_id, project_id
                FROM agent_conversations
                WHERE id = ?
                """,
                [conversation_id],
            ).fetchone()
        if not row:
            return None
        return ConversationSummary(
            id=row[0],
            title=row[1],
            status=row[2],
            created_at=self._ensure_utc(row[3]),
            updated_at=self._ensure_utc(row[4]),
            last_message_preview=self._normalize_preview_for_response(row[5]),
            run_id=row[6],
            project_id=str(row[7]) if row[7] else None,
        )

    def get_conversation_messages(self, conversation_id: str) -> List[Dict[str, Any]]:
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT id, role, content, created_at, seq, run_id
                FROM agent_messages
                WHERE conversation_id = ?
                ORDER BY seq ASC
                """,
                [conversation_id],
            ).fetchall()
        messages: List[Dict[str, Any]] = []
        for row in rows:
            content = json.loads(row[2]) if row[2] else None
            messages.append(
                {
                    "id": row[0],
                    "role": row[1],
                    "content": content,
                    "created_at": self._ensure_utc(row[3]).isoformat(),
                    "seq": row[4],
                    "run_id": row[5],
                }
            )
        return messages

    def get_conversation_events(self, conversation_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT type, subtype, payload, metadata, timestamp
                FROM agent_events
                WHERE conversation_id = ?
                ORDER BY timestamp ASC
                LIMIT ?
                """,
                [conversation_id, limit],
            ).fetchall()
        events: List[Dict[str, Any]] = []
        for row in rows:
            payload = json.loads(row[2]) if row[2] else None
            metadata = json.loads(row[3]) if row[3] else None
            events.append(
                {
                    "type": row[0],
                    "subtype": row[1],
                    "content": payload,
                    "metadata": metadata,
                    "timestamp": self._ensure_utc(row[4]).isoformat() if row[4] else None,
                }
            )
        return events

    def get_settings(self) -> Dict[str, Any]:
        """Get global user settings."""
        with self._connect() as con:
            rows = con.execute("SELECT key, value FROM user_settings").fetchall()
        result: Dict[str, Any] = {}
        for row in rows:
            result[row[0]] = json.loads(row[1]) if row[1] else None
        for key, value in DEFAULT_SETTINGS.items():
            result.setdefault(key, value)
        return result

    def update_settings(self, payload: Dict[str, Any]) -> None:
        """Update global user settings."""
        now = datetime.now(UTC)
        with self._connect() as con:
            for key, value in payload.items():
                con.execute(
                    "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)",
                    [key, json.dumps(value) if value is not None else None, now],
                )

    def ensure_default_settings(self, defaults: Optional[Dict[str, Any]] = None) -> None:
        if not defaults:
            defaults = {}
        to_seed = {}
        existing = self.get_settings()
        for key, value in defaults.items():
            if existing.get(key) is None:
                to_seed[key] = value
        if to_seed:
            self.update_settings(to_seed)

    def _generate_uuid(self) -> str:
        from uuid import uuid4

        return str(uuid4())

    def _preview_from_content(self, content: Dict[str, Any]) -> Optional[str]:
        if isinstance(content, dict):
            if "text" in content and isinstance(content["text"], str):
                return content["text"][:160]
            if "summary" in content and isinstance(content["summary"], str):
                return content["summary"][:160]
        return None

    def _normalize_preview_for_response(self, preview: Optional[str]) -> Optional[str]:
        if preview is None:
            return None
        stripped = preview.strip()
        if not stripped:
            return None
        try:
            parsed = json.loads(stripped)
        except (json.JSONDecodeError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            text = self._extract_text_from_object(parsed)
            if text:
                return text[:160]
        pattern_order = [
            r'"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"',
            r'"content"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"',
            r'"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"',
        ]
        for pattern in pattern_order:
            match = re.search(pattern, stripped)
            if match:
                extracted = bytes(match.group(1), "utf-8").decode("unicode_escape")
                cleaned = extracted.strip()
                if cleaned:
                    return cleaned[:160]
        return stripped[:160]

    def _extract_text_from_object(self, value: Any) -> Optional[str]:
        if isinstance(value, dict):
            for key in ["final_answer", "answer", "text", "summary"]:
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return candidate.strip()
            content = value.get("content")
            if isinstance(content, dict) or isinstance(content, list):
                nested = self._extract_text_from_object(content)
                if nested:
                    return nested
            messages = value.get("messages")
            if isinstance(messages, list):
                for message in messages:
                    if isinstance(message, dict) and message.get("role") == "assistant":
                        nested = self._extract_text_from_object(message)
                        if nested:
                            return nested
                for message in messages:
                    nested = self._extract_text_from_object(message)
                    if nested:
                        return nested
        if isinstance(value, list):
            for item in value:
                nested = self._extract_text_from_object(item)
                if nested:
                    return nested
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def _ensure_utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


@lru_cache(maxsize=1)
def get_chat_repository() -> ChatRepository:
    settings = get_settings()
    return ChatRepository(settings.duckdb.path)
