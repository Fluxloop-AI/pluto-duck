"""Data sources management endpoints supporting multi-table ingestion."""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

import duckdb
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, validator

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.data_sources import (
    DataSource,
    DataSourceRepository,
    DataSourceTable,
    get_data_source_repository,
)
from pluto_duck_backend.app.services.ingestion import IngestionJob, IngestionService, get_registry


router = APIRouter(prefix="/data-sources", tags=["data-sources"])


class DataSourceCreateRequest(BaseModel):
    """Payload to create a new data source connection."""

    name: str = Field(..., description="Display name for the data source")
    description: Optional[str] = Field(None, description="Optional description")
    connector_type: str = Field(..., description="Connector type identifier")
    source_config: Dict[str, Any] = Field(..., description="Connector configuration payload")
    metadata: Optional[Dict[str, Any]] = Field(
        default=None, description="Optional metadata stored with the data source"
    )


class DataSourceResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    connector_type: str
    source_config: Dict[str, Any]
    status: str
    error_message: Optional[str]
    created_at: str
    updated_at: str
    metadata: Optional[Dict[str, Any]]
    table_count: int = Field(..., description="Number of tables imported from this source")


class DataSourceDetailResponse(DataSourceResponse):
    tables: List["DataSourceTableResponse"] = Field(default_factory=list)


class TestConnectionRequest(BaseModel):
    connector_type: str = Field(..., description="Connector type identifier")
    source_config: Dict[str, Any] = Field(..., description="Connector configuration payload")


class TestConnectionResponse(BaseModel):
    status: str
    tables: List[str]


class TableImportRequest(BaseModel):
    target_table: str = Field(..., description="DuckDB table name to materialize")
    overwrite: bool = Field(False, description="Overwrite DuckDB table if it exists")
    source_table: Optional[str] = Field(
        default=None,
        description="Optional source table (schema.table) when applicable",
    )
    source_query: Optional[str] = Field(
        default=None,
        description="Optional custom query to execute against the source",
    )
    metadata: Optional[Dict[str, Any]] = Field(
        default=None, description="Optional metadata to store with the table"
    )

    @validator("source_query", always=True)
    def _validate_source_inputs(
        cls, value: Optional[str], values: Dict[str, Any]
    ) -> Optional[str]:
        if not value and not values.get("source_table"):
            # Allow missing source table for connectors that do not require it (CSV, etc.)
            return value
        return value


class BulkTableImportItem(TableImportRequest):
    pass


class BulkTableImportRequest(BaseModel):
    tables: List[BulkTableImportItem]

    @validator("tables")
    def _ensure_non_empty(cls, value: List[BulkTableImportItem]) -> List[BulkTableImportItem]:
        if not value:
            raise ValueError("tables payload must include at least one entry")
        return value


class TableImportResult(BaseModel):
    target_table: str
    table_id: Optional[str]
    status: str
    rows_imported: Optional[int]
    error: Optional[str]


class BulkTableImportResponse(BaseModel):
    results: List[TableImportResult]


class DataSourceTableResponse(BaseModel):
    id: str
    data_source_id: str
    source_table: Optional[str]
    source_query: Optional[str]
    target_table: str
    rows_count: Optional[int]
    status: str
    last_imported_at: Optional[str]
    error_message: Optional[str]
    created_at: str
    updated_at: str
    metadata: Optional[Dict[str, Any]]


class SyncResponse(BaseModel):
    status: str
    rows_imported: Optional[int]
    message: str


def get_repository() -> DataSourceRepository:
    return get_data_source_repository()


def get_ingestion_service() -> IngestionService:
    registry = get_registry()
    return IngestionService(registry)


@router.get("", response_model=List[DataSourceResponse])
def list_data_sources(repo: DataSourceRepository = Depends(get_repository)) -> List[DataSourceResponse]:
    sources = repo.list_all()
    return [_serialize_source(source) for source in sources]


@router.post("", response_model=DataSourceResponse, status_code=status.HTTP_201_CREATED)
def create_data_source(
    payload: DataSourceCreateRequest,
    repo: DataSourceRepository = Depends(get_repository),
) -> DataSourceResponse:
    source_id = repo.create(
        name=payload.name,
        connector_type=payload.connector_type,
        source_config=payload.source_config,
        description=payload.description,
        metadata=payload.metadata,
    )

    # Newly created connections are immediately marked active.
    repo.update_status(source_id, status="active")

    source = repo.get(source_id)
    if not source:
        raise HTTPException(status_code=500, detail="Failed to load created data source")
    return _serialize_source(source)


