"""Tests for the Source service (ATTACH + Cache)."""

from __future__ import annotations

import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import duckdb
import pytest

from pluto_duck_backend.app.services.source import (
    SourceService,
    SourceType,
    TableMode,
    AttachError,
    CacheError,
    SourceNotFoundError,
)


@pytest.fixture
def temp_warehouse(tmp_path: Path) -> Path:
    """Create a temporary warehouse database."""
    return tmp_path / "warehouse.duckdb"


@pytest.fixture
def source_service(temp_warehouse: Path) -> SourceService:
    """Create a SourceService instance with a test project."""
    return SourceService("test_project", temp_warehouse)


@pytest.fixture
def sample_sqlite_db(tmp_path: Path) -> Path:
    """Create a sample SQLite database for testing."""
    db_path = tmp_path / "sample.db"
    import sqlite3

    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)")
    cursor.execute("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')")
    cursor.execute("INSERT INTO users VALUES (2, 'Bob', 'bob@example.com')")
    cursor.execute("INSERT INTO users VALUES (3, 'Charlie', 'charlie@example.com')")
    cursor.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL)")
    cursor.execute("INSERT INTO orders VALUES (1, 1, 100.0)")
    cursor.execute("INSERT INTO orders VALUES (2, 1, 200.0)")
    cursor.execute("INSERT INTO orders VALUES (3, 2, 150.0)")
    conn.commit()
    conn.close()
    return db_path


class TestSourceServiceInit:
    """Test SourceService initialization."""

    def test_creates_metadata_tables(self, temp_warehouse: Path):
        """Ensure metadata tables are created on init."""
        service = SourceService("test_project", temp_warehouse)

        with duckdb.connect(str(temp_warehouse)) as con:
            # Check schema exists
            schemas = con.execute(
                "SELECT schema_name FROM information_schema.schemata"
            ).fetchall()
            schema_names = [s[0] for s in schemas]
            assert "_sources" in schema_names
            assert "cache" in schema_names

            # Check tables exist
            tables = con.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = '_sources'"
            ).fetchall()
            table_names = [t[0] for t in tables]
            assert "attached" in table_names
            assert "cached_tables" in table_names


