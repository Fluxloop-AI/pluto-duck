"""LLM settings with priority resolution: DB > ENV > default."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

_SUPPORTED_REMOTE_MODELS = {"gpt-5", "gpt-5-mini"}
_DEFAULT_MODEL = "gpt-5-mini"


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
    reasoning_effort: Optional[str]
    text_verbosity: Optional[str]
    max_output_tokens: Optional[int]

    @staticmethod
    def _normalize_model(model: object) -> str:
        if isinstance(model, str):
            if model.startswith("local:"):
                return model
            if model in _SUPPORTED_REMOTE_MODELS:
                return model
        logger.warning("Unsupported llm_model '%s'; fallback to %s", model, _DEFAULT_MODEL)
        return _DEFAULT_MODEL

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
            logger.warning(
                "Failed to load LLM settings from DB; fallback to env/default",
                exc_info=True,
            )

        # Resolve provider: DB > ENV > default
        provider = (
            db_settings.get("llm_provider")
            or settings.agent.provider
            or "openai"
        ).lower()

        # Resolve model: DB > ENV > default
        raw_model = (
            db_settings.get("llm_model")
            or settings.agent.model
            or _DEFAULT_MODEL
        )
        model = cls._normalize_model(raw_model)

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
            reasoning_effort=settings.agent.reasoning_effort,
            text_verbosity=settings.agent.text_verbosity,
            max_output_tokens=settings.agent.max_output_tokens,
        )
