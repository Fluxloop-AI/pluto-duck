"""Asset Files API Router - File Asset management."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from pluto_duck_backend.app.services.asset import (
    AssetNotFoundError,
    FileAsset,
    get_file_asset_service,
)
from pluto_duck_backend.app.services.asset.errors import AssetError, AssetValidationError

logger = logging.getLogger(__name__)


router = APIRouter()


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
        description="Import mode: replace (new table), append (add rows), merge (upsert)",
    )
    target_table: Optional[str] = Field(
        None,
        description="Existing table name for append/merge modes",
    )
    merge_keys: Optional[List[str]] = Field(
        None,
        description="Column names for merge key (required for merge mode)",
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


@router.post("", response_model=FileAssetResponse)
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
    logger.info(
        "[import_file] Request received: table_name=%s, diagnosis_id=%s",
        request.table_name,
        request.diagnosis_id,
    )
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
        logger.info(
            "[import_file] Asset created: id=%s, diagnosis_id=%s",
            asset.id,
            asset.diagnosis_id,
        )
        return _file_asset_to_response(asset)
    except AssetValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except AssetError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=List[FileAssetResponse])
def list_files(
    project_id: Optional[str] = Query(None),
) -> List[FileAssetResponse]:
    """List all file assets for the project."""
    service = get_file_asset_service(project_id)
    assets = service.list_files()
    return [_file_asset_to_response(a) for a in assets]


@router.get("/{file_id}", response_model=FileAssetResponse)
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


@router.delete("/{file_id}")
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


@router.post("/{file_id}/refresh", response_model=FileAssetResponse)
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


@router.get("/{file_id}/schema", response_model=FileSchemaResponse)
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


@router.get("/{file_id}/preview", response_model=FilePreviewResponse)
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
