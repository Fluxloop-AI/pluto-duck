"""File Asset service - Uploaded File (CSV/Parquet) management.

This service handles file-based assets that are imported directly into DuckDB:
1. CSV files → read_csv()
2. Parquet files → read_parquet()

These bypass the Raw Zone (ATTACH) and go directly to Asset Zone.
"""

from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import duckdb

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from .errors import AssetError, AssetNotFoundError, AssetValidationError


# =============================================================================
# Data Models
# =============================================================================


@dataclass
class FileSource:
    """Represents a source file for a FileAsset."""

    id: Optional[str]
    file_asset_id: Optional[str]
    file_path: str
    original_name: Optional[str] = None
    row_count: Optional[int] = None
    file_size_bytes: Optional[int] = None
    added_at: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "file_asset_id": self.file_asset_id,
            "file_path": self.file_path,
            "original_name": self.original_name,
            "row_count": self.row_count,
            "file_size_bytes": self.file_size_bytes,
            "added_at": self.added_at.isoformat() if self.added_at else None,
        }


@dataclass
class FileAsset:
    """Represents an uploaded file asset.

    Attributes:
        id: Unique identifier
        name: Human-readable name
        file_path: Path to the source file
        file_type: Type of file (csv, parquet)
        table_name: Name of the DuckDB table
        description: Optional description
        row_count: Number of rows (after import)
        column_count: Number of columns
        file_size_bytes: Size of source file
        created_at: When the asset was created
        updated_at: When the asset was last updated
    """

    id: str
    name: str
    file_path: str
    file_type: Literal["csv", "parquet"]
    table_name: str
    description: Optional[str] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    file_size_bytes: Optional[int] = None
    diagnosis_id: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    sources: Optional[List[FileSource]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        payload = {
            "id": self.id,
            "name": self.name,
            "file_path": self.file_path,
            "file_type": self.file_type,
            "table_name": self.table_name,
            "description": self.description,
            "row_count": self.row_count,
            "column_count": self.column_count,
            "file_size_bytes": self.file_size_bytes,
            "diagnosis_id": self.diagnosis_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if self.sources is not None:
            payload["sources"] = [s.to_dict() for s in self.sources]
        return payload

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FileAsset":
        """Create from dictionary."""
        created_at = data.get("created_at")
        updated_at = data.get("updated_at")

        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        if isinstance(updated_at, str):
            updated_at = datetime.fromisoformat(updated_at)

        return cls(
            id=data["id"],
            name=data["name"],
            file_path=data["file_path"],
            file_type=data["file_type"],
            table_name=data["table_name"],
            description=data.get("description"),
            row_count=data.get("row_count"),
            column_count=data.get("column_count"),
            file_size_bytes=data.get("file_size_bytes"),
            diagnosis_id=data.get("diagnosis_id"),
            created_at=created_at or datetime.now(UTC),
            updated_at=updated_at or datetime.now(UTC),
            sources=[
                FileSource(
                    id=s.get("id"),
                    file_asset_id=s.get("file_asset_id"),
                    file_path=s["file_path"],
                    original_name=s.get("original_name"),
                    row_count=s.get("row_count"),
                    file_size_bytes=s.get("file_size_bytes"),
                    added_at=datetime.fromisoformat(s["added_at"]) if s.get("added_at") else None,
                )
                for s in data.get("sources", [])
            ]
            if data.get("sources") is not None
            else None,
        )


# =============================================================================
# File Asset Service
# =============================================================================


def _to_identifier(name: str) -> str:
    """Convert a name to a valid SQL identifier."""
    # Remove special characters, keep alphanumeric and underscores
    name = re.sub(r"[^\w]", "_", name)
    # Remove consecutive underscores
    name = re.sub(r"_+", "_", name)
    # Strip leading/trailing underscores
    name = name.strip("_")
    # Ensure it starts with a letter or underscore
    if name and name[0].isdigit():
        name = "_" + name
    return name.lower() or "unnamed"


def _generate_id() -> str:
    """Generate a unique ID for a file asset."""
    import uuid
    return f"file_{uuid.uuid4().hex[:12]}"


def _generate_file_source_id() -> str:
    """Generate a unique ID for a file source."""
    import uuid
    return f"fsrc_{uuid.uuid4().hex[:12]}"


class FileAssetService:
    """Service for managing Uploaded File assets (CSV/Parquet).

    These files go directly to Asset Zone, bypassing Raw Zone (ATTACH).

    Example:
        service = FileAssetService(project_id, warehouse_path)

        # Import a CSV file
        asset = service.import_file(
            file_path="/path/to/data.csv",
            file_type="csv",
            table_name="customers",
            name="Customer Data",
        )

        # List all file assets
        assets = service.list_files()

        # Delete a file asset
        service.delete_file(asset.id)
    """

    METADATA_SCHEMA = "_file_assets"
    METADATA_TABLE = "files"

    def __init__(
        self,
        project_id: str,
        warehouse_path: Path,
    ):
        """Initialize the file asset service.

        Args:
            project_id: Project identifier for isolation
            warehouse_path: Path to the main DuckDB warehouse
        """
        self.project_id = project_id
        self.warehouse_path = warehouse_path
        self._ensure_metadata_tables()

    @contextmanager
    def _get_connection(self):
        """Get a DuckDB connection (serialized for stability)."""
        with connect_warehouse(self.warehouse_path) as conn:
            yield conn

    def _ensure_metadata_tables(self) -> None:
        """Ensure metadata tables exist."""
        with self._get_connection() as conn:
            conn.execute(f"CREATE SCHEMA IF NOT EXISTS {self.METADATA_SCHEMA}")
            conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    description TEXT,
                    row_count BIGINT,
                    column_count INTEGER,
                    file_size_bytes BIGINT,
                    diagnosis_id TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Add diagnosis_id column if it doesn't exist (for existing tables)
            try:
                conn.execute(f"""
                    ALTER TABLE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                    ADD COLUMN IF NOT EXISTS diagnosis_id TEXT
                """)
            except Exception:
                # Column might already exist or ALTER not supported
                pass
            conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.METADATA_SCHEMA}.file_sources (
                    id TEXT PRIMARY KEY,
                    file_asset_id TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    original_name TEXT,
                    row_count BIGINT,
                    file_size_bytes BIGINT,
                    added_at TIMESTAMP WITH TIME ZONE
                )
            """)
            self._backfill_file_sources(conn)

    def _backfill_file_sources(self, conn: duckdb.DuckDBPyConnection) -> None:
        """Backfill file_sources from legacy file assets (idempotent)."""
        try:
            existing = conn.execute(
                f"SELECT DISTINCT file_asset_id FROM {self.METADATA_SCHEMA}.file_sources"
            ).fetchall()
        except Exception:
            return

        existing_ids = {row[0] for row in existing}
        rows = conn.execute(f"""
            SELECT id, file_path, row_count, file_size_bytes, created_at, updated_at
            FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
        """).fetchall()

        for file_id, file_path, row_count, file_size_bytes, created_at, updated_at in rows:
            if file_id in existing_ids:
                continue
            added_at = created_at or updated_at or datetime.now(UTC)
            original_name = Path(file_path).name if file_path else None
            conn.execute(
                f"""
                INSERT INTO {self.METADATA_SCHEMA}.file_sources (
                    id, file_asset_id, file_path, original_name,
                    row_count, file_size_bytes, added_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    _generate_file_source_id(),
                    file_id,
                    file_path,
                    original_name,
                    row_count,
                    file_size_bytes,
                    added_at,
                ],
            )

    def _insert_file_source(
        self,
        conn: duckdb.DuckDBPyConnection,
        *,
        file_asset_id: str,
        file_path: str,
        row_count: Optional[int],
        file_size_bytes: Optional[int],
        added_at: datetime,
    ) -> None:
        """Insert a single file source record."""
        original_name = Path(file_path).name if file_path else None
        conn.execute(
            f"""
            INSERT INTO {self.METADATA_SCHEMA}.file_sources (
                id, file_asset_id, file_path, original_name,
                row_count, file_size_bytes, added_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                _generate_file_source_id(),
                file_asset_id,
                file_path,
                original_name,
                row_count,
                file_size_bytes,
                added_at,
            ],
        )

    def _fetch_sources(
        self,
        conn: duckdb.DuckDBPyConnection,
        asset_ids: List[str],
    ) -> Dict[str, List[FileSource]]:
        """Fetch file sources for a set of asset IDs."""
        if not asset_ids:
            return {}
        placeholders = ",".join(["?" for _ in asset_ids])
        rows = conn.execute(
            f"""
            SELECT id, file_asset_id, file_path, original_name,
                   row_count, file_size_bytes, added_at
            FROM {self.METADATA_SCHEMA}.file_sources
            WHERE file_asset_id IN ({placeholders})
            ORDER BY added_at ASC
            """,
            asset_ids,
        ).fetchall()

        sources_by_asset: Dict[str, List[FileSource]] = {}
        for row in rows:
            source = FileSource(
                id=row[0],
                file_asset_id=row[1],
                file_path=row[2],
                original_name=row[3],
                row_count=row[4],
                file_size_bytes=row[5],
                added_at=row[6],
            )
            sources_by_asset.setdefault(row[1], []).append(source)
        return sources_by_asset

    def _build_fallback_sources(self, asset: FileAsset) -> List[FileSource]:
        """Build a fallback source list from legacy file fields."""
        added_at = asset.created_at or asset.updated_at or datetime.now(UTC)
        return [
            FileSource(
                id=None,
                file_asset_id=asset.id,
                file_path=asset.file_path,
                original_name=Path(asset.file_path).name if asset.file_path else None,
                row_count=asset.row_count,
                file_size_bytes=asset.file_size_bytes,
                added_at=added_at,
            )
        ]

    def _append_file_event(
        self,
        *,
        file_asset_id: str,
        event_type: str,
        message: Optional[str],
    ) -> None:
        try:
            from .file_preprocessing_service import get_file_preprocessing_service

            service = get_file_preprocessing_service(self.project_id)
            service.append_event(
                file_asset_id=file_asset_id,
                event_type=event_type,
                message=message,
                actor=None,
            )
        except Exception as exc:
            logger.warning("[FileAssetService] Failed to append event: %s", exc)

    # =========================================================================
    # CRUD Operations
    # =========================================================================

    def import_file(
        self,
        file_path: str,
        file_type: Literal["csv", "parquet"],
        table_name: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        overwrite: bool = True,
        mode: Literal["replace", "append", "merge"] = "replace",
        target_table: Optional[str] = None,
        merge_keys: Optional[List[str]] = None,
        deduplicate: bool = False,
        diagnosis_id: Optional[str] = None,
    ) -> FileAsset:
        """Import a file into DuckDB as a table.

        Args:
            file_path: Path to the source file
            file_type: Type of file ("csv" or "parquet")
            table_name: Name for the DuckDB table (used for new tables)
            name: Human-readable name (defaults to table_name)
            description: Optional description
            overwrite: If True, drop existing table first (only for replace mode)
            mode: Import mode - "replace", "append", or "merge"
            target_table: Existing table name for append/merge modes
            merge_keys: Column names for merge key (required for merge mode)
            deduplicate: If True (append only), skip exact duplicate rows that already exist in the target table

        Returns:
            Created/Updated FileAsset

        Raises:
            AssetValidationError: If validation fails
            AssetError: If import fails
        """
        logger.info(f"[FileAssetService.import_file] Called with table_name={table_name}, diagnosis_id={diagnosis_id}")
        # Validate file exists
        path = Path(file_path)
        if not path.exists():
            raise AssetValidationError(f"File not found: {file_path}")

        # Get file size
        file_size_bytes = path.stat().st_size

        # Determine actual table name
        if mode in ("append", "merge") and target_table:
            safe_table = _to_identifier(target_table)
        else:
            safe_table = _to_identifier(table_name)
        
        if not safe_table:
            raise AssetValidationError("Invalid table name")

        # Validate merge mode has keys
        if mode == "merge" and not merge_keys:
            raise AssetValidationError("merge_keys required for merge mode")

        # Build read expression
        if file_type == "csv":
            read_expr = f"read_csv('{file_path}', auto_detect=true)"
        elif file_type == "parquet":
            read_expr = f"read_parquet('{file_path}')"
        else:
            raise AssetValidationError(f"Unsupported file type: {file_type}")

        with self._get_connection() as conn:
            try:
                if mode in ("append", "merge"):
                    # Check table exists early for append/merge
                    result = conn.execute(f"""
                        SELECT COUNT(*) FROM information_schema.tables
                        WHERE table_name = '{safe_table}'
                    """).fetchone()
                    if not result or result[0] == 0:
                        raise AssetValidationError(
                            f"Target table '{safe_table}' not found for {mode}"
                        )

                # Count rows in the source file for per-source stats
                source_row_count = conn.execute(
                    f"SELECT COUNT(*) FROM {read_expr}"
                ).fetchone()[0]

                if mode == "replace":
                    # Replace mode: drop and recreate
                    if overwrite:
                        conn.execute(f"DROP TABLE IF EXISTS {safe_table}")
                    else:
                        result = conn.execute(f"""
                            SELECT COUNT(*) FROM information_schema.tables
                            WHERE table_name = '{safe_table}'
                        """).fetchone()
                        if result and result[0] > 0:
                            raise AssetValidationError(f"Table '{safe_table}' already exists")
                    
                    conn.execute(f"CREATE TABLE {safe_table} AS SELECT * FROM {read_expr}")
                    
                elif mode == "append":
                    # Append mode: insert into existing table
                    # Validate schema compatibility (simple: same column names/order)
                    try:
                        target_cols = [r[0] for r in conn.execute(f"DESCRIBE {safe_table}").fetchall()]
                        source_cols = [
                            r[0]
                            for r in conn.execute(f"DESCRIBE SELECT * FROM {read_expr}").fetchall()
                        ]
                        if target_cols != source_cols:
                            raise AssetValidationError(
                                "Schema mismatch for append. "
                                "Columns must match exactly. Consider using Replace."
                            )
                    except AssetValidationError:
                        raise
                    except Exception:
                        # If DESCRIBE fails for any reason, we let DuckDB attempt the insert and surface the error.
                        pass

                    if deduplicate:
                        # Skip rows that are exact duplicates of existing rows in the target table.
                        # This compares the full row (all columns), which is suitable for
                        # "overlapping date range" re-imports where rows are identical.
                        conn.execute(
                            f"""
                            INSERT INTO {safe_table}
                            SELECT * FROM (SELECT DISTINCT * FROM {read_expr})
                            EXCEPT
                            SELECT * FROM {safe_table}
                            """
                        )
                    else:
                        conn.execute(f"INSERT INTO {safe_table} SELECT * FROM {read_expr}")
                    
                elif mode == "merge":
                    # Merge mode: UPSERT using merge keys
                    # Get columns from existing table
                    cols_result = conn.execute(f"DESCRIBE {safe_table}").fetchall()
                    all_columns = [r[0] for r in cols_result]
                    update_columns = [c for c in all_columns if c not in merge_keys]
                    
                    # Build merge SQL
                    key_conditions = " AND ".join([f"target.{k} = source.{k}" for k in merge_keys])
                    update_set = ", ".join([f"{c} = source.{c}" for c in update_columns])
                    insert_cols = ", ".join(all_columns)
                    insert_vals = ", ".join([f"source.{c}" for c in all_columns])
                    
                    merge_sql = f"""
                        MERGE INTO {safe_table} AS target
                        USING (SELECT * FROM {read_expr}) AS source
                        ON {key_conditions}
                        WHEN MATCHED THEN UPDATE SET {update_set}
                        WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({insert_vals})
                    """
                    conn.execute(merge_sql)

            except duckdb.Error as e:
                raise AssetError(f"Failed to import file ({mode}): {e}")

            # Get updated row and column count
            row_count = conn.execute(f"SELECT COUNT(*) FROM {safe_table}").fetchone()[0]
            column_count = len(conn.execute(f"DESCRIBE {safe_table}").fetchall())

            now = datetime.now(UTC)

            # For append/merge, find and update existing metadata
            if mode in ("append", "merge") and target_table:
                existing = conn.execute(f"""
                    SELECT id FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                    WHERE table_name = ? AND project_id = ?
                """, [safe_table, self.project_id]).fetchone()
                
                if existing:
                    asset_id = existing[0]
                    conn.execute(f"""
                        UPDATE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                        SET row_count = ?, updated_at = ?
                        WHERE id = ?
                    """, [row_count, now, asset_id])

                    self._insert_file_source(
                        conn,
                        file_asset_id=asset_id,
                        file_path=file_path,
                        row_count=source_row_count,
                        file_size_bytes=file_size_bytes,
                        added_at=now,
                    )

                    file_name = Path(file_path).name if file_path else None
                    message = f"Dataset appended from {file_name}" if file_name else "Dataset appended"
                    self._append_file_event(
                        file_asset_id=asset_id,
                        event_type="dataset_appended",
                        message=message,
                    )
                    
                    # Return updated asset
                    asset = self.get_file(asset_id)
                    if asset:
                        return asset
            
            # For replace mode or if no existing metadata, create new
            asset_id = _generate_id()
            logger.info(f"[FileAssetService.import_file] Creating new asset: asset_id={asset_id}, diagnosis_id={diagnosis_id}")

            # Remove old metadata and sources if exists (for replace mode)
            old_ids = conn.execute(
                f"""
                SELECT id FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE table_name = ? AND project_id = ?
                """,
                [safe_table, self.project_id],
            ).fetchall()
            if old_ids:
                old_asset_ids = [row[0] for row in old_ids]
                placeholders = ",".join(["?" for _ in old_asset_ids])
                conn.execute(
                    f"""
                    DELETE FROM {self.METADATA_SCHEMA}.file_sources
                    WHERE file_asset_id IN ({placeholders})
                    """,
                    old_asset_ids,
                )
            conn.execute(f"""
                DELETE FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE table_name = ? AND project_id = ?
            """, [safe_table, self.project_id])

            conn.execute(f"""
                INSERT INTO {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                (id, project_id, name, file_path, file_type, table_name, description,
                 row_count, column_count, file_size_bytes, diagnosis_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                asset_id,
                self.project_id,
                name or table_name,
                file_path,
                file_type,
                safe_table,
                description,
                row_count,
                column_count,
                file_size_bytes,
                diagnosis_id,
                now,
                now,
            ])
            logger.info(f"[FileAssetService.import_file] Asset saved to DB with diagnosis_id={diagnosis_id}")

            self._insert_file_source(
                conn,
                file_asset_id=asset_id,
                file_path=file_path,
                row_count=source_row_count,
                file_size_bytes=file_size_bytes,
                added_at=now,
            )

            file_name = Path(file_path).name if file_path else None
            message = f"Dataset created from {file_name}" if file_name else "Dataset created"
            self._append_file_event(
                file_asset_id=asset_id,
                event_type="dataset_created",
                message=message,
            )

        return FileAsset(
            id=asset_id,
            name=name or table_name,
            file_path=file_path,
            file_type=file_type,
            table_name=safe_table,
            description=description,
            row_count=row_count,
            column_count=column_count,
            file_size_bytes=file_size_bytes,
            diagnosis_id=diagnosis_id,
            created_at=now,
            updated_at=now,
            sources=[
                FileSource(
                    id=None,
                    file_asset_id=asset_id,
                    file_path=file_path,
                    original_name=Path(file_path).name if file_path else None,
                    row_count=source_row_count,
                    file_size_bytes=file_size_bytes,
                    added_at=now,
                )
            ],
        )

    def get_file(self, file_id: str) -> Optional[FileAsset]:
        """Get a file asset by ID.

        Args:
            file_id: File asset identifier

        Returns:
            FileAsset if found, None otherwise
        """
        with self._get_connection() as conn:
            result = conn.execute(f"""
                SELECT id, name, file_path, file_type, table_name, description,
                       row_count, column_count, file_size_bytes, diagnosis_id, created_at, updated_at
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE id = ? AND project_id = ?
            """, [file_id, self.project_id]).fetchone()

            if not result:
                return None

            asset = FileAsset(
                id=result[0],
                name=result[1],
                file_path=result[2],
                file_type=result[3],
                table_name=result[4],
                description=result[5],
                row_count=result[6],
                column_count=result[7],
                file_size_bytes=result[8],
                diagnosis_id=result[9],
                created_at=result[10],
                updated_at=result[11],
            )
            sources = self._fetch_sources(conn, [asset.id]).get(asset.id)
            asset.sources = sources if sources else self._build_fallback_sources(asset)
            return asset

    def list_files(self) -> List[FileAsset]:
        """List all file assets for this project.

        Returns:
            List of FileAsset objects
        """
        with self._get_connection() as conn:
            results = conn.execute(f"""
                SELECT id, name, file_path, file_type, table_name, description,
                       row_count, column_count, file_size_bytes, diagnosis_id, created_at, updated_at
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE project_id = ?
                ORDER BY created_at DESC
            """, [self.project_id]).fetchall()

            assets = [
                FileAsset(
                    id=r[0],
                    name=r[1],
                    file_path=r[2],
                    file_type=r[3],
                    table_name=r[4],
                    description=r[5],
                    row_count=r[6],
                    column_count=r[7],
                    file_size_bytes=r[8],
                    diagnosis_id=r[9],
                    created_at=r[10],
                    updated_at=r[11],
                )
                for r in results
            ]

            sources_by_asset = self._fetch_sources(conn, [a.id for a in assets])
            for asset in assets:
                sources = sources_by_asset.get(asset.id)
                asset.sources = sources if sources else self._build_fallback_sources(asset)
            return assets

    def delete_file(self, file_id: str, *, drop_table: bool = True) -> bool:
        """Delete a file asset.

        Args:
            file_id: File asset identifier
            drop_table: If True, also drop the DuckDB table

        Returns:
            True if deleted, False if not found
        """
        with self._get_connection() as conn:
            # Get table name first
            result = conn.execute(f"""
                SELECT table_name FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE id = ? AND project_id = ?
            """, [file_id, self.project_id]).fetchone()

            if not result:
                return False

            table_name = result[0]

            # Drop the table if requested
            if drop_table:
                try:
                    conn.execute(f"DROP TABLE IF EXISTS {table_name}")
                except duckdb.Error:
                    pass  # Table might not exist

            # Delete metadata
            conn.execute(f"""
                DELETE FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE id = ? AND project_id = ?
            """, [file_id, self.project_id])
            conn.execute(
                f"""
                DELETE FROM {self.METADATA_SCHEMA}.file_sources
                WHERE file_asset_id = ?
                """,
                [file_id],
            )

            return True

    def refresh_file(self, file_id: str) -> FileAsset:
        """Refresh a file asset by re-importing from the source file.

        Args:
            file_id: File asset identifier

        Returns:
            Updated FileAsset

        Raises:
            AssetNotFoundError: If file asset not found
        """
        asset = self.get_file(file_id)
        if not asset:
            raise AssetNotFoundError(file_id)

        # Re-import with same settings
        return self.import_file(
            file_path=asset.file_path,
            file_type=asset.file_type,
            table_name=asset.table_name,
            name=asset.name,
            description=asset.description,
            overwrite=True,
        )

    def update_diagnosis_id(self, file_id: str, diagnosis_id: Optional[str]) -> None:
        """Update the diagnosis_id for a file asset."""
        with self._get_connection() as conn:
            conn.execute(f"""
                UPDATE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                SET diagnosis_id = ?, updated_at = ?
                WHERE id = ? AND project_id = ?
            """, [diagnosis_id, datetime.now(UTC), file_id, self.project_id])

    def get_table_schema(self, file_id: str) -> List[Dict[str, Any]]:
        """Get the schema of the imported table.

        Args:
            file_id: File asset identifier

        Returns:
            List of column definitions

        Raises:
            AssetNotFoundError: If file asset not found
        """
        asset = self.get_file(file_id)
        if not asset:
            raise AssetNotFoundError(file_id)

        with self._get_connection() as conn:
            results = conn.execute(f"DESCRIBE {asset.table_name}").fetchall()
            return [
                {
                    "column_name": r[0],
                    "column_type": r[1],
                    "null": r[2],
                    "key": r[3],
                    "default": r[4],
                    "extra": r[5],
                }
                for r in results
            ]

    def preview_data(
        self,
        file_id: str,
        *,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """Preview data from the imported table.

        Args:
            file_id: File asset identifier
            limit: Maximum number of rows

        Returns:
            Dict with columns and rows

        Raises:
            AssetNotFoundError: If file asset not found
        """
        asset = self.get_file(file_id)
        if not asset:
            raise AssetNotFoundError(file_id)

        with self._get_connection() as conn:
            result = conn.execute(f"SELECT * FROM {asset.table_name} LIMIT {limit}")
            columns = [desc[0] for desc in result.description]
            rows = result.fetchall()

            return {
                "columns": columns,
                "rows": [list(row) for row in rows],
                "total_rows": asset.row_count,
            }


# =============================================================================
# Singleton factory
# =============================================================================


_file_asset_services: Dict[str, FileAssetService] = {}


def get_file_asset_service(project_id: Optional[str] = None) -> FileAssetService:
    """Get a FileAssetService instance for a project.

    Args:
        project_id: Project ID (uses default if not provided)

    Returns:
        FileAssetService instance
    """
    from pluto_duck_backend.app.services.chat import get_chat_repository

    settings = get_settings()

    if project_id is None:
        chat_repo = get_chat_repository()
        project_id = chat_repo._default_project_id

    if project_id not in _file_asset_services:
        _file_asset_services[project_id] = FileAssetService(
            project_id=project_id,
            warehouse_path=settings.duckdb.path,
        )

    return _file_asset_services[project_id]
