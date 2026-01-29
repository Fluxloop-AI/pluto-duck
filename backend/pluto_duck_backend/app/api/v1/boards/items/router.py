"""Board items and assets API router."""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse

from pluto_duck_backend.app.api.deps import get_project_id_header
from pluto_duck_backend.app.api.v1.boards.items.schemas import (
    AssetUploadResponse,
    BoardItemResponse,
    CreateItemRequest,
    UpdateItemPositionRequest,
    UpdateItemRequest,
)
from pluto_duck_backend.app.services.boards import (
    BoardsRepository,
    BoardsService,
    get_boards_repository,
    get_boards_service,
)


router = APIRouter()


# ========== Helper Functions ==========


def get_repo() -> BoardsRepository:
    """Get repository dependency."""

    return get_boards_repository()


def get_service() -> BoardsService:
    """Get service dependency."""

    return get_boards_service()


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
) -> Response:
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


# ========== Asset Endpoints ==========


@router.post("/items/{item_id}/assets/upload", response_model=AssetUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_asset(
    item_id: str,
    file: UploadFile = File(...),
    project_id: str = Depends(get_project_id_header),
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
) -> Response:
    """Delete an asset."""

    deleted = repo.delete_asset(asset_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Asset not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
