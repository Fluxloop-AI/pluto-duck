"""File Diagnosis service - Pre-import data quality analysis.

This service analyzes CSV/Parquet files before import to provide:
1. Schema extraction (columns, types, nullable)
2. Missing values (NULL count per column)
3. Row count and file size
4. Type suggestions (detect mismatched types)
5. Optional result caching for faster re-diagnosis
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import chardet
import duckdb

logger = logging.getLogger(__name__)

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
class EncodingInfo:
    """Detected file encoding information.

    Attributes:
        detected: Detected encoding name (UTF-8, CP949, etc.)
        confidence: Detection confidence (0.0 to 1.0)
    """

    detected: str
    confidence: float

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "detected": self.detected,
            "confidence": self.confidence,
        }


@dataclass
class ParsingIntegrity:
    """Parsing integrity check result.

    Attributes:
        total_lines: Original file line count
        parsed_rows: Successfully parsed row count
        malformed_rows: Failed to parse row count
        has_errors: Whether any parsing errors occurred
        error_message: Error message if any
    """

    total_lines: int
    parsed_rows: int
    malformed_rows: int
    has_errors: bool
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "total_lines": self.total_lines,
            "parsed_rows": self.parsed_rows,
            "malformed_rows": self.malformed_rows,
            "has_errors": self.has_errors,
            "error_message": self.error_message,
        }


@dataclass
class NumericStats:
    """Statistics for numeric columns.

    Attributes:
        min: Minimum value
        max: Maximum value
        median: Median value
        mean: Mean value
        stddev: Standard deviation
        distinct_count: Number of distinct values
    """

    min: Optional[float] = None
    max: Optional[float] = None
    median: Optional[float] = None
    mean: Optional[float] = None
    stddev: Optional[float] = None
    distinct_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "min": self.min,
            "max": self.max,
            "median": self.median,
            "mean": self.mean,
            "stddev": self.stddev,
            "distinct_count": self.distinct_count,
        }


@dataclass
class ValueFrequency:
    """A value and its frequency.

    Attributes:
        value: The value
        frequency: Occurrence count
    """

    value: str
    frequency: int

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "value": self.value,
            "frequency": self.frequency,
        }


@dataclass
class CategoricalStats:
    """Statistics for categorical columns.

    Attributes:
        unique_count: Number of unique values
        top_values: Most frequent values with counts
        avg_length: Average string length
    """

    unique_count: int
    top_values: List[ValueFrequency] = field(default_factory=list)
    avg_length: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "unique_count": self.unique_count,
            "top_values": [v.to_dict() for v in self.top_values],
            "avg_length": self.avg_length,
        }


@dataclass
class DateStats:
    """Statistics for date/timestamp columns.

    Attributes:
        min_date: Earliest date (ISO format)
        max_date: Latest date (ISO format)
        span_days: Number of days between min and max
        distinct_days: Number of distinct dates
    """

    min_date: Optional[str] = None
    max_date: Optional[str] = None
    span_days: Optional[int] = None
    distinct_days: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "min_date": self.min_date,
            "max_date": self.max_date,
            "span_days": self.span_days,
            "distinct_days": self.distinct_days,
        }


@dataclass
class ColumnStatistics:
    """Statistics for a single column.

    Attributes:
        column_name: Name of the column
        column_type: DuckDB data type
        semantic_type: Semantic type (numeric, categorical, date, text)
        null_count: Number of NULL values
        null_percentage: Percentage of NULL values
        numeric_stats: Statistics if numeric column
        categorical_stats: Statistics if categorical column
        date_stats: Statistics if date column
    """

    column_name: str
    column_type: str
    semantic_type: str  # 'numeric' | 'categorical' | 'date' | 'text'
    null_count: int
    null_percentage: float
    numeric_stats: Optional[NumericStats] = None
    categorical_stats: Optional[CategoricalStats] = None
    date_stats: Optional[DateStats] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "column_name": self.column_name,
            "column_type": self.column_type,
            "semantic_type": self.semantic_type,
            "null_count": self.null_count,
            "null_percentage": self.null_percentage,
            "numeric_stats": self.numeric_stats.to_dict() if self.numeric_stats else None,
            "categorical_stats": self.categorical_stats.to_dict() if self.categorical_stats else None,
            "date_stats": self.date_stats.to_dict() if self.date_stats else None,
        }


@dataclass
class PotentialItem:
    """A potential analysis question and answer pair.

    Attributes:
        question: Analysis question that can be answered with this data
        analysis: Brief description of how to perform the analysis
    """

    question: str
    analysis: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "question": self.question,
            "analysis": self.analysis,
        }


@dataclass
class IssueItem:
    """A data quality issue and suggested fix.

    Attributes:
        issue: Description of the data quality issue
        issue_type: Category of the issue (e.g., Validity, Completeness)
        suggestion: Suggested fix or improvement
        example: Example values showing the issue (optional)
    """

    issue: str
    issue_type: str
    suggestion: str
    example: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "issue": self.issue,
            "issue_type": self.issue_type,
            "suggestion": self.suggestion,
        }
        if self.example is not None:
            result["example"] = self.example
        return result


@dataclass
class LLMAnalysisResult:
    """LLM-generated analysis of a dataset.

    Attributes:
        suggested_name: Suggested dataset name
        context: Context description (2-3 sentences)
        potential: List of potential analysis questions (3-5 items)
        issues: List of data quality issues (0 or more items)
        analyzed_at: Timestamp of analysis
        model_used: LLM model identifier used for analysis
    """

    suggested_name: str
    context: str
    potential: List[PotentialItem]
    issues: List[IssueItem]
    analyzed_at: datetime
    model_used: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "suggested_name": self.suggested_name,
            "context": self.context,
            "potential": [p.to_dict() for p in self.potential],
            "issues": [i.to_dict() for i in self.issues],
            "analyzed_at": self.analyzed_at.isoformat() if self.analyzed_at else None,
            "model_used": self.model_used,
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
        encoding: Detected file encoding (CSV only)
        parsing_integrity: Parsing integrity check result (CSV only)
        column_statistics: Per-column statistics
        sample_rows: Sample data rows (up to 5)
        llm_analysis: LLM-generated analysis result (optional)
        diagnosis_id: Unique ID of this diagnosis (set after save)
    """

    file_path: str
    file_type: Literal["csv", "parquet"]
    schema: List[ColumnSchema]
    missing_values: Dict[str, int]
    row_count: int
    file_size_bytes: int
    type_suggestions: List[TypeSuggestion] = field(default_factory=list)
    diagnosed_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    # New optional fields for extended diagnosis
    encoding: Optional[EncodingInfo] = None
    parsing_integrity: Optional[ParsingIntegrity] = None
    column_statistics: List[ColumnStatistics] = field(default_factory=list)
    sample_rows: List[List[Any]] = field(default_factory=list)
    # LLM analysis result
    llm_analysis: Optional[LLMAnalysisResult] = None
    # Diagnosis ID (set after save to cache)
    diagnosis_id: Optional[str] = None

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
            "encoding": self.encoding.to_dict() if self.encoding else None,
            "parsing_integrity": self.parsing_integrity.to_dict() if self.parsing_integrity else None,
            "column_statistics": [cs.to_dict() for cs in self.column_statistics],
            "sample_rows": self.sample_rows,
            "llm_analysis": self.llm_analysis.to_dict() if self.llm_analysis else None,
            "diagnosis_id": self.diagnosis_id,
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


