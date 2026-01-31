"""Settings management endpoints."""

import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from pluto_duck_backend.app.api.deps import get_project_id_query_required
from pluto_duck_backend.app.core.config import get_settings as get_app_settings
from pluto_duck_backend.app.services.asset import (
    get_diagnosis_issue_service,
    get_file_asset_service,
    get_file_diagnosis_service,
)
from pluto_duck_backend.app.services.chat import get_chat_repository
from pluto_duck_backend.app.services.source import get_source_service
from pluto_duck_backend.app.services.workzone import get_work_zone_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    """Request model for updating user settings."""

    llm_api_key: Optional[str] = Field(None, description="OpenAI API key")
    llm_model: Optional[str] = Field(None, description="Default LLM model")
    llm_provider: Optional[str] = Field(None, description="LLM provider (currently only 'openai')")
    user_name: Optional[str] = Field(None, description="User display name")


class SettingsResponse(BaseModel):
    """Response model for settings."""

    llm_provider: str = "openai"
    llm_api_key: Optional[str] = None  # Masked
    llm_model: Optional[str] = None
    data_sources: Optional[Any] = None
    ui_preferences: Dict[str, Any] = {"theme": "dark"}
    default_project_id: Optional[str] = None
    user_name: Optional[str] = None


class UpdateSettingsResponse(BaseModel):
    """Response for settings update."""

    success: bool
    message: str


class ResetDatabaseResponse(BaseModel):
    """Response for database reset."""

    success: bool
    message: str


class ResetWorkspaceDataResponse(BaseModel):
    """Response for workspace data reset."""

    success: bool
    message: str


def _quote_identifier(name: str) -> str:
    """Quote a SQL identifier safely for DuckDB."""
    return f"\"{name.replace('\"', '\"\"')}\""


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
        user_name=settings.get("user_name"),
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

    if request.user_name is not None:
        payload["user_name"] = request.user_name

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
        settings = get_app_settings()
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


@router.post("/reset-workspace-data", response_model=ResetWorkspaceDataResponse)
def reset_workspace_data(
    project_id: str = Depends(get_project_id_query_required),
) -> ResetWorkspaceDataResponse:
    """Reset all workspace data without deleting the project."""
    try:
        logger.warning(
            "Workspace data reset requested. Project: %s",
            project_id,
        )

        settings = get_app_settings()
        repo = get_chat_repository()

        # Gather analysis IDs before deleting analysis files.
        analyses_dir = settings.duckdb.path.parent / "analyses" / project_id
        analysis_ids = []
        if analyses_dir.exists():
            analysis_ids = [path.stem for path in analyses_dir.glob("*.yaml")]

        # Gather conversation IDs to clean up runtime work zones.
        with repo._connect() as con:
            conversation_ids = [
                row[0]
                for row in con.execute(
                    "SELECT id FROM agent_conversations WHERE project_id = ?",
                    [project_id],
                ).fetchall()
            ]

        # Delete file assets (and their tables) for this project.
        file_service = get_file_asset_service(project_id)
        assets = file_service.list_files()
        for asset in assets:
            file_service.delete_file(asset.id, drop_table=True)

        # Clear cached diagnoses for this project.
        diagnosis_service = get_file_diagnosis_service(project_id)
        diagnosis_service.delete_all()

        # Clear diagnosis issues for this project.
        issue_service = get_diagnosis_issue_service(project_id)
        issue_service.delete_all()

        # Drop cached tables in the project's warehouse.
        source_service = get_source_service(project_id)
        cached_tables = source_service.list_cached_tables()
        for cached in cached_tables:
            source_service.drop_cache(cached.local_table)

        # Clear board data, chats, and project-scoped metadata from main warehouse.
        with repo._write_connection() as con:
            # Boards
            con.execute(
                """
                DELETE FROM board_item_assets
                WHERE board_item_id IN (
                    SELECT id FROM board_items
                    WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
                )
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM board_queries
                WHERE board_item_id IN (
                    SELECT id FROM board_items
                    WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
                )
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM board_items
                WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
                """,
                [project_id],
            )
            con.execute("DELETE FROM boards WHERE project_id = ?", [project_id])

            # Conversations + related artifacts
            con.execute(
                """
                DELETE FROM agent_tool_approvals
                WHERE conversation_id IN (
                    SELECT id FROM agent_conversations WHERE project_id = ?
                )
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM agent_checkpoints
                WHERE run_id IN (
                    SELECT run_id
                    FROM agent_messages
                    WHERE conversation_id IN (
                        SELECT id FROM agent_conversations WHERE project_id = ?
                    )
                    AND run_id IS NOT NULL
                    UNION
                    SELECT run_id
                    FROM agent_conversations
                    WHERE project_id = ?
                    AND run_id IS NOT NULL
                )
                """,
                [project_id, project_id],
            )
            con.execute(
                """
                DELETE FROM agent_events
                WHERE conversation_id IN (
                    SELECT id FROM agent_conversations WHERE project_id = ?
                )
                """,
                [project_id],
            )
            con.execute(
                """
                DELETE FROM agent_messages
                WHERE conversation_id IN (
                    SELECT id FROM agent_conversations WHERE project_id = ?
                )
                """,
                [project_id],
            )
            con.execute("DELETE FROM agent_conversations WHERE project_id = ?", [project_id])

            # Data sources metadata
            con.execute(
                """
                DELETE FROM data_source_tables
                WHERE data_source_id IN (
                    SELECT id FROM data_sources WHERE project_id = ?
                )
                """,
                [project_id],
            )
            con.execute("DELETE FROM data_sources WHERE project_id = ?", [project_id])

            # Duckpipe run history/state for this project's analyses
            if analysis_ids:
                placeholders = ", ".join(["?"] * len(analysis_ids))
                con.execute(
                    f"DELETE FROM _duckpipe.run_history WHERE analysis_id IN ({placeholders})",
                    analysis_ids,
                )
                con.execute(
                    f"DELETE FROM _duckpipe.run_state WHERE analysis_id IN ({placeholders})",
                    analysis_ids,
                )
                for analysis_id in analysis_ids:
                    safe_id = _quote_identifier(analysis_id)
                    try:
                        con.execute(f"DROP VIEW IF EXISTS analysis.{safe_id}")
                    except Exception:
                        pass
                    try:
                        con.execute(f"DROP TABLE IF EXISTS analysis.{safe_id}")
                    except Exception:
                        pass

            # Reset project settings metadata
            con.execute(
                "UPDATE projects SET settings = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                [project_id],
            )

        # Remove per-conversation work zones.
        if conversation_ids:
            workzone_service = get_work_zone_service()
            for conv_id in conversation_ids:
                workzone_service.delete(conv_id)

        # Remove project-specific warehouse file (cached tables, attached sources, etc.).
        project_dir = settings.data_dir.root / "data" / "projects" / project_id
        if project_dir.exists():
            shutil.rmtree(project_dir)

        # Clear cached SourceService instances so future requests reinitialize safely.
        try:
            get_source_service.cache_clear()
        except Exception:
            pass

        # Remove analysis definitions for this project.
        if analyses_dir.exists():
            shutil.rmtree(analyses_dir)

        return ResetWorkspaceDataResponse(
            success=True,
            message="Workspace reset successfully. All project data and metadata have been cleared.",
        )
    except Exception as e:
        logger.error(f"Failed to reset workspace data: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset workspace data: {str(e)}",
        )
