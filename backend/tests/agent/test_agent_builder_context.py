"""Tests for build_deep_agent context wiring."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pluto_duck_backend.agent.core.deep import agent as agent_module
from pluto_duck_backend.agent.core.deep.context import RunContext, SessionContext
from pluto_duck_backend.agent.core.deep.hitl import ApprovalBroker


async def _emit(_event: Any) -> None:
    return None


def test_build_deep_agent_uses_context_values(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class FakeLLMService:
        def __init__(self, model_override: str | None = None) -> None:
            captured["model_override"] = model_override

        def get_chat_model(self) -> object:
            return object()

    def fake_build_default_tools(*, workspace_root: Path, project_id: str | None = None):
        captured["workspace_root"] = workspace_root
        captured["project_id"] = project_id
        return []

    def fake_create_deep_agent(**kwargs):
        captured["tools"] = kwargs.get("tools")
        return {"ok": True}

    monkeypatch.setattr(agent_module, "LLMService", FakeLLMService)
    monkeypatch.setattr(agent_module, "build_default_tools", fake_build_default_tools)
    monkeypatch.setattr(agent_module, "create_deep_agent", fake_create_deep_agent)

    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir(parents=True, exist_ok=True)
    session_ctx = SessionContext(
        conversation_id="conv",
        project_id="project-123",
        workspace_root=workspace_root,
        prompt_layout="v1",
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
