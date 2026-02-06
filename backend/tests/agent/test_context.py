"""Tests for Session/Run context models."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pluto_duck_backend.agent.core.deep.context import RunContext, build_session_context
from pluto_duck_backend.agent.core.deep.hitl import ApprovalBroker
from pluto_duck_backend.app.core.config import get_settings


async def _emit(_event: Any) -> None:
    return None


def _set_data_root(tmp_path: Path, monkeypatch) -> Path:
    data_root = tmp_path / "root"
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(data_root))
    get_settings.cache_clear()
    return data_root


def test_build_session_context_computes_workspace_root(tmp_path: Path, monkeypatch) -> None:
    data_root = _set_data_root(tmp_path, monkeypatch)

    ctx = build_session_context(conversation_id="conv-1", project_id="proj-1")

    assert ctx.conversation_id == "conv-1"
    assert ctx.project_id == "proj-1"
    assert ctx.workspace_root == data_root / "agent_workspaces" / "conv-1"
    assert ctx.workspace_root.exists()


def test_run_context_fields() -> None:
    broker = ApprovalBroker(emit=_emit, run_id="run-1")

    ctx = RunContext(run_id="run-1", broker=broker, model="model-1")

    assert ctx.run_id == "run-1"
    assert ctx.broker is broker
    assert ctx.model == "model-1"
