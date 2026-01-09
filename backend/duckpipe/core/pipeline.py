"""Pipeline - the main duckpipe orchestrator."""

from __future__ import annotations

import json
from datetime import datetime
from graphlib import CycleError, TopologicalSorter
from typing import Any, Dict, List, Optional, Set
from uuid import uuid4

import duckdb

from duckpipe.core.analysis import Analysis
from duckpipe.core.plan import ExecutionPlan, ExecutionStep, StepAction
from duckpipe.core.ref import Ref, RefType
from duckpipe.core.result import AnalysisStatus, ExecutionResult, StepResult
from duckpipe.errors import AnalysisNotFoundError, CircularDependencyError, ValidationError
from duckpipe.parsing.compiler import compile_sql, validate_identifier
from duckpipe.parsing.sql import extract_dependencies
from duckpipe.storage.base import MetadataStore


class Pipeline:
    """
    Main duckpipe orchestrator.

    Manages Analysis registration, compilation, and execution.

    Key methods:
    - register(): Add/update an Analysis
    - compile(): Generate an ExecutionPlan (no DB changes)
    - execute(): Run an ExecutionPlan (DB changes)
    - run(): compile + execute in one call

    Example:
        >>> from duckpipe import Pipeline, Analysis, FileMetadataStore
        >>> store = FileMetadataStore(Path("./analyses"))
        >>> pipe = Pipeline(store)
        >>>
        >>> pipe.register(Analysis(
        ...     id="test",
        ...     name="Test",
        ...     sql="SELECT 1",
        ...     materialize="table"
        ... ))
        >>>
        >>> plan = pipe.compile("test")
        >>> result = pipe.execute(conn, plan)
    """

    def __init__(self, metadata_store: MetadataStore) -> None:
        """
        Initialize Pipeline.

        Args:
            metadata_store: Storage backend for Analysis metadata
        """
        self.metadata = metadata_store
        self._dag_cache: Optional[Dict[str, List[str]]] = None

    # ─────────────────────────────────────────────────
    # Registration
    # ─────────────────────────────────────────────────

    def register(self, analysis: Analysis) -> None:
        """
        Register or update an Analysis.

        Automatically extracts dependencies if not provided.
        Validates the analysis ID.

        Args:
            analysis: Analysis to register
        """
        # Validate ID
        validate_identifier(analysis.id)

        # Auto-extract dependencies if empty
        if not analysis.depends_on:
            analysis.depends_on = extract_dependencies(analysis.sql)

        # Set timestamps
        if not analysis.created_at:
            analysis.created_at = datetime.now()
        analysis.updated_at = datetime.now()

        # Save
        self.metadata.save(analysis)
        self._invalidate_dag_cache()

    def get(self, analysis_id: str) -> Optional[Analysis]:
        """Get an Analysis by ID."""
        return self.metadata.get(analysis_id)

    def list_all(self) -> List[Analysis]:
        """List all registered analyses."""
        return self.metadata.list_all()

    def delete(self, analysis_id: str) -> None:
        """Delete an Analysis by ID."""
        self.metadata.delete(analysis_id)
        self._invalidate_dag_cache()

    # ─────────────────────────────────────────────────
    # Compile (Plan Generation)
    # ─────────────────────────────────────────────────

    def compile(
        self,
        analysis_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        force: bool = False,
        conn: Optional[duckdb.DuckDBPyConnection] = None,
    ) -> ExecutionPlan:
        """
        Generate an execution plan.

        This does NOT execute anything - it only plans.
        Use this for HITL review before execution.

        Args:
            analysis_id: Target analysis to execute
            params: Parameters for the target analysis
            force: If True, ignore freshness and plan all as RUN
            conn: DuckDB connection for freshness check (optional)

        Returns:
            ExecutionPlan with all steps in topological order
        """
        analysis = self.metadata.get(analysis_id)
        if not analysis:
            raise AnalysisNotFoundError(analysis_id)

        # Ensure schemas exist if conn provided (for freshness check)
        if conn:
            self._ensure_schemas(conn)

        # Collect analysis dependencies
        all_analysis_ids = self._collect_analysis_dependencies(analysis_id)

        # Topological sort
        execution_order = self._topological_sort(all_analysis_ids)

        # Build steps
        steps = []
        for aid in execution_order:
            a = self.metadata.get(aid)
            if not a:
                continue

            # Determine action
            if force:
                action = StepAction.RUN
                reason = "forced"
            elif conn and not self._is_stale(conn, a):
                action = StepAction.SKIP
                reason = "already fresh"
            else:
                action = StepAction.RUN
                reason = "stale" if conn else "no freshness check"

            # Compile SQL for RUN steps
            compiled_sql = None
            bound_params = None
            operation = None

            if action == StepAction.RUN:
                # Only target analysis gets params
                step_params = params if aid == analysis_id else None
                compiled_sql, bound_params = compile_sql(
                    a.sql,
                    a.materialize,
                    a.result_table,
                    step_params,
                )
                operation = self._get_operation_name(a.materialize)

            steps.append(
                ExecutionStep(
                    analysis_id=aid,
                    action=action,
                    reason=reason,
                    compiled_sql=compiled_sql,
                    bound_params=bound_params,
                    target_table=a.result_table if action == StepAction.RUN else None,
                    operation=operation,
                )
            )

        return ExecutionPlan(
            target_id=analysis_id,
            steps=steps,
            params=params or {},
        )

    def _get_operation_name(self, materialize: str) -> str:
        """Get SQL operation name for materialization type."""
        return {
            "view": "CREATE OR REPLACE VIEW",
            "table": "CREATE OR REPLACE TABLE",
            "append": "INSERT INTO",
            "parquet": "COPY TO FILE",
        }.get(materialize, "UNKNOWN")

    # ─────────────────────────────────────────────────
    # Execute (Plan Execution)
    # ─────────────────────────────────────────────────

    def execute(
        self,
        conn: duckdb.DuckDBPyConnection,
        plan: ExecutionPlan,
        *,
        continue_on_failure: bool = False,
    ) -> ExecutionResult:
        """
        Execute a compiled plan.

        Args:
            conn: DuckDB connection (injected)
            plan: Execution plan from compile()
            continue_on_failure: If True, continue executing remaining steps
                                 even if one fails. Default is False.

        Returns:
            ExecutionResult with all step results
        """
        # Ensure schemas exist
        self._ensure_schemas(conn)

        step_results = []
        success = True
        failed_deps: set[str] = set()  # Track failed analyses for dependency skipping

        for step in plan.steps:
            # Check if any dependency failed (skip if so)
            if continue_on_failure and failed_deps:
                analysis = self.metadata.get(step.analysis_id)
                if analysis:
                    dep_ids = {ref.name for ref in analysis.depends_on if ref.type == RefType.ANALYSIS}
                    if dep_ids & failed_deps:
                        step_results.append(
                            StepResult(
                                run_id=str(uuid4()),
                                analysis_id=step.analysis_id,
                                status="skipped",
                                started_at=datetime.now(),
                                error="Skipped: dependency failed",
                            )
                        )
                        continue

            if step.action == StepAction.SKIP:
                step_results.append(
                    StepResult(
                        run_id=str(uuid4()),
                        analysis_id=step.analysis_id,
                        status="skipped",
                        started_at=datetime.now(),
                    )
                )
                continue

            if step.action == StepAction.FAIL:
                step_results.append(
                    StepResult(
                        run_id=str(uuid4()),
                        analysis_id=step.analysis_id,
                        status="skipped",
                        started_at=datetime.now(),
                        error=step.reason,
                    )
                )
                continue

            # Execute RUN step
            result = self._execute_step(conn, step)
            step_results.append(result)

            if result.status == "failed":
                success = False
                failed_deps.add(step.analysis_id)
                if not continue_on_failure:
                    break  # Stop on failure (default behavior)

        return ExecutionResult(
            plan=plan,
            success=success,
            step_results=step_results,
        )

    def _execute_step(
        self,
        conn: duckdb.DuckDBPyConnection,
        step: ExecutionStep,
    ) -> StepResult:
        """Execute a single step."""
        run_id = str(uuid4())
        started_at = datetime.now()

        # Record start
        conn.execute(
            """
            INSERT INTO _duckpipe.run_history (run_id, analysis_id, started_at, status)
            VALUES (?, ?, ?, 'running')
            """,
            [run_id, step.analysis_id, started_at],
        )

        try:
            # Handle append: ensure table exists
            if step.operation == "INSERT INTO":
                analysis = self.metadata.get(step.analysis_id)
                if analysis:
                    self._ensure_append_table(conn, analysis)

            # Execute SQL
            if step.bound_params:
                conn.execute(step.compiled_sql, step.bound_params)
            else:
                conn.execute(step.compiled_sql)

            # Get row count for table materialization
            rows_affected = None
            if step.operation in ("CREATE OR REPLACE TABLE", "INSERT INTO"):
                try:
                    count = conn.execute(
                        f"SELECT COUNT(*) FROM {step.target_table}"
                    ).fetchone()
                    rows_affected = count[0] if count else None
                except Exception:
                    pass

            finished_at = datetime.now()
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)

            # Record success
            self._record_run_end(
                conn, run_id, step.analysis_id, "success", rows_affected, None, duration_ms
            )

            return StepResult(
                run_id=run_id,
                analysis_id=step.analysis_id,
                status="success",
                started_at=started_at,
                finished_at=finished_at,
                rows_affected=rows_affected,
                duration_ms=duration_ms,
            )

        except Exception as e:
            finished_at = datetime.now()
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)
            error_msg = str(e)

            # Record failure
            self._record_run_end(
                conn, run_id, step.analysis_id, "failed", None, error_msg, duration_ms
            )

            return StepResult(
                run_id=run_id,
                analysis_id=step.analysis_id,
                status="failed",
                started_at=started_at,
                finished_at=finished_at,
                error=error_msg,
                duration_ms=duration_ms,
            )

    def _ensure_append_table(
        self, conn: duckdb.DuckDBPyConnection, analysis: Analysis
    ) -> None:
        """Ensure table exists for append mode."""
        try:
            # Check if table exists
            conn.execute(f"SELECT 1 FROM {analysis.result_table} LIMIT 0")
        except Exception:
            # Table doesn't exist, create from query structure
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {analysis.result_table} AS
                SELECT * FROM ({analysis.sql}) WHERE FALSE
                """
            )

    # ─────────────────────────────────────────────────
    # Convenience: run = compile + execute
    # ─────────────────────────────────────────────────

    def run(
        self,
        conn: duckdb.DuckDBPyConnection,
        analysis_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        force: bool = False,
        continue_on_failure: bool = False,
    ) -> ExecutionResult:
        """
        Compile and execute in one call.

        Equivalent to: execute(conn, compile(analysis_id, ...), continue_on_failure=...)

        Args:
            conn: DuckDB connection
            analysis_id: Target analysis
            params: Parameters for target analysis
            force: Ignore freshness check

        Returns:
            ExecutionResult
        """
        plan = self.compile(analysis_id, params=params, force=force, conn=conn)
        return self.execute(conn, plan, continue_on_failure=continue_on_failure)

    # ─────────────────────────────────────────────────
    # Status & History
    # ─────────────────────────────────────────────────

    def status(
        self, conn: duckdb.DuckDBPyConnection, analysis_id: str
    ) -> AnalysisStatus:
        """Get status of an Analysis."""
        analysis = self.metadata.get(analysis_id)
        if not analysis:
            raise AnalysisNotFoundError(analysis_id)

        self._ensure_schemas(conn)

        # Get last run state
        state = conn.execute(
            """
            SELECT last_run_at, last_run_status
            FROM _duckpipe.run_state
            WHERE analysis_id = ?
            """,
            [analysis_id],
        ).fetchone()

        last_run_at = state[0] if state else None
        last_run_status = state[1] if state else None

        # Get reverse dependencies
        depended_by = []
        for a in self.metadata.list_all():
            if any(
                ref.type == RefType.ANALYSIS and ref.name == analysis_id
                for ref in a.depends_on
            ):
                depended_by.append(a.id)

        return AnalysisStatus(
            analysis_id=analysis_id,
            is_stale=self._is_stale(conn, analysis),
            last_run_at=last_run_at,
            last_run_status=last_run_status,
            depends_on=[str(ref) for ref in analysis.depends_on],
            depended_by=depended_by,
        )

    def get_run_history(
        self,
        conn: duckdb.DuckDBPyConnection,
        analysis_id: str,
        limit: int = 10,
    ) -> List[StepResult]:
        """Get run history for an Analysis."""
        self._ensure_schemas(conn)

        rows = conn.execute(
            """
            SELECT run_id, analysis_id, started_at, finished_at,
                   status, rows_affected, error, duration_ms
            FROM _duckpipe.run_history
            WHERE analysis_id = ?
            ORDER BY started_at DESC
            LIMIT ?
            """,
            [analysis_id, limit],
        ).fetchall()

        return [
            StepResult(
                run_id=row[0],
                analysis_id=row[1],
                started_at=row[2],
                finished_at=row[3],
                status=row[4],
                rows_affected=row[5],
                error=row[6],
                duration_ms=row[7],
            )
            for row in rows
        ]

    def preview(
        self,
        conn: duckdb.DuckDBPyConnection,
        analysis_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Preview analysis results without materializing."""
        analysis = self.metadata.get(analysis_id)
        if not analysis:
            raise AnalysisNotFoundError(analysis_id)

        # Compile in preview mode
        compiled_sql, bound_params = compile_sql(
            analysis.sql,
            "preview",
            None,
            params,
        )

        preview_sql = f"SELECT * FROM ({compiled_sql}) AS _preview LIMIT {limit}"

        if bound_params:
            result = conn.execute(preview_sql, bound_params)
        else:
            result = conn.execute(preview_sql)

        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()

        return [dict(zip(columns, row)) for row in rows]

    # ─────────────────────────────────────────────────
    # DAG
    # ─────────────────────────────────────────────────

    def get_dag(self) -> Dict[str, List[str]]:
        """Get dependency DAG (analysis_id → [dependency_ids])."""
        if self._dag_cache is not None:
            return self._dag_cache

        dag = {}
        for analysis in self.metadata.list_all():
            dag[analysis.id] = analysis.get_analysis_dependencies()

        self._dag_cache = dag
        return dag

    # ─────────────────────────────────────────────────
    # Private Methods
    # ─────────────────────────────────────────────────

    def _ensure_schemas(self, conn: duckdb.DuckDBPyConnection) -> None:
        """Ensure required schemas and tables exist."""
        # Analysis results schema
        conn.execute("CREATE SCHEMA IF NOT EXISTS analysis")

        # Runtime state schema
        conn.execute("CREATE SCHEMA IF NOT EXISTS _duckpipe")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS _duckpipe.run_history (
                run_id TEXT PRIMARY KEY,
                analysis_id TEXT NOT NULL,
                started_at TIMESTAMP NOT NULL,
                finished_at TIMESTAMP,
                status TEXT NOT NULL,
                rows_affected BIGINT,
                error TEXT,
                duration_ms INTEGER,
                params JSON
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS _duckpipe.run_state (
                analysis_id TEXT PRIMARY KEY,
                last_run_id TEXT,
                last_run_at TIMESTAMP,
                last_run_status TEXT,
                last_run_error TEXT
            )
            """
        )

    def _record_run_end(
        self,
        conn: duckdb.DuckDBPyConnection,
        run_id: str,
        analysis_id: str,
        status: str,
        rows_affected: Optional[int],
        error: Optional[str],
        duration_ms: int,
    ) -> None:
        """Record run completion."""
        finished_at = datetime.now()

        # Update history
        conn.execute(
            """
            UPDATE _duckpipe.run_history
            SET finished_at = ?, status = ?, rows_affected = ?, error = ?, duration_ms = ?
            WHERE run_id = ?
            """,
            [finished_at, status, rows_affected, error, duration_ms, run_id],
        )

        # Update state (upsert)
        conn.execute(
            """
            INSERT INTO _duckpipe.run_state 
                (analysis_id, last_run_id, last_run_at, last_run_status, last_run_error)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (analysis_id) DO UPDATE SET
                last_run_id = EXCLUDED.last_run_id,
                last_run_at = EXCLUDED.last_run_at,
                last_run_status = EXCLUDED.last_run_status,
                last_run_error = EXCLUDED.last_run_error
            """,
            [analysis_id, run_id, finished_at, status, error],
        )

    def _is_stale(
        self, conn: duckdb.DuckDBPyConnection, analysis: Analysis
    ) -> bool:
        """Check if analysis needs refresh."""
        state = conn.execute(
            """
            SELECT last_run_at FROM _duckpipe.run_state WHERE analysis_id = ?
            """,
            [analysis.id],
        ).fetchone()

        if not state or not state[0]:
            return True  # Never run

        last_run_at = state[0]

        # Check if any analysis dependency is newer
        for ref in analysis.depends_on:
            if ref.type != RefType.ANALYSIS:
                continue  # Sources are always "fresh"

            dep_state = conn.execute(
                """
                SELECT last_run_at FROM _duckpipe.run_state WHERE analysis_id = ?
                """,
                [ref.name],
            ).fetchone()

            if dep_state and dep_state[0] and dep_state[0] > last_run_at:
                return True

        return False

    def _collect_analysis_dependencies(self, analysis_id: str) -> Set[str]:
        """Recursively collect all analysis dependencies."""
        visited: Set[str] = set()

        def collect(aid: str) -> None:
            if aid in visited:
                return
            visited.add(aid)

            analysis = self.metadata.get(aid)
            if not analysis:
                return

            for ref in analysis.depends_on:
                if ref.type == RefType.ANALYSIS:
                    collect(ref.name)

        collect(analysis_id)
        return visited

    def _topological_sort(self, analysis_ids: Set[str]) -> List[str]:
        """Topologically sort analysis IDs."""
        graph: Dict[str, Set[str]] = {}

        for aid in analysis_ids:
            analysis = self.metadata.get(aid)
            if analysis:
                deps = set(analysis.get_analysis_dependencies()) & analysis_ids
                graph[aid] = deps
            else:
                graph[aid] = set()

        ts = TopologicalSorter(graph)
        try:
            return list(ts.static_order())
        except CycleError as e:
            raise CircularDependencyError(str(e))

    def _invalidate_dag_cache(self) -> None:
        """Invalidate DAG cache."""
        self._dag_cache = None

