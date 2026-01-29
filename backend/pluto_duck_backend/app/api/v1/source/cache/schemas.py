"""Schemas for source cache endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


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

    model_config = {"from_attributes": True}
