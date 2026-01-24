"""File Diagnosis service - Pre-import data quality analysis.

This service analyzes CSV/Parquet files before import to provide:
1. Schema extraction (columns, types, nullable)
2. Missing values (NULL count per column)
3. Row count and file size
4. Type suggestions (detect mismatched types)
5. Optional result caching for faster re-diagnosis
"""

from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import duckdb

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from .errors import DiagnosisError


# =============================================================================
# Data Models
# =============================================================================


@dataclass
class ColumnSchema:
    """Schema information for a single column.

    Attributes:
        name: Column name
        type: DuckDB data type
        nullable: Whether the column allows NULL values
    """

    name: str
    type: str
    nullable: bool = True

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "type": self.type,
            "nullable": self.nullable,
        }


@dataclass
class TypeSuggestion:
    """Suggestion for a better column type.

    Attributes:
        column_name: Name of the column
        current_type: Current detected type
        suggested_type: Recommended type
        confidence: Confidence percentage (0-100)
        sample_values: Sample values that support the suggestion
    """

    column_name: str
    current_type: str
    suggested_type: str
    confidence: float
    sample_values: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "column_name": self.column_name,
            "current_type": self.current_type,
            "suggested_type": self.suggested_type,
            "confidence": self.confidence,
            "sample_values": self.sample_values,
        }


@dataclass
class FileDiagnosis:
    """Result of file diagnosis.

    Attributes:
        file_path: Path to the analyzed file
        file_type: Type of file (csv, parquet)
        schema: List of column schemas
        missing_values: Dict mapping column name to NULL count
        row_count: Total number of rows
        file_size_bytes: Size of the file in bytes
        type_suggestions: List of type improvement suggestions
        diagnosed_at: Timestamp of diagnosis
    """

    file_path: str
    file_type: Literal["csv", "parquet"]
    schema: List[ColumnSchema]
    missing_values: Dict[str, int]
    row_count: int
    file_size_bytes: int
    type_suggestions: List[TypeSuggestion] = field(default_factory=list)
    diagnosed_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "file_path": self.file_path,
            "file_type": self.file_type,
            "schema": [col.to_dict() for col in self.schema],
            "missing_values": self.missing_values,
            "row_count": self.row_count,
            "file_size_bytes": self.file_size_bytes,
            "type_suggestions": [ts.to_dict() for ts in self.type_suggestions],
            "diagnosed_at": self.diagnosed_at.isoformat() if self.diagnosed_at else None,
        }


@dataclass
class DiagnoseFileRequest:
    """Request to diagnose a single file.

    Attributes:
        file_path: Path to the file
        file_type: Type of file (csv, parquet)
    """

    file_path: str
    file_type: Literal["csv", "parquet"]


# =============================================================================
# File Diagnosis Service
# =============================================================================


