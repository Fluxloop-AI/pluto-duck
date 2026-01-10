"""Asset service - Saved Analysis management with duckpipe integration.

This service wraps duckpipe Pipeline to provide:
1. Analysis CRUD with project isolation
2. Execution with HITL support (compile → review → execute)
3. Freshness and lineage tracking
4. Run history queries
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import duckdb

from duckpipe import (
    Analysis,
    ExecutionPlan,
    ExecutionResult,
    FileMetadataStore,
    ParameterDef,
    Pipeline,
    Ref,
    RefType,
)
from duckpipe.errors import AnalysisNotFoundError as DuckpipeNotFoundError

from pluto_duck_backend.app.core.config import get_settings
from .errors import AssetError, AssetNotFoundError, AssetExecutionError, AssetValidationError


@dataclass
class FreshnessStatus:
    """Freshness status for an analysis."""

    is_stale: bool
    last_run_at: Optional[datetime] = None
    stale_reason: Optional[str] = None


@dataclass
class LineageInfo:
    """Lineage information for an analysis."""

    upstream: List[Dict[str, Any]]  # Dependencies
    downstream: List[Dict[str, Any]]  # Dependents


@dataclass
class RunHistoryEntry:
    """A single run history entry."""

    run_id: str
    analysis_id: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    rows_affected: Optional[int] = None
    error_message: Optional[str] = None


def _to_snake_case(name: str) -> str:
    """Convert a name to snake_case for analysis ID."""
    # Remove special characters, keep alphanumeric and spaces
    name = re.sub(r"[^\w\s]", "", name)
    # Replace spaces with underscores
    name = re.sub(r"\s+", "_", name)
    # Convert CamelCase to snake_case
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    # Lowercase
    name = name.lower()
    # Remove consecutive underscores
    name = re.sub(r"_+", "_", name)
    # Strip leading/trailing underscores
    name = name.strip("_")
    return name or "unnamed"


class AssetService:
    """Service for managing Saved Analyses (Assets).

    Wraps duckpipe Pipeline to provide:
    - CRUD operations for Analysis definitions
    - Plan-before-execute pattern for HITL integration
    - Freshness tracking and lineage queries
    - Run history management

    Example:
        service = AssetService(project_id, warehouse_path)

        # Create an analysis
        analysis = service.create_analysis(
            analysis_id="monthly_sales",
            sql="SELECT month, SUM(amount) FROM orders GROUP BY 1",
            name="월별 매출",
            materialization="table",
        )

        # Compile for review
        plan = service.compile_analysis("monthly_sales", conn)

        # Execute after approval
        result = service.execute_plan(plan, conn)
    """

    def __init__(
        self,
        project_id: str,
        warehouse_path: Path,
        analyses_dir: Optional[Path] = None,
    ):
        """Initialize the asset service.

        Args:
            project_id: Project identifier for isolation
            warehouse_path: Path to the main DuckDB warehouse
            analyses_dir: Directory for Analysis YAML files
                         (default: {warehouse_path.parent}/analyses/{project_id}/)
        """
        self.project_id = project_id
        self.warehouse_path = warehouse_path

        # Set up analyses directory
        if analyses_dir is None:
            analyses_dir = warehouse_path.parent / "analyses" / project_id
        self.analyses_dir = analyses_dir
        self.analyses_dir.mkdir(parents=True, exist_ok=True)

        # Initialize duckpipe components
        self._store = FileMetadataStore(self.analyses_dir)
        self._pipeline = Pipeline(self._store)

    # =========================================================================
    # CRUD Operations
    # =========================================================================

    def create_analysis(
        self,
        sql: str,
        name: str,
        *,
        analysis_id: Optional[str] = None,
        description: Optional[str] = None,
        materialization: Literal["view", "table", "append", "parquet"] = "view",
        parameters: Optional[List[Dict[str, Any]]] = None,
        tags: Optional[List[str]] = None,
        depends_on: Optional[List[str]] = None,
    ) -> Analysis:
        """Create a new Analysis.

        Args:
            sql: SQL query for the analysis
            name: Human-readable name
            analysis_id: Unique identifier (auto-generated from name if not provided)
            description: Optional description
            materialization: How to materialize results ("view", "table", "append", "parquet")
            parameters: Optional parameter definitions
            tags: Optional tags for categorization
            depends_on: Optional explicit dependencies

        Returns:
            Created Analysis

        Raises:
            AssetValidationError: If validation fails
        """
        # Generate ID from name if not provided
        if not analysis_id:
            analysis_id = _to_snake_case(name)

        # Check for existing
        if self._store.exists(analysis_id):
            raise AssetValidationError(f"Analysis '{analysis_id}' already exists")

        # Parse parameters
        param_defs = []
        if parameters:
            for p in parameters:
                param_defs.append(
                    ParameterDef(
                        name=p["name"],
                        type=p.get("type", "string"),
                        required=p.get("required", False),
                        default=p.get("default"),
                        description=p.get("description"),
                    )
                )

        # Parse depends_on to Refs
        refs = []
        if depends_on:
            for dep in depends_on:
                refs.append(Ref.parse(dep))

        # Create Analysis
        analysis = Analysis(
            id=analysis_id,
            name=name,
            sql=sql,
            description=description,
            materialize=materialization,
            parameters=param_defs,
            tags=tags or [],
            depends_on=refs,
        )

        # Register with pipeline (auto-extracts deps if not provided)
        self._pipeline.register(analysis)

        return analysis

    def get_analysis(self, analysis_id: str) -> Optional[Analysis]:
        """Get an Analysis by ID.

        Args:
            analysis_id: Analysis identifier

        Returns:
            Analysis if found, None otherwise
        """
        return self._pipeline.get(analysis_id)

    def list_analyses(self, tags: Optional[List[str]] = None) -> List[Analysis]:
        """List all analyses, optionally filtered by tags.

        Args:
            tags: Optional tags to filter by

        Returns:
            List of Analysis objects
        """
        all_analyses = self._pipeline.list_all()

        if tags:
            return [a for a in all_analyses if set(tags) & set(a.tags)]

        return all_analyses

    def update_analysis(
        self,
        analysis_id: str,
        *,
        sql: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        materialization: Optional[Literal["view", "table", "append", "parquet"]] = None,
        parameters: Optional[List[Dict[str, Any]]] = None,
        tags: Optional[List[str]] = None,
    ) -> Analysis:
        """Update an existing Analysis.

        Args:
            analysis_id: Analysis identifier
            sql: New SQL (optional)
            name: New name (optional)
            description: New description (optional)
            materialization: New materialization strategy (optional)
            parameters: New parameters (optional)
            tags: New tags (optional)

        Returns:
            Updated Analysis

        Raises:
            AssetNotFoundError: If analysis doesn't exist
        """
        analysis = self._pipeline.get(analysis_id)
        if not analysis:
            raise AssetNotFoundError(analysis_id)

        # Apply updates
        if sql is not None:
            analysis.sql = sql
            # Re-extract dependencies
            analysis.depends_on = []

        if name is not None:
            analysis.name = name

        if description is not None:
            analysis.description = description

        if materialization is not None:
            analysis.materialize = materialization

        if parameters is not None:
            analysis.parameters = [
                ParameterDef(
                    name=p["name"],
                    type=p.get("type", "string"),
                    required=p.get("required", False),
                    default=p.get("default"),
                    description=p.get("description"),
                )
                for p in parameters
            ]

        if tags is not None:
            analysis.tags = tags

        # Re-register to save and update deps
        self._pipeline.register(analysis)

        return analysis

    def delete_analysis(self, analysis_id: str) -> bool:
        """Delete an Analysis.

        Args:
            analysis_id: Analysis identifier

        Returns:
            True if deleted, False if not found
        """
        if not self._store.exists(analysis_id):
            return False

        self._pipeline.delete(analysis_id)
        return True

    # =========================================================================
    # Execution
    # =========================================================================

    def compile_analysis(
        self,
        analysis_id: str,
        conn: duckdb.DuckDBPyConnection,
        *,
        params: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> ExecutionPlan:
        """Compile an execution plan for review.

        This does NOT execute anything - use for HITL review.

        Args:
            analysis_id: Analysis to compile
            conn: DuckDB connection for freshness check
            params: Parameter values
            force: If True, plan all steps as RUN regardless of freshness

        Returns:
            ExecutionPlan for review

        Raises:
            AssetNotFoundError: If analysis doesn't exist
        """
        try:
            return self._pipeline.compile(
                analysis_id,
                params=params,
                force=force,
                conn=conn,
            )
        except DuckpipeNotFoundError as e:
            raise AssetNotFoundError(analysis_id) from e

    def execute_plan(
        self,
        plan: ExecutionPlan,
        conn: duckdb.DuckDBPyConnection,
        *,
        continue_on_failure: bool = False,
    ) -> ExecutionResult:
        """Execute a compiled plan.

        Call this after HITL approval.

        Args:
            plan: Execution plan from compile_analysis()
            conn: DuckDB connection
            continue_on_failure: If True, continue executing remaining steps
                                 even if one fails (skipping dependent steps)

        Returns:
            ExecutionResult with step-by-step results
        """
        return self._pipeline.execute(conn, plan, continue_on_failure=continue_on_failure)

    def run_analysis(
        self,
        analysis_id: str,
        conn: duckdb.DuckDBPyConnection,
        *,
        params: Optional[Dict[str, Any]] = None,
        force: bool = False,
        continue_on_failure: bool = False,
    ) -> ExecutionResult:
        """Compile and execute in one step.

        Use for already-approved analyses or non-interactive contexts.

        Args:
            analysis_id: Analysis to run
            conn: DuckDB connection
            params: Parameter values
            force: If True, run regardless of freshness
            continue_on_failure: If True, continue executing remaining steps
                                 even if one fails

        Returns:
            ExecutionResult
        """
        plan = self.compile_analysis(analysis_id, conn, params=params, force=force)
        return self.execute_plan(plan, conn, continue_on_failure=continue_on_failure)

    # =========================================================================
    # Freshness & Status
    # =========================================================================

    def get_freshness(
        self,
        analysis_id: str,
        conn: duckdb.DuckDBPyConnection,
    ) -> FreshnessStatus:
        """Get freshness status for an analysis.

        Args:
            analysis_id: Analysis identifier
            conn: DuckDB connection

        Returns:
            FreshnessStatus with is_stale flag and details
        """
        analysis = self._pipeline.get(analysis_id)
        if not analysis:
            raise AssetNotFoundError(analysis_id)

        # Ensure schemas exist
        try:
            conn.execute("CREATE SCHEMA IF NOT EXISTS _duckpipe")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS _duckpipe.run_state (
                    analysis_id TEXT PRIMARY KEY,
                    last_run_id TEXT,
                    last_run_at TIMESTAMP,
                    last_run_status TEXT,
                    last_run_error TEXT
                )
            """)
        except duckdb.Error:
            pass

        # Check run state
        try:
            row = conn.execute(
                """
                SELECT last_run_at, last_run_status
                FROM _duckpipe.run_state
                WHERE analysis_id = ?
                """,
                [analysis_id],
            ).fetchone()
        except duckdb.Error:
            # Schema doesn't exist yet
            return FreshnessStatus(is_stale=True, stale_reason="never run")

        if not row or not row[0]:
            return FreshnessStatus(is_stale=True, stale_reason="never run")

        last_run_at = row[0]
        if last_run_at and last_run_at.tzinfo is None:
            last_run_at = last_run_at.replace(tzinfo=UTC)

        last_run_status = row[1]

        # Check if any dependency has been updated since last run
        is_stale = False
        stale_reason = None

        for ref in analysis.depends_on:
            if ref.type != RefType.ANALYSIS:
                continue

            dep_state = conn.execute(
                """
                SELECT last_run_at FROM _duckpipe.run_state WHERE analysis_id = ?
                """,
                [ref.name],
            ).fetchone()

            if dep_state and dep_state[0]:
                dep_run_at = dep_state[0]
                # Ensure timezone-aware comparison
                if dep_run_at.tzinfo is None:
                    dep_run_at = dep_run_at.replace(tzinfo=UTC)
                if dep_run_at > last_run_at:
                    is_stale = True
                    stale_reason = f"dependency '{ref.id}' updated"
                    break

        return FreshnessStatus(
            is_stale=is_stale,
            last_run_at=last_run_at,
            stale_reason=stale_reason,
        )

    # =========================================================================
    # Lineage
    # =========================================================================

    def get_lineage(
        self,
        analysis_id: str,
    ) -> LineageInfo:
        """Get lineage information for an analysis.

        Args:
            analysis_id: Analysis identifier

        Returns:
            LineageInfo with upstream and downstream dependencies
        """
        analysis = self._pipeline.get(analysis_id)
        if not analysis:
            raise AssetNotFoundError(analysis_id)

        # Get upstream (what this analysis depends on)
        upstream = []
        for ref in analysis.depends_on:
            upstream.append({
                "type": ref.type.value,
                "id": ref.name,
                "full": str(ref),
            })

        # Get downstream (what depends on this analysis)
        downstream = []
        all_analyses = self._pipeline.list_all()
        for a in all_analyses:
            for ref in a.depends_on:
                if ref.type == RefType.ANALYSIS and ref.name == analysis_id:
                    downstream.append({
                        "type": "analysis",
                        "id": a.id,
                        "name": a.name,
                    })
                    break

        return LineageInfo(upstream=upstream, downstream=downstream)

    # =========================================================================
    # Run History
    # =========================================================================

    def get_run_history(
        self,
        analysis_id: str,
        conn: duckdb.DuckDBPyConnection,
        *,
        limit: int = 10,
    ) -> List[RunHistoryEntry]:
        """Get execution history for an analysis.

        Args:
            analysis_id: Analysis identifier
            conn: DuckDB connection
            limit: Maximum number of entries

        Returns:
            List of RunHistoryEntry
        """
        # Ensure schema exists
        try:
            conn.execute("CREATE SCHEMA IF NOT EXISTS _duckpipe")
            conn.execute("""
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
            """)
        except duckdb.Error:
            pass

        try:
            rows = conn.execute(
                """
                SELECT run_id, analysis_id, status, started_at, finished_at,
                       duration_ms, rows_affected, error
                FROM _duckpipe.run_history
                WHERE analysis_id = ?
                ORDER BY started_at DESC
                LIMIT ?
                """,
                [analysis_id, limit],
            ).fetchall()
        except duckdb.Error:
            return []

        entries = []
        for row in rows:
            started_at = row[3]
            finished_at = row[4]

            if started_at and started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=UTC)
            if finished_at and finished_at.tzinfo is None:
                finished_at = finished_at.replace(tzinfo=UTC)

            entries.append(
                RunHistoryEntry(
                    run_id=row[0],
                    analysis_id=row[1],
                    status=row[2],
                    started_at=started_at,
                    finished_at=finished_at,
                    duration_ms=row[5],
                    rows_affected=row[6],
                    error_message=row[7],
                )
            )

        return entries

    def get_last_run(
        self,
        analysis_id: str,
        conn: duckdb.DuckDBPyConnection,
    ) -> Optional[RunHistoryEntry]:
        """Get the most recent run for an analysis.

        Args:
            analysis_id: Analysis identifier
            conn: DuckDB connection

        Returns:
            Most recent RunHistoryEntry or None
        """
        history = self.get_run_history(analysis_id, conn, limit=1)
        return history[0] if history else None


# =============================================================================
# Singleton factory
# =============================================================================


_asset_services: Dict[str, AssetService] = {}


def get_asset_service(project_id: Optional[str] = None) -> AssetService:
    """Get an AssetService instance for a project.

    Args:
        project_id: Project ID (uses default if not provided)

    Returns:
        AssetService instance
    """
    from pluto_duck_backend.app.services.chat import get_chat_repository

    settings = get_settings()

    if project_id is None:
        chat_repo = get_chat_repository()
        project_id = chat_repo._default_project_id

    if project_id not in _asset_services:
        _asset_services[project_id] = AssetService(
            project_id=project_id,
            warehouse_path=settings.duckdb.path,
        )

    return _asset_services[project_id]

