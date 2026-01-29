"""Schemas for board item endpoints."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


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

    model_config = {"from_attributes": True}


class AssetUploadResponse(BaseModel):
    """Asset upload response."""

    asset_id: str
    file_name: str
    file_size: int
    mime_type: str
    url: str

    model_config = {"from_attributes": True}
