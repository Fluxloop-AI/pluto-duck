"""Tests for Pipeline class."""

from pathlib import Path

import duckdb
import pytest

from duckpipe import (
    Analysis,
    CircularDependencyError,
    AnalysisNotFoundError,
    FileMetadataStore,
    ParameterDef,
    Pipeline,
)
from duckpipe.core.plan import StepAction
from duckpipe.core.ref import Ref, RefType


@pytest.fixture
def metadata_store(tmp_path: Path) -> FileMetadataStore:
    """Create a temporary metadata store."""
    return FileMetadataStore(tmp_path / "analyses")


@pytest.fixture
def conn(tmp_path: Path) -> duckdb.DuckDBPyConnection:
    """Create a temporary DuckDB connection."""
    db_path = tmp_path / "test.duckdb"
    connection = duckdb.connect(str(db_path))
    yield connection
    connection.close()


@pytest.fixture
def pipe(metadata_store: FileMetadataStore) -> Pipeline:
    """Create a Pipeline instance."""
    return Pipeline(metadata_store)


class TestPipelineRegistration:
    """Test Analysis registration."""

    def test_register_simple(self, pipe: Pipeline):
        """Test registering a simple analysis."""
        pipe.register(
            Analysis(
                id="test",
                name="Test",
                sql="SELECT 1 as value",
            )
        )

        analysis = pipe.get("test")
        assert analysis is not None
        assert analysis.id == "test"
        assert analysis.name == "Test"

    def test_register_with_auto_dependencies(self, pipe: Pipeline):
        """Test that dependencies are auto-extracted."""
        pipe.register(
            Analysis(
                id="test",
                name="Test",
                sql="SELECT * FROM analysis.source_data",
            )
        )

        analysis = pipe.get("test")
        assert len(analysis.depends_on) == 1
        assert analysis.depends_on[0].type == RefType.ANALYSIS
        assert analysis.depends_on[0].name == "source_data"

    def test_list_all(self, pipe: Pipeline):
        """Test listing all analyses."""
        pipe.register(Analysis(id="a", name="A", sql="SELECT 1"))
        pipe.register(Analysis(id="b", name="B", sql="SELECT 2"))

        all_analyses = pipe.list_all()
        assert len(all_analyses) == 2

    def test_delete(self, pipe: Pipeline):
        """Test deleting an analysis."""
        pipe.register(Analysis(id="test", name="Test", sql="SELECT 1"))
        assert pipe.get("test") is not None

        pipe.delete("test")
        assert pipe.get("test") is None


