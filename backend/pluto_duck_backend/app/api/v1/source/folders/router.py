"""Source Folders API Router - Local directory sources."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from pluto_duck_backend.app.services.source import FolderSource, SourceNotFoundError, get_source_service


router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================


class FolderSourceResponse(BaseModel):
    """Response for a folder source."""

    id: str
    name: str
    path: str
    allowed_types: str
    pattern: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class CreateFolderSourceRequest(BaseModel):
    """Request to create a folder source."""

    name: str = Field(..., description="Display name for this folder source")
    path: str = Field(..., description="Local directory path")
    allowed_types: Literal["csv", "parquet", "both"] = Field(
        "both", description="Which file types to include"
    )
    pattern: Optional[str] = Field(
        None, description="Optional filename pattern (e.g. *.csv)"
    )


class FolderFileResponse(BaseModel):
    """A discovered file within a folder source."""

    path: str
    name: str
    file_type: Literal["csv", "parquet"]
    size_bytes: int
    modified_at: datetime


class FolderScanResponse(BaseModel):
    folder_id: str
    scanned_at: datetime
    new_files: int
    changed_files: int
    deleted_files: int


# =============================================================================
# Helper Functions
# =============================================================================


def _folder_source_to_response(src: FolderSource) -> FolderSourceResponse:
    return FolderSourceResponse(
        id=src.id,
        name=src.name,
        path=src.path,
        allowed_types=src.allowed_types,
        pattern=src.pattern,
        created_at=src.created_at,
        updated_at=src.updated_at,
    )


# =============================================================================
# Folder Sources (local directory sources)
# =============================================================================


@router.get("", response_model=List[FolderSourceResponse])
def list_folder_sources(
    project_id: str = Query(..., description="Project ID"),
) -> List[FolderSourceResponse]:
    """List folder sources for a project."""
    service = get_source_service(project_id)
    sources = service.list_folder_sources()
    return [_folder_source_to_response(s) for s in sources]


@router.post("", response_model=FolderSourceResponse)
def create_folder_source(
    request: CreateFolderSourceRequest,
    project_id: str = Query(..., description="Project ID"),
) -> FolderSourceResponse:
    """Create (or update) a folder source for a project."""
    service = get_source_service(project_id)
    try:
        src = service.create_folder_source(
            name=request.name,
            path=request.path,
            allowed_types=request.allowed_types,
            pattern=request.pattern,
        )
        return _folder_source_to_response(src)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{folder_id}")
def delete_folder_source(
    folder_id: str,
    project_id: str = Query(..., description="Project ID"),
) -> Dict[str, Any]:
    """Delete a folder source."""
    service = get_source_service(project_id)
    ok = service.delete_folder_source(folder_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Folder source '{folder_id}' not found")
    return {"status": "deleted", "id": folder_id}


@router.get("/{folder_id}/files", response_model=List[FolderFileResponse])
def list_folder_files(
    folder_id: str,
    limit: int = Query(500, ge=1, le=5000),
    project_id: str = Query(..., description="Project ID"),
) -> List[FolderFileResponse]:
    """List files inside a folder source (non-recursive)."""
    service = get_source_service(project_id)
    try:
        files = service.list_folder_files(folder_id, limit=limit)
        return [
            FolderFileResponse(
                path=f.path,
                name=f.name,
                file_type=f.file_type,  # type: ignore[arg-type]
                size_bytes=f.size_bytes,
                modified_at=f.modified_at,
            )
            for f in files
        ]
    except SourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{folder_id}/scan", response_model=FolderScanResponse)
def scan_folder_source(
    folder_id: str,
    project_id: str = Query(..., description="Project ID"),
) -> FolderScanResponse:
    """Scan folder source, compare with last snapshot, and persist new snapshot."""
    service = get_source_service(project_id)
    try:
        res = service.scan_folder_source(folder_id)
        return FolderScanResponse(
            folder_id=res.folder_id,
            scanned_at=res.scanned_at,
            new_files=res.new_files,
            changed_files=res.changed_files,
            deleted_files=res.deleted_files,
        )
    except SourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
