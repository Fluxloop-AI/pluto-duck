"""Boards (CRUD) API router."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status

from pluto_duck_backend.app.api.deps import get_project_id_path
from pluto_duck_backend.app.api.v1.boards.boards.schemas import (
    BoardDetailResponse,
    BoardResponse,
    CreateBoardRequest,
    UpdateBoardRequest,
)
from pluto_duck_backend.app.api.v1.boards.items.schemas import BoardItemResponse
from pluto_duck_backend.app.services.boards import BoardsRepository, get_boards_repository


router = APIRouter()
logger = logging.getLogger("pluto_duck_backend.boards")


def _settings_size(settings: Optional[Dict[str, Any]]) -> int:
    if settings is None:
        return 0
    try:
        return len(json.dumps(settings))
    except Exception:
        return -1


# ========== Helper Functions ==========


def get_repo() -> BoardsRepository:
    """Get repository dependency."""

    return get_boards_repository()


# ========== Board Endpoints ==========


@router.get("/projects/{project_id}/boards", response_model=List[BoardResponse])
def list_boards(
    project_id: str = Depends(get_project_id_path),
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
    payload: CreateBoardRequest,
    project_id: str = Depends(get_project_id_path),
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

    logger.info(
        "board_update_start board_id=%s has_settings=%s settings_size=%s has_name=%s has_description=%s",
        board_id,
        payload.settings is not None,
        _settings_size(payload.settings),
        payload.name is not None,
        payload.description is not None,
    )
    board = repo.get_board(board_id)
    if not board:
        logger.warning("board_update_missing board_id=%s", board_id)
        raise HTTPException(status_code=404, detail="Board not found")

    try:
        repo.update_board(
            board_id=board_id,
            name=payload.name,
            description=payload.description,
            settings=payload.settings,
        )
    except Exception:
        logger.exception("board_update_failed board_id=%s", board_id)
        raise

    updated_board = repo.get_board(board_id)
    if not updated_board:
        logger.error("board_update_reload_failed board_id=%s", board_id)
        raise HTTPException(status_code=500, detail="Failed to update board")

    logger.info("board_update_success board_id=%s updated_at=%s", board_id, updated_board.updated_at)
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
) -> Response:
    """Delete a board."""

    deleted = repo.delete_board(board_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Board not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