@dataclass
class MergedAnalysis:
    """Merged dataset analysis from LLM.

    Attributes:
        suggested_name: Suggested name for merged dataset
        context: Description of merged dataset
    """

    suggested_name: str
    context: str


@dataclass
class DiagnosisWithMergedAnalysis:
    """Result of file diagnosis with optional merged analysis.

    Attributes:
        diagnoses: List of per-file diagnoses
        merged_analysis: Merged dataset analysis (when merge_context provided)
    """

    diagnoses: List[FileDiagnosis]
    merged_analysis: Optional[MergedAnalysis] = None


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

    # Type classification constants
    NUMERIC_TYPES = {'BIGINT', 'INTEGER', 'SMALLINT', 'TINYINT', 'DOUBLE', 'FLOAT', 'DECIMAL', 'REAL', 'HUGEINT', 'UBIGINT', 'UINTEGER', 'USMALLINT', 'UTINYINT'}
    DATE_TYPES = {'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIMESTAMP WITH TIME ZONE', 'TIME', 'INTERVAL'}
    STRING_TYPES = {'VARCHAR', 'TEXT', 'STRING', 'CHAR', 'BLOB'}

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
        self._llm_state_lock = threading.Lock()
        self._llm_inflight_keys: set[str] = set()
        self._llm_merged_cache: Dict[str, MergedAnalysis] = {}
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
                    parsing_integrity TEXT,
                    row_count BIGINT,
                    column_count INTEGER,
                    file_size_bytes BIGINT,
                    diagnosed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    llm_analysis TEXT
                )
            """)
            # Add llm_analysis column if it doesn't exist (for existing tables)
            try:
                conn.execute(f"""
                    ALTER TABLE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                    ADD COLUMN IF NOT EXISTS llm_analysis TEXT
                """)
            except Exception:
                # Column might already exist or ALTER not supported
                pass
            try:
                conn.execute(f"""
                    ALTER TABLE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                    ADD COLUMN IF NOT EXISTS parsing_integrity TEXT
                """)
            except Exception:
                # Column might already exist or ALTER not supported
                pass

    @contextmanager
    def _get_connection(self):
        """Get a DuckDB connection (serialized for stability)."""
        with connect_warehouse(self.warehouse_path) as conn:
            yield conn

    def _detect_encoding(self, file_path: str, sample_size: int = 10000) -> EncodingInfo:
        """Detect file encoding using chardet.

        Args:
            file_path: Path to the file
            sample_size: Number of bytes to sample (default 10000)

        Returns:
            EncodingInfo with detected encoding and confidence
        """
        # Encoding name mapping for DuckDB compatibility
        encoding_map = {
            'euc-kr': 'EUC-KR',
            'euc_kr': 'EUC-KR',
            'cp949': 'CP949',
            'utf-8': 'UTF-8',
            'utf-8-sig': 'UTF-8',
            'ascii': 'UTF-8',  # ASCII is subset of UTF-8
            'iso-8859-1': 'LATIN1',
            'latin-1': 'LATIN1',
            'windows-1252': 'LATIN1',
            'gb2312': 'GB2312',
            'gbk': 'GBK',
            'big5': 'BIG5',
            'shift_jis': 'SHIFT_JIS',
            'shift-jis': 'SHIFT_JIS',
        }

        try:
            with open(file_path, 'rb') as f:
                raw_data = f.read(sample_size)

            result = chardet.detect(raw_data)
            detected = result.get('encoding', 'UTF-8') or 'UTF-8'
            confidence = result.get('confidence', 0.0) or 0.0

            # Normalize encoding name
            detected_lower = detected.lower()
            normalized = encoding_map.get(detected_lower, detected.upper())

            return EncodingInfo(
                detected=normalized,
                confidence=round(confidence, 2),
            )
        except Exception:
            # Default to UTF-8 on error
            return EncodingInfo(detected='UTF-8', confidence=0.0)

    def _build_read_expr(
        self,
        file_path: str,
        file_type: str,
        encoding: Optional[str] = None,
        ignore_errors: bool = False,
    ) -> str:
        """Build DuckDB read expression for file.

        Args:
            file_path: Path to the file
            file_type: Type of file (csv, parquet)
            encoding: File encoding for CSV (e.g., 'UTF-8', 'CP949')
            ignore_errors: If True, skip malformed rows (CSV only)

        Returns:
            DuckDB expression to read the file
        """
        safe_path = file_path.replace("'", "''")
        if file_type == "csv":
            options = ["auto_detect=true"]
            if encoding and encoding != 'UTF-8':
                # DuckDB uses 'encoding' option for non-UTF-8 files
                options.append(f"encoding='{encoding}'")
            if ignore_errors:
                options.append("ignore_errors=true")
            return f"read_csv('{safe_path}', {', '.join(options)})"
        elif file_type == "parquet":
            return f"read_parquet('{safe_path}')"
        else:
            raise DiagnosisError(f"Unsupported file type: {file_type}")

    def _check_parsing_integrity(
        self,
        conn: duckdb.DuckDBPyConnection,
        file_path: str,
        encoding: Optional[str] = None,
    ) -> ParsingIntegrity:
        """Check CSV parsing integrity by comparing strict vs lenient parsing.

        Args:
            conn: DuckDB connection
            file_path: Path to the CSV file
            encoding: Detected file encoding

        Returns:
            ParsingIntegrity with parsing results
        """
        # Count raw lines in file (excluding header)
        try:
            with open(file_path, 'rb') as f:
                total_lines = sum(1 for _ in f)
            # Subtract 1 for header row
            total_lines = max(0, total_lines - 1)
        except Exception:
            total_lines = 0

        error_message: Optional[str] = None

        # Try strict parsing first
        try:
            strict_expr = self._build_read_expr(file_path, "csv", encoding, ignore_errors=False)
            result = conn.execute(f"SELECT COUNT(*) FROM {strict_expr}").fetchone()
            parsed_rows = result[0] if result else 0

            # If strict parsing succeeds, no errors
            return ParsingIntegrity(
                total_lines=total_lines,
                parsed_rows=parsed_rows,
                malformed_rows=0,
                has_errors=False,
                error_message=None,
            )
        except duckdb.Error as e:
            # Strict parsing failed, capture error
            error_message = str(e)

        # Try lenient parsing to get successful row count
        try:
            lenient_expr = self._build_read_expr(file_path, "csv", encoding, ignore_errors=True)
            result = conn.execute(f"SELECT COUNT(*) FROM {lenient_expr}").fetchone()
            parsed_rows = result[0] if result else 0

            # Calculate malformed rows
            malformed_rows = max(0, total_lines - parsed_rows)

            return ParsingIntegrity(
                total_lines=total_lines,
                parsed_rows=parsed_rows,
                malformed_rows=malformed_rows,
                has_errors=True,
                error_message=error_message,
            )
        except duckdb.Error as e:
            # Even lenient parsing failed
            return ParsingIntegrity(
                total_lines=total_lines,
                parsed_rows=0,
                malformed_rows=total_lines,
                has_errors=True,
                error_message=str(e),
            )

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

    def _compute_numeric_stats(
        self,
        conn: duckdb.DuckDBPyConnection,
        read_expr: str,
        column_name: str,
    ) -> NumericStats:
        """Compute statistics for a numeric column.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file
            column_name: Name of the column

        Returns:
            NumericStats with min, max, median, mean, stddev, distinct_count
        """
        safe_col = f'"{column_name}"'
        try:
            result = conn.execute(f"""
                SELECT
                    MIN({safe_col}),
                    MAX({safe_col}),
                    MEDIAN({safe_col}),
                    AVG({safe_col}),
                    STDDEV({safe_col}),
                    COUNT(DISTINCT {safe_col})
                FROM {read_expr}
                WHERE {safe_col} IS NOT NULL
            """).fetchone()

            if result:
                return NumericStats(
                    min=float(result[0]) if result[0] is not None else None,
                    max=float(result[1]) if result[1] is not None else None,
                    median=float(result[2]) if result[2] is not None else None,
                    mean=float(result[3]) if result[3] is not None else None,
                    stddev=float(result[4]) if result[4] is not None else None,
                    distinct_count=int(result[5]) if result[5] is not None else 0,
                )
        except duckdb.Error:
            pass

        return NumericStats(distinct_count=0)

    def _compute_categorical_stats(
        self,
        conn: duckdb.DuckDBPyConnection,
        read_expr: str,
        column_name: str,
        top_n: int = 5,
    ) -> CategoricalStats:
        """Compute statistics for a categorical column.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file
            column_name: Name of the column
            top_n: Number of top values to return (default 5)

        Returns:
            CategoricalStats with unique_count, top_values, avg_length
        """
        safe_col = f'"{column_name}"'
        try:
            # Get unique count and average length
            stats_result = conn.execute(f"""
                SELECT
                    COUNT(DISTINCT {safe_col}),
                    AVG(LENGTH(CAST({safe_col} AS VARCHAR)))
                FROM {read_expr}
                WHERE {safe_col} IS NOT NULL
            """).fetchone()

            unique_count = int(stats_result[0]) if stats_result and stats_result[0] else 0
            avg_length = float(stats_result[1]) if stats_result and stats_result[1] else 0.0

            # Get top values
            top_result = conn.execute(f"""
                SELECT
                    CAST({safe_col} AS VARCHAR) as value,
                    COUNT(*) as frequency
                FROM {read_expr}
                WHERE {safe_col} IS NOT NULL
                GROUP BY {safe_col}
                ORDER BY frequency DESC
                LIMIT {top_n}
            """).fetchall()

            top_values = [
                ValueFrequency(value=str(row[0]), frequency=int(row[1]))
                for row in top_result
            ]

            return CategoricalStats(
                unique_count=unique_count,
                top_values=top_values,
                avg_length=round(avg_length, 2),
            )
        except duckdb.Error:
            pass

        return CategoricalStats(unique_count=0)

    def _compute_date_stats(
        self,
        conn: duckdb.DuckDBPyConnection,
        read_expr: str,
        column_name: str,
    ) -> DateStats:
        """Compute statistics for a date/timestamp column.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file
            column_name: Name of the column

        Returns:
            DateStats with min_date, max_date, span_days, distinct_days
        """
        safe_col = f'"{column_name}"'
        try:
            result = conn.execute(f"""
                SELECT
                    MIN({safe_col}),
                    MAX({safe_col}),
                    COUNT(DISTINCT CAST({safe_col} AS DATE))
                FROM {read_expr}
                WHERE {safe_col} IS NOT NULL
            """).fetchone()

            if result and result[0] is not None:
                min_date = result[0]
                max_date = result[1]
                distinct_days = int(result[2]) if result[2] else 0

                # Calculate span in days
                try:
                    span_result = conn.execute(f"""
                        SELECT DATE_DIFF('day', MIN({safe_col}), MAX({safe_col}))
                        FROM {read_expr}
                        WHERE {safe_col} IS NOT NULL
                    """).fetchone()
                    span_days = int(span_result[0]) if span_result and span_result[0] else 0
                except duckdb.Error:
                    span_days = 0

                # Format dates as ISO strings
                min_date_str = str(min_date)[:10] if min_date else None
                max_date_str = str(max_date)[:10] if max_date else None

                return DateStats(
                    min_date=min_date_str,
                    max_date=max_date_str,
                    span_days=span_days,
                    distinct_days=distinct_days,
                )
        except duckdb.Error:
            pass

        return DateStats(distinct_days=0)

    def _is_categorical(
        self,
        unique_count: int,
        non_null_count: int,
    ) -> bool:
        """Determine if a string column should be classified as categorical.

        Uses heuristics based on unique value ratio:
        - If unique_count <= 20, treat as categorical
        - If unique_count >= 1000, treat as text
        - Otherwise, if unique ratio <= 5%, treat as categorical

        Args:
            unique_count: Number of unique values
            non_null_count: Number of non-null values

        Returns:
            True if column should be treated as categorical
        """
        if unique_count <= 20:
            return True
        if unique_count >= 1000:
            return False
        if non_null_count == 0:
            return False

        unique_ratio = unique_count / non_null_count
        return unique_ratio <= 0.05

    def _compute_column_statistics(
        self,
        conn: duckdb.DuckDBPyConnection,
        read_expr: str,
        schema: List[ColumnSchema],
        missing_values: Dict[str, int],
        row_count: int,
    ) -> List[ColumnStatistics]:
        """Compute statistics for all columns.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file
            schema: List of column schemas
            missing_values: Dict mapping column name to NULL count
            row_count: Total number of rows

        Returns:
            List of ColumnStatistics for each column
        """
        statistics: List[ColumnStatistics] = []

        for col in schema:
            null_count = missing_values.get(col.name, 0)
            null_percentage = (null_count / row_count * 100) if row_count > 0 else 0.0
            non_null_count = row_count - null_count

            # Determine column type and compute appropriate statistics
            col_type_upper = col.type.upper()
            # Handle parameterized types like DECIMAL(18,2)
            base_type = col_type_upper.split('(')[0]

            numeric_stats: Optional[NumericStats] = None
            categorical_stats: Optional[CategoricalStats] = None
            date_stats: Optional[DateStats] = None
            semantic_type: str

            if base_type in self.NUMERIC_TYPES:
                semantic_type = 'numeric'
                numeric_stats = self._compute_numeric_stats(conn, read_expr, col.name)
            elif base_type in self.DATE_TYPES:
                semantic_type = 'date'
                date_stats = self._compute_date_stats(conn, read_expr, col.name)
            elif base_type in self.STRING_TYPES:
                # Determine if categorical or text
                cat_stats = self._compute_categorical_stats(conn, read_expr, col.name)
                if self._is_categorical(cat_stats.unique_count, non_null_count):
                    semantic_type = 'categorical'
                    categorical_stats = cat_stats
                else:
                    semantic_type = 'text'
                    categorical_stats = cat_stats  # Still include stats for text
            else:
                # Unknown type, try to get basic stats
                semantic_type = 'unknown'

            statistics.append(ColumnStatistics(
                column_name=col.name,
                column_type=col.type,
                semantic_type=semantic_type,
                null_count=null_count,
                null_percentage=round(null_percentage, 2),
                numeric_stats=numeric_stats,
                categorical_stats=categorical_stats,
                date_stats=date_stats,
            ))

        return statistics

    def _get_sample_rows(
        self,
        conn: duckdb.DuckDBPyConnection,
        read_expr: str,
        limit: int = 5,
    ) -> List[List[Any]]:
        """Get sample rows from the file.

        Args:
            conn: DuckDB connection
            read_expr: Read expression for the file
            limit: Maximum number of rows to return (default 5)

        Returns:
            List of rows, each row is a list of values
        """
        try:
            result = conn.execute(f"SELECT * FROM {read_expr} LIMIT {limit}").fetchall()
            # Convert tuples to lists and handle special types
            sample_rows: List[List[Any]] = []
            for row in result:
                converted_row: List[Any] = []
                for val in row:
                    if val is None:
                        converted_row.append(None)
                    elif hasattr(val, 'isoformat'):
                        # Handle datetime objects
                        converted_row.append(val.isoformat())
                    else:
                        converted_row.append(val)
                sample_rows.append(converted_row)
            return sample_rows
        except duckdb.Error:
            return []

    def _log_diagnosis_result(self, diagnosis: FileDiagnosis) -> None:
        """Log detailed diagnosis result for debugging and verification.

        Args:
            diagnosis: FileDiagnosis result to log
        """
        # Format file size
        size_kb = diagnosis.file_size_bytes / 1024
        if size_kb >= 1024:
            size_str = f"{size_kb / 1024:.1f} MB"
        else:
            size_str = f"{size_kb:.1f} KB"

        lines = [
            "",
            "[FileDiagnosis] ========================================",
            f"File: {diagnosis.file_path}",
            f"Type: {diagnosis.file_type} | Rows: {diagnosis.row_count:,} | Size: {size_str}",
            "",
        ]

        # Encoding info (CSV only)
        if diagnosis.encoding:
            lines.append(f"Encoding: {diagnosis.encoding.detected} (confidence: {diagnosis.encoding.confidence})")

        # Parsing integrity (CSV only)
        if diagnosis.parsing_integrity:
            pi = diagnosis.parsing_integrity
            if pi.has_errors:
                lines.append(f"Parsing: ERROR ({pi.malformed_rows} malformed rows)")
                if pi.error_message:
                    # Truncate long error messages
                    error_msg = pi.error_message[:100] + "..." if len(pi.error_message) > 100 else pi.error_message
                    lines.append(f"  Error: {error_msg}")
            else:
                lines.append("Parsing: OK (0 malformed rows)")

        lines.append("")

        # Schema
        lines.append("Schema:")
        for col in diagnosis.schema:
            null_count = diagnosis.missing_values.get(col.name, 0)
            null_pct = (null_count / diagnosis.row_count * 100) if diagnosis.row_count > 0 else 0
            lines.append(f"  - {col.name} ({col.type}) | NULL: {null_count:,} ({null_pct:.1f}%)")

        # Type suggestions
        if diagnosis.type_suggestions:
            lines.append("")
            lines.append("Type Suggestions:")
            for ts in diagnosis.type_suggestions:
                lines.append(f"  - {ts.column_name}: {ts.current_type} → {ts.suggested_type} (confidence: {ts.confidence}%)")

        # Column statistics
        if diagnosis.column_statistics:
            lines.append("")
            lines.append("Column Statistics:")
            for cs in diagnosis.column_statistics:
                if cs.semantic_type == 'numeric' and cs.numeric_stats:
                    ns = cs.numeric_stats
                    lines.append(f"  [numeric] {cs.column_name}: min={ns.min}, max={ns.max}, median={ns.median}")
                elif cs.semantic_type == 'categorical' and cs.categorical_stats:
                    cat = cs.categorical_stats
                    top_vals_str = ", ".join([f"'{v.value}' ({v.frequency})" for v in cat.top_values[:3]])
                    lines.append(f"  [categorical] {cs.column_name}: unique={cat.unique_count}, top=[{top_vals_str}]")
                elif cs.semantic_type == 'date' and cs.date_stats:
                    ds = cs.date_stats
                    lines.append(f"  [date] {cs.column_name}: {ds.min_date} ~ {ds.max_date} ({ds.span_days} days)")
                elif cs.semantic_type == 'text' and cs.categorical_stats:
                    cat = cs.categorical_stats
                    lines.append(f"  [text] {cs.column_name}: unique={cat.unique_count}, avg_length={cat.avg_length}")

        lines.append("========================================")

        # Log all lines
        logger.info("\n".join(lines))

    def diagnose_file(
        self,
        file_path: str,
        file_type: Literal["csv", "parquet"],
        compute_statistics: bool = True,
    ) -> FileDiagnosis:
        """Diagnose a single file.

        Args:
            file_path: Path to the file to diagnose
            file_type: Type of file (csv or parquet)
            compute_statistics: Whether to compute column statistics (default True)

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

        # Detect encoding for CSV files
        encoding_info: Optional[EncodingInfo] = None
        detected_encoding: Optional[str] = None
        if file_type == "csv":
            encoding_info = self._detect_encoding(file_path)
            detected_encoding = encoding_info.detected

        # Build read expression with encoding
        read_expr = self._build_read_expr(file_path, file_type, encoding=detected_encoding)

        # Initialize optional fields
        parsing_integrity: Optional[ParsingIntegrity] = None
        column_statistics: List[ColumnStatistics] = []
        sample_rows: List[List[Any]] = []

        with self._get_connection() as conn:
            try:
                # Check parsing integrity for CSV files
                if file_type == "csv":
                    parsing_integrity = self._check_parsing_integrity(
                        conn, file_path, detected_encoding
                    )

                # Extract schema
                schema = self._extract_schema(conn, read_expr)

                # Count missing values
                missing_values = self._count_missing_values(conn, read_expr, schema)

                # Get row count
                row_count = self._get_row_count(conn, read_expr)

                # Analyze type suggestions for VARCHAR columns
                type_suggestions = self._analyze_type_suggestions(conn, read_expr, schema)

                # Compute column statistics if requested
                if compute_statistics:
                    column_statistics = self._compute_column_statistics(
                        conn, read_expr, schema, missing_values, row_count
                    )

                # Get sample rows
                sample_rows = self._get_sample_rows(conn, read_expr)

            except duckdb.Error as e:
                raise DiagnosisError(f"Failed to diagnose file: {e}")

        diagnosis = FileDiagnosis(
            file_path=file_path,
            file_type=file_type,
            schema=schema,
            missing_values=missing_values,
            row_count=row_count,
            file_size_bytes=file_size_bytes,
            type_suggestions=type_suggestions,
            diagnosed_at=datetime.now(UTC),
            encoding=encoding_info,
            parsing_integrity=parsing_integrity,
            column_statistics=column_statistics,
            sample_rows=sample_rows,
        )

        # Log diagnosis result for debugging/verification
        self._log_diagnosis_result(diagnosis)

        return diagnosis

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

    async def diagnose_files_with_llm(
        self,
        files: List[DiagnoseFileRequest],
        use_cache: bool = True,
        merge_context: Optional[Dict[str, Any]] = None,
    ) -> DiagnosisWithMergedAnalysis:
        """Diagnose multiple files with LLM analysis.

        This async method:
        1. Performs technical diagnosis for each file (cache-aware)
        2. Runs LLM analysis on files that needed fresh diagnosis
        3. Merges LLM results and updates cache
        4. If merge_context provided, includes merged dataset analysis

        Args:
            files: List of files to diagnose
            use_cache: Whether to use cached results (default True)
            merge_context: Optional dict with merge context for identical schema files
                - total_rows: Total rows across all files
                - duplicate_rows: Number of duplicate rows
                - estimated_rows: Estimated rows after deduplication
                - skipped: Whether duplicate calculation was skipped

        Returns:
            DiagnosisWithMergedAnalysis containing diagnoses and optional merged analysis
        """
        from .llm_analysis_service import (
            analyze_datasets_with_llm,
            MergeContext as LLMMergeContext,
        )

        diagnoses: List[FileDiagnosis] = []
        new_diagnoses: List[FileDiagnosis] = []  # Diagnoses that need LLM analysis

        # Step 1: Technical diagnosis (cache-aware)
        for file_req in files:
            diagnosis = None

            # Try cache if enabled
            if use_cache:
                diagnosis = self.get_cached_diagnosis(file_req.file_path)
                # If cached but no LLM analysis, treat as needing analysis
                if diagnosis and diagnosis.llm_analysis is None:
                    new_diagnoses.append(diagnosis)

            # Fresh diagnosis if not cached
            if diagnosis is None:
                diagnosis = self.diagnose_file(file_req.file_path, file_req.file_type)
                new_diagnoses.append(diagnosis)

            diagnoses.append(diagnosis)

        # Prepare merge context for LLM if provided
        llm_merge_context: Optional[LLMMergeContext] = None
        if merge_context is not None:
            llm_merge_context = LLMMergeContext(
                schemas_identical=True,  # API only sends merge_context when schemas match
                total_files=len(files),
                total_rows=merge_context.get("total_rows", 0),
                duplicate_rows=merge_context.get("duplicate_rows", 0),
                estimated_rows_after_dedup=merge_context.get("estimated_rows", 0),
                skipped=merge_context.get("skipped", False),
            )

        merged_analysis: Optional[MergedAnalysis] = None

        # Step 2: Run LLM analysis on new diagnoses
        if new_diagnoses:
            logger.info(f"Running LLM analysis on {len(new_diagnoses)} files (merge_context={llm_merge_context is not None})")
            try:
                batch_result = await analyze_datasets_with_llm(
                    new_diagnoses,
                    merge_context=llm_merge_context,
                )

                # Merge LLM results into diagnoses
                for diagnosis in new_diagnoses:
                    if diagnosis.file_path in batch_result.file_results:
                        diagnosis.llm_analysis = batch_result.file_results[diagnosis.file_path]
                        logger.info(f"LLM analysis added for {diagnosis.file_path}")

                    # Save updated diagnosis to cache
                    saved_id = self.save_diagnosis(diagnosis)
                    logger.info(f"[diagnose_files_with_llm] Saved diagnosis: file={diagnosis.file_path}, diagnosis_id={saved_id}")

                # Extract merged analysis if present
                if batch_result.merged_result is not None:
                    merged_analysis = MergedAnalysis(
                        suggested_name=batch_result.merged_result.suggested_name,
                        context=batch_result.merged_result.context,
                    )
                    logger.info(f"Merged analysis: {merged_analysis.suggested_name}")

            except Exception as e:
                logger.error(f"LLM analysis failed: {e}")
                # Still save diagnoses without LLM analysis
                for diagnosis in new_diagnoses:
                    if diagnosis.llm_analysis is None:
                        self.save_diagnosis(diagnosis)

        return DiagnosisWithMergedAnalysis(
            diagnoses=diagnoses,
            merged_analysis=merged_analysis,
        )

    # =========================================================================
    # Duplicate Counting Methods
    # =========================================================================

    def count_cross_file_duplicates(
        self,
        files: List[DiagnoseFileRequest],
        row_limit: int = 100000,
    ) -> Dict[str, Any]:
        """Count duplicate rows across multiple files.

        This method calculates cross-file duplicates by:
        1. Summing row counts from each file
        2. If total exceeds row_limit, return skipped=True
        3. Using UNION ALL + COUNT(DISTINCT *) to find unique rows
        4. Calculating duplicates = total - unique

        Args:
            files: List of files to check for duplicates
            row_limit: Maximum total rows before skipping calculation (default 100,000)

        Returns:
            Dict with keys:
                - total_rows: Total row count across all files
                - duplicate_rows: Number of duplicate rows
                - estimated_rows: Rows after deduplication (total - duplicates)
                - skipped: True if row_limit exceeded
        """
        if not files:
            return {
                "total_rows": 0,
                "duplicate_rows": 0,
                "estimated_rows": 0,
                "skipped": False,
            }

        with self._get_connection() as conn:
            # Step 1: Calculate total row count
            total_rows = 0
            read_exprs: List[str] = []

            for file_req in files:
                # Detect encoding for CSV files
                encoding: Optional[str] = None
                if file_req.file_type == "csv":
                    encoding_info = self._detect_encoding(file_req.file_path)
                    encoding = encoding_info.detected

                read_expr = self._build_read_expr(
                    file_req.file_path,
                    file_req.file_type,
                    encoding=encoding,
                )
                read_exprs.append(read_expr)

                # Get row count for this file
                try:
                    result = conn.execute(f"SELECT COUNT(*) FROM {read_expr}").fetchone()
                    total_rows += result[0] if result else 0
                except duckdb.Error as e:
                    logger.warning(f"Failed to count rows for {file_req.file_path}: {e}")
                    continue

            # Step 2: Check row limit
            if total_rows > row_limit:
                logger.info(f"Row limit exceeded ({total_rows} > {row_limit}), skipping duplicate calculation")
                return {
                    "total_rows": total_rows,
                    "duplicate_rows": 0,
                    "estimated_rows": total_rows,
                    "skipped": True,
                }

            # Step 3: Count unique rows using UNION ALL + DISTINCT
            if len(read_exprs) == 0:
                return {
                    "total_rows": 0,
                    "duplicate_rows": 0,
                    "estimated_rows": 0,
                    "skipped": False,
                }

            # Build UNION ALL query
            union_query = " UNION ALL ".join([f"SELECT * FROM {expr}" for expr in read_exprs])

            try:
                # Count distinct rows
                # Using a subquery with DISTINCT to count unique rows
                unique_count_query = f"""
                    SELECT COUNT(*) FROM (
                        SELECT DISTINCT * FROM ({union_query})
                    )
                """
                result = conn.execute(unique_count_query).fetchone()
                unique_rows = result[0] if result else 0

                # Step 4: Calculate duplicates
                duplicate_rows = total_rows - unique_rows
                estimated_rows = unique_rows

                logger.info(
                    f"Duplicate count complete: total={total_rows}, unique={unique_rows}, "
                    f"duplicates={duplicate_rows}"
                )

                return {
                    "total_rows": total_rows,
                    "duplicate_rows": duplicate_rows,
                    "estimated_rows": estimated_rows,
                    "skipped": False,
                }
            except duckdb.Error as e:
                logger.error(f"Failed to count unique rows: {e}")
                # Return total rows with no duplicates on error
                return {
                    "total_rows": total_rows,
                    "duplicate_rows": 0,
                    "estimated_rows": total_rows,
                    "skipped": False,
                }

    # =========================================================================
    # Caching Methods
    # =========================================================================

    def save_diagnosis(self, diagnosis: FileDiagnosis) -> str:
        """Save a diagnosis result to the cache.

        Args:
            diagnosis: FileDiagnosis to save

        Returns:
            ID of the saved diagnosis record

        Note:
            Also sets diagnosis.diagnosis_id to the generated ID
        """
        diagnosis_id = f"diag_{uuid.uuid4().hex[:12]}"
        logger.info(f"[save_diagnosis] Generated diagnosis_id={diagnosis_id} for file={diagnosis.file_path}")

        # Serialize complex fields to JSON
        schema_json = json.dumps([col.to_dict() for col in diagnosis.schema])
        missing_values_json = json.dumps(diagnosis.missing_values)
        type_suggestions_json = json.dumps([ts.to_dict() for ts in diagnosis.type_suggestions])
        parsing_integrity_json = (
            json.dumps(diagnosis.parsing_integrity.to_dict())
            if diagnosis.parsing_integrity
            else None
        )
        llm_analysis_json = json.dumps(diagnosis.llm_analysis.to_dict()) if diagnosis.llm_analysis else None
        logger.info(f"[save_diagnosis] llm_analysis present: {diagnosis.llm_analysis is not None}")

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
                 type_suggestions, parsing_integrity, row_count, column_count,
                 file_size_bytes, diagnosed_at, llm_analysis)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                diagnosis_id,
                self.project_id,
                diagnosis.file_path,
                diagnosis.file_type,
                schema_json,
                missing_values_json,
                type_suggestions_json,
                parsing_integrity_json,
                diagnosis.row_count,
                len(diagnosis.schema),
                diagnosis.file_size_bytes,
                diagnosis.diagnosed_at,
                llm_analysis_json,
            ])
            logger.info(f"[save_diagnosis] Diagnosis saved to DB: diagnosis_id={diagnosis_id}")

        # Set the diagnosis_id on the diagnosis object
        diagnosis.diagnosis_id = diagnosis_id

        return diagnosis_id

    def update_llm_analysis(self, diagnosis_id: str, llm_analysis: Optional[LLMAnalysisResult]) -> bool:
        """Update only the llm_analysis field for an existing diagnosis."""
        llm_analysis_json = json.dumps(llm_analysis.to_dict()) if llm_analysis else None
        with self._get_connection() as conn:
            conn.execute(
                f"""
                UPDATE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                SET llm_analysis = ?
                WHERE id = ? AND project_id = ?
                """,
                [llm_analysis_json, diagnosis_id, self.project_id],
            )
            result = conn.execute(
                f"""
                SELECT COUNT(*) FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE id = ? AND project_id = ?
                """,
                [diagnosis_id, self.project_id],
            ).fetchone()
        return bool(result and result[0])

    def update_quick_scan(self, diagnosis_id: str, diagnosis: FileDiagnosis) -> bool:
        """Update technical diagnosis fields without touching llm_analysis."""
        schema_json = json.dumps([col.to_dict() for col in diagnosis.schema])
        missing_values_json = json.dumps(diagnosis.missing_values)
        type_suggestions_json = json.dumps([ts.to_dict() for ts in diagnosis.type_suggestions])
        parsing_integrity_json = (
            json.dumps(diagnosis.parsing_integrity.to_dict())
            if diagnosis.parsing_integrity
            else None
        )
        with self._get_connection() as conn:
            conn.execute(
                f"""
                UPDATE {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                SET file_path = ?,
                    file_type = ?,
                    schema_info = ?,
                    missing_values = ?,
                    type_suggestions = ?,
                    parsing_integrity = ?,
                    row_count = ?,
                    column_count = ?,
                    file_size_bytes = ?,
                    diagnosed_at = ?
                WHERE id = ? AND project_id = ?
                """,
                [
                    diagnosis.file_path,
                    diagnosis.file_type,
                    schema_json,
                    missing_values_json,
                    type_suggestions_json,
                    parsing_integrity_json,
                    diagnosis.row_count,
                    len(diagnosis.schema),
                    diagnosis.file_size_bytes,
                    diagnosis.diagnosed_at,
                    diagnosis_id,
                    self.project_id,
                ],
            )
            result = conn.execute(
                f"""
                SELECT COUNT(*) FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE id = ? AND project_id = ?
                """,
                [diagnosis_id, self.project_id],
            ).fetchone()
        return bool(result and result[0])

    def get_diagnosis_by_id(self, diagnosis_id: str) -> Optional[FileDiagnosis]:
        """Get a diagnosis by its ID.

        Args:
            diagnosis_id: Diagnosis ID (e.g., 'diag_xxxxxxxxxxxx')

        Returns:
            FileDiagnosis if found, None otherwise
        """
        logger.info(f"[get_diagnosis_by_id] Looking up diagnosis_id={diagnosis_id}, project_id={self.project_id}")
        with self._get_connection() as conn:
            result = conn.execute(f"""
                SELECT file_path, file_type, schema_info, missing_values,
                       type_suggestions, parsing_integrity, row_count, file_size_bytes,
                       diagnosed_at, llm_analysis
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE id = ? AND project_id = ?
            """, [diagnosis_id, self.project_id]).fetchone()

            if not result:
                logger.warning(f"[get_diagnosis_by_id] Diagnosis NOT FOUND for id={diagnosis_id}")
                return None

            logger.info(f"[get_diagnosis_by_id] Diagnosis FOUND: file_path={result[0]}")

            # Deserialize JSON fields
            schema_data = json.loads(result[2]) if result[2] else []
            missing_values = json.loads(result[3]) if result[3] else {}
            type_suggestions_data = json.loads(result[4]) if result[4] else []
            parsing_integrity_data = json.loads(result[5]) if result[5] else None
            llm_analysis_data = json.loads(result[9]) if result[9] else None

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

            parsing_integrity = None
            if parsing_integrity_data:
                parsing_integrity = ParsingIntegrity(
                    total_lines=parsing_integrity_data.get("total_lines", 0),
                    parsed_rows=parsing_integrity_data.get("parsed_rows", 0),
                    malformed_rows=parsing_integrity_data.get("malformed_rows", 0),
                    has_errors=parsing_integrity_data.get("has_errors", False),
                    error_message=parsing_integrity_data.get("error_message"),
                )

            # Reconstruct LLM analysis if present
            llm_analysis: Optional[LLMAnalysisResult] = None
            if llm_analysis_data:
                llm_analysis = LLMAnalysisResult(
                    suggested_name=llm_analysis_data.get("suggested_name", ""),
                    context=llm_analysis_data.get("context", ""),
                    potential=[
                        PotentialItem(
                            question=p.get("question", ""),
                            analysis=p.get("analysis", ""),
                        )
                        for p in llm_analysis_data.get("potential", [])
                    ],
                    issues=[
                        IssueItem(
                            issue=i.get("issue", ""),
                            issue_type=i.get("issue_type", "general"),
                            suggestion=i.get("suggestion", ""),
                            example=i.get("example"),
                        )
                        for i in llm_analysis_data.get("issues", [])
                    ],
                    analyzed_at=datetime.fromisoformat(llm_analysis_data["analyzed_at"]) if llm_analysis_data.get("analyzed_at") else datetime.now(UTC),
                    model_used=llm_analysis_data.get("model_used", "unknown"),
                )

            return FileDiagnosis(
                file_path=result[0],
                file_type=result[1],
                schema=schema,
                missing_values=missing_values,
                row_count=result[6],
                file_size_bytes=result[7],
                type_suggestions=type_suggestions,
                parsing_integrity=parsing_integrity,
                diagnosed_at=result[8],
                llm_analysis=llm_analysis,
                diagnosis_id=diagnosis_id,
            )

    def get_cached_diagnosis(self, file_path: str) -> Optional[FileDiagnosis]:
        """Get a cached diagnosis result for a file.

        Args:
            file_path: Path to the file

        Returns:
            FileDiagnosis if cached, None otherwise
        """
        with self._get_connection() as conn:
            result = conn.execute(f"""
                SELECT id, file_path, file_type, schema_info, missing_values,
                       type_suggestions, parsing_integrity, row_count, file_size_bytes,
                       diagnosed_at, llm_analysis
                FROM {self.METADATA_SCHEMA}.{self.METADATA_TABLE}
                WHERE file_path = ? AND project_id = ?
            """, [file_path, self.project_id]).fetchone()

            if not result:
                return None

            # Deserialize JSON fields
            cached_diagnosis_id = result[0]
            schema_data = json.loads(result[3]) if result[3] else []
            missing_values = json.loads(result[4]) if result[4] else {}
            type_suggestions_data = json.loads(result[5]) if result[5] else []
            parsing_integrity_data = json.loads(result[6]) if result[6] else None
            llm_analysis_data = json.loads(result[10]) if result[10] else None

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

            parsing_integrity = None
            if parsing_integrity_data:
                parsing_integrity = ParsingIntegrity(
                    total_lines=parsing_integrity_data.get("total_lines", 0),
                    parsed_rows=parsing_integrity_data.get("parsed_rows", 0),
                    malformed_rows=parsing_integrity_data.get("malformed_rows", 0),
                    has_errors=parsing_integrity_data.get("has_errors", False),
                    error_message=parsing_integrity_data.get("error_message"),
                )

            # Reconstruct LLM analysis if present
            llm_analysis: Optional[LLMAnalysisResult] = None
            if llm_analysis_data:
                llm_analysis = LLMAnalysisResult(
                    suggested_name=llm_analysis_data.get("suggested_name", ""),
                    context=llm_analysis_data.get("context", ""),
                    potential=[
                        PotentialItem(
                            question=p.get("question", ""),
                            analysis=p.get("analysis", ""),
                        )
                        for p in llm_analysis_data.get("potential", [])
                    ],
                    issues=[
                        IssueItem(
                            issue=i.get("issue", ""),
                            issue_type=i.get("issue_type", "general"),
                            suggestion=i.get("suggestion", ""),
                            example=i.get("example"),
                        )
                        for i in llm_analysis_data.get("issues", [])
                    ],
                    analyzed_at=datetime.fromisoformat(llm_analysis_data["analyzed_at"]) if llm_analysis_data.get("analyzed_at") else datetime.now(UTC),
                    model_used=llm_analysis_data.get("model_used", "unknown"),
                )

            return FileDiagnosis(
                file_path=result[1],
                file_type=result[2],
                schema=schema,
                missing_values=missing_values,
                row_count=result[7],
                file_size_bytes=result[8],
                type_suggestions=type_suggestions,
                parsing_integrity=parsing_integrity,
                diagnosed_at=result[9],
                llm_analysis=llm_analysis,
                diagnosis_id=cached_diagnosis_id,
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

    # =========================================================================
    # LLM background coordination helpers
    # =========================================================================

    def build_llm_cache_key(
        self,
        files: List[DiagnoseFileRequest],
        merge_context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Build a stable key for LLM analysis caching/in-flight tracking."""
        payload = {
            "files": [
                {"path": f.file_path, "type": f.file_type} for f in files
            ],
            "merge_context": merge_context or {},
        }
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def is_llm_inflight(self, key: str) -> bool:
        """Return True if an LLM job is already running for this key."""
        with self._llm_state_lock:
            return key in self._llm_inflight_keys

    def mark_llm_inflight(self, key: str) -> bool:
        """Mark an LLM job as inflight. Returns True if newly marked."""
        with self._llm_state_lock:
            if key in self._llm_inflight_keys:
                return False
            self._llm_inflight_keys.add(key)
            return True

    def clear_llm_inflight(self, key: str) -> None:
        """Clear inflight marker for an LLM job."""
        with self._llm_state_lock:
            self._llm_inflight_keys.discard(key)

    def get_cached_merged_analysis(self, key: str) -> Optional[MergedAnalysis]:
        """Get cached merged analysis for an LLM job key."""
        with self._llm_state_lock:
            return self._llm_merged_cache.get(key)

    def set_cached_merged_analysis(self, key: str, merged: Optional[MergedAnalysis]) -> None:
        """Cache merged analysis for an LLM job key."""
        with self._llm_state_lock:
            if merged is None:
                self._llm_merged_cache.pop(key, None)
            else:
                self._llm_merged_cache[key] = merged

    def delete_all(self) -> int:
        """Delete all cached diagnoses for this project.

        Returns:
            Number of diagnoses removed (best effort).
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
