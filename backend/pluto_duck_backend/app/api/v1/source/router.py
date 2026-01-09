"""Source API Router - External database federation and caching.

Provides REST endpoints for:
1. Attaching external databases (ATTACH)
2. Listing sources and tables
3. Caching tables locally
4. Managing cached data
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from pluto_duck_backend.app.services.source import (
    SourceService,
    AttachedSource,
    CachedTable,
    SourceType,
    AttachError,
    CacheError,
    SourceNotFoundError,
    get_source_service,
)


router = APIRouter(prefix="/source", tags=["source"])


# =============================================================================
# Request/Response Models
# =============================================================================


class AttachPostgresRequest(BaseModel):
    """Request to attach a PostgreSQL database."""

    name: str = Field(..., description="Alias for this connection")
    host: str = Field(..., description="PostgreSQL host")
    port: int = Field(5432, description="PostgreSQL port")
    database: str = Field(..., description="Database name")
    user: str = Field(..., description="Username")
    password: str = Field(..., description="Password")
    schema_name: str = Field("public", alias="schema", description="Schema to use")
    read_only: bool = Field(True, description="Attach in read-only mode")


class AttachSqliteRequest(BaseModel):
    """Request to attach a SQLite database."""

    name: str = Field(..., description="Alias for this connection")
    path: str = Field(..., description="Path to SQLite file")
    read_only: bool = Field(True, description="Attach in read-only mode")


class AttachMysqlRequest(BaseModel):
    """Request to attach a MySQL database."""

    name: str = Field(..., description="Alias for this connection")
    host: str = Field(..., description="MySQL host")
    port: int = Field(3306, description="MySQL port")
    database: str = Field(..., description="Database name")
    user: str = Field(..., description="Username")
    password: str = Field(..., description="Password")
    read_only: bool = Field(True, description="Attach in read-only mode")


class AttachDuckdbRequest(BaseModel):
    """Request to attach another DuckDB file."""

    name: str = Field(..., description="Alias for this connection")
    path: str = Field(..., description="Path to DuckDB file")
    read_only: bool = Field(True, description="Attach in read-only mode")


class CacheTableRequest(BaseModel):
    """Request to cache a table locally."""

    source_name: str = Field(..., description="Source alias")
    table_name: str = Field(..., description="Table name in source")
    local_name: Optional[str] = Field(None, description="Custom local table name")
    filter_sql: Optional[str] = Field(None, description="WHERE clause to filter data")
    expires_hours: Optional[int] = Field(None, description="TTL in hours")


class SourceResponse(BaseModel):
    """Response for a single source."""

    id: str
    name: str
    source_type: str
    status: str
    attached_at: datetime
    error_message: Optional[str] = None
    # UI-friendly fields (merged from data_sources)
    project_id: Optional[str] = None
    description: Optional[str] = None
    table_count: int = 0
    connection_config: Optional[Dict[str, Any]] = None


class SourceDetailResponse(SourceResponse):
    """Detailed response including cached tables."""
    
    cached_tables: List["CachedTableResponse"] = []


class CreateSourceRequest(BaseModel):
    """Generic request to create/attach a source."""
    
    name: str = Field(..., description="Alias for this connection")
    source_type: Literal["postgres", "sqlite", "mysql", "duckdb"] = Field(..., description="Database type")
    source_config: Dict[str, Any] = Field(..., description="Connection configuration")
    description: Optional[str] = Field(None, description="Human-readable description")


class UpdateSourceRequest(BaseModel):
    """Request to update source metadata."""
    
    description: Optional[str] = None


class SourceTableResponse(BaseModel):
    """Response for a source table."""

    source_name: str
    schema_name: str
    table_name: str
    mode: str  # "live" or "cached"
    local_table: Optional[str] = None


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


class SizeEstimateResponse(BaseModel):
    """Response for table size estimation."""

    source_name: str
    table_name: str
    estimated_rows: Optional[int] = None
    recommend_cache: bool
    recommend_filter: bool = False
    suggestion: str
    error: Optional[str] = None


# =============================================================================
# Helper Functions
# =============================================================================


def _source_to_response(source: AttachedSource) -> SourceResponse:
    """Convert AttachedSource to SourceResponse."""
    return SourceResponse(
        id=source.id,
        name=source.name,
        source_type=source.source_type.value,
        status=source.status,
        attached_at=source.attached_at,
        error_message=source.error_message,
        project_id=source.project_id,
        description=source.description,
        table_count=source.table_count,
        connection_config=source.connection_config,
    )


# =============================================================================
# Source Endpoints
# =============================================================================


@router.post("", response_model=SourceResponse, status_code=201)
def create_source(
    request: CreateSourceRequest,
    project_id: str = Query(..., description="Project ID for isolation"),
) -> SourceResponse:
    """Create/attach a new source within a project."""
    service = get_source_service(project_id)
    try:
        source = service.attach_source(
            name=request.name,
            source_type=request.source_type,
            config=request.source_config,
            read_only=True,
            description=request.description,
        )
        return _source_to_response(source)
    except AttachError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/attach/postgres", response_model=SourceResponse)
def attach_postgres(
    request: AttachPostgresRequest,
    project_id: str = Query(..., description="Project ID for isolation"),
) -> SourceResponse:
    """Attach a PostgreSQL database."""
    service = get_source_service(project_id)
    try:
        source = service.attach_source(
            name=request.name,
            source_type=SourceType.POSTGRES,
            config={
                "host": request.host,
                "port": request.port,
                "database": request.database,
                "user": request.user,
                "password": request.password,
                "schema": request.schema_name,
            },
            read_only=request.read_only,
        )
        return _source_to_response(source)
    except AttachError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/attach/sqlite", response_model=SourceResponse)
def attach_sqlite(
    request: AttachSqliteRequest,
    project_id: str = Query(..., description="Project ID for isolation"),
) -> SourceResponse:
    """Attach a SQLite database."""
    service = get_source_service(project_id)
    try:
        source = service.attach_source(
            name=request.name,
            source_type=SourceType.SQLITE,
            config={"path": request.path},
            read_only=request.read_only,
        )
        return _source_to_response(source)
    except AttachError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/attach/mysql", response_model=SourceResponse)
def attach_mysql(
    request: AttachMysqlRequest,
    project_id: str = Query(..., description="Project ID for isolation"),
) -> SourceResponse:
    """Attach a MySQL database."""
    service = get_source_service(project_id)
    try:
        source = service.attach_source(
            name=request.name,
            source_type=SourceType.MYSQL,
            config={
                "host": request.host,
                "port": request.port,
                "database": request.database,
                "user": request.user,
                "password": request.password,
            },
            read_only=request.read_only,
        )
        return _source_to_response(source)
    except AttachError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/attach/duckdb", response_model=SourceResponse)
def attach_duckdb(
    request: AttachDuckdbRequest,
    project_id: str = Query(..., description="Project ID for isolation"),
) -> SourceResponse:
    """Attach another DuckDB file."""
    service = get_source_service(project_id)
    try:
        source = service.attach_source(
            name=request.name,
            source_type=SourceType.DUCKDB,
            config={"path": request.path},
            read_only=request.read_only,
        )
        return _source_to_response(source)
    except AttachError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("", response_model=List[SourceResponse])
def list_sources(
    project_id: str = Query(..., description="Project ID"),
) -> List[SourceResponse]:
    """List all attached sources for a project."""
    service = get_source_service(project_id)
    sources = service.list_sources()
    return [_source_to_response(s) for s in sources]


@router.get("/{source_name}", response_model=SourceDetailResponse)
def get_source_detail(
    source_name: str,
    project_id: str = Query(..., description="Project ID"),
) -> SourceDetailResponse:
    """Get a specific source by name with cached tables."""
    service = get_source_service(project_id)
    source = service.get_source(source_name)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")
    
    # Get cached tables for this source
    cached_tables = service.list_cached_tables(source_name)
    
    return SourceDetailResponse(
        id=source.id,
        name=source.name,
        source_type=source.source_type.value,
        status=source.status,
        attached_at=source.attached_at,
        error_message=source.error_message,
        project_id=source.project_id,
        description=source.description,
        table_count=source.table_count,
        connection_config=source.connection_config,
        cached_tables=[
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
            for c in cached_tables
        ],
    )


@router.patch("/{source_name}", response_model=SourceResponse)
def update_source(
    source_name: str,
    request: UpdateSourceRequest,
    project_id: str = Query(..., description="Project ID"),
) -> SourceResponse:
    """Update source metadata (description)."""
    service = get_source_service(project_id)
    source = service.update_source(
        source_name,
        description=request.description,
    )
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")
    return _source_to_response(source)


@router.delete("/{source_name}")
def detach_source(
    source_name: str,
    project_id: str = Query(..., description="Project ID"),
) -> Dict[str, str]:
    """Detach a source."""
    service = get_source_service(project_id)
    if service.detach_source(source_name):
        return {"status": "detached", "name": source_name}
    raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")


@router.get("/{source_name}/tables", response_model=List[SourceTableResponse])
def list_source_tables(
    source_name: str,
    project_id: str = Query(..., description="Project ID"),
) -> List[SourceTableResponse]:
    """List tables available from a source."""
    service = get_source_service(project_id)
    try:
        tables = service.list_source_tables(source_name)
        return [
            SourceTableResponse(
                source_name=t.source_name,
                schema_name=t.schema_name,
                table_name=t.table_name,
                mode=t.mode.value,
                local_table=t.local_table,
            )
            for t in tables
        ]
    except SourceNotFoundError:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")


@router.get("/{source_name}/tables/{table_name}/estimate", response_model=SizeEstimateResponse)
def estimate_table_size(
    source_name: str,
    table_name: str,
    project_id: str = Query(..., description="Project ID"),
) -> SizeEstimateResponse:
    """Estimate table size and get caching recommendation."""
    service = get_source_service(project_id)
    try:
        estimate = service.estimate_table_size(source_name, table_name)
        return SizeEstimateResponse(**estimate)
    except SourceNotFoundError:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")


# =============================================================================
# Cache Endpoints
# =============================================================================


@router.post("/cache", response_model=CachedTableResponse)
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


@router.get("/cache/", response_model=List[CachedTableResponse])
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


@router.get("/cache/{local_table}", response_model=CachedTableResponse)
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


@router.post("/cache/{local_table}/refresh", response_model=CachedTableResponse)
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


@router.delete("/cache/{local_table}")
def drop_cache(
    local_table: str,
    project_id: str = Query(..., description="Project ID"),
) -> Dict[str, str]:
    """Drop a cached table."""
    service = get_source_service(project_id)
    if service.drop_cache(local_table):
        return {"status": "dropped", "local_table": local_table}
    raise HTTPException(status_code=404, detail=f"Cached table '{local_table}' not found")


@router.post("/cache/cleanup")
def cleanup_expired_caches(
    project_id: str = Query(..., description="Project ID"),
) -> Dict[str, Any]:
    """Clean up expired cached tables."""
    service = get_source_service(project_id)
    count = service.cleanup_expired_caches()
    return {"status": "completed", "cleaned_count": count}

