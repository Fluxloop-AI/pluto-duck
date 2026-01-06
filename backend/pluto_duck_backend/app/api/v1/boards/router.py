"""Boards API router."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Header, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from pluto_duck_backend.app.services.boards import (
    BoardsRepository,
    BoardsService,
    get_boards_repository,
    get_boards_service,
)

router = APIRouter(prefix="/boards", tags=["boards"])


# ========== Request/Response Models ==========

class CreateBoardRequest(BaseModel):
    """Request to create a board."""
    name: str
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class UpdateBoardRequest(BaseModel):
    """Request to update a board."""
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class BoardResponse(BaseModel):
    """Board response."""
    id: str
    project_id: str
    name: str
    description: Optional[str]
    position: int
    created_at: str
    updated_at: str
    settings: Optional[Dict[str, Any]] = None


class CreateItemRequest(BaseModel):
    """Request to create a board item."""
    item_type: str = Field(..., description="Item type: markdown, chart, table, metric, image")
    title: Optional[str] = None
    payload: Dict[str, Any]
    render_config: Optional[Dict[str, Any]] = None
    position_x: int = 0
    position_y: int = 0
    width: int = 1
    height: int = 1


class UpdateItemRequest(BaseModel):
    """Request to update a board item."""
    title: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    render_config: Optional[Dict[str, Any]] = None


class UpdateItemPositionRequest(BaseModel):
    """Request to update item position."""
    position_x: int
    position_y: int
    width: int
    height: int


class BoardItemResponse(BaseModel):
    """Board item response."""
    id: str
    board_id: str
    item_type: str
    title: Optional[str]
    position_x: int
    position_y: int
    width: int
    height: int
    payload: Dict[str, Any]
    render_config: Optional[Dict[str, Any]]
    created_at: str
    updated_at: str


class BoardDetailResponse(BoardResponse):
    """Board detail with items."""
    items: List[BoardItemResponse]


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


class AssetUploadResponse(BaseModel):
    """Asset upload response."""
    asset_id: str
    file_name: str
    file_size: int
    mime_type: str
    url: str


# ========== Helper Functions ==========

def get_repo() -> BoardsRepository:
    """Get repository dependency."""
    return get_boards_repository()


def get_service() -> BoardsService:
    """Get service dependency."""
    return get_boards_service()


# ========== Board Endpoints ==========

@router.get("/projects/{project_id}/boards", response_model=List[BoardResponse])
def list_boards(
    project_id: str,
    repo: BoardsRepository = Depends(get_repo),
) -> List[BoardResponse]:
    """List all boards for a project."""
    boards = repo.list_boards(project_id)
    return [
        BoardResponse(
            id=board.id,
            project_id=board.project_id,
            name=board.name,
            description=board.description,
            position=board.position,
            created_at=board.created_at.isoformat(),
            updated_at=board.updated_at.isoformat(),
            settings=board.settings,
        )
        for board in boards
    ]


@router.post("/projects/{project_id}/boards", response_model=BoardResponse, status_code=status.HTTP_201_CREATED)
def create_board(
    project_id: str,
    payload: CreateBoardRequest,
    repo: BoardsRepository = Depends(get_repo),
) -> BoardResponse:
    """Create a new board."""
    board_id = repo.create_board(
        project_id=project_id,
        name=payload.name,
        description=payload.description,
        settings=payload.settings,
    )

    board = repo.get_board(board_id)
    if not board:
        raise HTTPException(status_code=500, detail="Failed to create board")

    return BoardResponse(
        id=board.id,
        project_id=board.project_id,
        name=board.name,
        description=board.description,
        position=board.position,
        created_at=board.created_at.isoformat(),
        updated_at=board.updated_at.isoformat(),
        settings=board.settings,
    )


@router.get("/{board_id}", response_model=BoardDetailResponse)
def get_board(
    board_id: str,
    repo: BoardsRepository = Depends(get_repo),
) -> BoardDetailResponse:
    """Get board details with items."""
    board = repo.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    items = repo.list_items(board_id)

    return BoardDetailResponse(
        id=board.id,
        project_id=board.project_id,
        name=board.name,
        description=board.description,
        position=board.position,
        created_at=board.created_at.isoformat(),
        updated_at=board.updated_at.isoformat(),
        settings=board.settings,
        items=[
            BoardItemResponse(
                id=item.id,
                board_id=item.board_id,
                item_type=item.item_type,
                title=item.title,
                position_x=item.position_x,
                position_y=item.position_y,
                width=item.width,
                height=item.height,
                payload=item.payload,
                render_config=item.render_config,
                created_at=item.created_at.isoformat(),
                updated_at=item.updated_at.isoformat(),
            )
            for item in items
        ],
    )


@router.patch("/{board_id}", response_model=BoardResponse)
def update_board(
    board_id: str,
    payload: UpdateBoardRequest,
    repo: BoardsRepository = Depends(get_repo),
) -> BoardResponse:
    """Update a board."""
    board = repo.get_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    repo.update_board(
        board_id=board_id,
        name=payload.name,
        description=payload.description,
        settings=payload.settings,
    )

    updated_board = repo.get_board(board_id)
    if not updated_board:
        raise HTTPException(status_code=500, detail="Failed to update board")

    return BoardResponse(
        id=updated_board.id,
        project_id=updated_board.project_id,
        name=updated_board.name,
        description=updated_board.description,
        position=updated_board.position,
        created_at=updated_board.created_at.isoformat(),
        updated_at=updated_board.updated_at.isoformat(),
        settings=updated_board.settings,
    )


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_board(
    board_id: str,
    repo: BoardsRepository = Depends(get_repo),
):
    """Delete a board."""
    deleted = repo.delete_board(board_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Board not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ========== Board Item Endpoints ==========

@router.get("/{board_id}/items", response_model=List[BoardItemResponse])
def list_items(
    board_id: str,
    repo: BoardsRepository = Depends(get_repo),
) -> List[BoardItemResponse]:
    """List all items for a board."""
    items = repo.list_items(board_id)
    return [
        BoardItemResponse(
            id=item.id,
            board_id=item.board_id,
            item_type=item.item_type,
            title=item.title,
            position_x=item.position_x,
            position_y=item.position_y,
            width=item.width,
            height=item.height,
            payload=item.payload,
            render_config=item.render_config,
            created_at=item.created_at.isoformat(),
            updated_at=item.updated_at.isoformat(),
        )
        for item in items
    ]


@router.post("/{board_id}/items", response_model=BoardItemResponse, status_code=status.HTTP_201_CREATED)
def create_item(
    board_id: str,
    payload: CreateItemRequest,
    repo: BoardsRepository = Depends(get_repo),
) -> BoardItemResponse:
    """Create a new board item."""
    item_id = repo.create_item(
        board_id=board_id,
        item_type=payload.item_type,
        payload=payload.payload,
        title=payload.title,
        position_x=payload.position_x,
        position_y=payload.position_y,
        width=payload.width,
        height=payload.height,
        render_config=payload.render_config,
    )

    item = repo.get_item(item_id)
    if not item:
        raise HTTPException(status_code=500, detail="Failed to create item")

    return BoardItemResponse(
        id=item.id,
        board_id=item.board_id,
        item_type=item.item_type,
        title=item.title,
        position_x=item.position_x,
        position_y=item.position_y,
        width=item.width,
        height=item.height,
        payload=item.payload,
        render_config=item.render_config,
        created_at=item.created_at.isoformat(),
        updated_at=item.updated_at.isoformat(),
    )


@router.patch("/items/{item_id}", response_model=BoardItemResponse)
def update_item(
    item_id: str,
    payload: UpdateItemRequest,
    repo: BoardsRepository = Depends(get_repo),
) -> BoardItemResponse:
    """Update a board item."""
    item = repo.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    repo.update_item(
        item_id=item_id,
        title=payload.title,
        payload=payload.payload,
        render_config=payload.render_config,
    )

    updated_item = repo.get_item(item_id)
    if not updated_item:
        raise HTTPException(status_code=500, detail="Failed to update item")

    return BoardItemResponse(
        id=updated_item.id,
        board_id=updated_item.board_id,
        item_type=updated_item.item_type,
        title=updated_item.title,
        position_x=updated_item.position_x,
        position_y=updated_item.position_y,
        width=updated_item.width,
        height=updated_item.height,
        payload=updated_item.payload,
        render_config=updated_item.render_config,
        created_at=updated_item.created_at.isoformat(),
        updated_at=updated_item.updated_at.isoformat(),
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_item(
    item_id: str,
    repo: BoardsRepository = Depends(get_repo),
):
    """Delete a board item."""
    deleted = repo.delete_item(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/items/{item_id}/position", response_model=BoardItemResponse)
def update_item_position(
    item_id: str,
    payload: UpdateItemPositionRequest,
    repo: BoardsRepository = Depends(get_repo),
) -> BoardItemResponse:
    """Update item position and size."""
    item = repo.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    repo.update_item_position(
        item_id=item_id,
        position_x=payload.position_x,
        position_y=payload.position_y,
        width=payload.width,
        height=payload.height,
    )

    updated_item = repo.get_item(item_id)
    if not updated_item:
        raise HTTPException(status_code=500, detail="Failed to update position")

    return BoardItemResponse(
        id=updated_item.id,
        board_id=updated_item.board_id,
        item_type=updated_item.item_type,
        title=updated_item.title,
        position_x=updated_item.position_x,
        position_y=updated_item.position_y,
        width=updated_item.width,
        height=updated_item.height,
        payload=updated_item.payload,
        render_config=updated_item.render_config,
        created_at=updated_item.created_at.isoformat(),
        updated_at=updated_item.updated_at.isoformat(),
    )


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


# ========== Asset Endpoints ==========

@router.post("/items/{item_id}/assets/upload", response_model=AssetUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_asset(
    item_id: str,
    file: UploadFile = File(...),
    project_id: str = Header(..., alias="X-Project-ID"),
    service: BoardsService = Depends(get_service),
) -> AssetUploadResponse:
    """Upload an asset (image) for a board item."""
    try:
        result = await service.upload_asset(item_id, file, project_id)
        return AssetUploadResponse(
            asset_id=result["asset_id"],
            file_name=result["file_name"],
            file_size=result["file_size"],
            mime_type=result["mime_type"],
            url=result["url"],
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/assets/{asset_id}/download")
async def download_asset(
    asset_id: str,
    service: BoardsService = Depends(get_service),
) -> FileResponse:
    """Download an asset file."""
    try:
        file_path, mime_type = await service.download_asset(asset_id)
        return FileResponse(
            path=str(file_path),
            media_type=mime_type,
            filename=file_path.name,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_asset_endpoint(
    asset_id: str,
    repo: BoardsRepository = Depends(get_repo),
):
    """Delete an asset."""
    deleted = repo.delete_asset(asset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Asset not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

