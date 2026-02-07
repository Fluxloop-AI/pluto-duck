"""Tests for SystemPromptComposerMiddleware."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pluto_duck_backend.agent.core.deep.middleware.system_prompt_composer import (
    SystemPromptComposerMiddleware,
)
from pluto_duck_backend.agent.core.deep.prompt_experiment import ExperimentProfile


@dataclass
class DummyRequest:
    system_prompt: str
    state: dict[str, Any]


def _assert_in_order(text: str, parts: list[str]) -> None:
    positions = [text.index(part) for part in parts]
    assert positions == sorted(positions)


def _profile(profile_id: str, compose_order: tuple[str, ...]) -> ExperimentProfile:
    return ExperimentProfile(
        id=profile_id,
        description=f"profile-{profile_id}",
        compose_order=compose_order,
        prompt_bundle={"runtime": Path("/tmp/runtime.md")},
    )


def _skill_meta() -> dict[str, str]:
    return {
        "name": "analytics-skill",
        "description": "Analyze tables",
        "path": "/skills/user/skills/analytics-skill/SKILL.md",
        "source": "user",
    }


def test_composer_v1_order() -> None:
    composer = SystemPromptComposerMiddleware(
        project_id="proj-1",
        profile=_profile(
            "v1",
            (
                "user_profile",
                "memory_section",
                "runtime",
                "memory_guide",
                "dataset",
                "skills_full",
            ),
        ),
    )
    request = DummyRequest(
        system_prompt="RUNTIME_PROMPT",
        state={
            "user_profile_section": "USER_PROFILE",
            "user_memory": "USER_MEM",
            "project_memory": "PROJECT_MEM",
            "dataset_readiness_summary": "## Dataset Readiness Context",
            "skills_metadata": [_skill_meta()],
        },
    )

    output = composer._compose(request)  # type: ignore[arg-type]

    _assert_in_order(
        output,
        [
            "USER_PROFILE",
            "<user_memory>",
            "RUNTIME_PROMPT",
            "## Long-term Memory",
            "## Dataset Readiness Context",
            "## Skills System",
        ],
    )


def test_composer_v2_order() -> None:
    composer = SystemPromptComposerMiddleware(
        project_id="proj-1",
        profile=_profile(
            "v2",
            (
                "runtime",
                "skills_guide",
                "memory_guide",
                "user_profile",
                "memory_section",
                "memory_context",
                "dataset",
                "skills_list",
            ),
        ),
    )
    request = DummyRequest(
        system_prompt="RUNTIME_PROMPT",
        state={
            "user_profile_section": "USER_PROFILE",
            "user_memory": "USER_MEM",
            "project_memory": "PROJECT_MEM",
            "dataset_readiness_summary": "## Dataset Readiness Context",
            "skills_metadata": [_skill_meta()],
        },
    )

    output = composer._compose(request)  # type: ignore[arg-type]

    _assert_in_order(
        output,
        [
            "RUNTIME_PROMPT",
            "## Skills System",
            "## Long-term Memory",
            "USER_PROFILE",
            "<user_memory>",
            "## Memory Context",
            "## Dataset Readiness Context",
            "**Available Skills:**",
        ],
    )


def test_composer_skips_empty_optional_blocks() -> None:
    composer = SystemPromptComposerMiddleware(
        project_id="proj-1",
        profile=_profile(
            "optional-skip",
            (
                "runtime",
                "dataset",
                "skills_list",
                "memory_section",
            ),
        ),
    )
    request = DummyRequest(
        system_prompt="RUNTIME_PROMPT",
        state={
            "user_profile_section": "",
            "user_memory": "USER_MEM",
            "project_memory": "PROJECT_MEM",
            "dataset_readiness_summary": "",
            "skills_metadata": [],
        },
    )

    output = composer._compose(request)  # type: ignore[arg-type]

    assert "RUNTIME_PROMPT" in output
    assert "## Dataset Readiness Context" not in output
    assert "**Available Skills:**" not in output
