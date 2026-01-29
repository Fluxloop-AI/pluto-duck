"""Asset Analyses API Router - Saved Analysis management."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import tempfile
from typing import Dict, List, Optional

import duckdb
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from pluto_duck_backend.app.api.deps import get_project_id_query
from pluto_duck_backend.app.api.v1.asset.analyses.schemas import (
    AnalysisDataResponse,
    AnalysisResponse,
    CompileRequest,
    CreateAnalysisRequest,
    ExecuteRequest,
    ExecutionPlanResponse,
    ExecutionResultResponse,
    ExecutionStepResponse,
    ExportAnalysisRequest,
    ExportAnalysisResponse,
    FreshnessResponse,
    LineageNodeResponse,
    LineageResponse,
    RunHistoryResponse,
    StepResultResponse,
    UpdateAnalysisRequest,
)
from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from pluto_duck_backend.app.services.asset import AssetNotFoundError, AssetService, get_asset_service
from pluto_duck_backend.app.services.asset.errors import AssetValidationError


router = APIRouter()


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

def get_asset_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> AssetService:
    """Provide an AssetService scoped to the project."""
    return get_asset_service(project_id)


@router.post("", response_model=AnalysisResponse)
def create_analysis(
    request: CreateAnalysisRequest,
    service: AssetService = Depends(get_asset_service_dep),
) -> AnalysisResponse:
    """Create a new Analysis."""

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


@router.get("", response_model=List[AnalysisResponse])
def list_analyses(
    tags: Optional[List[str]] = Query(None),
    service: AssetService = Depends(get_asset_service_dep),
) -> List[AnalysisResponse]:
    """List all analyses."""
    analyses = service.list_analyses(tags)
    return [_analysis_to_response(a) for a in analyses]


@router.get("/{analysis_id}", response_model=AnalysisResponse)
def get_analysis(
    analysis_id: str,
    service: AssetService = Depends(get_asset_service_dep),
) -> AnalysisResponse:
    """Get an Analysis by ID."""
    analysis = service.get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return _analysis_to_response(analysis)


@router.patch("/{analysis_id}", response_model=AnalysisResponse)
def update_analysis(
    analysis_id: str,
    request: UpdateAnalysisRequest,
    service: AssetService = Depends(get_asset_service_dep),
) -> AnalysisResponse:
    """Update an existing Analysis."""

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


@router.delete("/{analysis_id}")
def delete_analysis(
    analysis_id: str,
    service: AssetService = Depends(get_asset_service_dep),
) -> Dict[str, str]:
    """Delete an Analysis."""

    if not service.delete_analysis(analysis_id):
        raise HTTPException(status_code=404, detail=f"Analysis '{analysis_id}' not found")

    return {"status": "deleted", "analysis_id": analysis_id}


# =============================================================================
# Execution Endpoints
# =============================================================================


@router.post("/{analysis_id}/compile", response_model=ExecutionPlanResponse)
def compile_analysis(
    analysis_id: str,
    request: CompileRequest,
    service: AssetService = Depends(get_asset_service_dep),
) -> ExecutionPlanResponse:
    """Compile an execution plan for review."""

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


@router.post("/{analysis_id}/execute", response_model=ExecutionResultResponse)
def execute_analysis(
    analysis_id: str,
    request: ExecuteRequest,
    service: AssetService = Depends(get_asset_service_dep),
) -> ExecutionResultResponse:
    """Compile and execute an analysis."""

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


@router.get("/{analysis_id}/data", response_model=AnalysisDataResponse)
def get_analysis_data(
    analysis_id: str,
    service: AssetService = Depends(get_asset_service_dep),
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0),
) -> AnalysisDataResponse:
    """Get the result data from an analysis.

    Returns the materialized data (table/view) for the analysis.
    Use after executing the analysis to fetch its output.
    """
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


@router.post("/{analysis_id}/export", response_model=ExportAnalysisResponse)
def export_analysis_csv(
    analysis_id: str,
    request: ExportAnalysisRequest,
    service: AssetService = Depends(get_asset_service_dep),
) -> ExportAnalysisResponse:
    """Execute an analysis and export results to a CSV file path."""
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


@router.get("/{analysis_id}/download")
def download_analysis_csv(
    analysis_id: str,
    background_tasks: BackgroundTasks,
    service: AssetService = Depends(get_asset_service_dep),
    force: bool = Query(False, description="Force execution even if fresh"),
) -> FileResponse:
    """Execute an analysis and download results as CSV."""
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


@router.get("/{analysis_id}/freshness", response_model=FreshnessResponse)
def get_freshness(
    analysis_id: str,
    service: AssetService = Depends(get_asset_service_dep),
) -> FreshnessResponse:
    """Get freshness status for an analysis."""

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


@router.get("/{analysis_id}/lineage", response_model=LineageResponse)
def get_lineage(
    analysis_id: str,
    service: AssetService = Depends(get_asset_service_dep),
) -> LineageResponse:
    """Get lineage information for an analysis."""

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


@router.get("/{analysis_id}/history", response_model=List[RunHistoryResponse])
def get_run_history(
    analysis_id: str,
    limit: int = Query(10, ge=1, le=100),
    service: AssetService = Depends(get_asset_service_dep),
) -> List[RunHistoryResponse]:
    """Get run history for an analysis."""

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
