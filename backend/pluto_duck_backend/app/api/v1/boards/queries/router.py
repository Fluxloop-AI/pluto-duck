"""Board queries API router."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from pluto_duck_backend.app.services.boards import (
    BoardsRepository,
    BoardsService,
    get_boards_repository,
    get_boards_service,
)


router = APIRouter()


# ========== Request/Response Models ==========


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


# ========== Helper Functions ==========


def get_repo() -> BoardsRepository:
    """Get repository dependency."""

    return get_boards_repository()


def get_service() -> BoardsService:
    """Get service dependency."""

    return get_boards_service()


# ========== Query Endpoints ==========


@router.post("/items/{item_id}/query", response_model=Dict[str, str], status_code=status.HTTP_201_CREATED)
def create_query(
    item_id: str,
    payload: CreateQueryRequest,
    repo: BoardsRepository = Depends(get_repo),
) -> Dict[str, str]:
    """Create a query for a board item (chart/table/metric)."""

    item = repo.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    query_id = repo.create_query(
        item_id=item_id,
        query_text=payload.query_text,
        data_source_tables=payload.data_source_tables,
        refresh_mode=payload.refresh_mode,
        refresh_interval_seconds=payload.refresh_interval_seconds,
    )

    return {"query_id": query_id}


@router.post("/items/{item_id}/query/execute", response_model=QueryResultResponse)
async def execute_query(
    item_id: str,
    project_id: str = Header(..., alias="X-Project-ID"),
    service: BoardsService = Depends(get_service),
    repo: BoardsRepository = Depends(get_repo),
) -> QueryResultResponse:
    """Execute query for a board item."""

    query = repo.get_query_by_item(item_id)
    if not query:
        raise HTTPException(status_code=404, detail="Query not found for this item")

    try:
        result = await service.execute_query(query.id, project_id)
        return QueryResultResponse(
            columns=result["columns"],
            data=result["data"],
            row_count=result["row_count"],
            executed_at=result["executed_at"],
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query execution failed: {str(e)}")


@router.get("/items/{item_id}/query/result", response_model=QueryResultResponse)
async def get_cached_result(
    item_id: str,
    service: BoardsService = Depends(get_service),
    repo: BoardsRepository = Depends(get_repo),
) -> QueryResultResponse:
    """Get cached query result without re-execution."""

    query = repo.get_query_by_item(item_id)
    if not query:
        raise HTTPException(status_code=404, detail="Query not found for this item")

    result = await service.get_cached_result(query.id)
    if not result:
        raise HTTPException(status_code=404, detail="No cached result available")

    return QueryResultResponse(
        columns=result.get("columns", []),
        data=result.get("data", []),
        row_count=result.get("row_count", 0),
        executed_at=result.get("executed_at", ""),
    )
