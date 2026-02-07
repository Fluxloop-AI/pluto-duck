"""System prompt composer middleware for Pluto Duck deep agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Mapping, NotRequired, cast

from langchain.agents.middleware.types import (
    AgentMiddleware,
    AgentState,
    ModelRequest,
    ModelResponse,
)

from ..prompt_experiment import ExperimentProfile
from ..skills.load import SkillMetadata
from .memory import (
    build_longterm_memory_context,
    build_longterm_memory_prompt,
    build_memory_section,
)
from .skills import build_skills_list_block, build_skills_section


class ComposerState(AgentState):
    user_profile_section: NotRequired[str]
    user_memory: NotRequired[str]
    project_memory: NotRequired[str]
    dataset_readiness_summary: NotRequired[str]
    skills_metadata: NotRequired[list[SkillMetadata]]


class SystemPromptComposerMiddleware(AgentMiddleware):
    ALLOWED_BLOCKS = frozenset(
        {
            "runtime",
            "user_profile",
            "memory_section",
            "memory_guide",
            "memory_context",
            "dataset",
            "skills_guide",
            "skills_list",
            "skills_full",
        }
    )
    REQUIRED_BLOCKS = frozenset({"runtime"})

    state_schema = ComposerState

    def __init__(
        self,
        *,
        project_id: str | None,
        profile: ExperimentProfile,
        static_blocks: Mapping[str, str] | None = None,
    ) -> None:
        self._project_id = project_id
        self._profile = profile
        self._compose_order = self._validate_compose_order(profile.compose_order)
        self._static_blocks = dict(static_blocks or {})

    def _compose(self, request: ModelRequest) -> str:
        state = cast("ComposerState", request.state)
        rendered: list[str] = []
        for block in self._compose_order:
            block_text = self._render_block(block, request, state).strip()
            if block_text:
                rendered.append(block_text)
        return "\n\n".join(rendered)

    def _render_block(self, block: str, request: ModelRequest, state: ComposerState) -> str:
        if block == "runtime":
            return request.system_prompt or ""
        if block == "user_profile":
            return str(state.get("user_profile_section") or "")
        if block == "memory_section":
            return build_memory_section(
                user_memory=str(state.get("user_memory") or ""),
                project_memory=str(state.get("project_memory") or ""),
            )
        if block == "memory_guide":
            return build_longterm_memory_prompt(
                project_id=self._project_id,
                project_memory=str(state.get("project_memory") or ""),
            )
        if block == "memory_context":
            return build_longterm_memory_context(
                project_id=self._project_id,
                project_memory=str(state.get("project_memory") or ""),
            )
        if block == "dataset":
            return str(state.get("dataset_readiness_summary") or "")
        if block == "skills_guide":
            return self._required_static_block("skills_guide")
        if block == "skills_list":
            skills_metadata = state.get("skills_metadata", [])
            if not skills_metadata:
                return ""
            return build_skills_list_block(
                skills_metadata=skills_metadata,
                project_id=self._project_id,
            )
        if block == "skills_full":
            return build_skills_section(
                skills_metadata=state.get("skills_metadata", []),
                project_id=self._project_id,
            )
        raise ValueError(f"Unsupported compose block '{block}'")

    def _required_static_block(self, block: str) -> str:
        text = (self._static_blocks.get(block) or "").strip()
        if not text:
            raise ValueError(
                f"Prompt profile '{self._profile.id}' is missing non-empty static block '{block}'"
            )
        return text

    @classmethod
    def _validate_compose_order(cls, compose_order: tuple[str, ...]) -> tuple[str, ...]:
        if not compose_order:
            raise ValueError("compose_order must not be empty")
        unknown_blocks = [block for block in compose_order if block not in cls.ALLOWED_BLOCKS]
        if unknown_blocks:
            raise ValueError(f"Unsupported compose blocks: {', '.join(unknown_blocks)}")
        seen: set[str] = set()
        duplicates: list[str] = []
        for block in compose_order:
            if block in seen and block not in duplicates:
                duplicates.append(block)
            seen.add(block)
        if duplicates:
            raise ValueError(f"Duplicate compose blocks are not allowed: {', '.join(duplicates)}")
        missing_required = sorted(cls.REQUIRED_BLOCKS.difference(compose_order))
        if missing_required:
            raise ValueError(
                f"Missing required compose blocks: {', '.join(missing_required)}"
            )
        return compose_order

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        system_prompt = self._compose(request)
        return handler(request.override(system_prompt=system_prompt))

    async def awrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], Awaitable[ModelResponse]]
    ) -> ModelResponse:
        system_prompt = self._compose(request)
        return await handler(request.override(system_prompt=system_prompt))
