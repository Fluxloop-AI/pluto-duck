"""Tests for the Asset service."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import duckdb
import pytest

from pluto_duck_backend.app.services.asset import AssetService, AssetNotFoundError
from pluto_duck_backend.app.services.asset.errors import AssetValidationError


@pytest.fixture
def temp_dir(tmp_path: Path) -> Path:
    """Create temporary directories."""
    return tmp_path


@pytest.fixture
def warehouse_path(temp_dir: Path) -> Path:
    """Create a temporary warehouse."""
    return temp_dir / "warehouse.duckdb"


@pytest.fixture
def asset_service(temp_dir: Path, warehouse_path: Path) -> AssetService:
    """Create an AssetService instance."""
    return AssetService(
        project_id="test-project",
        warehouse_path=warehouse_path,
        analyses_dir=temp_dir / "analyses",
    )


@pytest.fixture
def db_conn(warehouse_path: Path) -> duckdb.DuckDBPyConnection:
    """Create a DuckDB connection."""
    return duckdb.connect(str(warehouse_path))


class TestAssetServiceInit:
    """Test AssetService initialization."""

    def test_creates_analyses_dir(self, temp_dir: Path, warehouse_path: Path):
        """Ensure analyses directory is created."""
        analyses_dir = temp_dir / "analyses"
        assert not analyses_dir.exists()

        AssetService(
            project_id="test",
            warehouse_path=warehouse_path,
            analyses_dir=analyses_dir,
        )

        assert analyses_dir.exists()


class TestCreateAnalysis:
    """Test create_analysis functionality."""

    def test_create_simple_analysis(self, asset_service: AssetService):
        """Test creating a simple analysis."""
        analysis = asset_service.create_analysis(
            sql="SELECT 1 as value",
            name="Test Analysis",
        )

        assert analysis.id == "test_analysis"
        assert analysis.name == "Test Analysis"
        assert analysis.sql == "SELECT 1 as value"
        assert analysis.materialize == "view"

    def test_create_with_custom_id(self, asset_service: AssetService):
        """Test creating with custom ID."""
        analysis = asset_service.create_analysis(
            sql="SELECT 1",
            name="My Analysis",
            analysis_id="custom_id",
        )

        assert analysis.id == "custom_id"

    def test_create_with_materialization(self, asset_service: AssetService):
        """Test different materialization strategies."""
        for mat in ["view", "table", "append", "parquet"]:
            analysis = asset_service.create_analysis(
                sql="SELECT 1",
                name=f"Test {mat}",
                analysis_id=f"test_{mat}",
                materialization=mat,
            )
            assert analysis.materialize == mat

    def test_create_with_tags(self, asset_service: AssetService):
        """Test creating with tags."""
        analysis = asset_service.create_analysis(
            sql="SELECT 1",
            name="Tagged Analysis",
            tags=["sales", "monthly"],
        )

        assert analysis.tags == ["sales", "monthly"]

    def test_create_with_description(self, asset_service: AssetService):
        """Test creating with description."""
        analysis = asset_service.create_analysis(
            sql="SELECT 1",
            name="Described Analysis",
            description="This is a test analysis",
        )

        assert analysis.description == "This is a test analysis"

    def test_create_duplicate_fails(self, asset_service: AssetService):
        """Test that creating duplicate fails."""
        asset_service.create_analysis(
            sql="SELECT 1",
            name="Duplicate",
            analysis_id="duplicate",
        )

        with pytest.raises(AssetValidationError):
            asset_service.create_analysis(
                sql="SELECT 2",
                name="Duplicate 2",
                analysis_id="duplicate",
            )


class TestGetAnalysis:
    """Test get_analysis functionality."""

    def test_get_existing(self, asset_service: AssetService):
        """Test getting existing analysis."""
        asset_service.create_analysis(sql="SELECT 1", name="Test", analysis_id="test")

        analysis = asset_service.get_analysis("test")
        assert analysis is not None
        assert analysis.id == "test"

    def test_get_nonexistent(self, asset_service: AssetService):
        """Test getting non-existent analysis."""
        analysis = asset_service.get_analysis("nonexistent")
        assert analysis is None


class TestListAnalyses:
    """Test list_analyses functionality."""

    def test_list_empty(self, asset_service: AssetService):
        """Test listing when empty."""
        analyses = asset_service.list_analyses()
        assert len(analyses) == 0

    def test_list_multiple(self, asset_service: AssetService):
        """Test listing multiple analyses."""
        asset_service.create_analysis(sql="SELECT 1", name="A1", analysis_id="a1")
        asset_service.create_analysis(sql="SELECT 2", name="A2", analysis_id="a2")
        asset_service.create_analysis(sql="SELECT 3", name="A3", analysis_id="a3")

        analyses = asset_service.list_analyses()
        assert len(analyses) == 3

    def test_list_filter_by_tags(self, asset_service: AssetService):
        """Test filtering by tags."""
        asset_service.create_analysis(
            sql="SELECT 1", name="Sales", analysis_id="sales", tags=["sales", "report"]
        )
        asset_service.create_analysis(
            sql="SELECT 2", name="Marketing", analysis_id="marketing", tags=["marketing"]
        )

        sales = asset_service.list_analyses(tags=["sales"])
        assert len(sales) == 1
        assert sales[0].id == "sales"

        report = asset_service.list_analyses(tags=["report"])
        assert len(report) == 1


class TestUpdateAnalysis:
    """Test update_analysis functionality."""

    def test_update_sql(self, asset_service: AssetService):
        """Test updating SQL."""
        asset_service.create_analysis(sql="SELECT 1", name="Test", analysis_id="test")

        updated = asset_service.update_analysis("test", sql="SELECT 2")
        assert updated.sql == "SELECT 2"

    def test_update_name(self, asset_service: AssetService):
        """Test updating name."""
        asset_service.create_analysis(sql="SELECT 1", name="Old Name", analysis_id="test")

        updated = asset_service.update_analysis("test", name="New Name")
        assert updated.name == "New Name"

    def test_update_nonexistent_fails(self, asset_service: AssetService):
        """Test updating non-existent fails."""
        with pytest.raises(AssetNotFoundError):
            asset_service.update_analysis("nonexistent", name="New Name")


class TestDeleteAnalysis:
    """Test delete_analysis functionality."""

    def test_delete_existing(self, asset_service: AssetService):
        """Test deleting existing analysis."""
        asset_service.create_analysis(sql="SELECT 1", name="Test", analysis_id="to_delete")

        assert asset_service.delete_analysis("to_delete") is True
        assert asset_service.get_analysis("to_delete") is None

    def test_delete_nonexistent(self, asset_service: AssetService):
        """Test deleting non-existent."""
        assert asset_service.delete_analysis("nonexistent") is False


class TestCompileAndExecute:
    """Test compile and execute functionality."""

    def test_compile_analysis(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test compiling an analysis."""
        asset_service.create_analysis(
            sql="SELECT 1 as value",
            name="Test",
            analysis_id="test",
            materialization="table",
        )

        plan = asset_service.compile_analysis("test", db_conn)

        assert plan.target_id == "test"
        assert len(plan.steps) >= 1

    def test_execute_analysis(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test executing an analysis."""
        asset_service.create_analysis(
            sql="SELECT 1 as value",
            name="Test",
            analysis_id="test",
            materialization="table",
        )

        result = asset_service.run_analysis("test", db_conn)

        assert result.success is True

    def test_execute_view(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test executing a view analysis."""
        asset_service.create_analysis(
            sql="SELECT 42 as answer",
            name="Answer",
            analysis_id="answer",
            materialization="view",
        )

        result = asset_service.run_analysis("answer", db_conn)
        assert result.success is True

        # Query the view (uses analysis.{id} schema)
        row = db_conn.execute("SELECT * FROM analysis.answer").fetchone()
        assert row[0] == 42

    def test_execute_table(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test executing a table analysis."""
        asset_service.create_analysis(
            sql="SELECT 1 as a, 2 as b, 3 as c",
            name="Table Test",
            analysis_id="table_test",
            materialization="table",
        )

        result = asset_service.run_analysis("table_test", db_conn)
        assert result.success is True

        # Query the table (uses analysis.{id} schema)
        row = db_conn.execute("SELECT * FROM analysis.table_test").fetchone()
        assert row == (1, 2, 3)


class TestFreshness:
    """Test freshness functionality."""

    def test_freshness_never_run(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test freshness for never-run analysis."""
        asset_service.create_analysis(
            sql="SELECT 1",
            name="Never Run",
            analysis_id="never_run",
        )

        freshness = asset_service.get_freshness("never_run", db_conn)
        assert freshness.is_stale is True
        assert freshness.stale_reason == "never run"

    def test_freshness_after_run(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test freshness after running."""
        asset_service.create_analysis(
            sql="SELECT 1",
            name="Run Test",
            analysis_id="run_test",
            materialization="table",
        )

        # Run it
        asset_service.run_analysis("run_test", db_conn)

        # Check freshness
        freshness = asset_service.get_freshness("run_test", db_conn)
        assert freshness.is_stale is False
        assert freshness.last_run_at is not None


class TestLineage:
    """Test lineage functionality."""

    def test_lineage_no_deps(self, asset_service: AssetService):
        """Test lineage with no dependencies."""
        asset_service.create_analysis(
            sql="SELECT 1",
            name="No Deps",
            analysis_id="no_deps",
        )

        lineage = asset_service.get_lineage("no_deps")
        # May have implicit deps from SQL parsing
        assert isinstance(lineage.upstream, list)
        assert isinstance(lineage.downstream, list)

    def test_lineage_with_downstream(self, asset_service: AssetService):
        """Test lineage with downstream."""
        asset_service.create_analysis(
            sql="SELECT 1 as val",
            name="Base",
            analysis_id="base",
        )

        # Create dependent analysis that explicitly depends on base
        # Using analysis.base table reference which duckpipe parses
        asset_service.create_analysis(
            sql="SELECT * FROM analysis.base",
            name="Dependent",
            analysis_id="dependent",
        )

        lineage = asset_service.get_lineage("base")
        # Should have dependent as downstream
        downstream_ids = [d["id"] for d in lineage.downstream]
        assert "dependent" in downstream_ids


class TestRunHistory:
    """Test run history functionality."""

    def test_history_empty(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test history when no runs."""
        asset_service.create_analysis(
            sql="SELECT 1",
            name="No History",
            analysis_id="no_history",
        )

        history = asset_service.get_run_history("no_history", db_conn)
        assert len(history) == 0

    def test_history_after_run(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test history after running."""
        asset_service.create_analysis(
            sql="SELECT 1",
            name="With History",
            analysis_id="with_history",
            materialization="table",
        )

        # Run it
        asset_service.run_analysis("with_history", db_conn)

        # Check history
        history = asset_service.get_run_history("with_history", db_conn)
        assert len(history) >= 1
        assert history[0].status == "success"

    def test_last_run(self, asset_service: AssetService, db_conn: duckdb.DuckDBPyConnection):
        """Test get_last_run."""
        asset_service.create_analysis(
            sql="SELECT 1",
            name="Last Run Test",
            analysis_id="last_run_test",
            materialization="table",
        )

        # No runs yet
        assert asset_service.get_last_run("last_run_test", db_conn) is None

        # Run it
        asset_service.run_analysis("last_run_test", db_conn)

        # Get last run
        last_run = asset_service.get_last_run("last_run_test", db_conn)
        assert last_run is not None
        assert last_run.status == "success"

