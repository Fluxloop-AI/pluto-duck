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

import duckdb
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.asset import (
    AssetService,
    get_asset_service,
    AssetNotFoundError,
    FileAssetService,
    FileAsset,
    get_file_asset_service,
)
from pluto_duck_backend.app.services.asset.errors import AssetValidationError, AssetError


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


# =============================================================================
# Helper functions
# =============================================================================


def _get_connection() -> duckdb.DuckDBPyConnection:
    """Get a DuckDB connection."""
    settings = get_settings()
    return duckdb.connect(str(settings.duckdb.path))


def _analysis_to_response(analysis) -> AnalysisResponse:
    """Convert Analysis to response model."""
    return AnalysisResponse(
        id=analysis.id,
        name=analysis.name,
        sql=analysis.sql,
        description=analysis.description,
        materialization=analysis.materialize,
        parameters=[
            {
                "name": p.name,
                "type": p.type,
                "required": p.required,
                "default": p.default,
                "description": p.description,
            }
            for p in (analysis.parameters or [])
        ],
        tags=analysis.tags or [],
        result_table=analysis.result_table,
        created_at=analysis.created_at,
        updated_at=analysis.updated_at,
    )


# =============================================================================
# CRUD Endpoints
# =============================================================================


@router.post("/analyses", response_model=AnalysisResponse)
def create_analysis(
    request: CreateAnalysisRequest,
    project_id: Optional[str] = Query(None),
) -> AnalysisResponse:
    """Create a new Analysis."""
    service = get_asset_service(project_id)

    try:
        analysis = service.create_analysis(
            sql=request.sql,
            name=request.name,
            analysis_id=request.analysis_id,
            description=request.description,
            materialization=request.materialization,
            parameters=[p.model_dump() for p in request.parameters] if request.parameters else None,
            tags=request.tags,
        )
        return _analysis_to_response(analysis)
    except AssetValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/analyses", response_model=List[AnalysisResponse])
def list_analyses(
    tags: Optional[List[str]] = Query(None),
    project_id: Optional[str] = Query(None),
) -> List[AnalysisResponse]:
    """List all analyses."""
    service = get_asset_service(project_id)
    analyses = service.list_analyses(tags)
    return [_analysis_to_response(a) for a in analyses]


@router.get("/analyses/{analysis_id}", response_model=AnalysisResponse)
def get_analysis(
    analysis_id: str,
    project_id: Optional[str] = Query(None),
) -> AnalysisResponse:
    """Get an Analysis by ID."""
    service = get_asset_service(project_id)
    analysis = service.get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return _analysis_to_response(analysis)


@router.patch("/analyses/{analysis_id}", response_model=AnalysisResponse)
def update_analysis(
    analysis_id: str,
    request: UpdateAnalysisRequest,
    project_id: Optional[str] = Query(None),
) -> AnalysisResponse:
    """Update an existing Analysis."""
    service = get_asset_service(project_id)

    try:
        analysis = service.update_analysis(
            analysis_id,
            sql=request.sql,
            name=request.name,
            description=request.description,
            materialization=request.materialization,
            parameters=[p.model_dump() for p in request.parameters] if request.parameters else None,
            tags=request.tags,
        )
        return _analysis_to_response(analysis)
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")


@router.delete("/analyses/{analysis_id}")
def delete_analysis(
    analysis_id: str,
    project_id: Optional[str] = Query(None),
) -> Dict[str, str]:
    """Delete an Analysis."""
    service = get_asset_service(project_id)

    if not service.delete_analysis(analysis_id):
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return {"status": "deleted", "analysis_id": analysis_id}


# =============================================================================
# Execution Endpoints
# =============================================================================


@router.post("/analyses/{analysis_id}/compile", response_model=ExecutionPlanResponse)
def compile_analysis(
    analysis_id: str,
    request: CompileRequest,
    project_id: Optional[str] = Query(None),
) -> ExecutionPlanResponse:
    """Compile an execution plan for review."""
    service = get_asset_service(project_id)

    with _get_connection() as conn:
        try:
            plan = service.compile_analysis(
                analysis_id,
                conn,
                params=request.params,
                force=request.force,
            )
        except AssetNotFoundError:
            raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return ExecutionPlanResponse(
        target_id=plan.target_id,
        steps=[
            ExecutionStepResponse(
                analysis_id=s.analysis_id,
                action=s.action.value if hasattr(s.action, "value") else str(s.action),
                reason=s.reason,
                operation=s.operation,
                target_table=s.target_table,
            )
            for s in plan.steps
        ],
        params=plan.params or {},
    )


