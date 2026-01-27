"""LLM settings with priority resolution: DB > ENV > default."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class LLMSettings:
    """Resolved LLM configuration settings.

    Attributes:
        provider: LLM provider name (e.g., "openai")
        model: Model identifier (e.g., "gpt-4o-mini")
        api_key: API key for the provider
        api_base: Optional custom API base URL
    """

    provider: str
    model: str
    api_key: Optional[str]
    api_base: Optional[str]

    @classmethod
    def from_config(cls) -> LLMSettings:
        """Create LLMSettings with DB > ENV > default priority resolution.

        Priority order for each setting:
        1. Database settings (if available)
        2. Environment variables / config file settings
        3. Default values

        Returns:
            LLMSettings with resolved configuration
        """
        from pluto_duck_backend.app.core.config import get_settings
        from pluto_duck_backend.app.services.chat import get_chat_repository

        settings = get_settings()
        db_settings: dict = {}

        try:
            repo = get_chat_repository()
            db_settings = repo.get_settings()
        except Exception:
            pass  # DB not available, continue with env/defaults

        # Resolve provider: DB > ENV > default
        provider = (
            db_settings.get("llm_provider")
            or settings.agent.provider
            or "openai"
        ).lower()

        # Resolve model: DB > ENV > default
        model = (
            db_settings.get("llm_model")
            or settings.agent.model
            or "gpt-4o-mini"
        )

        # Resolve api_key: DB > ENV > OPENAI_API_KEY fallback
        api_key = (
            db_settings.get("llm_api_key")
            or settings.agent.api_key
            or os.getenv("OPENAI_API_KEY")
        )

        # Resolve api_base: ENV only (not typically stored in DB)
        api_base = str(settings.agent.api_base) if settings.agent.api_base else None

        return cls(
            provider=provider,
            model=model,
            api_key=api_key,
            api_base=api_base,
        )
