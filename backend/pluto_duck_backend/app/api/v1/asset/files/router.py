"""Asset Files API Router - File Asset management."""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from pluto_duck_backend.app.api.deps import get_project_id_query
from pluto_duck_backend.app.api.v1.asset.files.schemas import (
    FileAssetResponse,
    FilePreprocessingEventResponse,
    FilePreviewResponse,
    FileSchemaResponse,
    FileSourceResponse,
    ImportFileRequest,
)
from pluto_duck_backend.app.services.asset import (
    AssetNotFoundError,
    DiagnosisIssueService,
    FileAsset,
    FileAssetService,
    FileDiagnosisService,
    FilePreprocessingService,
    get_file_asset_service,
    get_diagnosis_issue_service,
    get_file_diagnosis_service,
    get_file_preprocessing_service,
)
from pluto_duck_backend.app.services.asset.errors import AssetError, AssetValidationError

logger = logging.getLogger(__name__)


router = APIRouter()
def _file_asset_to_response(asset: FileAsset) -> FileAssetResponse:
    """Convert FileAsset to response model."""
    sources = None
    if asset.sources is not None:
        sources = [
            FileSourceResponse(
                file_path=s.file_path,
                original_name=s.original_name,
                row_count=s.row_count,
                file_size_bytes=s.file_size_bytes,
                added_at=s.added_at,
            )
            for s in asset.sources
        ]
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
        sources=sources,
    )


# =============================================================================
# File Asset Endpoints
# =============================================================================

def get_file_asset_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> FileAssetService:
    """Provide a FileAssetService scoped to the project."""
    return get_file_asset_service(project_id)


def get_file_diagnosis_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> FileDiagnosisService:
    """Provide a FileDiagnosisService scoped to the project."""
    return get_file_diagnosis_service(project_id)


def get_diagnosis_issue_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> DiagnosisIssueService:
    """Provide a DiagnosisIssueService scoped to the project."""
    return get_diagnosis_issue_service(project_id)


def get_file_preprocessing_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> FilePreprocessingService:
    """Provide a FilePreprocessingService scoped to the project."""
    return get_file_preprocessing_service(project_id)


@router.post("", response_model=FileAssetResponse)
def import_file(
    request: ImportFileRequest,
    service: FileAssetService = Depends(get_file_asset_service_dep),
    diagnosis_service: FileDiagnosisService = Depends(get_file_diagnosis_service_dep),
    issue_service: DiagnosisIssueService = Depends(get_diagnosis_issue_service_dep),
) -> FileAssetResponse:
    """Import a CSV or Parquet file into DuckDB.

    This creates a table from the file and registers it as a File Asset.
    File Assets go directly to Asset Zone (no ATTACH, no TTL).

    Modes:
    - replace: Create new table or overwrite existing
    - append: Add rows to existing table
    - merge: Upsert based on merge_keys
    """
    logger.info(
        "[import_file] Request received: table_name=%s, diagnosis_id=%s",
        request.table_name,
        request.diagnosis_id,
    )
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
        logger.info(
            "[import_file] Asset created: id=%s, diagnosis_id=%s",
            asset.id,
            asset.diagnosis_id,
        )
        if request.diagnosis_id:
            try:
                diagnosis = diagnosis_service.get_diagnosis_by_id(request.diagnosis_id)
                if diagnosis and diagnosis.llm_analysis and diagnosis.llm_analysis.issues:
                    issue_service.create_issues(
                        diagnosis_id=request.diagnosis_id,
                        file_asset_id=asset.id,
                        issues=[issue.to_dict() for issue in diagnosis.llm_analysis.issues],
                    )
            except Exception as e:
                logger.warning("[import_file] Failed to store diagnosis issues: %s", e)
        return _file_asset_to_response(asset)
    except AssetValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except AssetError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=List[FileAssetResponse])
def list_files(
    service: FileAssetService = Depends(get_file_asset_service_dep),
) -> List[FileAssetResponse]:
    """List all file assets for the project."""
    assets = service.list_files()
    return [_file_asset_to_response(a) for a in assets]


@router.get("/{file_id}", response_model=FileAssetResponse)
def get_file(
    file_id: str,
    service: FileAssetService = Depends(get_file_asset_service_dep),
) -> FileAssetResponse:
    """Get a file asset by ID."""
    asset = service.get_file(file_id)

    if not asset:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    return _file_asset_to_response(asset)


@router.delete("/{file_id}")
def delete_file(
    file_id: str,
    drop_table: bool = Query(True, description="Also drop the DuckDB table"),
    service: FileAssetService = Depends(get_file_asset_service_dep),
) -> Dict[str, str]:
    """Delete a file asset."""

    if not service.delete_file(file_id, drop_table=drop_table):
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")

    return {"status": "deleted", "file_id": file_id}


@router.post("/{file_id}/refresh", response_model=FileAssetResponse)
def refresh_file(
    file_id: str,
    service: FileAssetService = Depends(get_file_asset_service_dep),
) -> FileAssetResponse:
    """Refresh a file asset by re-importing from the source file."""

    try:
        asset = service.refresh_file(file_id)
        return _file_asset_to_response(asset)
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")
    except AssetError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{file_id}/schema", response_model=FileSchemaResponse)
def get_file_schema(
    file_id: str,
    service: FileAssetService = Depends(get_file_asset_service_dep),
) -> FileSchemaResponse:
    """Get the schema of the imported table."""

    try:
        columns = service.get_table_schema(file_id)
        return FileSchemaResponse(columns=columns)
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")


@router.get("/{file_id}/preview", response_model=FilePreviewResponse)
def preview_file_data(
    file_id: str,
    limit: int = Query(100, ge=1, le=1000),
    service: FileAssetService = Depends(get_file_asset_service_dep),
) -> FilePreviewResponse:
    """Preview data from the imported table."""

    try:
        data = service.preview_data(file_id, limit=limit)
        return FilePreviewResponse(
            columns=data["columns"],
            rows=data["rows"],
            total_rows=data["total_rows"],
        )
    except AssetNotFoundError:
        raise HTTPException(status_code=404, detail=f"File asset '{file_id}' not found")


@router.get("/{file_id}/events", response_model=List[FilePreprocessingEventResponse])
def list_file_events(
    file_id: str,
    service: FilePreprocessingService = Depends(get_file_preprocessing_service_dep),
) -> List[FilePreprocessingEventResponse]:
    """List preprocessing/history events for a file asset."""
    events = service.list_events(file_asset_id=file_id)
    return [FilePreprocessingEventResponse(**event.to_dict()) for event in events]
