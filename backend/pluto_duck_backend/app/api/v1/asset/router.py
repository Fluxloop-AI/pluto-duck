"""Asset API Router - Saved Analysis and File Asset management.

Provides REST endpoints for:
1. Analysis CRUD (create, read, update, delete)
2. Execution (compile, execute, run)
3. Status queries (freshness, lineage, history)
4. File Asset management (CSV/Parquet imports)
"""

from __future__ import annotations

import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)
from datetime import datetime
from pathlib import Path
import tempfile
from typing import Any, Dict, List, Literal, Optional

import duckdb
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from pluto_duck_backend.app.services.asset import (
    AssetService,
    get_asset_service,
    AssetNotFoundError,
    FileAssetService,
    FileAsset,
    get_file_asset_service,
    FileDiagnosisService,
    get_file_diagnosis_service,
)
from pluto_duck_backend.app.services.asset.errors import AssetValidationError, AssetError, DiagnosisError


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


@contextmanager
def _get_connection():
    """Get a DuckDB connection (serialized for stability)."""
    settings = get_settings()
    with connect_warehouse(settings.duckdb.path) as conn:
        yield conn


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


def _cleanup_temp_file(path: Path) -> None:
    """Best-effort cleanup for temp files."""
    try:
        path.unlink()
    except FileNotFoundError:
        pass


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


class ExportAnalysisRequest(BaseModel):
    """Request to export analysis results to a CSV file path."""

    file_path: str = Field(..., description="Destination path for the CSV file")
    force: bool = Field(False, description="Force execution even if fresh")


class ExportAnalysisResponse(BaseModel):
    """Response for analysis export."""

    status: str
    file_path: str


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


@router.post("/analyses/{analysis_id}/export", response_model=ExportAnalysisResponse)
def export_analysis_csv(
    analysis_id: str,
    request: ExportAnalysisRequest,
    project_id: Optional[str] = Query(None),
) -> ExportAnalysisResponse:
    """Execute an analysis and export results to a CSV file path."""
    service = get_asset_service(project_id)
    analysis = service.get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    dest_path = Path(request.file_path).expanduser()
    if not dest_path.is_absolute():
        raise HTTPException(status_code=400, detail="file_path must be absolute")
    if dest_path.exists() and dest_path.is_dir():
        raise HTTPException(status_code=400, detail="file_path cannot be a directory")
    if dest_path.suffix.lower() != ".csv":
        dest_path = dest_path.with_suffix(".csv")
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    safe_path = str(dest_path).replace("'", "''")

    with _get_connection() as conn:
        try:
            result = service.run_analysis(
                analysis_id,
                conn,
                force=request.force,
                continue_on_failure=False,
            )
        except AssetNotFoundError:
            raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

        if not result.success:
            failed_step = next((s for s in result.step_results if s.status == "failed"), None)
            detail = failed_step.error if failed_step and failed_step.error else "Execution failed"
            raise HTTPException(status_code=500, detail=detail)

        try:
            conn.execute(
                f"COPY (SELECT * FROM {analysis.result_table}) TO '{safe_path}' (HEADER, DELIMITER ',')"
            )
        except duckdb.Error as e:
            raise HTTPException(status_code=500, detail=f"Failed to export CSV: {e}")

    return ExportAnalysisResponse(status="saved", file_path=str(dest_path))


