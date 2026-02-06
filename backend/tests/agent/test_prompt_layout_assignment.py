"""Tests for prompt layout assignment."""

from __future__ import annotations

from pathlib import Path

from pluto_duck_backend.agent.core.deep.context import build_session_context
from pluto_duck_backend.app.core.config import get_settings


def _set_data_root(tmp_path: Path, monkeypatch) -> Path:
    data_root = tmp_path / "root"
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(data_root))
    get_settings.cache_clear()
    return data_root


def test_prompt_layout_is_stable(tmp_path: Path, monkeypatch) -> None:
    _set_data_root(tmp_path, monkeypatch)

    ctx_a = build_session_context(conversation_id="conv-1", project_id=None)
    ctx_b = build_session_context(conversation_id="conv-1", project_id=None)

    assert ctx_a.prompt_layout == ctx_b.prompt_layout


def test_prompt_layout_distribution_smoke(tmp_path: Path, monkeypatch) -> None:
    _set_data_root(tmp_path, monkeypatch)

    layouts = {
        build_session_context(conversation_id=f"conv-{idx}", project_id=None).prompt_layout
        for idx in range(200)
    }

    assert "v1" in layouts
    assert "v2" in layouts
