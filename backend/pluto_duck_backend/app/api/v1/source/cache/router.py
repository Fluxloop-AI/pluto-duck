"""Source Cache API Router - Cached table management."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from pluto_duck_backend.app.services.source import CacheError, SourceNotFoundError, get_source_service


router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================


class CacheTableRequest(BaseModel):
    """Request to cache a table locally."""

    source_name: str = Field(..., description="Source alias")
    table_name: str = Field(..., description="Table name in source")
    local_name: Optional[str] = Field(None, description="Custom local table name")
    filter_sql: Optional[str] = Field(None, description="WHERE clause to filter data")
    expires_hours: Optional[int] = Field(None, description="TTL in hours")


class CachedTableResponse(BaseModel):
    """Response for a cached table."""

    id: str
    source_name: str
    source_table: str
    local_table: str
    cached_at: datetime
    row_count: Optional[int] = None
    expires_at: Optional[datetime] = None
    filter_sql: Optional[str] = None


# =============================================================================
# Cache Endpoints
# =============================================================================


@router.post("", response_model=CachedTableResponse)
def cache_table(
    request: CacheTableRequest,
    project_id: str = Query(..., description="Project ID"),
) -> CachedTableResponse:
    """Cache a table from a source locally."""
    service = get_source_service(project_id)
    try:
        cached = service.cache_table(
            source_name=request.source_name,
            source_table=request.table_name,
            local_table=request.local_name,
            filter_sql=request.filter_sql,
            expires_hours=request.expires_hours,
        )
        return CachedTableResponse(
            id=cached.id,
            source_name=cached.source_name,
            source_table=cached.source_table,
            local_table=cached.local_table,
            cached_at=cached.cached_at,
            row_count=cached.row_count,
            expires_at=cached.expires_at,
            filter_sql=cached.filter_sql,
        )
    except SourceNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except CacheError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/", response_model=List[CachedTableResponse])
def list_cached_tables(
    project_id: str = Query(..., description="Project ID"),
    source_name: Optional[str] = None,
) -> List[CachedTableResponse]:
    """List all cached tables."""
    service = get_source_service(project_id)
    cached = service.list_cached_tables(source_name)
    return [
        CachedTableResponse(
            id=c.id,
            source_name=c.source_name,
            source_table=c.source_table,
            local_table=c.local_table,
            cached_at=c.cached_at,
            row_count=c.row_count,
            expires_at=c.expires_at,
            filter_sql=c.filter_sql,
        )
        for c in cached
    ]


@router.get("/{local_table}", response_model=CachedTableResponse)
def get_cached_table(
    local_table: str,
    project_id: str = Query(..., description="Project ID"),
) -> CachedTableResponse:
    """Get a specific cached table."""
    service = get_source_service(project_id)
    cached = service.get_cached_table(local_table)
    if not cached:
        raise HTTPException(status_code=404, detail=f"Cached table '{local_table}' not found")
    return CachedTableResponse(
        id=cached.id,
        source_name=cached.source_name,
        source_table=cached.source_table,
        local_table=cached.local_table,
        cached_at=cached.cached_at,
        row_count=cached.row_count,
        expires_at=cached.expires_at,
        filter_sql=cached.filter_sql,
    )


@router.get("/{local_table}/preview")
def preview_cached_table(
    local_table: str,
    project_id: str = Query(..., description="Project ID"),
    limit: int = Query(100, ge=1, le=10000, description="Max rows to return"),
) -> Dict[str, Any]:
    """Preview data from a cached table."""
    service = get_source_service(project_id)
    try:
        return service.preview_cached_table(local_table, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{local_table}/refresh", response_model=CachedTableResponse)
def refresh_cache(
    local_table: str,
    project_id: str = Query(..., description="Project ID"),
) -> CachedTableResponse:
    """Refresh a cached table with fresh data."""
    service = get_source_service(project_id)
    try:
        cached = service.refresh_cache(local_table)
        return CachedTableResponse(
            id=cached.id,
            source_name=cached.source_name,
            source_table=cached.source_table,
            local_table=cached.local_table,
            cached_at=cached.cached_at,
            row_count=cached.row_count,
            expires_at=cached.expires_at,
            filter_sql=cached.filter_sql,
        )
    except CacheError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{local_table}")
def drop_cache(
    local_table: str,
    project_id: str = Query(..., description="Project ID"),
) -> Dict[str, str]:
    """Drop a cached table."""
    service = get_source_service(project_id)
    if service.drop_cache(local_table):
        return {"status": "dropped", "local_table": local_table}
    raise HTTPException(status_code=404, detail=f"Cached table '{local_table}' not found")


@router.post("/cleanup")
def cleanup_expired_caches(
    project_id: str = Query(..., description="Project ID"),
) -> Dict[str, Any]:
    """Clean up expired cached tables."""
    service = get_source_service(project_id)
    count = service.cleanup_expired_caches()
    return {"status": "completed", "cleaned_count": count}
