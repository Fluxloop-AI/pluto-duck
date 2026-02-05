"""System prompt composer middleware for Pluto Duck deep agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import NotRequired, TypedDict, cast

from langchain.agents.middleware.types import AgentMiddleware, AgentState, ModelRequest, ModelResponse

from .memory import build_longterm_memory_prompt, build_memory_section
from .skills import build_skills_section
from ..skills.load import SkillMetadata


class ComposerState(AgentState):
    user_profile_section: NotRequired[str]
    user_memory: NotRequired[str]
    project_memory: NotRequired[str]
    dataset_readiness_summary: NotRequired[str]
    skills_metadata: NotRequired[list[SkillMetadata]]


class SystemPromptComposerMiddleware(AgentMiddleware):
    state_schema = ComposerState

    def __init__(self, *, project_id: str | None, layout: str = "v1") -> None:
        self._project_id = project_id
        self._layout = layout

    def _compose_v1(self, request: ModelRequest) -> str:
        state = cast("ComposerState", request.state)
        user_profile_section = state.get("user_profile_section") or ""
        user_memory = state.get("user_memory") or ""
        project_memory = state.get("project_memory") or ""
        dataset_readiness_summary = state.get("dataset_readiness_summary") or ""
        skills_metadata = state.get("skills_metadata", [])

        memory_section = build_memory_section(
            user_memory=user_memory,
            project_memory=project_memory,
        )
        longterm_prompt = build_longterm_memory_prompt(
            project_id=self._project_id,
            project_memory=project_memory,
        )
        skills_section = build_skills_section(
            skills_metadata=skills_metadata,
            project_id=self._project_id,
        )

        system_prompt = memory_section
        if request.system_prompt:
            system_prompt += "\n\n" + request.system_prompt
        system_prompt += "\n\n" + longterm_prompt
        if dataset_readiness_summary:
            system_prompt += "\n\n" + dataset_readiness_summary
        if skills_section:
            system_prompt += "\n\n" + skills_section
        if user_profile_section:
            system_prompt = user_profile_section + "\n\n" + system_prompt
        return system_prompt

    def _compose(self, request: ModelRequest) -> str:
        if self._layout == "v1":
            return self._compose_v1(request)
        return self._compose_v1(request)

    def wrap_model_call(self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]) -> ModelResponse:
        system_prompt = self._compose(request)
        return handler(request.override(system_prompt=system_prompt))

    async def awrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], Awaitable[ModelResponse]]
    ) -> ModelResponse:
        system_prompt = self._compose(request)
        return await handler(request.override(system_prompt=system_prompt))
