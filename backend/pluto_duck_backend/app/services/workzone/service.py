"""Work Zone service - Session-scoped temporary workspaces.

Work Zones provide isolated DuckDB workspaces per conversation session.
This enables:
1. Temporary tables that don't pollute the main warehouse
2. Session isolation for concurrent users
3. Automatic cleanup when sessions expire

Directory structure:
    {data_dir}/
    └── sessions/
        └── {conversation_id}/
            ├── work.duckdb      # Session-specific DuckDB
            └── files/           # Session-specific files (exports, etc.)
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import duckdb

from pluto_duck_backend.app.core.config import get_settings


# Default TTL for work zones (24 hours)
DEFAULT_TTL_HOURS = 24


@dataclass
class WorkZone:
    """A session-scoped work zone."""

    conversation_id: str
    db_path: Path
    files_path: Path
    created_at: datetime
    last_accessed_at: datetime
    expires_at: datetime
    metadata: Dict[str, Any]


class WorkZoneService:
    """Service for managing session-scoped work zones.

    Each conversation gets its own isolated workspace with:
    - A dedicated DuckDB file for temporary tables and results
    - A files directory for exports and imports
    - TTL-based automatic cleanup

    Example usage:
        service = WorkZoneService(sessions_dir)

        # Get or create a work zone for a conversation
        zone = service.get_or_create("conv-123")

        # Get a DuckDB connection to the work zone
        with service.connect(zone.conversation_id) as con:
            con.execute("CREATE TABLE temp_results AS SELECT ...")

        # Clean up expired zones
        service.cleanup_expired()
    """

    def __init__(self, sessions_dir: Path):
        self.sessions_dir = sessions_dir
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self._registry_path = self.sessions_dir / "_registry.json"
        self._load_registry()

    def _load_registry(self) -> None:
        """Load the work zone registry from disk."""
        if self._registry_path.exists():
            try:
                with open(self._registry_path, "r") as f:
                    self._registry: Dict[str, Dict[str, Any]] = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._registry = {}
        else:
            self._registry = {}

    def _save_registry(self) -> None:
        """Save the work zone registry to disk."""
        try:
            with open(self._registry_path, "w") as f:
                json.dump(self._registry, f, indent=2, default=str)
        except IOError:
            pass  # Best effort

    def _get_zone_dir(self, conversation_id: str) -> Path:
        """Get the directory path for a work zone."""
        # Sanitize conversation ID for filesystem
        safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in conversation_id)
        return self.sessions_dir / safe_id

    def get_or_create(
        self,
        conversation_id: str,
        *,
        ttl_hours: int = DEFAULT_TTL_HOURS,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WorkZone:
        """Get or create a work zone for a conversation.

        Args:
            conversation_id: The conversation/session ID
            ttl_hours: Time-to-live in hours (default 24)
            metadata: Optional metadata to store

        Returns:
            WorkZone instance
        """
        now = datetime.now(UTC)

        # Check if zone already exists
        if conversation_id in self._registry:
            zone_data = self._registry[conversation_id]
            zone_dir = self._get_zone_dir(conversation_id)

            # Update last accessed time and extend expiry
            zone_data["last_accessed_at"] = now.isoformat()
            zone_data["expires_at"] = (now + timedelta(hours=ttl_hours)).isoformat()
            self._save_registry()

            return WorkZone(
                conversation_id=conversation_id,
                db_path=zone_dir / "work.duckdb",
                files_path=zone_dir / "files",
                created_at=datetime.fromisoformat(zone_data["created_at"]),
                last_accessed_at=now,
                expires_at=datetime.fromisoformat(zone_data["expires_at"]),
                metadata=zone_data.get("metadata", {}),
            )

        # Create new zone
        zone_dir = self._get_zone_dir(conversation_id)
        zone_dir.mkdir(parents=True, exist_ok=True)

        db_path = zone_dir / "work.duckdb"
        files_path = zone_dir / "files"
        files_path.mkdir(exist_ok=True)

        expires_at = now + timedelta(hours=ttl_hours)

        # Initialize the DuckDB file
        with duckdb.connect(str(db_path)) as con:
            # Create a marker table to track the zone
            con.execute("""
                CREATE TABLE IF NOT EXISTS _workzone_meta (
                    key VARCHAR PRIMARY KEY,
                    value VARCHAR
                )
            """)
            con.execute(
                "INSERT OR REPLACE INTO _workzone_meta VALUES ('created_at', ?)",
                [now.isoformat()],
            )
            con.execute(
                "INSERT OR REPLACE INTO _workzone_meta VALUES ('conversation_id', ?)",
                [conversation_id],
            )

        # Register the zone
        self._registry[conversation_id] = {
            "created_at": now.isoformat(),
            "last_accessed_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "metadata": metadata or {},
        }
        self._save_registry()

        return WorkZone(
            conversation_id=conversation_id,
            db_path=db_path,
            files_path=files_path,
            created_at=now,
            last_accessed_at=now,
            expires_at=expires_at,
            metadata=metadata or {},
        )

    def get(self, conversation_id: str) -> Optional[WorkZone]:
        """Get an existing work zone.

        Args:
            conversation_id: The conversation/session ID

        Returns:
            WorkZone if exists, None otherwise
        """
        if conversation_id not in self._registry:
            return None

        zone_data = self._registry[conversation_id]
        zone_dir = self._get_zone_dir(conversation_id)

        # Check if files still exist
        if not (zone_dir / "work.duckdb").exists():
            # Clean up stale registry entry
            del self._registry[conversation_id]
            self._save_registry()
            return None

        return WorkZone(
            conversation_id=conversation_id,
            db_path=zone_dir / "work.duckdb",
            files_path=zone_dir / "files",
            created_at=datetime.fromisoformat(zone_data["created_at"]),
            last_accessed_at=datetime.fromisoformat(zone_data["last_accessed_at"]),
            expires_at=datetime.fromisoformat(zone_data["expires_at"]),
            metadata=zone_data.get("metadata", {}),
        )

    def connect(self, conversation_id: str) -> duckdb.DuckDBPyConnection:
        """Get a DuckDB connection to a work zone.

        Creates the zone if it doesn't exist.

        Args:
            conversation_id: The conversation/session ID

        Returns:
            DuckDB connection to the work zone
        """
        zone = self.get_or_create(conversation_id)
        return duckdb.connect(str(zone.db_path))

    def list_zones(self) -> List[WorkZone]:
        """List all active work zones."""
        zones = []
        for conv_id in list(self._registry.keys()):
            zone = self.get(conv_id)
            if zone:
                zones.append(zone)
        return zones

    def delete(self, conversation_id: str) -> bool:
        """Delete a work zone.

        Args:
            conversation_id: The conversation/session ID

        Returns:
            True if deleted, False if not found
        """
        if conversation_id not in self._registry:
            return False

        zone_dir = self._get_zone_dir(conversation_id)

        # Remove files
        if zone_dir.exists():
            try:
                shutil.rmtree(zone_dir)
            except IOError:
                pass  # Best effort

        # Remove from registry
        del self._registry[conversation_id]
        self._save_registry()

        return True

    def cleanup_expired(self) -> int:
        """Clean up expired work zones.

        Returns:
            Number of zones cleaned up
        """
        now = datetime.now(UTC)
        count = 0

        for conv_id in list(self._registry.keys()):
            zone_data = self._registry[conv_id]
            expires_at = datetime.fromisoformat(zone_data["expires_at"])

            # Handle timezone-naive datetimes
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)

            if expires_at < now:
                if self.delete(conv_id):
                    count += 1

        return count

    def get_disk_usage(self, conversation_id: str) -> int:
        """Get disk usage of a work zone in bytes.

        Args:
            conversation_id: The conversation/session ID

        Returns:
            Total bytes used, or 0 if not found
        """
        zone_dir = self._get_zone_dir(conversation_id)
        if not zone_dir.exists():
            return 0

        total = 0
        for path in zone_dir.rglob("*"):
            if path.is_file():
                try:
                    total += path.stat().st_size
                except IOError:
                    pass
        return total

    def touch(self, conversation_id: str, ttl_hours: int = DEFAULT_TTL_HOURS) -> bool:
        """Update last accessed time and extend expiry.

        Args:
            conversation_id: The conversation/session ID
            ttl_hours: New TTL in hours

        Returns:
            True if zone exists and was updated
        """
        if conversation_id not in self._registry:
            return False

        now = datetime.now(UTC)
        self._registry[conversation_id]["last_accessed_at"] = now.isoformat()
        self._registry[conversation_id]["expires_at"] = (now + timedelta(hours=ttl_hours)).isoformat()
        self._save_registry()

        return True


@lru_cache(maxsize=1)
def get_work_zone_service() -> WorkZoneService:
    """Get singleton work zone service instance."""
    settings = get_settings()
    sessions_dir = settings.data_dir.runtime / "sessions"
    return WorkZoneService(sessions_dir=sessions_dir)

