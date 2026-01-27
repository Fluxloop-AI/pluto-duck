"""Unified LLM service module.

This module provides a centralized LLM service for all LLM interactions,
replacing the scattered provider implementations.

Usage:
    from pluto_duck_backend.app.services.llm import LLMService, get_llm_service

    # Get cached singleton
    llm_service = get_llm_service()
    chat_model = llm_service.get_chat_model()

    # Or create new instance with model override
    llm_service = LLMService(model_override="gpt-4o")
    chat_model = llm_service.get_chat_model()
"""

from .schemas import (
    BatchAnalysisSchema,
    FileAnalysisSchema,
    IssueItemSchema,
    PotentialItemSchema,
)
from .service import LLMService, get_llm_service
from .settings import LLMSettings

__all__ = [
    "LLMService",
    "LLMSettings",
    "get_llm_service",
    "BatchAnalysisSchema",
    "FileAnalysisSchema",
    "IssueItemSchema",
    "PotentialItemSchema",
]
