"""Asset API Router - Saved Analysis and File Asset management.

Provides REST endpoints for:
1. Analysis CRUD (create, read, update, delete)
2. Execution (compile, execute, run)
3. Status queries (freshness, lineage, history)
4. File Asset management (CSV/Parquet imports)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from pluto_duck_backend.app.services.asset import get_asset_service

router = APIRouter(prefix="/asset", tags=["asset"])


# =============================================================================
# Request/Response Models
# =============================================================================


class ParameterDefRequest(BaseModel):
    """Parameter definition in request."""

    name: str
    type: str = "string"
    required: bool = False
    default: Optional[Any] = None
    description: Optional[str] = None


class CreateAnalysisRequest(BaseModel):
    """Request to create an Analysis."""

    sql: str = Field(..., description="SQL query")
    name: str = Field(..., description="Human-readable name")
    analysis_id: Optional[str] = Field(None, description="Unique ID (auto-generated if not provided)")
    description: Optional[str] = Field(None, description="Description")
    materialization: Literal["view", "table", "append", "parquet"] = Field(
        "view", description="Materialization strategy"
    )
    parameters: Optional[List[ParameterDefRequest]] = Field(None, description="Parameter definitions")
    tags: Optional[List[str]] = Field(None, description="Tags for categorization")


class UpdateAnalysisRequest(BaseModel):
    """Request to update an Analysis."""

    sql: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    materialization: Optional[Literal["view", "table", "append", "parquet"]] = None
    parameters: Optional[List[ParameterDefRequest]] = None
    tags: Optional[List[str]] = None


class CompileRequest(BaseModel):
    """Request to compile an analysis."""

    params: Optional[Dict[str, Any]] = Field(None, description="Parameter values")
    force: bool = Field(False, description="Force recompilation ignoring freshness")


class ExecuteRequest(BaseModel):
    """Request to execute an analysis."""

    params: Optional[Dict[str, Any]] = Field(None, description="Parameter values")
    force: bool = Field(False, description="Force execution ignoring freshness")
    continue_on_failure: bool = Field(
        False,
        description="Continue executing remaining steps even if one fails"
    )


class AnalysisResponse(BaseModel):
    """Response for an Analysis."""

    id: str
    name: str
    sql: str
    description: Optional[str] = None
    materialization: str
    parameters: List[Dict[str, Any]] = []
    tags: List[str] = []
    result_table: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ExecutionStepResponse(BaseModel):
    """Response for an execution step."""

    analysis_id: str
    action: str
    reason: Optional[str] = None
    operation: Optional[str] = None
    target_table: Optional[str] = None


class ExecutionPlanResponse(BaseModel):
    """Response for an execution plan."""

    target_id: str
    steps: List[ExecutionStepResponse]
    params: Dict[str, Any] = {}


class StepResultResponse(BaseModel):
    """Response for a step result."""

    run_id: str
    analysis_id: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    rows_affected: Optional[int] = None
    error: Optional[str] = None


class ExecutionResultResponse(BaseModel):
    """Response for execution result."""

    success: bool
    target_id: str
    step_results: List[StepResultResponse]


class FreshnessResponse(BaseModel):
    """Response for freshness status."""

    analysis_id: str
    is_stale: bool
    last_run_at: Optional[datetime] = None
    stale_reason: Optional[str] = None


class LineageNodeResponse(BaseModel):
    """A node in lineage."""

    type: str
    id: str
    name: Optional[str] = None
    full: Optional[str] = None


class LineageResponse(BaseModel):
    """Response for lineage information."""

    analysis_id: str
    upstream: List[LineageNodeResponse]
    downstream: List[LineageNodeResponse]


class LineageGraphNode(BaseModel):
    """A node in the full lineage graph."""

    id: str
    type: str  # analysis, source, file
    name: Optional[str] = None
    materialization: Optional[str] = None
    is_stale: Optional[bool] = None
    last_run_at: Optional[datetime] = None


class LineageGraphEdge(BaseModel):
    """An edge in the full lineage graph."""

    source: str
    target: str


class LineageGraphResponse(BaseModel):
    """Response for full lineage graph."""

    nodes: List[LineageGraphNode]
    edges: List[LineageGraphEdge]


class RunHistoryResponse(BaseModel):
    """Response for run history entry."""

    run_id: str
    analysis_id: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    rows_affected: Optional[int] = None
    error_message: Optional[str] = None


class AnalysisDataResponse(BaseModel):
    """Response for analysis data."""

    columns: List[str]
    rows: List[List[Any]]
    total_rows: int


class ExportAnalysisRequest(BaseModel):
    """Request to export analysis results to a CSV file path."""

    file_path: str = Field(..., description="Destination path for the CSV file")
    force: bool = Field(False, description="Force execution even if fresh")


class ExportAnalysisResponse(BaseModel):
    """Response for analysis export."""

    status: str
    file_path: str


# Local import after model declarations to avoid circular dependencies.
from pluto_duck_backend.app.api.v1.asset.analyses import router as analyses_router
from pluto_duck_backend.app.api.v1.asset.diagnosis import router as diagnosis_router
from pluto_duck_backend.app.api.v1.asset.files import router as files_router

router.include_router(analyses_router, prefix="/analyses", tags=["asset"])
router.include_router(files_router, prefix="/files", tags=["asset"])
router.include_router(diagnosis_router, prefix="/files", tags=["asset"])


@router.get("/lineage-graph", response_model=LineageGraphResponse)
def get_lineage_graph(
    project_id: Optional[str] = Query(None),
) -> LineageGraphResponse:
    """Get the full lineage graph for all analyses.

    Returns all analyses as nodes and their dependencies as edges.
    Useful for visualizing the entire data pipeline.
    """
    service = get_asset_service(project_id)
    analyses = service.list_analyses()

    nodes: List[LineageGraphNode] = []
    edges: List[LineageGraphEdge] = []
    seen_sources: set = set()

    settings = get_settings()
    with connect_warehouse(settings.duckdb.path) as conn:
        for analysis in analyses:
            # Get freshness status
            try:
                freshness = service.get_freshness(analysis.id, conn)
                is_stale = freshness.is_stale
                last_run_at = freshness.last_run_at
            except Exception:
                is_stale = None
                last_run_at = None

            # Add analysis node
            nodes.append(
                LineageGraphNode(
                    id=f"analysis:{analysis.id}",
                    type="analysis",
                    name=analysis.name,
                    materialization=analysis.materialize,
                    is_stale=is_stale,
                    last_run_at=last_run_at,
                )
            )

            # Add edges for dependencies
            for ref in analysis.depends_on:
                source_id = f"{ref.type.value}:{ref.name}"

                # Add source/file nodes if not seen
                if ref.type.value != "analysis" and source_id not in seen_sources:
                    seen_sources.add(source_id)
                    nodes.append(
                        LineageGraphNode(
                            id=source_id,
                            type=ref.type.value,
                            name=ref.name,
                        )
                    )

                # Add edge
                edges.append(
                    LineageGraphEdge(
                        source=source_id,
                        target=f"analysis:{analysis.id}",
                    )
                )

    return LineageGraphResponse(nodes=nodes, edges=edges)
