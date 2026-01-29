"""Schemas for source folder endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class FolderSourceResponse(BaseModel):
    """Response for a folder source."""

    id: str
    name: str
    path: str
    allowed_types: str
    pattern: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CreateFolderSourceRequest(BaseModel):
    """Request to create a folder source."""

    name: str = Field(..., description="Display name for this folder source")
    path: str = Field(..., description="Local directory path")
    allowed_types: Literal["csv", "parquet", "both"] = Field(
        "both", description="Which file types to include"
    )
    pattern: Optional[str] = Field(None, description="Optional filename pattern (e.g. *.csv)")


class FolderFileResponse(BaseModel):
    """A discovered file within a folder source."""

    path: str
    name: str
    file_type: Literal["csv", "parquet"]
    size_bytes: int
    modified_at: datetime

    model_config = {"from_attributes": True}


class FolderScanResponse(BaseModel):
    """Response for folder scan results."""

    folder_id: str
    scanned_at: datetime
    new_files: int
    changed_files: int
    deleted_files: int

    model_config = {"from_attributes": True}
