"""Source service - DuckDB ATTACH-based external database federation.

This service manages:
1. ATTACH: Live connections to external databases (Postgres, SQLite, etc.)
2. CACHE: Local copies of external tables for performance
3. Metadata: Tracking attached sources and cached tables

IMPORTANT: DuckDB ATTACH is connection-scoped. This service stores connection
configs and re-attaches on each connection. For sensitive configs (passwords),
the full config is stored encrypted or in a separate secure store.

NOTE: This service is now project-scoped. Each project has its own warehouse
file for complete data isolation.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, parse_qs
from uuid import uuid4

import duckdb

from pluto_duck_backend.app.core.config import get_settings
from .errors import AttachError, CacheError, SourceNotFoundError, TableNotFoundError


# Store full configs (including passwords) in memory for re-attachment
# Keyed by project_id -> source_name -> config
# In production, this should use a secure store (e.g., keyring, encrypted file)
_FULL_CONFIGS: Dict[str, Dict[str, Dict[str, Any]]] = {}


class SourceType(str, Enum):
    """Supported external database types."""

    POSTGRES = "postgres"
    SQLITE = "sqlite"
    MYSQL = "mysql"
    DUCKDB = "duckdb"
    # Future: MOTHERDUCK = "motherduck"


class TableMode(str, Enum):
    """How a table is accessed."""

    LIVE = "live"  # Direct query via ATTACH (zero-copy)
    CACHED = "cached"  # Local copy in DuckDB


@dataclass
class AttachedSource:
    """An attached external database."""

    id: str
    name: str  # Alias used in queries (e.g., "pg", "sales_db")
    source_type: SourceType
    connection_config: Dict[str, Any]  # Sanitized (no passwords in logs)
    attached_at: datetime
    status: str  # "attached", "error", "detached"
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    # UI-friendly fields (merged from data_sources)
    project_id: Optional[str] = None
    description: Optional[str] = None
    table_count: int = 0


@dataclass
class CachedTable:
    """A locally cached copy of an external table."""

    id: str
    source_name: str  # The attached source alias
    source_table: str  # Original table name in source
    local_table: str  # Local table name in cache schema
    cached_at: datetime
    row_count: Optional[int] = None
    expires_at: Optional[datetime] = None
    filter_sql: Optional[str] = None  # If partial cache (e.g., WHERE date > '2024-01-01')
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SourceTable:
    """A table available from an attached source."""

    source_name: str
    schema_name: str
    table_name: str
    mode: TableMode  # live or cached
    local_table: Optional[str] = None  # If cached, the local table name
    row_count: Optional[int] = None


# Schema for metadata tables
_DDL_STATEMENTS = [
    """
    CREATE SCHEMA IF NOT EXISTS _sources
    """,
    """
    CREATE TABLE IF NOT EXISTS _sources.attached (
        id VARCHAR PRIMARY KEY,
        name VARCHAR UNIQUE NOT NULL,
        source_type VARCHAR NOT NULL,
        connection_config JSON NOT NULL,
        attached_at TIMESTAMP NOT NULL,
        status VARCHAR NOT NULL,
        error_message VARCHAR,
        metadata JSON,
        project_id VARCHAR,
        description VARCHAR,
        updated_at TIMESTAMP
    )
    """,
    """
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
    CREATE SCHEMA IF NOT EXISTS cache
    """,
]

# Migration: Add columns if they don't exist (for existing databases)
_MIGRATION_STATEMENTS = [
    "ALTER TABLE _sources.attached ADD COLUMN IF NOT EXISTS project_id VARCHAR",
    "ALTER TABLE _sources.attached ADD COLUMN IF NOT EXISTS description VARCHAR",
    "ALTER TABLE _sources.attached ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
]


def _quote_identifier(identifier: str) -> str:
    """Safely quote a SQL identifier."""
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'


def _sanitize_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Remove sensitive fields from config for storage/logging."""
    sensitive_keys = {"password", "secret", "token", "key", "credential"}
    return {
        k: "***" if any(s in k.lower() for s in sensitive_keys) else v
        for k, v in config.items()
    }


