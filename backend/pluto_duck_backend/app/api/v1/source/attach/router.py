"""Source Attach API Router - External database federation and metadata."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException

from pluto_duck_backend.app.api.deps import get_project_id_query_required
from pluto_duck_backend.app.api.v1.source.attach.schemas import (
    AttachDuckdbRequest,
    AttachMysqlRequest,
    AttachPostgresRequest,
    AttachSqliteRequest,
    CreateSourceRequest,
    SizeEstimateResponse,
    SourceDetailResponse,
    SourceResponse,
    SourceTableResponse,
    UpdateSourceRequest,
)
from pluto_duck_backend.app.api.v1.source.cache.schemas import CachedTableResponse
from pluto_duck_backend.app.services.source import (
    AttachError,
    AttachedSource,
    SourceNotFoundError,
    SourceType,
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


@router.post("/", response_model=SourceResponse, status_code=201)
def create_source(
    request: CreateSourceRequest,
    service: SourceService = Depends(get_source_service_dep),
) -> SourceResponse:
    """Create/attach a new source within a project."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> SourceResponse:
    """Attach a PostgreSQL database."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> SourceResponse:
    """Attach a SQLite database."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> SourceResponse:
    """Attach a MySQL database."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> SourceResponse:
    """Attach another DuckDB file."""
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


@router.get("/", response_model=List[SourceResponse])
def list_sources(
    service: SourceService = Depends(get_source_service_dep),
) -> List[SourceResponse]:
    """List all attached sources for a project."""
    sources = service.list_sources()
    return [_source_to_response(s) for s in sources]


@router.get("/{source_name}", response_model=SourceDetailResponse)
def get_source_detail(
    source_name: str,
    service: SourceService = Depends(get_source_service_dep),
) -> SourceDetailResponse:
    """Get a specific source by name with cached tables."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> SourceResponse:
    """Update source metadata (description)."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> Dict[str, str]:
    """Detach a source."""
    if service.detach_source(source_name):
        return {"status": "detached", "name": source_name}
    raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")


@router.get("/{source_name}/tables", response_model=List[SourceTableResponse])
def list_source_tables(
    source_name: str,
    service: SourceService = Depends(get_source_service_dep),
) -> List[SourceTableResponse]:
    """List tables available from a source."""
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
    service: SourceService = Depends(get_source_service_dep),
) -> SizeEstimateResponse:
    """Estimate table size and get caching recommendation."""
    try:
        estimate = service.estimate_table_size(source_name, table_name)
        return SizeEstimateResponse(**estimate)
    except SourceNotFoundError:
        raise HTTPException(status_code=404, detail=f"Source '{source_name}' not found")
