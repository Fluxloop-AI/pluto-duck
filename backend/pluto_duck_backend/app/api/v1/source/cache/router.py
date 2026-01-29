"""Source Cache API Router - Cached table management."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from pluto_duck_backend.app.api.deps import get_project_id_query_required
from pluto_duck_backend.app.api.v1.source.cache.schemas import CacheTableRequest, CachedTableResponse
from pluto_duck_backend.app.services.source import CacheError, SourceNotFoundError, SourceService, get_source_service


router = APIRouter()


# =============================================================================
# Cache Endpoints
# =============================================================================

def get_source_service_dep(
    project_id: str = Depends(get_project_id_query_required),
) -> SourceService:
    """Provide a SourceService scoped to the project."""
    return get_source_service(project_id)


@router.post("", response_model=CachedTableResponse)
def cache_table(
    request: CacheTableRequest,
    service: SourceService = Depends(get_source_service_dep),
) -> CachedTableResponse:
    """Cache a table from a source locally."""
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
    service: SourceService = Depends(get_source_service_dep),
    source_name: Optional[str] = None,
) -> List[CachedTableResponse]:
    """List all cached tables."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> CachedTableResponse:
    """Get a specific cached table."""
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
    service: SourceService = Depends(get_source_service_dep),
    limit: int = Query(100, ge=1, le=10000, description="Max rows to return"),
) -> Dict[str, Any]:
    """Preview data from a cached table."""
    try:
        return service.preview_cached_table(local_table, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{local_table}/refresh", response_model=CachedTableResponse)
def refresh_cache(
    local_table: str,
    service: SourceService = Depends(get_source_service_dep),
) -> CachedTableResponse:
    """Refresh a cached table with fresh data."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> Dict[str, str]:
    """Drop a cached table."""
    if service.drop_cache(local_table):
        return {"status": "dropped", "local_table": local_table}
    raise HTTPException(status_code=404, detail=f"Cached table '{local_table}' not found")


@router.post("/cleanup")
def cleanup_expired_caches(
    service: SourceService = Depends(get_source_service_dep),
) -> Dict[str, Any]:
    """Clean up expired cached tables."""
    count = service.cleanup_expired_caches()
    return {"status": "completed", "cleaned_count": count}
