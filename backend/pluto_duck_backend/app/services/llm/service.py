"""Unified LLM service for all LLM interactions.

This module provides a single entry point for all LLM operations,
using LangChain for provider-agnostic model access.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Optional, Type, TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from .settings import LLMSettings

T = TypeVar("T", bound=BaseModel)

logger = logging.getLogger(__name__)


class LLMService:
    """Unified LLM service for all LLM interactions.

    This class provides:
    - `get_chat_model()`: Returns a LangChain BaseChatModel for tool-calling agents
    - Centralized settings resolution (DB > ENV > default)
    - Provider abstraction for future expansion

    Example:
        llm_service = LLMService()
        chat_model = llm_service.get_chat_model()
        # Use with LangChain agents or directly
    """

    def __init__(self, model_override: Optional[str] = None) -> None:
        """Initialize LLMService.

        Args:
            model_override: Optional model name to override resolved settings
        """
        self._model_override = model_override
        self._settings: Optional[LLMSettings] = None

    def _resolve_settings(self) -> LLMSettings:
        """Resolve and cache LLM settings.

        Returns:
            LLMSettings with resolved configuration
        """
        if self._settings is None:
            self._settings = LLMSettings.from_config()
            if self._model_override:
                self._settings = LLMSettings(
                    provider=self._settings.provider,
                    model=self._model_override,
                    api_key=self._settings.api_key,
                    api_base=self._settings.api_base,
                )
        return self._settings

    def get_chat_model(self, *, streaming: bool = False) -> BaseChatModel:
        """Get a LangChain BaseChatModel for chat/tool-calling.

        Args:
            streaming: Enable token streaming callbacks for the model

        Returns:
            BaseChatModel instance (currently ChatOpenAI)

        Raises:
            RuntimeError: If API key is not configured or provider is unsupported
        """
        settings = self._resolve_settings()

        if settings.provider == "openai":
            from langchain_openai import ChatOpenAI

            if not settings.api_key:
                raise RuntimeError(
                    "OpenAI API key is not configured. "
                    "Set it in Settings (llm_api_key) or via OPENAI_API_KEY."
                )

            return ChatOpenAI(
                model=settings.model,
                api_key=settings.api_key,
                base_url=settings.api_base,
                streaming=streaming,
            )

        raise RuntimeError(
            f"LLM provider '{settings.provider}' is not supported yet. "
            "Use provider 'openai'."
        )

    async def complete(self, prompt: str) -> str:
        """Complete a prompt and return text response.

        Args:
            prompt: The prompt to send to the LLM

        Returns:
            The LLM's text response
        """
        chat_model = self.get_chat_model()
        response = await chat_model.ainvoke([HumanMessage(content=prompt)])
        return str(response.content)

    async def complete_structured(
        self,
        prompt: str,
        response_schema: Type[T],
    ) -> T:
        """Complete a prompt with structured output.

        Uses LangChain's `with_structured_output()` to ensure
        the response conforms to the given Pydantic schema.

        Args:
            prompt: The prompt to send to the LLM
            response_schema: Pydantic model class for the expected response

        Returns:
            Instance of response_schema with LLM's structured response
        """
        chat_model = self.get_chat_model()
        structured_model = chat_model.with_structured_output(
            response_schema,
            method="json_schema",
            strict=True,
        )
        result = await structured_model.ainvoke([HumanMessage(content=prompt)])
        return result  # type: ignore[return-value]

    @property
    def model_name(self) -> str:
        """Get the resolved model name."""
        return self._resolve_settings().model

    @property
    def provider_name(self) -> str:
        """Get the resolved provider name."""
        return self._resolve_settings().provider


@lru_cache(maxsize=1)
def get_llm_service() -> LLMService:
    """Get a cached LLMService instance.

    Returns:
        Singleton LLMService instance
    """
    return LLMService()