@router.get("/{source_id}", response_model=DataSourceDetailResponse)
def get_data_source(
    source_id: str,
    repo: DataSourceRepository = Depends(get_repository),
) -> DataSourceDetailResponse:
    source = repo.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")
    tables = repo.list_tables(source_id)
    return _serialize_source_detail(source, tables)


@router.delete("/{source_id}")
def delete_data_source(
    source_id: str,
    drop_tables: bool = False,
    repo: DataSourceRepository = Depends(get_repository),
) -> Dict[str, Any]:
    source = repo.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")

    settings = get_settings()
    if drop_tables:
        tables = repo.list_tables(source_id)
        with duckdb.connect(str(settings.duckdb.path)) as con:
            for table in tables:
                con.execute(f"DROP TABLE IF EXISTS {table.target_table}")

    removed = repo.delete(source_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Data source not found")

    return {"message": f"Data source '{source.name}' deleted", "tables_dropped": drop_tables}


@router.post("/test-connection", response_model=TestConnectionResponse)
def test_connection(
    payload: TestConnectionRequest,
    ingestion: IngestionService = Depends(get_ingestion_service),
) -> TestConnectionResponse:
    try:
        tables = ingestion.list_available_tables(payload.connector_type, payload.source_config)
    except Exception as exc:  # pragma: no cover - connector errors
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return TestConnectionResponse(status="success", tables=tables)


@router.get("/{source_id}/tables", response_model=List[DataSourceTableResponse])
def list_data_source_tables(
    source_id: str,
    repo: DataSourceRepository = Depends(get_repository),
) -> List[DataSourceTableResponse]:
    if not repo.get(source_id):
        raise HTTPException(status_code=404, detail="Data source not found")
    tables = repo.list_tables(source_id)
    return [_serialize_table(table) for table in tables]


@router.post(
    "/{source_id}/tables",
    response_model=DataSourceTableResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_table(
    source_id: str,
    payload: TableImportRequest,
    repo: DataSourceRepository = Depends(get_repository),
    ingestion: IngestionService = Depends(get_ingestion_service),
) -> DataSourceTableResponse:
    source = repo.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")

    table = _import_table(repo, ingestion, source, payload)
    return _serialize_table(table)


@router.post(
    "/{source_id}/tables/bulk",
    response_model=BulkTableImportResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def import_tables_bulk(
    source_id: str,
    payload: BulkTableImportRequest,
    repo: DataSourceRepository = Depends(get_repository),
    ingestion: IngestionService = Depends(get_ingestion_service),
) -> BulkTableImportResponse:
    source = repo.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")

    results: List[TableImportResult] = []
    for item in payload.tables:
        try:
            table = _import_table(repo, ingestion, source, item)
            results.append(
                TableImportResult(
                    target_table=table.target_table,
                    table_id=table.id,
                    status=table.status,
                    rows_imported=table.rows_count,
                    error=None,
                )
            )
        except HTTPException as exc:
            results.append(
                TableImportResult(
                    target_table=item.target_table,
                    table_id=None,
                    status="error",
                    rows_imported=None,
                    error=str(exc.detail),
                )
            )

    return BulkTableImportResponse(results=results)


@router.post("/{source_id}/tables/{table_id}/sync", response_model=SyncResponse)
def sync_table(
    source_id: str,
    table_id: str,
    repo: DataSourceRepository = Depends(get_repository),
    ingestion: IngestionService = Depends(get_ingestion_service),
) -> SyncResponse:
    source = repo.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")

    table = repo.get_table(table_id)
    if not table or table.data_source_id != source_id:
        raise HTTPException(status_code=404, detail="Data source table not found")

    repo.update_table_status(table_id, status="syncing")

    settings = get_settings()
    job = _build_ingestion_job(source, table, settings.duckdb.path, overwrite=True)

    try:
        result = ingestion.run(job)
    except Exception as exc:
        repo.update_table_status(table_id, status="error", error_message=str(exc))
        raise HTTPException(status_code=500, detail=f"Failed to sync table: {exc}") from exc

    repo.update_table_status(
        table_id,
        status="active",
        rows_count=result.get("rows_ingested"),
        metadata=result.get("metadata"),
    )

    message = f"Successfully synced {result.get('rows_ingested', 0)} rows"
    return SyncResponse(status="active", rows_imported=result.get("rows_ingested"), message=message)


@router.delete("/{source_id}/tables/{table_id}")
def delete_table(
    source_id: str,
    table_id: str,
    drop_table: bool = False,
    repo: DataSourceRepository = Depends(get_repository),
) -> Dict[str, Any]:
    source = repo.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")

    table = repo.get_table(table_id)
    if not table or table.data_source_id != source_id:
        raise HTTPException(status_code=404, detail="Data source table not found")

    settings = get_settings()
    if drop_table:
        with duckdb.connect(str(settings.duckdb.path)) as con:
            con.execute(f"DROP TABLE IF EXISTS {table.target_table}")

    deleted = repo.delete_table(table_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Data source table not found")

    return {
        "message": f"Table '{table.target_table}' removed from data source",
        "table_dropped": drop_table,
    }


def _serialize_source(source: DataSource) -> DataSourceResponse:
    return DataSourceResponse(
        id=source.id,
        name=source.name,
        description=source.description,
        connector_type=source.connector_type,
        source_config=source.source_config,
        status=source.status,
        error_message=source.error_message,
        created_at=source.created_at.isoformat(),
        updated_at=source.updated_at.isoformat(),
        metadata=source.metadata,
        table_count=source.table_count,
    )


def _serialize_source_detail(
    source: DataSource, tables: List[DataSourceTable]
) -> DataSourceDetailResponse:
    return DataSourceDetailResponse(
        **_serialize_source(source).dict(),
        tables=[_serialize_table(table) for table in tables],
    )


def _serialize_table(table: DataSourceTable) -> DataSourceTableResponse:
    return DataSourceTableResponse(
        id=table.id,
        data_source_id=table.data_source_id,
        source_table=table.source_table,
        source_query=table.source_query,
        target_table=table.target_table,
        rows_count=table.rows_count,
        status=table.status,
        last_imported_at=table.last_imported_at.isoformat() if table.last_imported_at else None,
        error_message=table.error_message,
        created_at=table.created_at.isoformat(),
        updated_at=table.updated_at.isoformat(),
        metadata=table.metadata,
    )


def _import_table(
    repo: DataSourceRepository,
    ingestion: IngestionService,
    source: DataSource,
    request: TableImportRequest,
) -> DataSourceTable:
    settings = get_settings()

    table_id = repo.create_table(
        data_source_id=source.id,
        source_table=request.source_table,
        source_query=request.source_query,
        target_table=request.target_table,
        metadata=request.metadata,
    )

    repo.update_table_status(table_id, status="syncing")

    table_placeholder = repo.get_table(table_id)
    if not table_placeholder:
        raise HTTPException(status_code=500, detail="Failed to persist table metadata")

    job = _build_ingestion_job(source, table_placeholder, settings.duckdb.path, overwrite=request.overwrite)

    try:
        result = ingestion.run(job)
    except Exception as exc:  # pragma: no cover - connector/runtime errors
        repo.update_table_status(table_id, status="error", error_message=str(exc))
        raise HTTPException(status_code=500, detail=f"Failed to import table: {exc}") from exc

    repo.update_table_status(
        table_id,
        status="active",
        rows_count=result.get("rows_ingested"),
        metadata=result.get("metadata"),
    )

    table = repo.get_table(table_id)
    if not table:
        raise HTTPException(status_code=500, detail="Failed to load imported table")
    return table


def _build_ingestion_job(
    source: DataSource,
    table: DataSourceTable,
    duckdb_path: str,
    *,
    overwrite: bool,
) -> IngestionJob:
    config = copy.deepcopy(source.source_config) if source.source_config else {}

    if table.source_query:
        config["query"] = table.source_query
    elif table.source_table:
        config["query"] = f"SELECT * FROM {table.source_table}"

    if table.metadata:
        config.setdefault("metadata", {}).update(table.metadata)

    return IngestionJob(
        connector=source.connector_type,
        warehouse_path=duckdb_path,
        config=config,
        target_table=table.target_table,
        overwrite=overwrite,
        source_table=table.source_table,
        source_query=table.source_query,
    )


