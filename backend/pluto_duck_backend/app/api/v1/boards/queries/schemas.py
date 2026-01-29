"""Schemas for board query endpoints."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class CreateQueryRequest(BaseModel):
    """Request to create a query for chart/table/metric item."""

    query_text: str
    data_source_tables: Optional[List[str]] = None
    refresh_mode: str = "manual"
    refresh_interval_seconds: Optional[int] = None


class QueryResultResponse(BaseModel):
    """Query execution result."""

    columns: List[str]
    data: List[Dict[str, Any]]
    row_count: int
    executed_at: str

    model_config = {"from_attributes": True}