class TestAttachSource:
    """Test source attachment operations."""

    def test_attach_sqlite_success(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test successfully attaching a SQLite database."""
        source = source_service.attach_source(
            name="test_db",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        assert source.name == "test_db"
        assert source.source_type == SourceType.SQLITE
        assert source.status == "attached"
        assert source.error_message is None

    def test_attach_invalid_name(self, source_service: SourceService):
        """Test that invalid names are rejected."""
        with pytest.raises(AttachError) as exc_info:
            source_service.attach_source(
                name="invalid-name",  # Hyphens not allowed
                source_type=SourceType.SQLITE,
                config={"path": "/nonexistent.db"},
            )
        assert "alphanumeric" in str(exc_info.value).lower()

    def test_attach_name_starting_with_number(self, source_service: SourceService):
        """Test that names starting with numbers are rejected."""
        with pytest.raises(AttachError):
            source_service.attach_source(
                name="123db",
                source_type=SourceType.SQLITE,
                config={"path": "/nonexistent.db"},
            )

    def test_list_sources(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test listing attached sources."""
        # Initially empty
        sources = source_service.list_sources()
        assert len(sources) == 0

        # Attach a source
        source_service.attach_source(
            name="db1",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        sources = source_service.list_sources()
        assert len(sources) == 1
        assert sources[0].name == "db1"

    def test_get_source(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test getting a specific source."""
        source_service.attach_source(
            name="mydb",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        source = source_service.get_source("mydb")
        assert source is not None
        assert source.name == "mydb"

        # Non-existent
        assert source_service.get_source("nonexistent") is None

    def test_detach_source(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test detaching a source."""
        source_service.attach_source(
            name="to_detach",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        assert source_service.detach_source("to_detach") is True
        assert source_service.get_source("to_detach") is None

        # Detaching non-existent returns False
        assert source_service.detach_source("nonexistent") is False


class TestListSourceTables:
    """Test listing tables from attached sources."""

    def test_list_tables_from_sqlite(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test listing tables from an attached SQLite database."""
        source_service.attach_source(
            name="sample",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        tables = source_service.list_source_tables("sample")
        table_names = [t.table_name for t in tables]

        # SQLite should have users and orders tables
        assert "users" in table_names or any("users" in t.table_name for t in tables)

    def test_list_tables_nonexistent_source(self, source_service: SourceService):
        """Test error when listing tables from non-existent source."""
        with pytest.raises(SourceNotFoundError):
            source_service.list_source_tables("nonexistent")


class TestCacheTable:
    """Test table caching operations."""

    def test_cache_table_success(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test successfully caching a table."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        cached = source_service.cache_table("src", "users")

        assert cached.source_name == "src"
        assert cached.source_table == "users"
        assert cached.local_table == "src_users"
        assert cached.row_count == 3  # 3 users in sample data

        # Verify the table exists in DuckDB
        with duckdb.connect(str(source_service.warehouse_path)) as con:
            count = con.execute("SELECT COUNT(*) FROM cache.src_users").fetchone()[0]
            assert count == 3

    def test_cache_table_with_filter(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test caching with a filter."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        cached = source_service.cache_table(
            "src",
            "users",
            filter_sql="id <= 2",
            local_table="filtered_users",
        )

        assert cached.row_count == 2
        assert cached.filter_sql == "id <= 2"

    def test_cache_table_with_custom_name(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test caching with custom local table name."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        cached = source_service.cache_table(
            "src",
            "users",
            local_table="my_users",
        )

        assert cached.local_table == "my_users"

    def test_cache_table_with_expiry(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test caching with TTL."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        cached = source_service.cache_table(
            "src",
            "users",
            expires_hours=24,
        )

        assert cached.expires_at is not None
        # Should expire approximately 24 hours from now
        expected_expiry = datetime.now(UTC) + timedelta(hours=24)
        assert abs((cached.expires_at - expected_expiry).total_seconds()) < 60

    def test_cache_nonexistent_source(self, source_service: SourceService):
        """Test error when caching from non-existent source."""
        with pytest.raises(SourceNotFoundError):
            source_service.cache_table("nonexistent", "users")

    def test_list_cached_tables(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test listing cached tables."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        # Initially empty
        assert len(source_service.list_cached_tables()) == 0

        # Cache some tables
        source_service.cache_table("src", "users")
        source_service.cache_table("src", "orders")

        cached = source_service.list_cached_tables()
        assert len(cached) == 2

        # Filter by source
        cached_src = source_service.list_cached_tables("src")
        assert len(cached_src) == 2

    def test_get_cached_table(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test getting a specific cached table."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        source_service.cache_table("src", "users")

        cached = source_service.get_cached_table("src_users")
        assert cached is not None
        assert cached.source_table == "users"

        # Non-existent
        assert source_service.get_cached_table("nonexistent") is None

    def test_refresh_cache(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test refreshing a cached table."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        # Initial cache
        source_service.cache_table("src", "users")

        # Refresh
        refreshed = source_service.refresh_cache("src_users")
        assert refreshed.row_count == 3

    def test_drop_cache(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test dropping a cached table."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        source_service.cache_table("src", "users")

        assert source_service.drop_cache("src_users") is True
        assert source_service.get_cached_table("src_users") is None

        # Dropping non-existent returns False
        assert source_service.drop_cache("nonexistent") is False


class TestSmartCache:
    """Test smart cache suggestion functionality."""

    def test_estimate_small_table(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test size estimation for small table."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        estimate = source_service.estimate_table_size("src", "users")

        assert estimate["estimated_rows"] == 3
        assert estimate["recommend_cache"] is False  # Small table
        assert "작아서" in estimate["suggestion"] or "Live" in estimate["suggestion"]

    def test_estimate_nonexistent_source(self, source_service: SourceService):
        """Test error handling for non-existent source."""
        with pytest.raises(SourceNotFoundError):
            source_service.estimate_table_size("nonexistent", "users")


class TestCleanupExpired:
    """Test expired cache cleanup."""

    def test_cleanup_expired_caches(
        self, source_service: SourceService, sample_sqlite_db: Path
    ):
        """Test cleaning up expired caches."""
        source_service.attach_source(
            name="src",
            source_type=SourceType.SQLITE,
            config={"path": str(sample_sqlite_db)},
        )

        # Cache with immediate expiry (0 hours = already expired)
        source_service.cache_table("src", "users", expires_hours=0)

        # Manually set expiry to past
        with duckdb.connect(str(source_service.warehouse_path)) as con:
            con.execute(
                """
                UPDATE _sources.cached_tables
                SET expires_at = TIMESTAMP '2020-01-01 00:00:00'
                WHERE local_table = 'src_users'
                """
            )

        # Cleanup
        count = source_service.cleanup_expired_caches()
        assert count == 1

        # Cache should be gone
        assert source_service.get_cached_table("src_users") is None

