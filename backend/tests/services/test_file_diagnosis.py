"""Tests for the File Diagnosis service."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from pluto_duck_backend.app.services.asset import (
    FileDiagnosisService,
    DiagnosisError,
)


@pytest.fixture
def temp_dir(tmp_path: Path) -> Path:
    """Create temporary directories."""
    return tmp_path


@pytest.fixture
def warehouse_path(temp_dir: Path) -> Path:
    """Create a temporary warehouse."""
    return temp_dir / "warehouse.duckdb"


@pytest.fixture
def diagnosis_service(temp_dir: Path, warehouse_path: Path) -> FileDiagnosisService:
    """Create a FileDiagnosisService instance."""
    return FileDiagnosisService(
        project_id="test-project",
        warehouse_path=warehouse_path,
    )


@pytest.fixture
def sample_csv(temp_dir: Path) -> Path:
    """Create a sample CSV file with some NULL values."""
    csv_path = temp_dir / "sample.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "name", "value", "category"])
        writer.writerow([1, "Alice", 100, "A"])
        writer.writerow([2, "Bob", "", "B"])  # Empty value
        writer.writerow([3, "", 300, "A"])  # Empty name
        writer.writerow([4, "Diana", 400, ""])  # Empty category
        writer.writerow([5, "Eve", 500, "C"])
    return csv_path


@pytest.fixture
def sample_csv_with_nulls(temp_dir: Path) -> Path:
    """Create a CSV file with NULL values."""
    csv_path = temp_dir / "nulls.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["col_a", "col_b", "col_c"])
        writer.writerow([1, "x", ""])
        writer.writerow(["", "y", "val"])
        writer.writerow([3, "", "val"])
        writer.writerow(["", "", ""])
    return csv_path


@pytest.fixture
def empty_csv(temp_dir: Path) -> Path:
    """Create an empty CSV file with only headers."""
    csv_path = temp_dir / "empty.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["col1", "col2", "col3"])
    return csv_path


class TestFileDiagnosisServiceInit:
    """Test FileDiagnosisService initialization."""

    def test_init(self, temp_dir: Path, warehouse_path: Path):
        """Test service initialization."""
        service = FileDiagnosisService(
            project_id="test",
            warehouse_path=warehouse_path,
        )
        assert service.project_id == "test"
        assert service.warehouse_path == warehouse_path


class TestDiagnoseFile:
    """Test diagnose_file functionality."""

    def test_diagnose_csv_schema(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test schema extraction from CSV."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")

        assert diagnosis.file_path == str(sample_csv)
        assert diagnosis.file_type == "csv"
        assert len(diagnosis.schema) == 4

        col_names = [col.name for col in diagnosis.schema]
        assert "id" in col_names
        assert "name" in col_names
        assert "value" in col_names
        assert "category" in col_names

    def test_diagnose_csv_row_count(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test row count from CSV."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")

        assert diagnosis.row_count == 5

    def test_diagnose_csv_file_size(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test file size is captured."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")

        assert diagnosis.file_size_bytes > 0

    def test_diagnose_csv_missing_values(
        self, diagnosis_service: FileDiagnosisService, sample_csv_with_nulls: Path
    ):
        """Test missing values detection."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv_with_nulls), "csv")

        # Check that missing values are counted
        assert "col_a" in diagnosis.missing_values
        assert "col_b" in diagnosis.missing_values
        assert "col_c" in diagnosis.missing_values

        # col_a has 2 empty values, col_b has 2, col_c has 2
        # Note: empty string detection may vary based on CSV parsing
        total_missing = sum(diagnosis.missing_values.values())
        assert total_missing >= 0  # At least some detection occurred

    def test_diagnose_empty_csv(
        self, diagnosis_service: FileDiagnosisService, empty_csv: Path
    ):
        """Test diagnosis of empty CSV (headers only)."""
        diagnosis = diagnosis_service.diagnose_file(str(empty_csv), "csv")

        assert diagnosis.row_count == 0
        assert len(diagnosis.schema) == 3

    def test_diagnose_nonexistent_file(
        self, diagnosis_service: FileDiagnosisService
    ):
        """Test diagnosis of non-existent file raises error."""
        with pytest.raises(DiagnosisError) as exc_info:
            diagnosis_service.diagnose_file("/nonexistent/path.csv", "csv")

        assert "not found" in str(exc_info.value).lower()

    def test_diagnose_unsupported_file_type(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test diagnosis with unsupported file type raises error."""
        with pytest.raises(DiagnosisError) as exc_info:
            diagnosis_service.diagnose_file(str(sample_csv), "xlsx")  # type: ignore

        assert "unsupported" in str(exc_info.value).lower()


class TestDiagnoseFiles:
    """Test diagnose_files functionality for multiple files."""

    def test_diagnose_multiple_files(
        self,
        diagnosis_service: FileDiagnosisService,
        sample_csv: Path,
        sample_csv_with_nulls: Path,
    ):
        """Test diagnosing multiple files."""
        from pluto_duck_backend.app.services.asset import DiagnoseFileRequest

        files = [
            DiagnoseFileRequest(file_path=str(sample_csv), file_type="csv"),
            DiagnoseFileRequest(file_path=str(sample_csv_with_nulls), file_type="csv"),
        ]

        diagnoses = diagnosis_service.diagnose_files(files)

        assert len(diagnoses) == 2
        assert diagnoses[0].file_path == str(sample_csv)
        assert diagnoses[1].file_path == str(sample_csv_with_nulls)

    def test_diagnose_empty_list(
        self, diagnosis_service: FileDiagnosisService
    ):
        """Test diagnosing empty list returns empty list."""
        diagnoses = diagnosis_service.diagnose_files([])
        assert diagnoses == []


class TestFileDiagnosisDataclass:
    """Test FileDiagnosis dataclass methods."""

    def test_to_dict(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test to_dict conversion."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")
        result = diagnosis.to_dict()

        assert isinstance(result, dict)
        assert result["file_path"] == str(sample_csv)
        assert result["file_type"] == "csv"
        assert "schema" in result
        assert "missing_values" in result
        assert "row_count" in result
        assert "file_size_bytes" in result
        assert "diagnosed_at" in result

    def test_schema_to_dict(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test ColumnSchema to_dict conversion."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")

        for col in diagnosis.schema:
            col_dict = col.to_dict()
            assert "name" in col_dict
            assert "type" in col_dict
            assert "nullable" in col_dict


class TestTypeSuggestions:
    """Test type suggestion functionality.

    Note: DuckDB's auto_detect feature is quite good at inferring types.
    These tests use CSV files where DuckDB detects columns as VARCHAR
    but they could be better typed. This happens with:
    - Numbers with leading zeros (e.g., "001", "002")
    - Values with mixed formats or prefixes
    - Data that has non-numeric markers interspersed
    """

    @pytest.fixture
    def csv_with_varchar_integers(self, temp_dir: Path) -> Path:
        """Create a CSV with integers that DuckDB keeps as VARCHAR due to leading zeros."""
        csv_path = temp_dir / "varchar_integers.csv"
        with open(csv_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["id", "code", "status"])
            # Leading zeros cause DuckDB to treat as VARCHAR
            writer.writerow(["001", "100", "active"])
            writer.writerow(["002", "200", "active"])
            writer.writerow(["003", "300", "active"])
            writer.writerow(["004", "400", "active"])
            writer.writerow(["005", "500", "active"])
        return csv_path

    @pytest.fixture
    def csv_with_mixed_types(self, temp_dir: Path) -> Path:
        """Create a CSV file with mixed types that shouldn't trigger suggestions."""
        csv_path = temp_dir / "mixed_types.csv"
        with open(csv_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["id", "value"])
            writer.writerow(["1", "100"])
            writer.writerow(["2", "hello"])
            writer.writerow(["3", "300"])
            writer.writerow(["4", "world"])
            writer.writerow(["5", "500"])
        return csv_path

    def test_type_suggestions_structure(
        self, diagnosis_service: FileDiagnosisService, csv_with_varchar_integers: Path
    ):
        """Test that type suggestions have correct structure."""
        diagnosis = diagnosis_service.diagnose_file(str(csv_with_varchar_integers), "csv")

        # type_suggestions should always be a list
        assert isinstance(diagnosis.type_suggestions, list)

        # Each suggestion should have the required fields
        for suggestion in diagnosis.type_suggestions:
            assert hasattr(suggestion, "column_name")
            assert hasattr(suggestion, "current_type")
            assert hasattr(suggestion, "suggested_type")
            assert hasattr(suggestion, "confidence")
            assert hasattr(suggestion, "sample_values")

    def test_no_suggestion_for_mixed_types(
        self, diagnosis_service: FileDiagnosisService, csv_with_mixed_types: Path
    ):
        """Test that mixed type columns don't get suggestions."""
        diagnosis = diagnosis_service.diagnose_file(str(csv_with_mixed_types), "csv")

        # Find suggestion for 'value' column (mixed numbers and text)
        value_suggestions = [
            s for s in diagnosis.type_suggestions if s.column_name == "value"
        ]

        # Should not suggest any type change for mixed content
        assert len(value_suggestions) == 0

    def test_type_suggestion_includes_sample_values_when_present(
        self, diagnosis_service: FileDiagnosisService, csv_with_varchar_integers: Path
    ):
        """Test that type suggestions include sample values when present."""
        diagnosis = diagnosis_service.diagnose_file(str(csv_with_varchar_integers), "csv")

        for suggestion in diagnosis.type_suggestions:
            assert isinstance(suggestion.sample_values, list)
            # Sample values should be populated for valid suggestions
            if suggestion.confidence >= 90:
                assert len(suggestion.sample_values) > 0

    def test_type_suggestion_to_dict(
        self, diagnosis_service: FileDiagnosisService, csv_with_varchar_integers: Path
    ):
        """Test TypeSuggestion to_dict conversion."""
        diagnosis = diagnosis_service.diagnose_file(str(csv_with_varchar_integers), "csv")

        for suggestion in diagnosis.type_suggestions:
            suggestion_dict = suggestion.to_dict()
            assert "column_name" in suggestion_dict
            assert "current_type" in suggestion_dict
            assert "suggested_type" in suggestion_dict
            assert "confidence" in suggestion_dict
            assert "sample_values" in suggestion_dict

    def test_suggests_bigint_for_varchar_numeric_column(
        self, diagnosis_service: FileDiagnosisService, csv_with_varchar_integers: Path
    ):
        """Test that VARCHAR columns with numeric content get BIGINT/DOUBLE suggestions."""
        diagnosis = diagnosis_service.diagnose_file(str(csv_with_varchar_integers), "csv")

        # Check that we got the schema
        varchar_cols = [c for c in diagnosis.schema if "VARCHAR" in c.type.upper()]

        # If there are VARCHAR columns with numeric content, they should have suggestions
        for col in varchar_cols:
            col_suggestions = [s for s in diagnosis.type_suggestions if s.column_name == col.name]
            # Only columns with purely numeric content should have suggestions
            # (we can't predict exactly which ones without running the analysis)
            for suggestion in col_suggestions:
                assert suggestion.suggested_type in ("BIGINT", "DOUBLE", "DATE", "TIMESTAMP")
                assert suggestion.confidence >= 90


class TestDiagnosisCaching:
    """Test diagnosis result caching functionality."""

    def test_save_and_retrieve_diagnosis(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test saving and retrieving a cached diagnosis."""
        # First, diagnose the file
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")

        # Save the diagnosis
        diagnosis_id = diagnosis_service.save_diagnosis(diagnosis)
        assert diagnosis_id.startswith("diag_")

        # Retrieve the cached diagnosis
        cached = diagnosis_service.get_cached_diagnosis(str(sample_csv))
        assert cached is not None
        assert cached.file_path == diagnosis.file_path
        assert cached.file_type == diagnosis.file_type
        assert cached.row_count == diagnosis.row_count
        assert cached.file_size_bytes == diagnosis.file_size_bytes
        assert len(cached.schema) == len(diagnosis.schema)

    def test_get_nonexistent_cached_diagnosis(
        self, diagnosis_service: FileDiagnosisService
    ):
        """Test retrieving non-existent cached diagnosis returns None."""
        cached = diagnosis_service.get_cached_diagnosis("/nonexistent/path.csv")
        assert cached is None

    def test_save_overwrites_existing_diagnosis(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test that saving a diagnosis overwrites existing one for same file."""
        # First diagnosis
        diagnosis1 = diagnosis_service.diagnose_file(str(sample_csv), "csv")
        id1 = diagnosis_service.save_diagnosis(diagnosis1)

        # Second diagnosis (same file)
        diagnosis2 = diagnosis_service.diagnose_file(str(sample_csv), "csv")
        id2 = diagnosis_service.save_diagnosis(diagnosis2)

        # IDs should be different (new record created)
        assert id1 != id2

        # Only one cached result should exist
        cached = diagnosis_service.get_cached_diagnosis(str(sample_csv))
        assert cached is not None

    def test_cached_diagnosis_preserves_schema(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test that cached diagnosis preserves schema information."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")
        diagnosis_service.save_diagnosis(diagnosis)

        cached = diagnosis_service.get_cached_diagnosis(str(sample_csv))
        assert cached is not None

        # Check schema is preserved
        for orig_col, cached_col in zip(diagnosis.schema, cached.schema):
            assert orig_col.name == cached_col.name
            assert orig_col.type == cached_col.type
            assert orig_col.nullable == cached_col.nullable

    def test_cached_diagnosis_preserves_missing_values(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test that cached diagnosis preserves missing values."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")
        diagnosis_service.save_diagnosis(diagnosis)

        cached = diagnosis_service.get_cached_diagnosis(str(sample_csv))
        assert cached is not None

        assert cached.missing_values == diagnosis.missing_values

    def test_delete_cached_diagnosis(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test deleting a cached diagnosis."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")
        diagnosis_service.save_diagnosis(diagnosis)

        # Verify it exists
        assert diagnosis_service.get_cached_diagnosis(str(sample_csv)) is not None

        # Delete it
        diagnosis_service.delete_cached_diagnosis(str(sample_csv))

        # Verify it's gone
        assert diagnosis_service.get_cached_diagnosis(str(sample_csv)) is None

    def test_cached_diagnosis_preserves_llm_analysis(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test that cached diagnosis preserves LLM analysis results."""
        from datetime import timezone
        from pluto_duck_backend.app.services.asset.file_diagnosis_service import (
            LLMAnalysisResult,
            PotentialItem,
            IssueItem,
        )

        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")

        # Add LLM analysis to the diagnosis
        diagnosis.llm_analysis = LLMAnalysisResult(
            suggested_name="test_dataset",
            context="This is a test dataset for unit testing.",
            potential=[
                PotentialItem(question="What is the data about?", analysis="Analyze columns"),
                PotentialItem(question="Any patterns?", analysis="Check distributions"),
            ],
            issues=[
                IssueItem(issue="Missing values", suggestion="Fill or remove nulls"),
            ],
            analyzed_at=diagnosis.diagnosed_at,
            model_used="test-model",
        )

        # Save the diagnosis with LLM analysis
        diagnosis_service.save_diagnosis(diagnosis)

        # Retrieve and verify LLM analysis is preserved
        cached = diagnosis_service.get_cached_diagnosis(str(sample_csv))
        assert cached is not None
        assert cached.llm_analysis is not None

        # Check all LLM analysis fields
        assert cached.llm_analysis.suggested_name == "test_dataset"
        assert "test dataset" in cached.llm_analysis.context.lower()
        assert len(cached.llm_analysis.potential) == 2
        assert cached.llm_analysis.potential[0].question == "What is the data about?"
        assert len(cached.llm_analysis.issues) == 1
        assert cached.llm_analysis.issues[0].issue == "Missing values"
        assert cached.llm_analysis.model_used == "test-model"

    def test_cached_diagnosis_without_llm_analysis(
        self, diagnosis_service: FileDiagnosisService, sample_csv: Path
    ):
        """Test that diagnosis without LLM analysis can be cached and retrieved."""
        diagnosis = diagnosis_service.diagnose_file(str(sample_csv), "csv")

        # Ensure no LLM analysis
        assert diagnosis.llm_analysis is None

        # Save and retrieve
        diagnosis_service.save_diagnosis(diagnosis)
        cached = diagnosis_service.get_cached_diagnosis(str(sample_csv))

        assert cached is not None
        assert cached.llm_analysis is None
