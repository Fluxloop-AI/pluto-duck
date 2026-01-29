"""Schemas for source attach endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from pluto_duck_backend.app.api.v1.source.cache.schemas import CachedTableResponse


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
    project_id: Optional[str] = None
    description: Optional[str] = None
    table_count: int = 0
    connection_config: Optional[Dict[str, Any]] = None

    model_config = {"from_attributes": True}


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
    mode: str
    local_table: Optional[str] = None

    model_config = {"from_attributes": True}


class SizeEstimateResponse(BaseModel):
    """Response for table size estimation."""

    source_name: str
    table_name: str
    estimated_rows: Optional[int] = None
    recommend_cache: bool
    recommend_filter: bool = False
    suggestion: str
    error: Optional[str] = None

    model_config = {"from_attributes": True}
