"""Schemas for asset file endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ImportFileRequest(BaseModel):
    """Request to import a file."""

    file_path: str = Field(..., description="Path to the source file")
    file_type: Literal["csv", "parquet"] = Field(..., description="Type of file")
    table_name: str = Field(..., description="Name for the DuckDB table (for new tables)")
    name: Optional[str] = Field(None, description="Human-readable name")
    description: Optional[str] = Field(None, description="Description")
    overwrite: bool = Field(True, description="Overwrite existing table (replace mode only)")
    mode: Literal["replace", "append", "merge"] = Field(
        "replace",
        description="Import mode: replace (new table), append (add rows), merge (upsert)",
    )
    target_table: Optional[str] = Field(
        None,
        description="Existing table name for append/merge modes",
    )
    merge_keys: Optional[List[str]] = Field(
        None,
        description="Column names for merge key (required for merge mode)",
    )
    deduplicate: bool = Field(
        False,
        description="When appending, skip rows that are exact duplicates of existing rows in the target table",
    )
    diagnosis_id: Optional[str] = Field(
        None,
        description="ID of the diagnosis to link to this file asset",
    )


class FileSourceResponse(BaseModel):
    """Response for a file source."""

    file_path: str
    original_name: Optional[str] = None
    row_count: Optional[int] = None
    file_size_bytes: Optional[int] = None
    added_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class FileAssetResponse(BaseModel):
    """Response for a file asset."""

    id: str
    name: str
    file_path: str
    file_type: str
    table_name: str
    description: Optional[str] = None
    row_count: Optional[int] = None
    column_count: Optional[int] = None
    file_size_bytes: Optional[int] = None
    diagnosis_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    sources: Optional[List[FileSourceResponse]] = None

    model_config = {"from_attributes": True}


class FileSchemaResponse(BaseModel):
    """Response for file schema."""

    columns: List[Dict[str, Any]]

    model_config = {"from_attributes": True}


class FilePreviewResponse(BaseModel):
    """Response for file data preview."""

    columns: List[str]
    rows: List[List[Any]]
    total_rows: Optional[int] = None

    model_config = {"from_attributes": True}


class FilePreprocessingEventResponse(BaseModel):
    """Response for file preprocessing events."""

    id: str
    file_asset_id: str
    event_type: str
    message: Optional[str] = None
    actor: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
