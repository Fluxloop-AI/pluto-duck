"""Settings management endpoints."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from pluto_duck_backend.app.services.chat import get_chat_repository

router = APIRouter(tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    """Request model for updating user settings."""

    llm_api_key: Optional[str] = Field(None, description="OpenAI API key")
    llm_model: Optional[str] = Field(None, description="Default LLM model")
    llm_provider: Optional[str] = Field(None, description="LLM provider (currently only 'openai')")
    user_name: Optional[str] = Field(None, description="User display name")
    language: Optional[str] = Field(None, description="User language preference")


class SettingsResponse(BaseModel):
    """Response model for settings."""

    llm_provider: str = "openai"
    llm_api_key: Optional[str] = None  # Masked
    llm_model: Optional[str] = None
    data_sources: Optional[Any] = None
    ui_preferences: Dict[str, Any] = {"theme": "dark"}
    default_project_id: Optional[str] = None
    user_name: Optional[str] = None
    language: str = "en"


class UpdateSettingsResponse(BaseModel):
    """Response for settings update."""

    success: bool
    message: str


def mask_api_key(api_key: Optional[str]) -> Optional[str]:
    """Mask API key for display, showing only first few characters."""
    if not api_key or not isinstance(api_key, str):
        return None
    if len(api_key) <= 10:
        return "sk-***"
    return f"{api_key[:7]}***{api_key[-4:]}"


def _resolve_default_project_id() -> Optional[str]:
    """Return a valid default project id, restoring if stale."""
    repo = get_chat_repository()
    default_project_id = repo._default_project_id
    with repo._connect() as con:
        if default_project_id:
            row = con.execute(
                "SELECT id FROM projects WHERE id = ?",
                [default_project_id],
            ).fetchone()
            if row:
                return str(row[0])

        row = con.execute("SELECT id FROM projects WHERE is_default = TRUE").fetchone()
        if row:
            repo._default_project_id = str(row[0])
            return str(row[0])

    repo._default_project_id = repo._ensure_default_project()
    return repo._default_project_id


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
        default_project_id=_resolve_default_project_id(),
        user_name=settings.get("user_name"),
        language=settings.get("language") or "en",
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
            raise HTTPException(
                status_code=400,
                detail="Invalid API key format. Must start with 'sk-'",
            )
        payload["llm_api_key"] = request.llm_api_key
    
    if request.llm_model is not None:
        # Validate model (optional: add more validation)
        valid_models = ["gpt-5", "gpt-5-mini"]
        if not request.llm_model.startswith("local:") and request.llm_model not in valid_models:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid model. Must be one of: "
                    f"{', '.join(valid_models)} or start with 'local:'"
                ),
            )
        payload["llm_model"] = request.llm_model
    
    if request.llm_provider is not None:
        # Currently only support OpenAI
        if request.llm_provider != "openai":
            raise HTTPException(
                status_code=400,
                detail="Currently only 'openai' provider is supported",
            )
        payload["llm_provider"] = request.llm_provider

    if request.user_name is not None:
        payload["user_name"] = request.user_name
    
    if request.language is not None:
        if request.language not in {"en", "ko"}:
            raise HTTPException(status_code=400, detail="Invalid language. Must be 'en' or 'ko'")
        payload["language"] = request.language

    if payload:
        repo.update_settings(payload)

    return UpdateSettingsResponse(
        success=True,
        message="Settings saved successfully",
    )