@router.post("/analyses/{analysis_id}/execute", response_model=ExecutionResultResponse)
def execute_analysis(
    analysis_id: str,
    request: ExecuteRequest,
    project_id: Optional[str] = Query(None),
) -> ExecutionResultResponse:
    """Compile and execute an analysis."""
    service = get_asset_service(project_id)

    with _get_connection() as conn:
        try:
            result = service.run_analysis(
                analysis_id,
                conn,
                params=request.params,
                force=request.force,
                continue_on_failure=request.continue_on_failure,
            )
        except AssetNotFoundError:
            raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return ExecutionResultResponse(
        success=result.success,
        target_id=result.plan.target_id,
        step_results=[
            StepResultResponse(
                run_id=sr.run_id,
                analysis_id=sr.analysis_id,
                status=sr.status,
                started_at=sr.started_at,
                finished_at=sr.finished_at,
                duration_ms=sr.duration_ms,
                rows_affected=sr.rows_affected,
                error=sr.error,
            )
            for sr in result.step_results
        ],
    )


class AnalysisDataResponse(BaseModel):
    """Response for analysis data."""

    columns: List[str]
    rows: List[List[Any]]
    total_rows: int


@router.get("/analyses/{analysis_id}/data", response_model=AnalysisDataResponse)
def get_analysis_data(
    analysis_id: str,
    project_id: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0),
) -> AnalysisDataResponse:
    """Get the result data from an analysis.

    Returns the materialized data (table/view) for the analysis.
    Use after executing the analysis to fetch its output.
    """
    service = get_asset_service(project_id)
    analysis = service.get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    # The result table is stored in the analysis schema
    result_table = analysis.result_table
    if not result_table:
        raise HTTPException(status_code=400, detail="Analysis has no result table")

    with _get_connection() as conn:
        try:
            # Get total count
            count_result = conn.execute(f"SELECT COUNT(*) FROM {result_table}").fetchone()
            total_rows = count_result[0] if count_result else 0

            # Get data with pagination
            result = conn.execute(
                f"SELECT * FROM {result_table} LIMIT {limit} OFFSET {offset}"
            )
            columns = [desc[0] for desc in result.description] if result.description else []
            rows = [list(row) for row in result.fetchall()]

            return AnalysisDataResponse(
                columns=columns,
                rows=rows,
                total_rows=total_rows,
            )
        except duckdb.Error as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch data: {e}")


# =============================================================================
# Status Endpoints
# =============================================================================


@router.get("/analyses/{analysis_id}/freshness", response_model=FreshnessResponse)
def get_freshness(
    analysis_id: str,
    project_id: Optional[str] = Query(None),
) -> FreshnessResponse:
    """Get freshness status for an analysis."""
    service = get_asset_service(project_id)

    with _get_connection() as conn:
        try:
            status = service.get_freshness(analysis_id, conn)
        except AssetNotFoundError:
            raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return FreshnessResponse(
        analysis_id=analysis_id,
        is_stale=status.is_stale,
        last_run_at=status.last_run_at,
        stale_reason=status.stale_reason,
    )


@router.get("/analyses/{analysis_id}/lineage", response_model=LineageResponse)
def get_lineage(
    analysis_id: str,
    project_id: Optional[str] = Query(None),
) -> LineageResponse:
    """Get lineage information for an analysis."""
    service = get_asset_service(project_id)

    try:
        lineage = service.get_lineage(analysis_id)
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return LineageResponse(
        analysis_id=analysis_id,
        upstream=[
            LineageNodeResponse(
                type=node["type"],
                id=node["id"],
                full=node.get("full"),
            )
            for node in lineage.upstream
        ],
        downstream=[
            LineageNodeResponse(
                type=node["type"],
                id=node["id"],
                name=node.get("name"),
            )
            for node in lineage.downstream
        ],
    )


@router.get("/analyses/{analysis_id}/history", response_model=List[RunHistoryResponse])
def get_run_history(
    analysis_id: str,
    limit: int = Query(10, ge=1, le=100),
    project_id: Optional[str] = Query(None),
) -> List[RunHistoryResponse]:
    """Get run history for an analysis."""
    service = get_asset_service(project_id)

    with _get_connection() as conn:
        history = service.get_run_history(analysis_id, conn, limit=limit)

    return [
        RunHistoryResponse(
            run_id=h.run_id,
            analysis_id=h.analysis_id,
            status=h.status,
            started_at=h.started_at,
            finished_at=h.finished_at,
            duration_ms=h.duration_ms,
            rows_affected=h.rows_affected,
            error_message=h.error_message,
        )
        for h in history
    ]


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

    with _get_connection() as conn:
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


