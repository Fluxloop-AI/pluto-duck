"""Tests for build_deep_agent context wiring."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from pluto_duck_backend.agent.core.deep import agent as agent_module
from pluto_duck_backend.agent.core.deep.context import RunContext, SessionContext
from pluto_duck_backend.agent.core.deep.hitl import ApprovalBroker
from pluto_duck_backend.agent.core.deep.middleware.system_prompt_composer import (
    SystemPromptComposerMiddleware,
)
from pluto_duck_backend.agent.core.deep.prompt_experiment import ExperimentProfile


async def _emit(_event: Any) -> None:
    return None


def test_build_deep_agent_uses_context_values(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class FakeLLMService:
        def __init__(self, model_override: str | None = None) -> None:
            captured["model_override"] = model_override

        def get_chat_model(self, *, streaming: bool = False) -> object:
            captured["streaming"] = streaming
            return object()

    def fake_build_default_tools(*, workspace_root: Path, project_id: str | None = None):
        captured["workspace_root"] = workspace_root
        captured["project_id"] = project_id
        return []

    def fake_create_deep_agent(**kwargs):
        captured["system_prompt"] = kwargs.get("system_prompt")
        captured["tools"] = kwargs.get("tools")
        captured["middleware"] = kwargs.get("middleware")
        return {"ok": True}

    def fake_load_experiment_profile(profile_id: str) -> ExperimentProfile:
        captured["profile_id"] = profile_id
        return ExperimentProfile(
            id=profile_id,
            description="test-profile",
            compose_order=("runtime", "skills_guide", "memory_section"),
            prompt_bundle={"runtime": Path("/tmp/runtime.md")},
        )

    def fake_load_prompt_bundle(
        profile: ExperimentProfile,
        *,
        required_keys=(),
    ) -> dict[str, str]:
        captured["bundle_profile_id"] = profile.id
        captured["required_keys"] = tuple(required_keys)
        return {"runtime": "RUNTIME_PROMPT", "skills_guide": "SKILLS_GUIDE"}

    monkeypatch.setattr(agent_module, "LLMService", FakeLLMService)
    monkeypatch.setattr(agent_module, "build_default_tools", fake_build_default_tools)
    monkeypatch.setattr(agent_module, "create_deep_agent", fake_create_deep_agent)
    monkeypatch.setattr(agent_module, "load_experiment_profile", fake_load_experiment_profile)
    monkeypatch.setattr(agent_module, "load_prompt_bundle", fake_load_prompt_bundle)

    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir(parents=True, exist_ok=True)
    session_ctx = SessionContext(
        conversation_id="conv",
        project_id="project-123",
        workspace_root=workspace_root,
        experiment_profile_id="v2",
    )
    run_ctx = RunContext(
        run_id="run",
        broker=ApprovalBroker(emit=_emit, run_id="run"),
        model="model-1",
    )

    result = agent_module.build_deep_agent(session_ctx=session_ctx, run_ctx=run_ctx)

    assert result == {"ok": True}
    assert captured["project_id"] == "project-123"
    assert captured["workspace_root"] == session_ctx.workspace_root
    assert captured["model_override"] == "model-1"
    assert captured["tools"] == []
    assert captured["streaming"] is True
    assert captured["profile_id"] == "v2"
    assert captured["bundle_profile_id"] == "v2"
    assert captured["required_keys"] == ("runtime", "skills_guide")
    assert captured["system_prompt"] == "RUNTIME_PROMPT"
    middleware = captured["middleware"]
    assert isinstance(middleware[-1], SystemPromptComposerMiddleware)
    assert middleware[-1]._profile.id == "v2"
    assert middleware[-1]._static_blocks["skills_guide"] == "SKILLS_GUIDE"


def test_build_deep_agent_fails_when_required_static_block_missing(
    tmp_path: Path,
    monkeypatch,
) -> None:
    class FakeLLMService:
        def __init__(self, model_override: str | None = None) -> None:
            _ = model_override

        def get_chat_model(self, *, streaming: bool = False) -> object:
            _ = streaming
            return object()

    def fake_create_deep_agent(**kwargs):
        _ = kwargs
        return {"ok": True}

    def fake_load_experiment_profile(profile_id: str) -> ExperimentProfile:
        return ExperimentProfile(
            id=profile_id,
            description="test-profile",
            compose_order=("runtime", "skills_guide", "memory_section"),
            prompt_bundle={"runtime": Path("/tmp/runtime.md")},
        )

    def fake_load_prompt_bundle(
        profile: ExperimentProfile,
        *,
        required_keys=(),
    ) -> dict[str, str]:
        _ = (profile, required_keys)
        return {"runtime": "RUNTIME_PROMPT"}

    monkeypatch.setattr(agent_module, "LLMService", FakeLLMService)
    monkeypatch.setattr(agent_module, "build_default_tools", lambda **kwargs: [])
    monkeypatch.setattr(agent_module, "create_deep_agent", fake_create_deep_agent)
    monkeypatch.setattr(agent_module, "load_experiment_profile", fake_load_experiment_profile)
    monkeypatch.setattr(agent_module, "load_prompt_bundle", fake_load_prompt_bundle)

    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir(parents=True, exist_ok=True)
    session_ctx = SessionContext(
        conversation_id="conv",
        project_id="project-123",
        workspace_root=workspace_root,
        experiment_profile_id="v2",
    )
    run_ctx = RunContext(
        run_id="run",
        broker=ApprovalBroker(emit=_emit, run_id="run"),
        model="model-1",
    )

    with pytest.raises(ValueError, match="non-empty 'skills_guide' bundle"):
        agent_module.build_deep_agent(session_ctx=session_ctx, run_ctx=run_ctx)