class TestPipelineCompile:
    """Test compile() method."""

    def test_compile_simple(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test compiling a simple analysis."""
        pipe.register(
            Analysis(
                id="test",
                name="Test",
                sql="SELECT 1 as value",
                materialize="table",
            )
        )

        plan = pipe.compile("test")

        assert plan.target_id == "test"
        assert len(plan.steps) == 1
        assert plan.steps[0].analysis_id == "test"
        assert plan.steps[0].action == StepAction.RUN

    def test_compile_with_dependencies(self, pipe: Pipeline):
        """Test compiling with dependency chain."""
        pipe.register(Analysis(id="a", name="A", sql="SELECT 1 as value"))
        pipe.register(
            Analysis(
                id="b",
                name="B",
                sql="SELECT * FROM analysis.a",
                depends_on=[Ref(RefType.ANALYSIS, "a")],
            )
        )
        pipe.register(
            Analysis(
                id="c",
                name="C",
                sql="SELECT * FROM analysis.b",
                depends_on=[Ref(RefType.ANALYSIS, "b")],
            )
        )

        plan = pipe.compile("c")

        # Should have 3 steps in topological order
        assert len(plan.steps) == 3
        ids = [s.analysis_id for s in plan.steps]
        # a must come before b, b must come before c
        assert ids.index("a") < ids.index("b")
        assert ids.index("b") < ids.index("c")

    def test_compile_not_found(self, pipe: Pipeline):
        """Test compiling non-existent analysis."""
        with pytest.raises(AnalysisNotFoundError):
            pipe.compile("nonexistent")

    def test_compile_force(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test force flag."""
        pipe.register(Analysis(id="test", name="Test", sql="SELECT 1"))

        # First run
        pipe.run(conn, "test")

        # Without force, should skip
        plan = pipe.compile("test", conn=conn)
        assert plan.steps[0].action == StepAction.SKIP

        # With force, should run
        plan = pipe.compile("test", conn=conn, force=True)
        assert plan.steps[0].action == StepAction.RUN

    def test_compile_circular_dependency(self, pipe: Pipeline):
        """Test circular dependency detection."""
        pipe.register(
            Analysis(
                id="a",
                name="A",
                sql="SELECT * FROM analysis.b",
                depends_on=[Ref(RefType.ANALYSIS, "b")],
            )
        )
        pipe.register(
            Analysis(
                id="b",
                name="B",
                sql="SELECT * FROM analysis.a",
                depends_on=[Ref(RefType.ANALYSIS, "a")],
            )
        )

        with pytest.raises(CircularDependencyError):
            pipe.compile("a")


class TestPipelineExecute:
    """Test execute() method."""

    def test_execute_simple(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test executing a simple plan."""
        pipe.register(
            Analysis(
                id="test",
                name="Test",
                sql="SELECT 1 as value",
                materialize="table",
            )
        )

        plan = pipe.compile("test")
        result = pipe.execute(conn, plan)

        assert result.success
        assert len(result.step_results) == 1
        assert result.step_results[0].status == "success"

        # Verify table was created
        rows = conn.execute("SELECT * FROM analysis.test").fetchall()
        assert len(rows) == 1
        assert rows[0][0] == 1

    def test_execute_view(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test executing VIEW materialization."""
        pipe.register(
            Analysis(
                id="test",
                name="Test",
                sql="SELECT 1 as value",
                materialize="view",
            )
        )

        result = pipe.run(conn, "test")
        assert result.success

        # Verify view was created
        rows = conn.execute("SELECT * FROM analysis.test").fetchall()
        assert rows[0][0] == 1

    def test_execute_chain(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test executing dependency chain."""
        pipe.register(
            Analysis(
                id="a",
                name="A",
                sql="SELECT 1 as value",
                materialize="table",
            )
        )
        pipe.register(
            Analysis(
                id="b",
                name="B",
                sql="SELECT value * 2 as value FROM analysis.a",
                materialize="table",
                depends_on=[Ref(RefType.ANALYSIS, "a")],
            )
        )
        pipe.register(
            Analysis(
                id="c",
                name="C",
                sql="SELECT value * 3 as value FROM analysis.b",
                materialize="table",
                depends_on=[Ref(RefType.ANALYSIS, "b")],
            )
        )

        result = pipe.run(conn, "c")

        assert result.success
        assert len(result.step_results) == 3

        # Verify final result: 1 * 2 * 3 = 6
        rows = conn.execute("SELECT * FROM analysis.c").fetchall()
        assert rows[0][0] == 6


class TestPipelineParameters:
    """Test parameter handling."""

    def test_run_with_params(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test running with parameters."""
        pipe.register(
            Analysis(
                id="test",
                name="Test",
                sql="SELECT :value as v, :name as n",
                materialize="table",
                parameters=[
                    ParameterDef(name="value", type="int"),
                    ParameterDef(name="name", type="string"),
                ],
            )
        )

        result = pipe.run(
            conn,
            "test",
            params={"value": 42, "name": "hello"},
        )

        assert result.success

        rows = conn.execute("SELECT * FROM analysis.test").fetchall()
        assert rows[0][0] == 42
        assert rows[0][1] == "hello"


class TestPipelineStatus:
    """Test status and history methods."""

    def test_status(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test getting analysis status."""
        pipe.register(Analysis(id="test", name="Test", sql="SELECT 1"))

        # Before run
        status = pipe.status(conn, "test")
        assert status.is_stale
        assert status.last_run_at is None

        # After run
        pipe.run(conn, "test")
        status = pipe.status(conn, "test")
        assert not status.is_stale
        assert status.last_run_at is not None
        assert status.last_run_status == "success"

    def test_run_history(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test getting run history."""
        pipe.register(Analysis(id="test", name="Test", sql="SELECT 1"))

        # Run twice
        pipe.run(conn, "test", force=True)
        pipe.run(conn, "test", force=True)

        history = pipe.get_run_history(conn, "test")
        assert len(history) == 2
        assert all(r.status == "success" for r in history)

    def test_preview(self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection):
        """Test preview without materialization."""
        pipe.register(
            Analysis(
                id="test",
                name="Test",
                sql="SELECT :n as value",
                parameters=[ParameterDef(name="n", type="int")],
            )
        )

        rows = pipe.preview(conn, "test", params={"n": 42})
        assert len(rows) == 1
        assert rows[0]["value"] == 42

        # Verify table was NOT created
        with pytest.raises(Exception):
            conn.execute("SELECT * FROM analysis.test")


class TestPipelineDAG:
    """Test DAG methods."""

    def test_get_dag(self, pipe: Pipeline):
        """Test getting DAG."""
        pipe.register(Analysis(id="a", name="A", sql="SELECT 1"))
        pipe.register(
            Analysis(
                id="b",
                name="B",
                sql="SELECT * FROM analysis.a",
                depends_on=[Ref(RefType.ANALYSIS, "a")],
            )
        )
        pipe.register(
            Analysis(
                id="c",
                name="C",
                sql="SELECT * FROM analysis.a, analysis.b",
                depends_on=[
                    Ref(RefType.ANALYSIS, "a"),
                    Ref(RefType.ANALYSIS, "b"),
                ],
            )
        )

        dag = pipe.get_dag()

        assert dag["a"] == []
        assert dag["b"] == ["a"]
        assert set(dag["c"]) == {"a", "b"}


class TestPipelineFreshness:
    """Test freshness checking."""

    def test_freshness_after_dependency_update(
        self, pipe: Pipeline, conn: duckdb.DuckDBPyConnection
    ):
        """Test that analysis becomes stale when dependency is updated."""
        pipe.register(Analysis(id="a", name="A", sql="SELECT 1 as value"))
        pipe.register(
            Analysis(
                id="b",
                name="B",
                sql="SELECT * FROM analysis.a",
                depends_on=[Ref(RefType.ANALYSIS, "a")],
            )
        )

        # Run both
        pipe.run(conn, "b")

        # b should be fresh
        status = pipe.status(conn, "b")
        assert not status.is_stale

        # Update a
        pipe.run(conn, "a", force=True)

        # b should now be stale
        status = pipe.status(conn, "b")
        assert status.is_stale

