"""Source Folders API Router - Local directory sources."""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query

from pluto_duck_backend.app.api.deps import get_project_id_query_required
from pluto_duck_backend.app.api.v1.source.folders.schemas import (
    CreateFolderSourceRequest,
    FolderFileResponse,
    FolderScanResponse,
    FolderSourceResponse,
)
from pluto_duck_backend.app.services.source import (
    FolderSource,
    SourceNotFoundError,
    SourceService,
    get_source_service,
)


router = APIRouter()


# =============================================================================
# Helper Functions
# =============================================================================

def get_source_service_dep(
    project_id: str = Depends(get_project_id_query_required),
) -> SourceService:
    """Provide a SourceService scoped to the project."""
    return get_source_service(project_id)


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
    service: SourceService = Depends(get_source_service_dep),
) -> List[FolderSourceResponse]:
    """List folder sources for a project."""
    sources = service.list_folder_sources()
    return [_folder_source_to_response(s) for s in sources]


@router.post("", response_model=FolderSourceResponse)
def create_folder_source(
    request: CreateFolderSourceRequest,
    service: SourceService = Depends(get_source_service_dep),
) -> FolderSourceResponse:
    """Create (or update) a folder source for a project."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> Dict[str, Any]:
    """Delete a folder source."""
    ok = service.delete_folder_source(folder_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Folder source '{folder_id}' not found")
    return {"status": "deleted", "id": folder_id}


@router.get("/{folder_id}/files", response_model=List[FolderFileResponse])
def list_folder_files(
    folder_id: str,
    limit: int = Query(500, ge=1, le=5000),
    service: SourceService = Depends(get_source_service_dep),
) -> List[FolderFileResponse]:
    """List files inside a folder source (non-recursive)."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> FolderScanResponse:
    """Scan folder source, compare with last snapshot, and persist new snapshot."""
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