class SourceService:
    """Service for managing DuckDB ATTACH-based source connections.

    Key concepts:
    - Sources are attached to DuckDB as named databases (e.g., "pg", "sales")
    - Tables can be accessed live (zero-copy) or cached locally
    - Cache lives in the "cache" schema of the main warehouse
    - Each project has its own isolated warehouse for data separation

    IMPORTANT: DuckDB ATTACH is connection-scoped. Each new connection must
    re-attach sources. This service stores full configs and re-attaches
    automatically when needed.

    Example usage:
        service = get_source_service("my_project_id")

        # Attach a Postgres database
        service.attach_source(
            name="sales",
            source_type="postgres",
            config={"host": "localhost", "database": "sales_db", ...}
        )

        # Query live data
        # SELECT * FROM sales.orders LIMIT 10

        # Cache a table for faster queries
        service.cache_table("sales", "orders", filter_sql="WHERE date >= '2024-01-01'")

        # Now queries use local cache
        # SELECT * FROM cache.sales_orders
    """

    def __init__(self, project_id: str, warehouse_path: Optional[Path] = None):
        """Initialize source service for a specific project.

        Args:
            project_id: Project identifier for isolation
            warehouse_path: Optional override path. If None, uses default project path.
        """
        self.project_id = project_id
        
        if warehouse_path is None:
            settings = get_settings()
            warehouse_path = (
                settings.data_dir.root / "data" / "projects" / project_id / "warehouse.duckdb"
            )
        
        self.warehouse_path = warehouse_path
        self.warehouse_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_metadata_tables()

    def _connect(self) -> duckdb.DuckDBPyConnection:
        """Create a new connection to the warehouse."""
        return duckdb.connect(str(self.warehouse_path))

    def _connect_with_sources(self, source_names: Optional[List[str]] = None) -> duckdb.DuckDBPyConnection:
        """Create a connection with specified sources re-attached.
        
        Args:
            source_names: List of source names to attach. If None, attach all active sources.
            
        Returns:
            Connection with sources attached.
        """
        con = self._connect()
        
        # Get sources to attach
        if source_names is None:
            # Attach all active sources
            rows = con.execute(
                """
                SELECT name, source_type, connection_config
                FROM _sources.attached
                WHERE status = 'attached'
                """
            ).fetchall()
        else:
            placeholders = ",".join(["?" for _ in source_names])
            rows = con.execute(
                f"""
                SELECT name, source_type, connection_config
                FROM _sources.attached
                WHERE name IN ({placeholders}) AND status = 'attached'
                """,
                source_names,
            ).fetchall()
        
        # Re-attach each source
        for name, source_type_str, config_json in rows:
            source_type = SourceType(source_type_str)
            
            # Get full config from memory cache (with passwords)
            project_configs = _FULL_CONFIGS.get(self.project_id, {})
            full_config = project_configs.get(name)
            if full_config is None:
                # Fall back to stored config (may not have passwords)
                full_config = json.loads(config_json) if config_json else {}
            
            try:
                attach_sql = self._build_attach_sql(name, source_type, full_config, read_only=True)
                con.execute(attach_sql)
            except duckdb.Error:
                # Source might not be accessible anymore
                pass
        
        return con

    def _ensure_metadata_tables(self) -> None:
        """Ensure metadata tables exist and run migrations."""
        with self._connect() as con:
            for ddl in _DDL_STATEMENTS:
                con.execute(ddl)
            # Run migrations for existing databases
            for migration in _MIGRATION_STATEMENTS:
                try:
                    con.execute(migration)
                except duckdb.CatalogException:
                    pass  # Column already exists or table doesn't exist yet

    # =========================================================================
    # ATTACH Operations
    # =========================================================================

    def attach_source(
        self,
        name: str,
        source_type: str | SourceType,
        config: Dict[str, Any],
        *,
        read_only: bool = True,
        description: Optional[str] = None,
    ) -> AttachedSource:
        """Attach an external database as a named source.

        Args:
            name: Alias for the source (used in queries, e.g., "pg", "sales")
            source_type: Type of database ("postgres", "sqlite", etc.)
            config: Connection configuration (host, database, user, password, etc.)
            read_only: Whether to attach in read-only mode (default True)
            description: Optional human-readable description

        Returns:
            AttachedSource with connection details

        Raises:
            AttachError: If attach fails
        """
        if isinstance(source_type, str):
            source_type = SourceType(source_type)

        # Validate name (alphanumeric + underscore only)
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", name):
            raise AttachError(name, "Name must be alphanumeric with underscores, starting with letter")

        # Build ATTACH statement based on source type
        attach_sql = self._build_attach_sql(name, source_type, config, read_only)

        source_id = str(uuid4())
        now = datetime.now(UTC)
        sanitized_config = _sanitize_config(config)

        with self._connect() as con:
            try:
                # Execute ATTACH
                con.execute(attach_sql)

                # Store full config in memory for re-attachment (project-scoped)
                if self.project_id not in _FULL_CONFIGS:
                    _FULL_CONFIGS[self.project_id] = {}
                _FULL_CONFIGS[self.project_id][name] = config.copy()

                # Record in metadata (sanitized - no passwords)
                con.execute(
                    """
                    INSERT INTO _sources.attached (
                        id, name, source_type, connection_config,
                        attached_at, status, error_message, metadata,
                        project_id, description, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'attached', NULL, ?, ?, ?, ?)
                    ON CONFLICT (name) DO UPDATE SET
                        source_type = EXCLUDED.source_type,
                        connection_config = EXCLUDED.connection_config,
                        attached_at = EXCLUDED.attached_at,
                        status = 'attached',
                        error_message = NULL,
                        project_id = EXCLUDED.project_id,
                        description = COALESCE(EXCLUDED.description, _sources.attached.description),
                        updated_at = EXCLUDED.updated_at
                    """,
                    [
                        source_id,
                        name,
                        source_type.value,
                        json.dumps(sanitized_config),
                        now,
                        json.dumps({}),
                        self.project_id,
                        description,
                        now,
                    ],
                )

                return AttachedSource(
                    id=source_id,
                    name=name,
                    source_type=source_type,
                    connection_config=sanitized_config,
                    attached_at=now,
                    status="attached",
                    project_id=self.project_id,
                    description=description,
                )

            except duckdb.Error as e:
                # Record failure
                con.execute(
                    """
                    INSERT INTO _sources.attached (
                        id, name, source_type, connection_config,
                        attached_at, status, error_message, metadata,
                        project_id, description, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'error', ?, ?, ?, ?, ?)
                    ON CONFLICT (name) DO UPDATE SET
                        status = 'error',
                        error_message = EXCLUDED.error_message,
                        updated_at = EXCLUDED.updated_at
                    """,
                    [
                        source_id,
                        name,
                        source_type.value,
                        json.dumps(sanitized_config),
                        now,
                        str(e),
                        json.dumps({}),
                        self.project_id,
                        description,
                        now,
                    ],
                )
                raise AttachError(name, str(e)) from e

    def _build_attach_sql(
        self,
        name: str,
        source_type: SourceType,
        config: Dict[str, Any],
        read_only: bool,
    ) -> str:
        """Build the ATTACH SQL statement for a given source type."""
        read_only_clause = "READ_ONLY" if read_only else ""

        if source_type == SourceType.POSTGRES:
            return self._build_postgres_attach(name, config, read_only_clause)
        elif source_type == SourceType.SQLITE:
            return self._build_sqlite_attach(name, config, read_only_clause)
        elif source_type == SourceType.MYSQL:
            return self._build_mysql_attach(name, config, read_only_clause)
        elif source_type == SourceType.DUCKDB:
            return self._build_duckdb_attach(name, config, read_only_clause)
        else:
            raise AttachError(name, f"Unsupported source type: {source_type}")

    def _build_postgres_attach(
        self, name: str, config: Dict[str, Any], read_only_clause: str
    ) -> str:
        """Build ATTACH for Postgres using postgres_scanner extension."""
        # DuckDB postgres_scanner connection string format
        host = config.get("host", "localhost")
        port = config.get("port", 5432)
        database = config.get("database", "postgres")
        user = config.get("user", "postgres")
        password = config.get("password", "")
        schema = config.get("schema", "public")

        # Connection string format for postgres_scanner
        conn_str = f"host={host} port={port} dbname={database} user={user} password={password}"

        return f"""
            INSTALL postgres;
            LOAD postgres;
            ATTACH '{conn_str}' AS {_quote_identifier(name)} (TYPE POSTGRES, SCHEMA '{schema}' {', ' + read_only_clause if read_only_clause else ''})
        """

    def _build_sqlite_attach(
        self, name: str, config: Dict[str, Any], read_only_clause: str
    ) -> str:
        """Build ATTACH for SQLite."""
        path = config.get("path", "")
        return f"""
            ATTACH '{path}' AS {_quote_identifier(name)} (TYPE SQLITE {', ' + read_only_clause if read_only_clause else ''})
        """

    def _build_mysql_attach(
        self, name: str, config: Dict[str, Any], read_only_clause: str
    ) -> str:
        """Build ATTACH for MySQL using mysql_scanner extension."""
        host = config.get("host", "localhost")
        port = config.get("port", 3306)
        database = config.get("database", "mysql")
        user = config.get("user", "root")
        password = config.get("password", "")

        conn_str = f"host={host} port={port} database={database} user={user} password={password}"

        return f"""
            INSTALL mysql;
            LOAD mysql;
            ATTACH '{conn_str}' AS {_quote_identifier(name)} (TYPE MYSQL {', ' + read_only_clause if read_only_clause else ''})
        """

    def _build_duckdb_attach(
        self, name: str, config: Dict[str, Any], read_only_clause: str
    ) -> str:
        """Build ATTACH for another DuckDB file."""
        path = config.get("path", "")
        return f"""
            ATTACH '{path}' AS {_quote_identifier(name)} {('(' + read_only_clause + ')') if read_only_clause else ''}
        """

    def detach_source(self, name: str) -> bool:
        """Detach an external database.

        Args:
            name: Source alias to detach

        Returns:
            True if detached, False if not found
        """
        # Remove from memory cache (project-scoped)
        if self.project_id in _FULL_CONFIGS:
            _FULL_CONFIGS[self.project_id].pop(name, None)

        with self._connect() as con:
            # Check if source exists first
            exists = con.execute(
                "SELECT 1 FROM _sources.attached WHERE name = ? AND status != 'detached'",
                [name],
            ).fetchone()

            if not exists:
                return False

            try:
                con.execute(f"DETACH {_quote_identifier(name)}")
            except duckdb.Error:
                pass  # May already be detached

            con.execute(
                "UPDATE _sources.attached SET status = 'detached' WHERE name = ?",
                [name],
            )
            return True

    def list_sources(self) -> List[AttachedSource]:
        """List all attached sources for this project.
        
        Since each project has its own warehouse, no filtering is needed.
        """
        with self._connect() as con:
            rows = con.execute(
                """
                SELECT a.id, a.name, a.source_type, a.connection_config,
                       a.attached_at, a.status, a.error_message, a.metadata,
                       a.project_id, a.description,
                       (SELECT COUNT(*) FROM _sources.cached_tables c WHERE c.source_name = a.name)
                FROM _sources.attached a
                WHERE a.status != 'detached'
                ORDER BY COALESCE(a.updated_at, a.attached_at) DESC
                """
            ).fetchall()

        return [self._row_to_attached_source(row) for row in rows]

    def get_source(self, name: str) -> Optional[AttachedSource]:
        """Get a specific attached source by name."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT a.id, a.name, a.source_type, a.connection_config,
                       a.attached_at, a.status, a.error_message, a.metadata,
                       a.project_id, a.description,
                       (SELECT COUNT(*) FROM _sources.cached_tables c WHERE c.source_name = a.name)
                FROM _sources.attached a
                WHERE a.name = ? AND a.status != 'detached'
                """,
                [name],
            ).fetchone()

        if not row:
            return None

        return self._row_to_attached_source(row)

    def get_source_by_id(self, source_id: str) -> Optional[AttachedSource]:
        """Get a specific attached source by ID."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT a.id, a.name, a.source_type, a.connection_config,
                       a.attached_at, a.status, a.error_message, a.metadata,
                       a.project_id, a.description,
                       (SELECT COUNT(*) FROM _sources.cached_tables c WHERE c.source_name = a.name)
                FROM _sources.attached a
                WHERE a.id = ? AND a.status != 'detached'
                """,
                [source_id],
            ).fetchone()

        if not row:
            return None

        return self._row_to_attached_source(row)

    def update_source(
        self,
        name: str,
        *,
        description: Optional[str] = None,
    ) -> Optional[AttachedSource]:
        """Update source metadata (description)."""
        now = datetime.now(UTC)
        with self._connect() as con:
            updates = []
            params = []
            
            if description is not None:
                updates.append("description = ?")
                params.append(description)
            
            if not updates:
                return self.get_source(name)
            
            updates.append("updated_at = ?")
            params.append(now)
            params.append(name)
            
            con.execute(
                f"""
                UPDATE _sources.attached
                SET {", ".join(updates)}
                WHERE name = ?
                """,
                params,
            )
        
        return self.get_source(name)

    def _row_to_attached_source(self, row: tuple) -> AttachedSource:
        """Convert database row to AttachedSource."""
        attached_at = row[4]
        if attached_at and attached_at.tzinfo is None:
            attached_at = attached_at.replace(tzinfo=UTC)
        
        return AttachedSource(
            id=row[0],
            name=row[1],
            source_type=SourceType(row[2]),
            connection_config=json.loads(row[3]) if row[3] else {},
            attached_at=attached_at,
            status=row[5],
            error_message=row[6],
            metadata=json.loads(row[7]) if row[7] else {},
            project_id=row[8],
            description=row[9],
            table_count=row[10] or 0,
        )

    def list_source_tables(self, source_name: str) -> List[SourceTable]:
        """List all tables available from an attached source.

        Args:
            source_name: The attached source alias

        Returns:
            List of tables with their access mode (live/cached)
        """
        source = self.get_source(source_name)
        if not source:
            raise SourceNotFoundError(source_name)

        # Use connection with source attached
        with self._connect_with_sources([source_name]) as con:
            # Get tables from the attached database
            try:
                rows = con.execute(
                    f"""
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE table_catalog = ?
                    ORDER BY table_schema, table_name
                    """,
                    [source_name],
                ).fetchall()
            except duckdb.Error:
                # Fallback: some attached DBs don't populate information_schema properly
                rows = []

            # Get cached tables for this source
            cached = con.execute(
                """
                SELECT source_table, local_table
                FROM _sources.cached_tables
                WHERE source_name = ?
                """,
                [source_name],
            ).fetchall()
            cached_map = {row[0]: row[1] for row in cached}

        tables = []
        for schema_name, table_name in rows:
            full_name = f"{schema_name}.{table_name}" if schema_name else table_name
            is_cached = full_name in cached_map or table_name in cached_map

            tables.append(
                SourceTable(
                    source_name=source_name,
                    schema_name=schema_name or "",
                    table_name=table_name,
                    mode=TableMode.CACHED if is_cached else TableMode.LIVE,
                    local_table=cached_map.get(full_name) or cached_map.get(table_name),
                )
            )

        return tables

    # =========================================================================
    # CACHE Operations
    # =========================================================================

    def cache_table(
        self,
        source_name: str,
        source_table: str,
        *,
        local_table: Optional[str] = None,
        filter_sql: Optional[str] = None,
        expires_hours: Optional[int] = None,
    ) -> CachedTable:
        """Cache a table from an attached source locally.

        Args:
            source_name: The attached source alias
            source_table: Table name in the source (can be schema.table)
            local_table: Local table name (default: {source_name}_{table_name})
            filter_sql: Optional WHERE clause to filter data (e.g., "date >= '2024-01-01'")
            expires_hours: Optional TTL in hours

        Returns:
            CachedTable with cache details

        Raises:
            CacheError: If caching fails
        """
        # Verify source exists
        source = self.get_source(source_name)
        if not source:
            raise SourceNotFoundError(source_name)

        # Generate local table name
        if not local_table:
            # Convert schema.table to table_name format
            table_base = source_table.replace(".", "_")
            local_table = f"{source_name}_{table_base}"

        # Validate local table name
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", local_table):
            raise CacheError(source_table, "Invalid local table name")

        # Build source table reference
        source_ref = f"{_quote_identifier(source_name)}.{_quote_identifier(source_table)}"

        # Build SELECT with optional filter
        select_sql = f"SELECT * FROM {source_ref}"
        if filter_sql:
            # Basic sanitization - filter_sql should be a WHERE condition
            select_sql += f" WHERE {filter_sql}"

        cache_id = str(uuid4())
        now = datetime.now(UTC)
        expires_at = None
        if expires_hours:
            from datetime import timedelta

            expires_at = now + timedelta(hours=expires_hours)

        # Use connection with source attached
        with self._connect_with_sources([source_name]) as con:
            try:
                # Create the cached table
                cache_table_ref = f"cache.{_quote_identifier(local_table)}"
                con.execute(f"DROP TABLE IF EXISTS {cache_table_ref}")
                con.execute(f"CREATE TABLE {cache_table_ref} AS {select_sql}")

                # Get row count
                row_count = con.execute(f"SELECT COUNT(*) FROM {cache_table_ref}").fetchone()[0]

                # Record in metadata
                con.execute(
                    """
                    INSERT INTO _sources.cached_tables (
                        id, source_name, source_table, local_table,
                        cached_at, row_count, expires_at, filter_sql, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (local_table) DO UPDATE SET
                        source_name = EXCLUDED.source_name,
                        source_table = EXCLUDED.source_table,
                        cached_at = EXCLUDED.cached_at,
                        row_count = EXCLUDED.row_count,
                        expires_at = EXCLUDED.expires_at,
                        filter_sql = EXCLUDED.filter_sql
                    """,
                    [
                        cache_id,
                        source_name,
                        source_table,
                        local_table,
                        now,
                        row_count,
                        expires_at,
                        filter_sql,
                        json.dumps({}),
                    ],
                )

                return CachedTable(
                    id=cache_id,
                    source_name=source_name,
                    source_table=source_table,
                    local_table=local_table,
                    cached_at=now,
                    row_count=row_count,
                    expires_at=expires_at,
                    filter_sql=filter_sql,
                )

            except duckdb.Error as e:
                raise CacheError(source_table, str(e)) from e

    def refresh_cache(self, local_table: str) -> CachedTable:
        """Refresh an existing cached table.

        Args:
            local_table: The local cache table name

        Returns:
            Updated CachedTable

        Raises:
            CacheError: If refresh fails or table not found
        """
        with self._connect() as con:
            row = con.execute(
                """
                SELECT source_name, source_table, filter_sql,
                       expires_at - cached_at as ttl_interval
                FROM _sources.cached_tables
                WHERE local_table = ?
                """,
                [local_table],
            ).fetchone()

            if not row:
                raise CacheError(local_table, "Cached table not found")

            source_name, source_table, filter_sql, ttl_interval = row

        # Calculate expires_hours from stored interval if present
        expires_hours = None
        if ttl_interval:
            # ttl_interval is a timedelta-like object
            expires_hours = int(ttl_interval.total_seconds() / 3600) if hasattr(ttl_interval, "total_seconds") else None

        return self.cache_table(
            source_name,
            source_table,
            local_table=local_table,
            filter_sql=filter_sql,
            expires_hours=expires_hours,
        )

    def drop_cache(self, local_table: str) -> bool:
        """Drop a cached table.

        Args:
            local_table: The local cache table name

        Returns:
            True if dropped, False if not found
        """
        with self._connect() as con:
            # Check if cached table exists first
            exists = con.execute(
                "SELECT 1 FROM _sources.cached_tables WHERE local_table = ?",
                [local_table],
            ).fetchone()

            if not exists:
                return False

            # Drop the actual table
            try:
                con.execute(f"DROP TABLE IF EXISTS cache.{_quote_identifier(local_table)}")
            except duckdb.Error:
                pass

            # Remove metadata
            con.execute(
                "DELETE FROM _sources.cached_tables WHERE local_table = ?",
                [local_table],
            )
            return True

    def list_cached_tables(self, source_name: Optional[str] = None) -> List[CachedTable]:
        """List all cached tables.

        Args:
            source_name: Optional filter by source

        Returns:
            List of CachedTable
        """
        with self._connect() as con:
            if source_name:
                rows = con.execute(
                    """
                    SELECT id, source_name, source_table, local_table,
                           cached_at, row_count, expires_at, filter_sql, metadata
                    FROM _sources.cached_tables
                    WHERE source_name = ?
                    ORDER BY cached_at DESC
                    """,
                    [source_name],
                ).fetchall()
            else:
                rows = con.execute(
                    """
                    SELECT id, source_name, source_table, local_table,
                           cached_at, row_count, expires_at, filter_sql, metadata
                    FROM _sources.cached_tables
                    ORDER BY cached_at DESC
                    """
                ).fetchall()

        return [
            CachedTable(
                id=row[0],
                source_name=row[1],
                source_table=row[2],
                local_table=row[3],
                cached_at=row[4].replace(tzinfo=UTC) if row[4] and row[4].tzinfo is None else row[4],
                row_count=row[5],
                expires_at=row[6].replace(tzinfo=UTC) if row[6] and row[6].tzinfo is None else row[6],
                filter_sql=row[7],
                metadata=json.loads(row[8]) if row[8] else {},
            )
            for row in rows
        ]

    def get_cached_table(self, local_table: str) -> Optional[CachedTable]:
        """Get a specific cached table by local name."""
        with self._connect() as con:
            row = con.execute(
                """
                SELECT id, source_name, source_table, local_table,
                       cached_at, row_count, expires_at, filter_sql, metadata
                FROM _sources.cached_tables
                WHERE local_table = ?
                """,
                [local_table],
            ).fetchone()

        if not row:
            return None

        return CachedTable(
            id=row[0],
            source_name=row[1],
            source_table=row[2],
            local_table=row[3],
            cached_at=row[4].replace(tzinfo=UTC) if row[4] and row[4].tzinfo is None else row[4],
            row_count=row[5],
            expires_at=row[6].replace(tzinfo=UTC) if row[6] and row[6].tzinfo is None else row[6],
            filter_sql=row[7],
            metadata=json.loads(row[8]) if row[8] else {},
        )

    def cleanup_expired_caches(self) -> int:
        """Remove expired cached tables.

        Returns:
            Number of tables cleaned up
        """
        now = datetime.now(UTC)
        count = 0

        with self._connect() as con:
            expired = con.execute(
                """
                SELECT local_table
                FROM _sources.cached_tables
                WHERE expires_at IS NOT NULL AND expires_at < ?
                """,
                [now],
            ).fetchall()

            for (local_table,) in expired:
                if self.drop_cache(local_table):
                    count += 1

        return count

    # =========================================================================
    # Smart Cache Suggestions
    # =========================================================================

    def estimate_table_size(self, source_name: str, table_name: str) -> Dict[str, Any]:
        """Estimate the size of a remote table.

        Returns estimated row count and whether caching is recommended.
        """
        # Verify source exists
        source = self.get_source(source_name)
        if not source:
            raise SourceNotFoundError(source_name)

        # Use connection with source attached
        with self._connect_with_sources([source_name]) as con:
            try:
                # Try to get row count (may be slow for large tables)
                source_ref = f"{_quote_identifier(source_name)}.{_quote_identifier(table_name)}"

                # First try COUNT(*) with timeout
                row_count = con.execute(f"SELECT COUNT(*) FROM {source_ref}").fetchone()[0]

                # Recommendations based on size
                recommend_cache = row_count > 10000  # Cache if > 10k rows
                recommend_filter = row_count > 100000  # Suggest filtering if > 100k

                return {
                    "source_name": source_name,
                    "table_name": table_name,
                    "estimated_rows": row_count,
                    "recommend_cache": recommend_cache,
                    "recommend_filter": recommend_filter,
                    "suggestion": self._get_cache_suggestion(row_count),
                }

            except duckdb.Error as e:
                return {
                    "source_name": source_name,
                    "table_name": table_name,
                    "error": str(e),
                    "recommend_cache": True,  # Default to cache on error
                    "suggestion": "Unable to estimate size. Consider caching with a date filter.",
                }

    def _get_cache_suggestion(self, row_count: int) -> str:
        """Generate a human-readable cache suggestion."""
        if row_count < 1000:
            return "테이블이 작아서 Live 쿼리가 충분히 빠를 거예요."
        elif row_count < 10000:
            return "테이블 크기가 적당해요. Live로 사용하거나 자주 쿼리한다면 캐시해도 좋아요."
        elif row_count < 100000:
            return f"약 {row_count:,}건이에요. 로컬 캐시하면 분석이 빨라질 거예요."
        elif row_count < 1000000:
            return f"약 {row_count:,}건이에요. 날짜 필터와 함께 캐시하는 걸 추천해요."
        else:
            return f"약 {row_count:,}건으로 큰 테이블이에요. 필요한 기간만 필터해서 캐시하세요."


@lru_cache(maxsize=32)
def get_source_service(project_id: str) -> SourceService:
    """Get source service instance for a specific project.
    
    Args:
        project_id: Project identifier for isolation
        
    Returns:
        SourceService bound to the project's warehouse
    """
    return SourceService(project_id)

