"""Source Attach API Router - External database federation and metadata."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from pluto_duck_backend.app.api.v1.source.cache.router import CachedTableResponse
from pluto_duck_backend.app.services.source import (
    AttachError,
    AttachedSource,
    SourceNotFoundError,
    SourceType,
    get_source_service,
)


router = APIRouter()


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

    cached_tables: List[CachedTableResponse] = []


class CreateSourceRequest(BaseModel):
    """Generic request to create/attach a source."""

    name: str = Field(..., description="Alias for this connection")
    source_type: Literal["postgres", "sqlite", "mysql", "duckdb"] = Field(
        ..., description="Database type"
    )
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


@router.get(
    "/{source_name}/tables/{table_name}/estimate",
    response_model=SizeEstimateResponse,
)
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
