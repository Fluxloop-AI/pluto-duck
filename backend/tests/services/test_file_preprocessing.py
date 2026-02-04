"""Tests for the File Preprocessing service."""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from pluto_duck_backend.app.services.asset import FilePreprocessingService


@pytest.fixture
def temp_dir(tmp_path: Path) -> Path:
    """Create temporary directories."""
    return tmp_path


@pytest.fixture
def warehouse_path(temp_dir: Path) -> Path:
    """Create a temporary warehouse."""
    return temp_dir / "warehouse.duckdb"


@pytest.fixture
def preprocessing_service(warehouse_path: Path) -> FilePreprocessingService:
    """Create a FilePreprocessingService instance."""
    return FilePreprocessingService(
        project_id="test-project",
        warehouse_path=warehouse_path,
    )


class TestFilePreprocessingStatus:
    def test_set_and_get_status(self, preprocessing_service: FilePreprocessingService):
        status = preprocessing_service.set_status(
            file_asset_id="file_123",
            status="not_ready",
            reason="missing headers",
            actor="tester",
            last_diagnosis_id="diag_1",
        )

        assert status.file_asset_id == "file_123"
        assert status.status == "not_ready"
        assert status.reason == "missing headers"
        assert status.last_diagnosis_id == "diag_1"
        assert status.updated_by == "tester"

        fetched = preprocessing_service.get_status("file_123")
        assert fetched is not None
        assert fetched.status == "not_ready"
        assert fetched.reason == "missing headers"
        assert fetched.last_diagnosis_id == "diag_1"

    def test_effective_status_stale(self, preprocessing_service: FilePreprocessingService):
        preprocessing_service.set_status(
            file_asset_id="file_456",
            status="ready",
            reason=None,
            actor="tester",
            last_diagnosis_id="diag_old",
        )

        effective = preprocessing_service.get_effective_status(
            file_asset_id="file_456",
            current_diagnosis_id="diag_new",
        )
        assert effective.status == "unknown"
        assert effective.stale is True

        effective_current = preprocessing_service.get_effective_status(
            file_asset_id="file_456",
            current_diagnosis_id="diag_old",
        )
        assert effective_current.status == "ready"
        assert effective_current.stale is False

    def test_append_event(self, preprocessing_service: FilePreprocessingService, warehouse_path: Path):
        event = preprocessing_service.append_event(
            file_asset_id="file_789",
            event_type="preprocess_suggested",
            message="Consider fixing date formats",
            actor="agent",
        )

        with duckdb.connect(str(warehouse_path)) as conn:
            row = conn.execute(
                """
                SELECT event_type, message, actor, file_asset_id
                FROM _file_assets.file_preprocessing_events
                WHERE id = ?
                """,
                [event.id],
            ).fetchone()

        assert row is not None
        assert row[0] == "preprocess_suggested"
        assert row[1] == "Consider fixing date formats"
        assert row[2] == "agent"
        assert row[3] == "file_789"

    def test_readiness_summary(self, preprocessing_service: FilePreprocessingService):
        preprocessing_service.set_status(
            file_asset_id="file_ready",
            status="ready",
            reason=None,
            actor="tester",
            last_diagnosis_id="diag_1",
        )
        preprocessing_service.set_status(
            file_asset_id="file_not_ready",
            status="not_ready",
            reason="missing columns",
            actor="tester",
            last_diagnosis_id="diag_2",
        )
        preprocessing_service.set_status(
            file_asset_id="file_unknown",
            status="unknown",
            reason=None,
            actor="tester",
            last_diagnosis_id="diag_3",
        )

        summary = preprocessing_service.get_readiness_summary("test-project")
        assert summary["total"] == 3
        assert summary["ready_count"] == 1
        assert len(summary["not_ready"]) == 1
        assert summary["not_ready"][0]["file_asset_id"] == "file_not_ready"
