"""Tests for skills path resolution."""

from __future__ import annotations

from pathlib import Path

from pluto_duck_backend.agent.core.deep.middleware.skills import resolve_skills_paths
from pluto_duck_backend.app.core.config import get_settings


def _set_data_root(tmp_path: Path, monkeypatch) -> Path:
    data_root = tmp_path / "root"
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(data_root))
    get_settings.cache_clear()
    return data_root


def test_resolve_skills_paths_no_project(tmp_path: Path, monkeypatch) -> None:
    data_root = _set_data_root(tmp_path, monkeypatch)

    paths = resolve_skills_paths(None)

    assert paths.project_id is None
    assert paths.project_skills_dir is None
    assert paths.user_skills_dir == data_root / "deepagents" / "user" / "skills"


def test_resolve_skills_paths_with_project(tmp_path: Path, monkeypatch) -> None:
    data_root = _set_data_root(tmp_path, monkeypatch)

    paths = resolve_skills_paths("project-123")

    assert paths.project_id == "project-123"
    assert paths.project_skills_dir == data_root / "deepagents" / "projects" / "project-123" / "skills"
    assert paths.user_skills_dir == data_root / "deepagents" / "user" / "skills"
