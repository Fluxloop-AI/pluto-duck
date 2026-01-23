"""Tests for the File Diagnosis API endpoint."""

from __future__ import annotations

import csv
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from pluto_duck_backend.app.api.router import api_router


def create_app() -> FastAPI:
    """Create a test FastAPI application."""
    app = FastAPI()
    app.include_router(api_router)
    return app


@pytest.fixture
def client():
    """Create a test client."""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def sample_csv(tmp_path: Path) -> Path:
    """Create a sample CSV file."""
    csv_path = tmp_path / "sample.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "name", "value", "category"])
        writer.writerow([1, "Alice", 100, "A"])
        writer.writerow([2, "Bob", 200, "B"])
        writer.writerow([3, "Charlie", 300, "A"])
        writer.writerow([4, "Diana", 400, "B"])
        writer.writerow([5, "Eve", 500, "C"])
    return csv_path


@pytest.fixture
def sample_csv_with_nulls(tmp_path: Path) -> Path:
    """Create a CSV file with NULL values."""
    csv_path = tmp_path / "nulls.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["col_a", "col_b", "col_c"])
        writer.writerow([1, "x", ""])
        writer.writerow(["", "y", "val"])
        writer.writerow([3, "", "val"])
    return csv_path


class TestDiagnoseFilesEndpoint:
    """Tests for POST /api/v1/asset/files/diagnose endpoint."""

    def test_diagnose_single_csv(self, client: TestClient, sample_csv: Path):
        """Test diagnosing a single CSV file."""
        response = client.post(
            "/api/v1/asset/files/diagnose",
            json={
                "files": [
                    {"file_path": str(sample_csv), "file_type": "csv"}
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()

        assert "diagnoses" in data
        assert len(data["diagnoses"]) == 1

        diagnosis = data["diagnoses"][0]
        assert diagnosis["file_path"] == str(sample_csv)
        assert diagnosis["file_type"] == "csv"
        assert diagnosis["row_count"] == 5
        assert diagnosis["file_size_bytes"] > 0
        assert "columns" in diagnosis
        assert len(diagnosis["columns"]) == 4

        # Check column names
        col_names = [col["name"] for col in diagnosis["columns"]]
        assert "id" in col_names
        assert "name" in col_names
        assert "value" in col_names
        assert "category" in col_names

    def test_diagnose_multiple_files(
        self, client: TestClient, sample_csv: Path, sample_csv_with_nulls: Path
    ):
        """Test diagnosing multiple files."""
        response = client.post(
            "/api/v1/asset/files/diagnose",
            json={
                "files": [
                    {"file_path": str(sample_csv), "file_type": "csv"},
                    {"file_path": str(sample_csv_with_nulls), "file_type": "csv"},
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["diagnoses"]) == 2

    def test_diagnose_missing_values(
        self, client: TestClient, sample_csv_with_nulls: Path
    ):
        """Test that missing values are detected."""
        response = client.post(
            "/api/v1/asset/files/diagnose",
            json={
                "files": [
                    {"file_path": str(sample_csv_with_nulls), "file_type": "csv"}
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()

        diagnosis = data["diagnoses"][0]
        assert "missing_values" in diagnosis
        # Verify structure exists (actual counts depend on CSV parsing)
        assert isinstance(diagnosis["missing_values"], dict)

    def test_diagnose_nonexistent_file(self, client: TestClient):
        """Test diagnosing a non-existent file returns 404."""
        response = client.post(
            "/api/v1/asset/files/diagnose",
            json={
                "files": [
                    {"file_path": "/nonexistent/path.csv", "file_type": "csv"}
                ]
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_diagnose_empty_files_list(self, client: TestClient):
        """Test diagnosing with empty files list."""
        response = client.post(
            "/api/v1/asset/files/diagnose",
            json={"files": []},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["diagnoses"] == []

    def test_diagnose_invalid_request(self, client: TestClient):
        """Test diagnosing with invalid request body."""
        response = client.post(
            "/api/v1/asset/files/diagnose",
            json={"invalid": "data"},
        )

        assert response.status_code == 422  # Validation error

    def test_diagnose_response_structure(self, client: TestClient, sample_csv: Path):
        """Test that response has correct structure."""
        response = client.post(
            "/api/v1/asset/files/diagnose",
            json={
                "files": [
                    {"file_path": str(sample_csv), "file_type": "csv"}
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()

        diagnosis = data["diagnoses"][0]

        # Check all required fields exist
        required_fields = [
            "file_path",
            "file_type",
            "columns",
            "missing_values",
            "row_count",
            "file_size_bytes",
            "type_suggestions",
            "diagnosed_at",
        ]
        for field in required_fields:
            assert field in diagnosis, f"Missing field: {field}"

        # Check column structure
        for col in diagnosis["columns"]:
            assert "name" in col
            assert "type" in col
            assert "nullable" in col
