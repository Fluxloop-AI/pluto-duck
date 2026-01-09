"""Tests for the Work Zone service."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pytest

from pluto_duck_backend.app.services.workzone import WorkZoneService, WorkZone


@pytest.fixture
def sessions_dir(tmp_path: Path) -> Path:
    """Create a temporary sessions directory."""
    return tmp_path / "sessions"


@pytest.fixture
def service(sessions_dir: Path) -> WorkZoneService:
    """Create a WorkZoneService instance."""
    return WorkZoneService(sessions_dir)


class TestWorkZoneServiceInit:
    """Test WorkZoneService initialization."""

    def test_creates_sessions_dir(self, sessions_dir: Path):
        """Ensure sessions directory is created."""
        assert not sessions_dir.exists()
        WorkZoneService(sessions_dir)
        assert sessions_dir.exists()

    def test_loads_existing_registry(self, sessions_dir: Path):
        """Test loading existing registry."""
        # Create a zone
        service1 = WorkZoneService(sessions_dir)
        service1.get_or_create("test-conv")

        # Create new service instance
        service2 = WorkZoneService(sessions_dir)
        zone = service2.get("test-conv")

        assert zone is not None
        assert zone.conversation_id == "test-conv"


class TestGetOrCreate:
    """Test get_or_create functionality."""

    def test_creates_new_zone(self, service: WorkZoneService, sessions_dir: Path):
        """Test creating a new work zone."""
        zone = service.get_or_create("conv-123")

        assert zone.conversation_id == "conv-123"
        assert zone.db_path.exists()
        assert zone.files_path.exists()
        assert zone.created_at is not None
        assert zone.expires_at > zone.created_at

    def test_returns_existing_zone(self, service: WorkZoneService):
        """Test returning existing zone on second call."""
        zone1 = service.get_or_create("conv-456")
        time.sleep(0.01)  # Small delay
        zone2 = service.get_or_create("conv-456")

        assert zone1.conversation_id == zone2.conversation_id
        # Created time should be the same
        assert zone1.created_at == zone2.created_at
        # Last accessed should be updated
        assert zone2.last_accessed_at >= zone1.last_accessed_at

    def test_custom_ttl(self, service: WorkZoneService):
        """Test custom TTL."""
        zone = service.get_or_create("conv-ttl", ttl_hours=48)

        expected_expiry = zone.created_at + timedelta(hours=48)
        # Allow 1 second tolerance
        assert abs((zone.expires_at - expected_expiry).total_seconds()) < 1

    def test_with_metadata(self, service: WorkZoneService):
        """Test storing metadata."""
        metadata = {"project_id": "proj-1", "user": "test"}
        zone = service.get_or_create("conv-meta", metadata=metadata)

        assert zone.metadata == metadata

    def test_initializes_duckdb(self, service: WorkZoneService):
        """Test that DuckDB is properly initialized."""
        zone = service.get_or_create("conv-db")

        with duckdb.connect(str(zone.db_path)) as con:
            result = con.execute(
                "SELECT value FROM _workzone_meta WHERE key = 'conversation_id'"
            ).fetchone()
            assert result[0] == "conv-db"


class TestGet:
    """Test get functionality."""

    def test_get_existing(self, service: WorkZoneService):
        """Test getting existing zone."""
        service.get_or_create("existing")
        zone = service.get("existing")

        assert zone is not None
        assert zone.conversation_id == "existing"

    def test_get_nonexistent(self, service: WorkZoneService):
        """Test getting non-existent zone."""
        zone = service.get("nonexistent")
        assert zone is None


class TestConnect:
    """Test connect functionality."""

    def test_connect_creates_zone(self, service: WorkZoneService):
        """Test that connect creates zone if needed."""
        with service.connect("new-zone") as con:
            con.execute("CREATE TABLE test (id INTEGER)")

        zone = service.get("new-zone")
        assert zone is not None

    def test_connect_returns_working_connection(self, service: WorkZoneService):
        """Test that connection is functional."""
        with service.connect("work-zone") as con:
            con.execute("CREATE TABLE results AS SELECT 1 as val")
            result = con.execute("SELECT * FROM results").fetchone()
            assert result[0] == 1


class TestListZones:
    """Test list_zones functionality."""

    def test_list_empty(self, service: WorkZoneService):
        """Test listing when no zones exist."""
        zones = service.list_zones()
        assert len(zones) == 0

    def test_list_multiple(self, service: WorkZoneService):
        """Test listing multiple zones."""
        service.get_or_create("zone-1")
        service.get_or_create("zone-2")
        service.get_or_create("zone-3")

        zones = service.list_zones()
        conv_ids = [z.conversation_id for z in zones]

        assert len(zones) == 3
        assert "zone-1" in conv_ids
        assert "zone-2" in conv_ids
        assert "zone-3" in conv_ids


class TestDelete:
    """Test delete functionality."""

    def test_delete_existing(self, service: WorkZoneService):
        """Test deleting existing zone."""
        zone = service.get_or_create("to-delete")
        zone_dir = zone.db_path.parent

        assert service.delete("to-delete") is True
        assert not zone_dir.exists()
        assert service.get("to-delete") is None

    def test_delete_nonexistent(self, service: WorkZoneService):
        """Test deleting non-existent zone."""
        assert service.delete("nonexistent") is False


class TestCleanupExpired:
    """Test cleanup_expired functionality."""

    def test_cleanup_expired(self, service: WorkZoneService):
        """Test cleaning up expired zones."""
        # Create a zone with very short TTL
        zone = service.get_or_create("expiring", ttl_hours=0)

        # Manually set expires_at to past
        service._registry["expiring"]["expires_at"] = (
            datetime.now(UTC) - timedelta(hours=1)
        ).isoformat()
        service._save_registry()

        count = service.cleanup_expired()
        assert count == 1
        assert service.get("expiring") is None

    def test_cleanup_preserves_valid(self, service: WorkZoneService):
        """Test that valid zones are preserved."""
        service.get_or_create("valid", ttl_hours=24)
        service.get_or_create("expiring", ttl_hours=0)

        # Expire one zone
        service._registry["expiring"]["expires_at"] = (
            datetime.now(UTC) - timedelta(hours=1)
        ).isoformat()
        service._save_registry()

        count = service.cleanup_expired()
        assert count == 1
        assert service.get("valid") is not None
        assert service.get("expiring") is None


class TestDiskUsage:
    """Test disk usage tracking."""

    def test_disk_usage_new_zone(self, service: WorkZoneService):
        """Test disk usage of new zone."""
        zone = service.get_or_create("usage-test")
        usage = service.get_disk_usage("usage-test")

        # Should have some size from DuckDB file
        assert usage > 0

    def test_disk_usage_nonexistent(self, service: WorkZoneService):
        """Test disk usage of non-existent zone."""
        usage = service.get_disk_usage("nonexistent")
        assert usage == 0


class TestTouch:
    """Test touch functionality."""

    def test_touch_updates_expiry(self, service: WorkZoneService):
        """Test that touch updates expiry."""
        zone1 = service.get_or_create("touch-test", ttl_hours=1)
        original_expiry = zone1.expires_at

        time.sleep(0.01)

        assert service.touch("touch-test", ttl_hours=48) is True

        zone2 = service.get("touch-test")
        assert zone2.expires_at > original_expiry

    def test_touch_nonexistent(self, service: WorkZoneService):
        """Test touch on non-existent zone."""
        assert service.touch("nonexistent") is False