# =============================================================================
# File Asset Request/Response Models
# =============================================================================


class ImportFileRequest(BaseModel):
    """Request to import a file."""

    file_path: str = Field(..., description="Path to the source file")
    file_type: Literal["csv", "parquet"] = Field(..., description="Type of file")
    table_name: str = Field(..., description="Name for the DuckDB table")
    name: Optional[str] = Field(None, description="Human-readable name")
    description: Optional[str] = Field(None, description="Description")
    overwrite: bool = Field(True, description="Overwrite existing table")


class FileAssetResponse(BaseModel):
    """Response for a file asset."""

    id: str
    name: str
    file_path: str
    file_type: str
    table_name: str
    description: Optional[str] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    file_size_bytes: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class FileSchemaResponse(BaseModel):
    """Response for file schema."""

    columns: List[Dict[str, Any]]


class FilePreviewResponse(BaseModel):
    """Response for file data preview."""

    columns: List[str]
    rows: List[List[Any]]
    total_rows: Optional[int] = None


def _file_asset_to_response(asset: FileAsset) -> FileAssetResponse:
    """Convert FileAsset to response model."""
    return FileAssetResponse(
        id=asset.id,
        name=asset.name,
        file_path=asset.file_path,
        file_type=asset.file_type,
        table_name=asset.table_name,
        description=asset.description,
        row_count=asset.row_count,
        column_count=asset.column_count,
        file_size_bytes=asset.file_size_bytes,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )


# =============================================================================
# File Asset Endpoints
# =============================================================================


@router.post("/files", response_model=FileAssetResponse)
def import_file(
    request: ImportFileRequest,
    project_id: Optional[str] = Query(None),
) -> FileAssetResponse:
    """Import a CSV or Parquet file into DuckDB.

    This creates a table from the file and registers it as a File Asset.
    File Assets go directly to Asset Zone (no ATTACH, no TTL).
    """
    service = get_file_asset_service(project_id)

    try:
        asset = service.import_file(
            file_path=request.file_path,
            file_type=request.file_type,
            table_name=request.table_name,
            name=request.name,
            description=request.description,
            overwrite=request.overwrite,
        )
        return _file_asset_to_response(asset)
    except AssetValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except AssetError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files", response_model=List[FileAssetResponse])
def list_files(
    project_id: Optional[str] = Query(None),
) -> List[FileAssetResponse]:
    """List all file assets for the project."""
    service = get_file_asset_service(project_id)
    assets = service.list_files()
    return [_file_asset_to_response(a) for a in assets]


@router.get("/files/{file_id}", response_model=FileAssetResponse)
def get_file(
    file_id: str,
    project_id: Optional[str] = Query(None),
) -> FileAssetResponse:
    """Get a file asset by ID."""
    service = get_file_asset_service(project_id)
    asset = service.get_file(file_id)

    if not asset:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    return _file_asset_to_response(asset)


@router.delete("/files/{file_id}")
def delete_file(
    file_id: str,
    drop_table: bool = Query(True, description="Also drop the DuckDB table"),
    project_id: Optional[str] = Query(None),
) -> Dict[str, str]:
    """Delete a file asset."""
    service = get_file_asset_service(project_id)

    if not service.delete_file(file_id, drop_table=drop_table):
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    return {"status": "deleted", "file_id": file_id}


@router.post("/files/{file_id}/refresh", response_model=FileAssetResponse)
def refresh_file(
    file_id: str,
    project_id: Optional[str] = Query(None),
) -> FileAssetResponse:
    """Refresh a file asset by re-importing from the source file."""
    service = get_file_asset_service(project_id)

    try:
        asset = service.refresh_file(file_id)
        return _file_asset_to_response(asset)
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")
    except AssetError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/{file_id}/schema", response_model=FileSchemaResponse)
def get_file_schema(
    file_id: str,
    project_id: Optional[str] = Query(None),
) -> FileSchemaResponse:
    """Get the schema of the imported table."""
    service = get_file_asset_service(project_id)

    try:
        columns = service.get_table_schema(file_id)
        return FileSchemaResponse(columns=columns)
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")


@router.get("/files/{file_id}/preview", response_model=FilePreviewResponse)
def preview_file_data(
    file_id: str,
    limit: int = Query(100, ge=1, le=1000),
    project_id: Optional[str] = Query(None),
) -> FilePreviewResponse:
    """Preview data from the imported table."""
    service = get_file_asset_service(project_id)

    try:
        data = service.preview_data(file_id, limit=limit)
        return FilePreviewResponse(
            columns=data["columns"],
            rows=data["rows"],
            total_rows=data["total_rows"],
        )
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