class FileDiagnosisService:
    """Service for diagnosing file data quality before import.

    Analyzes CSV/Parquet files without creating tables to provide:
    - Schema information (columns, types, nullable)
    - Missing value counts per column
    - Type mismatch suggestions
    - Optional result caching

    Example:
        service = FileDiagnosisService(project_id, warehouse_path)

        # Diagnose a single file
        diagnosis = service.diagnose_file("/path/to/data.csv", "csv")
        print(f"Columns: {len(diagnosis.schema)}")
        print(f"Rows: {diagnosis.row_count}")
        print(f"Missing values: {diagnosis.missing_values}")

        # Diagnose multiple files
        files = [
            DiagnoseFileRequest("/path/to/a.csv", "csv"),
            DiagnoseFileRequest("/path/to/b.parquet", "parquet"),
        ]
        diagnoses = service.diagnose_files(files)

        # Use cached diagnosis
        cached = service.get_cached_diagnosis("/path/to/data.csv")
    """

    METADATA_SCHEMA = "_file_assets"
    METADATA_TABLE = "file_diagnoses"

    def __init__(
        self,
        project_id: str,
        warehouse_path: Path,
    ):
        """Initialize the file diagnosis service.

        Args:
            project_id: Project identifier for isolation
            warehouse_path: Path to the main DuckDB warehouse
        """
        self.project_id = project_id
        self.warehouse_path = warehouse_path
        self._ensure_metadata_tables()

    def _ensure_metadata_tables(self) -> None:
        """Ensure metadata tables exist for caching diagnosis results."""
        with self._get_connection() as conn:
            conn.execute(f"CREATE SCHEMA IF NOT EXISTS {self.METADATA_SCHEMA}")
            conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.METADATA_SCHEMA}.{self.METADATA_TABLE} (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    schema_info TEXT,
                    missing_values TEXT,
                    type_suggestions TEXT,
                    row_count BIGINT,
                    column_count INTEGER,
                    file_size_bytes BIGINT,
                    diagnosed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """)

    @contextmanager
    def _get_connection(self):
        """Get a DuckDB connection (serialized for stability)."""
        with connect_warehouse(self.warehouse_path) as conn:
            yield conn

    def _build_read_expr(self, file_path: str, file_type: str) -> str:
        """Build DuckDB read expression for file.

        Args:
            file_path: Path to the file
            file_type: Type of file (csv, parquet)

        Returns:
            DuckDB expression to read the file
        """
        safe_path = file_path.replace("'", "''")
        if file_type == "csv":
            return f"read_csv('{safe_path}', auto_detect=true)"
        elif file_type == "parquet":
            return f"read_parquet('{safe_path}')"
        else:
            raise DiagnosisError(f"Unsupported file type: {file_type}")

    def _extract_schema(
        self, conn: duckdb.DuckDBPyConnection, read_expr: str
    ) -> List[ColumnSchema]:
        """Extract schema from file using DESCRIBE.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file

        Returns:
            List of ColumnSchema objects
        """
        result = conn.execute(f"DESCRIBE SELECT * FROM {read_expr}").fetchall()
        schema = []
        for row in result:
            # DESCRIBE returns: column_name, column_type, null, key, default, extra
            name = row[0]
            col_type = row[1]
            nullable = row[2] == "YES" if row[2] else True
            schema.append(ColumnSchema(name=name, type=col_type, nullable=nullable))
        return schema

    def _count_missing_values(
        self,
        conn: duckdb.DuckDBPyConnection,
        read_expr: str,
        schema: List[ColumnSchema],
    ) -> Dict[str, int]:
        """Count NULL values for each column.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file
            schema: List of column schemas

        Returns:
            Dict mapping column name to NULL count
        """
        missing_values = {}
        for col in schema:
            safe_col = f'"{col.name}"'
            try:
                result = conn.execute(
                    f"SELECT COUNT(*) FROM {read_expr} WHERE {safe_col} IS NULL"
                ).fetchone()
                missing_values[col.name] = result[0] if result else 0
            except duckdb.Error:
                # If column query fails, set to 0
                missing_values[col.name] = 0
        return missing_values

    def _get_row_count(
        self, conn: duckdb.DuckDBPyConnection, read_expr: str
    ) -> int:
        """Get total row count from file.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file

        Returns:
            Total number of rows
        """
        result = conn.execute(f"SELECT COUNT(*) FROM {read_expr}").fetchone()
        return result[0] if result else 0

    def _analyze_type_suggestions(
        self,
        conn: duckdb.DuckDBPyConnection,
        read_expr: str,
        schema: List[ColumnSchema],
        sample_size: int = 1000,
        confidence_threshold: float = 0.9,
    ) -> List[TypeSuggestion]:
        """Analyze VARCHAR columns for potential better type matches.

        Checks if VARCHAR columns could be better represented as:
        - INTEGER/BIGINT (whole numbers)
        - DOUBLE (decimal numbers)
        - DATE (date values)
        - TIMESTAMP (datetime values)

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file
            schema: List of column schemas
            sample_size: Number of rows to sample (default 1000)
            confidence_threshold: Minimum success rate to suggest type (default 90%)

        Returns:
            List of TypeSuggestion objects for columns that could be better typed
        """
        suggestions = []

        # Only analyze VARCHAR columns
        varchar_columns = [
            col for col in schema
            if col.type.upper() in ("VARCHAR", "STRING", "TEXT")
        ]

        for col in varchar_columns:
            safe_col = f'"{col.name}"'

            try:
                # Get sample of non-null values
                sample_query = f"""
                    SELECT {safe_col}
                    FROM {read_expr}
                    WHERE {safe_col} IS NOT NULL AND TRIM({safe_col}) != ''
                    LIMIT {sample_size}
                """
                sample_result = conn.execute(sample_query).fetchall()
                total_non_null = len(sample_result)

                if total_non_null == 0:
                    continue

                # Check for INTEGER type
                int_check = conn.execute(f"""
                    SELECT COUNT(*)
                    FROM ({sample_query}) AS sample
                    WHERE TRY_CAST(sample.{safe_col} AS BIGINT) IS NOT NULL
                """).fetchone()
                int_success = int_check[0] if int_check else 0

                if int_success / total_non_null >= confidence_threshold:
                    # Get sample values
                    sample_values = [str(r[0]) for r in sample_result[:5]]
                    suggestions.append(TypeSuggestion(
                        column_name=col.name,
                        current_type=col.type,
                        suggested_type="BIGINT",
                        confidence=round(int_success / total_non_null * 100, 1),
                        sample_values=sample_values,
                    ))
                    continue

                # Check for DOUBLE type (if not all integers)
                double_check = conn.execute(f"""
                    SELECT COUNT(*)
                    FROM ({sample_query}) AS sample
                    WHERE TRY_CAST(sample.{safe_col} AS DOUBLE) IS NOT NULL
                """).fetchone()
                double_success = double_check[0] if double_check else 0

                if double_success / total_non_null >= confidence_threshold:
                    sample_values = [str(r[0]) for r in sample_result[:5]]
                    suggestions.append(TypeSuggestion(
                        column_name=col.name,
                        current_type=col.type,
                        suggested_type="DOUBLE",
                        confidence=round(double_success / total_non_null * 100, 1),
                        sample_values=sample_values,
                    ))
                    continue

                # Check for DATE type
                date_check = conn.execute(f"""
                    SELECT COUNT(*)
                    FROM ({sample_query}) AS sample
                    WHERE TRY_CAST(sample.{safe_col} AS DATE) IS NOT NULL
                """).fetchone()
                date_success = date_check[0] if date_check else 0

                if date_success / total_non_null >= confidence_threshold:
                    sample_values = [str(r[0]) for r in sample_result[:5]]
                    suggestions.append(TypeSuggestion(
                        column_name=col.name,
                        current_type=col.type,
                        suggested_type="DATE",
                        confidence=round(date_success / total_non_null * 100, 1),
                        sample_values=sample_values,
                    ))
                    continue

                # Check for TIMESTAMP type
                timestamp_check = conn.execute(f"""
                    SELECT COUNT(*)
                    FROM ({sample_query}) AS sample
                    WHERE TRY_CAST(sample.{safe_col} AS TIMESTAMP) IS NOT NULL
                """).fetchone()
                timestamp_success = timestamp_check[0] if timestamp_check else 0

                if timestamp_success / total_non_null >= confidence_threshold:
                    sample_values = [str(r[0]) for r in sample_result[:5]]
                    suggestions.append(TypeSuggestion(
                        column_name=col.name,
                        current_type=col.type,
                        suggested_type="TIMESTAMP",
                        confidence=round(timestamp_success / total_non_null * 100, 1),
                        sample_values=sample_values,
                    ))

            except duckdb.Error:
                # Skip columns that fail analysis
                continue

        return suggestions

    def diagnose_file(
        self,
        file_path: str,
        file_type: Literal["csv", "parquet"],
    ) -> FileDiagnosis:
        """Diagnose a single file.

        Args:
            file_path: Path to the file to diagnose
            file_type: Type of file (csv or parquet)

        Returns:
            FileDiagnosis with schema, missing values, and metadata

        Raises:
            DiagnosisError: If diagnosis fails (file not found, parse error, etc.)
        """
        # Validate file exists
        path = Path(file_path)
        if not path.exists():
            raise DiagnosisError(f"File not found: {file_path}")

        # Get file size
        try:
            file_size_bytes = path.stat().st_size
        except OSError as e:
            raise DiagnosisError(f"Cannot read file stats: {e}")

        # Build read expression
        read_expr = self._build_read_expr(file_path, file_type)

        with self._get_connection() as conn:
            try:
                # Extract schema
                schema = self._extract_schema(conn, read_expr)

                # Count missing values
                missing_values = self._count_missing_values(conn, read_expr, schema)

                # Get row count
                row_count = self._get_row_count(conn, read_expr)

                # Analyze type suggestions for VARCHAR columns
                type_suggestions = self._analyze_type_suggestions(conn, read_expr, schema)

            except duckdb.Error as e:
                raise DiagnosisError(f"Failed to diagnose file: {e}")

        return FileDiagnosis(
            file_path=file_path,
            file_type=file_type,
            schema=schema,
            missing_values=missing_values,
            row_count=row_count,
            file_size_bytes=file_size_bytes,
            type_suggestions=type_suggestions,
            diagnosed_at=datetime.now(UTC),
        )

    def diagnose_files(
        self,
        files: List[DiagnoseFileRequest],
    ) -> List[FileDiagnosis]:
        """Diagnose multiple files.

        Args:
            files: List of files to diagnose

        Returns:
            List of FileDiagnosis results

        Note:
            Files are diagnosed sequentially due to DuckDB connection serialization.
        """
        diagnoses = []
        for file_req in files:
            diagnosis = self.diagnose_file(file_req.file_path, file_req.file_type)
            diagnoses.append(diagnosis)
        return diagnoses

    # =========================================================================
    # Caching Methods
    # =========================================================================

    def save_diagnosis(self, diagnosis: FileDiagnosis) -> str:
        """Save a diagnosis result to the cache.

        Args:
            diagnosis: FileDiagnosis to save

        Returns:
            ID of the saved diagnosis record
        """
        diagnosis_id = f"diag_{uuid.uuid4().hex[:12]}"

        # Serialize complex fields to JSON
        schema_json = json.dumps([col.to_dict() for col in diagnosis.schema])
        missing_values_json = json.dumps(diagnosis.missing_values)
        type_suggestions_json = json.dumps([ts.to_dict() for ts in diagnosis.type_suggestions])

        with self._get_connection() as conn:
            # Delete existing diagnosis for this file path
            conn.execute(f"""
                DELETE FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE file_path = ? AND project_id = ?
            """, [diagnosis.file_path, self.project_id])

            # Insert new diagnosis
            conn.execute(f"""
                INSERT INTO {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                (id, project_id, file_path, file_type, schema_info, missing_values,
                 type_suggestions, row_count, column_count, file_size_bytes, diagnosed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                diagnosis_id,
                self.project_id,
                diagnosis.file_path,
                diagnosis.file_type,
                schema_json,
                missing_values_json,
                type_suggestions_json,
                diagnosis.row_count,
                len(diagnosis.schema),
                diagnosis.file_size_bytes,
                diagnosis.diagnosed_at,
            ])

        return diagnosis_id

    def get_cached_diagnosis(self, file_path: str) -> Optional[FileDiagnosis]:
        """Get a cached diagnosis result for a file.

        Args:
            file_path: Path to the file

        Returns:
            FileDiagnosis if cached, None otherwise
        """
        with self._get_connection() as conn:
            result = conn.execute(f"""
                SELECT file_path, file_type, schema_info, missing_values,
                       type_suggestions, row_count, file_size_bytes, diagnosed_at
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE file_path = ? AND project_id = ?
            """, [file_path, self.project_id]).fetchone()

            if not result:
                return None

            # Deserialize JSON fields
            schema_data = json.loads(result[2]) if result[2] else []
            missing_values = json.loads(result[3]) if result[3] else {}
            type_suggestions_data = json.loads(result[4]) if result[4] else []

            # Reconstruct schema
            schema = [
                ColumnSchema(
                    name=col["name"],
                    type=col["type"],
                    nullable=col.get("nullable", True),
                )
                for col in schema_data
            ]

            # Reconstruct type suggestions
            type_suggestions = [
                TypeSuggestion(
                    column_name=ts["column_name"],
                    current_type=ts["current_type"],
                    suggested_type=ts["suggested_type"],
                    confidence=ts["confidence"],
                    sample_values=ts.get("sample_values", []),
                )
                for ts in type_suggestions_data
            ]

            return FileDiagnosis(
                file_path=result[0],
                file_type=result[1],
                schema=schema,
                missing_values=missing_values,
                row_count=result[5],
                file_size_bytes=result[6],
                type_suggestions=type_suggestions,
                diagnosed_at=result[7],
            )

    def delete_cached_diagnosis(self, file_path: str) -> bool:
        """Delete a cached diagnosis for a file.

        Args:
            file_path: Path to the file

        Returns:
            True if deleted, False if not found
        """
        with self._get_connection() as conn:
            result = conn.execute(f"""
                DELETE FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE file_path = ? AND project_id = ?
            """, [file_path, self.project_id])
            # DuckDB doesn't return affected rows easily, so check if row existed
            check = conn.execute(f"""
                SELECT COUNT(*) FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE file_path = ? AND project_id = ?
            """, [file_path, self.project_id]).fetchone()
            return check[0] == 0


# =============================================================================
# Singleton factory
# =============================================================================


_file_diagnosis_services: Dict[str, FileDiagnosisService] = {}


def get_file_diagnosis_service(project_id: Optional[str] = None) -> FileDiagnosisService:
    """Get a FileDiagnosisService instance for a project.

    Args:
        project_id: Project ID (uses default if not provided)

    Returns:
        FileDiagnosisService instance
    """
    from pluto_duck_backend.app.services.chat import get_chat_repository

    settings = get_settings()

    if project_id is None:
        chat_repo = get_chat_repository()
        project_id = chat_repo._default_project_id

    if project_id not in _file_diagnosis_services:
        _file_diagnosis_services[project_id] = FileDiagnosisService(
            project_id=project_id,
            warehouse_path=settings.duckdb.path,
        )

    return _file_diagnosis_services[project_id]
