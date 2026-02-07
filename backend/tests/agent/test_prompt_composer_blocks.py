"""Validation tests for profile-driven composer blocks."""

from __future__ import annotations

from pathlib import Path

import pytest
from pluto_duck_backend.agent.core.deep.middleware.system_prompt_composer import (
    SystemPromptComposerMiddleware,
)
from pluto_duck_backend.agent.core.deep.prompt_experiment import ExperimentProfile


def _profile(profile_id: str, compose_order: tuple[str, ...]) -> ExperimentProfile:
    return ExperimentProfile(
        id=profile_id,
        description=f"profile-{profile_id}",
        compose_order=compose_order,
        prompt_bundle={"runtime": Path("/tmp/runtime.md")},
    )


def test_rejects_invalid_compose_block() -> None:
    with pytest.raises(ValueError, match="Unsupported compose blocks: does_not_exist"):
        SystemPromptComposerMiddleware(
            project_id="proj-1",
            profile=_profile("invalid-block", ("runtime", "does_not_exist")),
        )


def test_rejects_duplicate_compose_block() -> None:
    with pytest.raises(ValueError, match="Duplicate compose blocks are not allowed: runtime"):
        SystemPromptComposerMiddleware(
            project_id="proj-1",
            profile=_profile("duplicate-block", ("runtime", "runtime")),
        )


def test_rejects_missing_required_compose_block() -> None:
    with pytest.raises(ValueError, match="Missing required compose blocks: runtime"):
        SystemPromptComposerMiddleware(
            project_id="proj-1",
            profile=_profile("missing-required", ("memory_section", "dataset")),
        )
