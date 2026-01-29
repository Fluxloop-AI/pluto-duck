"""Schemas for boards endpoints."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from pluto_duck_backend.app.api.v1.boards.items.schemas import BoardItemResponse


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

    model_config = {"from_attributes": True}


class BoardDetailResponse(BoardResponse):
    """Board detail with items."""

    items: List[BoardItemResponse]
