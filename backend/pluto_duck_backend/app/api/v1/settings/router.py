"""Settings management endpoints."""

import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.chat import get_chat_repository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    """Request model for updating user settings."""

    llm_api_key: Optional[str] = Field(None, description="OpenAI API key")
    llm_model: Optional[str] = Field(None, description="Default LLM model")
    llm_provider: Optional[str] = Field(None, description="LLM provider (currently only 'openai')")


class SettingsResponse(BaseModel):
    """Response model for settings."""

    llm_provider: str = "openai"
    llm_api_key: Optional[str] = None  # Masked
    llm_model: Optional[str] = None
    data_sources: Optional[Any] = None
    ui_preferences: Dict[str, Any] = {"theme": "dark"}
    default_project_id: Optional[str] = None


class UpdateSettingsResponse(BaseModel):
    """Response for settings update."""

    success: bool
    message: str


class ResetDatabaseResponse(BaseModel):
    """Response for database reset."""

    success: bool
    message: str


def mask_api_key(api_key: Optional[str]) -> Optional[str]:
    """Mask API key for display, showing only first few characters."""
    if not api_key or not isinstance(api_key, str):
        return None
    if len(api_key) <= 10:
        return "sk-***"
    return f"{api_key[:7]}***{api_key[-4:]}"


@router.get("", response_model=SettingsResponse)
def get_settings() -> SettingsResponse:
    """Retrieve current user settings."""
    repo = get_chat_repository()
    settings = repo.get_settings()
    
    return SettingsResponse(
        llm_provider=settings.get("llm_provider") or "openai",
        llm_api_key=mask_api_key(settings.get("llm_api_key")),
        llm_model=settings.get("llm_model"),
        data_sources=settings.get("data_sources"),
        ui_preferences=settings.get("ui_preferences") or {"theme": "dark"},
        default_project_id=repo._default_project_id,
    )


@router.put("", response_model=UpdateSettingsResponse)
def update_settings(request: UpdateSettingsRequest) -> UpdateSettingsResponse:
    """Update user settings."""
    repo = get_chat_repository()
    
    # Build update payload
    payload = {}
    
    if request.llm_api_key is not None:
        # Validate API key format (basic check)
        if not request.llm_api_key.startswith("sk-"):
            raise HTTPException(status_code=400, detail="Invalid API key format. Must start with 'sk-'")
        payload["llm_api_key"] = request.llm_api_key
    
    if request.llm_model is not None:
        # Validate model (optional: add more validation)
        valid_models = ["gpt-5", "gpt-5-mini", "gpt-4o", "gpt-4o-mini"]
        if not request.llm_model.startswith("local:") and request.llm_model not in valid_models:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid model. Must be one of: {', '.join(valid_models)} or start with 'local:'",
            )
        payload["llm_model"] = request.llm_model
    
    if request.llm_provider is not None:
        # Currently only support OpenAI
        if request.llm_provider != "openai":
            raise HTTPException(status_code=400, detail="Currently only 'openai' provider is supported")
        payload["llm_provider"] = request.llm_provider
    
    if payload:
        repo.update_settings(payload)
    
    return UpdateSettingsResponse(
        success=True,
        message="Settings saved successfully",
    )


@router.post("/reset-database", response_model=ResetDatabaseResponse)
def reset_database() -> ResetDatabaseResponse:
    """
    Reset the DuckDB database by deleting all data files and recreating the schema.
    
    WARNING: This will permanently delete all conversations, messages, projects, and data sources.
    """
    try:
        settings = get_settings()
        duckdb_path = settings.duckdb.path
        
        logger.warning(f"Database reset requested. Target: {duckdb_path}")
        
        # Close any existing connections by clearing the repository cache
        from pluto_duck_backend.app.services.chat.repository import get_chat_repository
        get_chat_repository.cache_clear()
        
        # Delete the DuckDB file if it exists
        if duckdb_path.exists():
            logger.info(f"Deleting DuckDB file: {duckdb_path}")
            duckdb_path.unlink()
        
        # Also delete any WAL files
        wal_path = duckdb_path.parent / f"{duckdb_path.name}.wal"
        if wal_path.exists():
            logger.info(f"Deleting WAL file: {wal_path}")
            wal_path.unlink()
        
        # Delete the entire data directory to clean up any other artifacts
        data_dir = duckdb_path.parent
        if data_dir.exists() and data_dir.name == "data":
            logger.info(f"Cleaning data directory: {data_dir}")
            shutil.rmtree(data_dir)
            data_dir.mkdir(parents=True, exist_ok=True)
        
        # Reinitialize the database with fresh schema
        logger.info("Reinitializing database with fresh schema")
        _ = get_chat_repository()
        
        return ResetDatabaseResponse(
            success=True,
            message="Database reset successfully. All data has been cleared.",
        )
        
    except Exception as e:
        logger.error(f"Failed to reset database: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset database: {str(e)}",
        )

