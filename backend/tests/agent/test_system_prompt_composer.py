"""Tests for SystemPromptComposerMiddleware."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pluto_duck_backend.agent.core.deep.middleware.system_prompt_composer import SystemPromptComposerMiddleware


@dataclass
class DummyRequest:
    system_prompt: str
    state: dict[str, Any]


def _assert_in_order(text: str, parts: list[str]) -> None:
    positions = [text.index(part) for part in parts]
    assert positions == sorted(positions)


def test_composer_v1_order() -> None:
    composer = SystemPromptComposerMiddleware(project_id="proj-1", layout="v1")
    request = DummyRequest(
        system_prompt="RUNTIME_PROMPT",
        state={
            "user_profile_section": "USER_PROFILE",
            "user_memory": "USER_MEM",
            "project_memory": "PROJECT_MEM",
            "dataset_readiness_summary": "## Dataset Readiness Context",
            "skills_metadata": [],
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
    composer = SystemPromptComposerMiddleware(project_id="proj-1", layout="v2")
    request = DummyRequest(
        system_prompt="RUNTIME_PROMPT",
        state={
            "user_profile_section": "USER_PROFILE",
            "user_memory": "USER_MEM",
            "project_memory": "PROJECT_MEM",
            "dataset_readiness_summary": "## Dataset Readiness Context",
            "skills_metadata": [],
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
