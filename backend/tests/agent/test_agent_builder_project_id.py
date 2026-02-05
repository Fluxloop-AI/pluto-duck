"""Tests for build_deep_agent project_id wiring."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pluto_duck_backend.agent.core.deep import agent as agent_module
from pluto_duck_backend.agent.core.deep.hitl import ApprovalBroker
from pluto_duck_backend.app.core.config import get_settings


async def _emit(_event: Any) -> None:
    return None


def _set_data_root(tmp_path: Path, monkeypatch) -> Path:
    data_root = tmp_path / "root"
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(data_root))
    get_settings.cache_clear()
    return data_root


def test_build_deep_agent_passes_project_id(tmp_path: Path, monkeypatch) -> None:
    _set_data_root(tmp_path, monkeypatch)
    captured: dict[str, Any] = {}

    def fake_build_default_tools(*, workspace_root: Path, project_id: str | None = None):
        captured["project_id"] = project_id
        captured["workspace_root"] = workspace_root
        return []

    def fake_create_deep_agent(**kwargs):
        captured["tools"] = kwargs.get("tools")
        return {"ok": True}

    monkeypatch.setattr(agent_module, "build_default_tools", fake_build_default_tools)
    monkeypatch.setattr(agent_module, "create_deep_agent", fake_create_deep_agent)
    monkeypatch.setattr(agent_module.LLMService, "get_chat_model", lambda self: object())

    broker = ApprovalBroker(emit=_emit, run_id="run")
    result = agent_module.build_deep_agent(
        conversation_id="conv",
        run_id="run",
        broker=broker,
        project_id="project-123",
    )

    assert result == {"ok": True}
    assert captured["project_id"] == "project-123"
    assert captured["tools"] == []