@router.get("/analyses/{analysis_id}/download")
def download_analysis_csv(
    analysis_id: str,
    background_tasks: BackgroundTasks,
    project_id: Optional[str] = Query(None),
    force: bool = Query(False, description="Force execution even if fresh"),
) -> FileResponse:
    """Execute an analysis and download results as CSV."""
    service = get_asset_service(project_id)
    analysis = service.get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    with _get_connection() as conn:
        try:
            result = service.run_analysis(
                analysis_id,
                conn,
                force=force,
                continue_on_failure=False,
            )
        except AssetNotFoundError:
            raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

        if not result.success:
            failed_step = next((s for s in result.step_results if s.status == "failed"), None)
            detail = failed_step.error if failed_step and failed_step.error else "Execution failed"
            raise HTTPException(status_code=500, detail=detail)

        tmp_file = tempfile.NamedTemporaryFile(
            prefix=f"analysis_{analysis_id}_",
            suffix=".csv",
            delete=False,
        )
        tmp_path = Path(tmp_file.name)
        tmp_file.close()
        safe_path = str(tmp_path).replace("'", "''")

        try:
            conn.execute(
                f"COPY (SELECT * FROM {analysis.result_table}) TO '{safe_path}' (HEADER, DELIMITER ',')"
            )
        except duckdb.Error as e:
            _cleanup_temp_file(tmp_path)
            raise HTTPException(status_code=500, detail=f"Failed to export CSV: {e}")

    background_tasks.add_task(_cleanup_temp_file, tmp_path)
    filename = f"{analysis_id}.csv"
    return FileResponse(path=str(tmp_path), media_type="text/csv", filename=filename)


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
    table_name: str = Field(..., description="Name for the DuckDB table (for new tables)")
    name: Optional[str] = Field(None, description="Human-readable name")
    description: Optional[str] = Field(None, description="Description")
    overwrite: bool = Field(True, description="Overwrite existing table (replace mode only)")
    mode: Literal["replace", "append", "merge"] = Field(
        "replace", 
        description="Import mode: replace (new table), append (add rows), merge (upsert)"
    )
    target_table: Optional[str] = Field(
        None, 
        description="Existing table name for append/merge modes"
    )
    merge_keys: Optional[List[str]] = Field(
        None, 
        description="Column names for merge key (required for merge mode)"
    )
    deduplicate: bool = Field(
        False,
        description="When appending, skip rows that are exact duplicates of existing rows in the target table",
    )
    diagnosis_id: Optional[str] = Field(
        None,
        description="ID of the diagnosis to link to this file asset",
    )


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
    diagnosis_id: Optional[str] = None
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
        diagnosis_id=asset.diagnosis_id,
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

    Modes:
    - replace: Create new table or overwrite existing
    - append: Add rows to existing table
    - merge: Upsert based on merge_keys
    """
    logger.info(f"[import_file] Request received: table_name={request.table_name}, diagnosis_id={request.diagnosis_id}")
    service = get_file_asset_service(project_id)

    try:
        asset = service.import_file(
            file_path=request.file_path,
            file_type=request.file_type,
            table_name=request.table_name,
            name=request.name,
            description=request.description,
            overwrite=request.overwrite,
            mode=request.mode,
            target_table=request.target_table,
            merge_keys=request.merge_keys,
            deduplicate=request.deduplicate,
            diagnosis_id=request.diagnosis_id,
        )
        logger.info(f"[import_file] Asset created: id={asset.id}, diagnosis_id={asset.diagnosis_id}")
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


# =============================================================================
# Count Duplicates Request/Response Models
# =============================================================================


class CountDuplicatesFileRequest(BaseModel):
    """Request for a single file in count duplicates request."""

    file_path: str = Field(..., description="Path to the file")
    file_type: Literal["csv", "parquet"] = Field(..., description="Type of file")


class CountDuplicatesRequest(BaseModel):
    """Request to count duplicate rows across multiple files."""

    files: List[CountDuplicatesFileRequest] = Field(..., description="List of files to check for duplicates")


class CountDuplicatesResponse(BaseModel):
    """Response for duplicate row count."""

    total_rows: int = Field(..., description="Total number of rows across all files")
    duplicate_rows: int = Field(..., description="Number of duplicate rows")
    estimated_rows: int = Field(..., description="Estimated rows after deduplication (total - duplicates)")
    skipped: bool = Field(False, description="Whether calculation was skipped due to row limit")


# =============================================================================
# File Diagnosis Request/Response Models
# =============================================================================


class DiagnoseFileRequestModel(BaseModel):
    """Request for diagnosing a single file."""

    file_path: str = Field(..., description="Path to the file to diagnose")
    file_type: Literal["csv", "parquet"] = Field(..., description="Type of file")


class MergeContextRequest(BaseModel):
    """Request for merge context when files have identical schemas."""

    total_rows: int = Field(..., description="Total rows across all files")
    duplicate_rows: int = Field(..., description="Number of duplicate rows")
    estimated_rows: int = Field(..., description="Estimated rows after deduplication")
    skipped: bool = Field(False, description="Whether duplicate calculation was skipped due to row limit")


class DiagnoseFilesRequest(BaseModel):
    """Request to diagnose multiple files."""

    files: List[DiagnoseFileRequestModel] = Field(..., description="List of files to diagnose")
    use_cache: bool = Field(True, description="Use cached results if available")
    include_llm: bool = Field(False, description="Include LLM analysis (slower, provides insights)")
    include_merge_analysis: bool = Field(False, description="Include merged dataset analysis (requires include_llm=true)")
    merge_context: Optional[MergeContextRequest] = Field(None, description="Context for merging files with identical schemas")


class ColumnSchemaResponse(BaseModel):
    """Schema information for a single column."""

    name: str
    type: str
    nullable: bool = True


class TypeSuggestionResponse(BaseModel):
    """Suggestion for a better column type."""

    column_name: str
    current_type: str
    suggested_type: str
    confidence: float
    sample_values: List[str] = []


class EncodingInfoResponse(BaseModel):
    """Response for detected file encoding."""

    detected: str
    confidence: float


class ParsingIntegrityResponse(BaseModel):
    """Response for parsing integrity check."""

    total_lines: int
    parsed_rows: int
    malformed_rows: int
    has_errors: bool
    error_message: Optional[str] = None


class NumericStatsResponse(BaseModel):
    """Response for numeric column statistics."""

    min: Optional[float] = None
    max: Optional[float] = None
    median: Optional[float] = None
    mean: Optional[float] = None
    stddev: Optional[float] = None
    distinct_count: int = 0


class ValueFrequencyResponse(BaseModel):
    """Response for value frequency."""

    value: str
    frequency: int


class CategoricalStatsResponse(BaseModel):
    """Response for categorical column statistics."""

    unique_count: int
    top_values: List[ValueFrequencyResponse] = []
    avg_length: float = 0


class DateStatsResponse(BaseModel):
    """Response for date column statistics."""

    min_date: Optional[str] = None
    max_date: Optional[str] = None
    span_days: Optional[int] = None
    distinct_days: int = 0


class ColumnStatisticsResponse(BaseModel):
    """Response for column statistics."""

    column_name: str
    column_type: str
    semantic_type: str
    null_count: int
    null_percentage: float
    numeric_stats: Optional[NumericStatsResponse] = None
    categorical_stats: Optional[CategoricalStatsResponse] = None
    date_stats: Optional[DateStatsResponse] = None


class PotentialItemResponse(BaseModel):
    """Response for a potential analysis question."""

    question: str
    analysis: str


class IssueItemResponse(BaseModel):
    """Response for a data quality issue."""

    issue: str
    suggestion: str


class LLMAnalysisResponse(BaseModel):
    """Response for LLM-generated dataset analysis."""

    suggested_name: str
    context: str
    potential: List[PotentialItemResponse] = []
    issues: List[IssueItemResponse] = []
    analyzed_at: Optional[datetime] = None
    model_used: str


class FileDiagnosisResponse(BaseModel):
    """Response for a single file diagnosis."""

    file_path: str
    file_type: str
    columns: List[ColumnSchemaResponse] = Field(..., description="Column schema information")
    missing_values: Dict[str, int]
    row_count: int
    file_size_bytes: int
    type_suggestions: List[TypeSuggestionResponse] = []
    diagnosed_at: Optional[datetime] = None
    # Extended diagnosis fields
    encoding: Optional[EncodingInfoResponse] = None
    parsing_integrity: Optional[ParsingIntegrityResponse] = None
    column_statistics: List[ColumnStatisticsResponse] = []
    sample_rows: List[List[Any]] = []
    # LLM analysis result
    llm_analysis: Optional[LLMAnalysisResponse] = None
    # Diagnosis ID for linking to FileAsset
    diagnosis_id: Optional[str] = None


class MergedAnalysisResponse(BaseModel):
    """Response for LLM-generated merged dataset analysis."""

    suggested_name: str = Field(..., description="Suggested name for the merged dataset")
    context: str = Field(..., description="Description of the merged dataset")


class DiagnoseFilesResponse(BaseModel):
    """Response for multiple file diagnoses."""

    diagnoses: List[FileDiagnosisResponse]
    merged_analysis: Optional[MergedAnalysisResponse] = Field(None, description="Merged dataset analysis (when include_merge_analysis=true)")


# =============================================================================
# File Diagnosis Endpoints
# =============================================================================


@router.post("/files/count-duplicates", response_model=CountDuplicatesResponse)
def count_duplicate_rows(
    request: CountDuplicatesRequest,
    project_id: Optional[str] = Query(None),
) -> CountDuplicatesResponse:
    """Count duplicate rows across multiple files.

    This endpoint calculates the number of duplicate rows when merging files,
    allowing users to preview deduplication results before import.

    If total rows exceed 100,000, calculation is skipped and skipped=true is returned.
    """
    from pluto_duck_backend.app.services.asset.file_diagnosis_service import DiagnoseFileRequest

    service = get_file_diagnosis_service(project_id)

    # Convert request to DiagnoseFileRequest objects
    file_requests = [
        DiagnoseFileRequest(file_path=f.file_path, file_type=f.file_type)
        for f in request.files
    ]

    try:
        result = service.count_cross_file_duplicates(files=file_requests)
        return CountDuplicatesResponse(
            total_rows=result["total_rows"],
            duplicate_rows=result["duplicate_rows"],
            estimated_rows=result["estimated_rows"],
            skipped=result["skipped"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to count duplicates: {e}")


@router.post("/files/diagnose", response_model=DiagnoseFilesResponse)
async def diagnose_files(
    request: DiagnoseFilesRequest,
    project_id: Optional[str] = Query(None),
) -> DiagnoseFilesResponse:
    """Diagnose CSV or Parquet files before import.

    This endpoint analyzes files without importing them, providing:
    - Schema information (columns, types, nullable)
    - Missing value counts per column
    - Row count and file size
    - Type suggestions (optional, for detecting mismatched types)
    - LLM-generated analysis (when include_llm=true)
    - Merged dataset analysis (when include_merge_analysis=true with merge_context)

    Use this to preview data quality before creating tables.

    Set use_cache=false to force fresh diagnosis even if cached results exist.
    Set include_llm=true to include LLM-generated analysis (slower).
    Set include_merge_analysis=true with merge_context to get merged dataset name suggestion.
    """
    from pluto_duck_backend.app.services.asset.file_diagnosis_service import DiagnoseFileRequest

    service = get_file_diagnosis_service(project_id)

    # Convert request to DiagnoseFileRequest objects
    file_requests = [
        DiagnoseFileRequest(file_path=f.file_path, file_type=f.file_type)
        for f in request.files
    ]

    # Prepare merge_context dict if provided
    merge_context_dict = None
    if request.include_merge_analysis and request.merge_context:
        merge_context_dict = {
            "total_rows": request.merge_context.total_rows,
            "duplicate_rows": request.merge_context.duplicate_rows,
            "estimated_rows": request.merge_context.estimated_rows,
            "skipped": request.merge_context.skipped,
        }

    # Run diagnosis (with or without LLM analysis based on include_llm flag)
    merged_analysis_response: Optional[MergedAnalysisResponse] = None
    try:
        if request.include_llm:
            # Include LLM analysis (slower)
            diagnosis_result = await service.diagnose_files_with_llm(
                files=file_requests,
                use_cache=request.use_cache,
                merge_context=merge_context_dict,
            )
            all_diagnoses = diagnosis_result.diagnoses
            # Extract merged analysis if present
            if diagnosis_result.merged_analysis:
                merged_analysis_response = MergedAnalysisResponse(
                    suggested_name=diagnosis_result.merged_analysis.suggested_name,
                    context=diagnosis_result.merged_analysis.context,
                )
        else:
            # Technical diagnosis only (fast)
            all_diagnoses = service.diagnose_files(files=file_requests)
    except DiagnosisError as e:
        error_message = str(e)
        if "File not found" in error_message:
            raise HTTPException(status_code=404, detail=error_message)
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {e}")

    # Build response objects
    diagnoses = []
    for diagnosis in all_diagnoses:
        diagnoses.append(
            FileDiagnosisResponse(
                file_path=diagnosis.file_path,
                file_type=diagnosis.file_type,
                columns=[
                    ColumnSchemaResponse(
                        name=col.name,
                        type=col.type,
                        nullable=col.nullable,
                    )
                    for col in diagnosis.schema
                ],
                missing_values=diagnosis.missing_values,
                row_count=diagnosis.row_count,
                file_size_bytes=diagnosis.file_size_bytes,
                type_suggestions=[
                    TypeSuggestionResponse(
                        column_name=ts.column_name,
                        current_type=ts.current_type,
                        suggested_type=ts.suggested_type,
                        confidence=ts.confidence,
                        sample_values=ts.sample_values,
                    )
                    for ts in diagnosis.type_suggestions
                ],
                diagnosed_at=diagnosis.diagnosed_at,
                # Extended diagnosis fields
                encoding=EncodingInfoResponse(
                    detected=diagnosis.encoding.detected,
                    confidence=diagnosis.encoding.confidence,
                ) if diagnosis.encoding else None,
                parsing_integrity=ParsingIntegrityResponse(
                    total_lines=diagnosis.parsing_integrity.total_lines,
                    parsed_rows=diagnosis.parsing_integrity.parsed_rows,
                    malformed_rows=diagnosis.parsing_integrity.malformed_rows,
                    has_errors=diagnosis.parsing_integrity.has_errors,
                    error_message=diagnosis.parsing_integrity.error_message,
                ) if diagnosis.parsing_integrity else None,
                column_statistics=[
                    ColumnStatisticsResponse(
                        column_name=cs.column_name,
                        column_type=cs.column_type,
                        semantic_type=cs.semantic_type,
                        null_count=cs.null_count,
                        null_percentage=cs.null_percentage,
                        numeric_stats=NumericStatsResponse(
                            min=cs.numeric_stats.min,
                            max=cs.numeric_stats.max,
                            median=cs.numeric_stats.median,
                            mean=cs.numeric_stats.mean,
                            stddev=cs.numeric_stats.stddev,
                            distinct_count=cs.numeric_stats.distinct_count,
                        ) if cs.numeric_stats else None,
                        categorical_stats=CategoricalStatsResponse(
                            unique_count=cs.categorical_stats.unique_count,
                            top_values=[
                                ValueFrequencyResponse(
                                    value=vf.value,
                                    frequency=vf.frequency,
                                )
                                for vf in cs.categorical_stats.top_values
                            ],
                            avg_length=cs.categorical_stats.avg_length,
                        ) if cs.categorical_stats else None,
                        date_stats=DateStatsResponse(
                            min_date=cs.date_stats.min_date,
                            max_date=cs.date_stats.max_date,
                            span_days=cs.date_stats.span_days,
                            distinct_days=cs.date_stats.distinct_days,
                        ) if cs.date_stats else None,
                    )
                    for cs in diagnosis.column_statistics
                ],
                sample_rows=diagnosis.sample_rows,
                llm_analysis=LLMAnalysisResponse(
                    suggested_name=diagnosis.llm_analysis.suggested_name,
                    context=diagnosis.llm_analysis.context,
                    potential=[
                        PotentialItemResponse(
                            question=p.question,
                            analysis=p.analysis,
                        )
                        for p in diagnosis.llm_analysis.potential
                    ],
                    issues=[
                        IssueItemResponse(
                            issue=i.issue,
                            suggestion=i.suggestion,
                        )
                        for i in diagnosis.llm_analysis.issues
                    ],
                    analyzed_at=diagnosis.llm_analysis.analyzed_at,
                    model_used=diagnosis.llm_analysis.model_used,
                ) if diagnosis.llm_analysis else None,
                diagnosis_id=diagnosis.diagnosis_id,
            )
        )

    return DiagnoseFilesResponse(diagnoses=diagnoses, merged_analysis=merged_analysis_response)


@router.get("/files/{file_id}/diagnosis", response_model=FileDiagnosisResponse)
def get_file_diagnosis(
    file_id: str,
    project_id: Optional[str] = Query(None),
) -> FileDiagnosisResponse:
    """Get diagnosis for a file asset.

    Retrieves the diagnosis linked to a file asset.
    First tries to lookup by diagnosis_id (if present), then falls back to file_path.
    """
    logger.info(f"[get_file_diagnosis] Request for file_id={file_id}")
    file_service = get_file_asset_service(project_id)
    asset = file_service.get_file(file_id)
    if not asset:
        logger.warning(f"[get_file_diagnosis] File asset not found: {file_id}")
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    logger.info(f"[get_file_diagnosis] Asset found: id={asset.id}, diagnosis_id={asset.diagnosis_id}, file_path={asset.file_path}")

    diagnosis_service = get_file_diagnosis_service(project_id)
    diagnosis = None

    # Method 1: Lookup by diagnosis_id (if present)
    if asset.diagnosis_id:
        logger.info(f"[get_file_diagnosis] Trying lookup by diagnosis_id: {asset.diagnosis_id}")
        diagnosis = diagnosis_service.get_diagnosis_by_id(asset.diagnosis_id)
        logger.info(f"[get_file_diagnosis] Lookup result by diagnosis_id: {'FOUND' if diagnosis else 'NOT FOUND'}")

    # Method 2: Fallback to file_path lookup (for legacy assets without diagnosis_id)
    if diagnosis is None:
        logger.info(f"[get_file_diagnosis] Trying fallback lookup by file_path: {asset.file_path}")
        diagnosis = diagnosis_service.get_cached_diagnosis(asset.file_path)
        logger.info(f"[get_file_diagnosis] Lookup result by file_path: {'FOUND' if diagnosis else 'NOT FOUND'}")

    if diagnosis is None:
        logger.warning(f"[get_file_diagnosis] No diagnosis found for file_id={file_id}")
        raise HTTPException(status_code=404, detail=f"No diagnosis found for file '{file_id}'")

    # Convert to response
    return FileDiagnosisResponse(
        file_path=diagnosis.file_path,
        file_type=diagnosis.file_type,
        columns=[
            ColumnSchemaResponse(
                name=col.name,
                type=col.type,
                nullable=col.nullable,
            )
            for col in diagnosis.schema
        ],
        missing_values=diagnosis.missing_values,
        row_count=diagnosis.row_count,
        file_size_bytes=diagnosis.file_size_bytes,
        type_suggestions=[
            TypeSuggestionResponse(
                column_name=ts.column_name,
                current_type=ts.current_type,
                suggested_type=ts.suggested_type,
                confidence=ts.confidence,
                sample_values=ts.sample_values,
            )
            for ts in diagnosis.type_suggestions
        ],
        diagnosed_at=diagnosis.diagnosed_at,
        encoding=EncodingInfoResponse(
            detected=diagnosis.encoding.detected,
            confidence=diagnosis.encoding.confidence,
        ) if diagnosis.encoding else None,
        parsing_integrity=ParsingIntegrityResponse(
            total_lines=diagnosis.parsing_integrity.total_lines,
            parsed_rows=diagnosis.parsing_integrity.parsed_rows,
            malformed_rows=diagnosis.parsing_integrity.malformed_rows,
            has_errors=diagnosis.parsing_integrity.has_errors,
            error_message=diagnosis.parsing_integrity.error_message,
        ) if diagnosis.parsing_integrity else None,
        column_statistics=[
            ColumnStatisticsResponse(
                column_name=cs.column_name,
                column_type=cs.column_type,
                semantic_type=cs.semantic_type,
                null_count=cs.null_count,
                null_percentage=cs.null_percentage,
                numeric_stats=NumericStatsResponse(
                    min=cs.numeric_stats.min,
                    max=cs.numeric_stats.max,
                    median=cs.numeric_stats.median,
                    mean=cs.numeric_stats.mean,
                    stddev=cs.numeric_stats.stddev,
                    distinct_count=cs.numeric_stats.distinct_count,
                ) if cs.numeric_stats else None,
                categorical_stats=CategoricalStatsResponse(
                    unique_count=cs.categorical_stats.unique_count,
                    top_values=[
                        ValueFrequencyResponse(
                            value=vf.value,
                            frequency=vf.frequency,
                        )
                        for vf in cs.categorical_stats.top_values
                    ],
                    avg_length=cs.categorical_stats.avg_length,
                ) if cs.categorical_stats else None,
                date_stats=DateStatsResponse(
                    min_date=cs.date_stats.min_date,
                    max_date=cs.date_stats.max_date,
                    span_days=cs.date_stats.span_days,
                    distinct_days=cs.date_stats.distinct_days,
                ) if cs.date_stats else None,
            )
            for cs in diagnosis.column_statistics
        ],
        sample_rows=diagnosis.sample_rows,
        llm_analysis=LLMAnalysisResponse(
            suggested_name=diagnosis.llm_analysis.suggested_name,
            context=diagnosis.llm_analysis.context,
            potential=[
                PotentialItemResponse(
                    question=p.question,
                    analysis=p.analysis,
                )
                for p in diagnosis.llm_analysis.potential
            ],
            issues=[
                IssueItemResponse(
                    issue=i.issue,
                    suggestion=i.suggestion,
                )
                for i in diagnosis.llm_analysis.issues
            ],
            analyzed_at=diagnosis.llm_analysis.analyzed_at,
            model_used=diagnosis.llm_analysis.model_used,
        ) if diagnosis.llm_analysis else None,
        diagnosis_id=diagnosis.diagnosis_id,
    )

