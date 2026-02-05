"""Tests for memory path resolution."""

from __future__ import annotations

from pathlib import Path

from pluto_duck_backend.agent.core.deep.middleware.memory import resolve_memory_paths
from pluto_duck_backend.app.core.config import get_settings


def _set_data_root(tmp_path: Path, monkeypatch) -> Path:
    data_root = tmp_path / "root"
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(data_root))
    get_settings.cache_clear()
    return data_root


def test_resolve_memory_paths_no_project(tmp_path: Path, monkeypatch) -> None:
    data_root = _set_data_root(tmp_path, monkeypatch)

    paths = resolve_memory_paths(None)

    assert paths.project_id is None
    assert paths.project_agent_md is None
    assert paths.user_agent_md == data_root / "deepagents" / "user" / "agent.md"


def test_resolve_memory_paths_with_project(tmp_path: Path, monkeypatch) -> None:
    data_root = _set_data_root(tmp_path, monkeypatch)

    paths = resolve_memory_paths("project-123")

    assert paths.project_id == "project-123"
    assert paths.project_agent_md == data_root / "deepagents" / "projects" / "project-123" / "agent.md"
    assert paths.user_agent_md == data_root / "deepagents" / "user" / "agent.md"
