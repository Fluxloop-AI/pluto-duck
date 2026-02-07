"""Tests for prompt experiment resolver and profile loading."""

from __future__ import annotations

from pathlib import Path

import pytest
from pluto_duck_backend.agent.core.deep.prompt_experiment import (
    clear_experiment_profile_cache,
    load_experiment_profile,
    resolve_profile_id,
)
from pluto_duck_backend.app.core.config import get_settings


def _settings_with_env(monkeypatch, *, profile: str | None):
    if profile is None:
        monkeypatch.delenv("PLUTODUCK_AGENT__PROMPT_EXPERIMENT", raising=False)
    else:
        monkeypatch.setenv("PLUTODUCK_AGENT__PROMPT_EXPERIMENT", profile)
    get_settings.cache_clear()
    return get_settings()


def _write_profile(
    root: Path,
    *,
    profile_id: str,
    bundle_path: str = "bundles/runtime.md",
    description: str = "desc",
) -> None:
    bundle_file = root / bundle_path
    bundle_file.parent.mkdir(parents=True, exist_ok=True)
    bundle_file.write_text("runtime prompt", encoding="utf-8")
    (root / f"{profile_id}.yaml").write_text(
        "\n".join(
            [
                f"id: {profile_id}",
                f"description: {description}",
                "compose_order:",
                "  - runtime",
                "prompt_bundle:",
                f"  runtime: {bundle_path}",
            ]
        ),
        encoding="utf-8",
    )


def test_resolve_profile_id_prefers_metadata_over_env(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile="v1")

    resolved = resolve_profile_id({"_prompt_experiment": "v2"}, settings)

    assert resolved == "v2"


def test_resolve_profile_id_uses_env_when_metadata_missing(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile="v1")

    resolved = resolve_profile_id({}, settings)

    assert resolved == "v1"


def test_resolve_profile_id_defaults_to_v2(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile=None)

    resolved = resolve_profile_id({}, settings)

    assert resolved == "v2"


def test_resolve_profile_id_raises_for_unknown_profile(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile=None)

    with pytest.raises(ValueError, match="Unknown prompt experiment profile: does-not-exist"):
        resolve_profile_id({"_prompt_experiment": "does-not-exist"}, settings)


def test_load_experiment_profile_raises_when_definition_missing(tmp_path: Path) -> None:
    clear_experiment_profile_cache()

    with pytest.raises(FileNotFoundError, match="Profile definition not found"):
        load_experiment_profile("v2", profiles_root=tmp_path)


def test_load_experiment_profile_raises_when_bundle_missing(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    (tmp_path / "v2.yaml").write_text(
        "\n".join(
            [
                "id: v2",
                "description: desc",
                "compose_order:",
                "  - runtime",
                "prompt_bundle:",
                "  runtime: missing/runtime.md",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(FileNotFoundError, match="Prompt bundle file not found"):
        load_experiment_profile("v2", profiles_root=tmp_path)


def test_load_experiment_profile_cache_hit_and_clear(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(tmp_path, profile_id="exp-a", description="first")

    first = load_experiment_profile("exp-a", profiles_root=tmp_path)
    _write_profile(tmp_path, profile_id="exp-a", description="second")
    cached = load_experiment_profile("exp-a", profiles_root=tmp_path)

    assert cached is first
    assert cached.description == "first"

    clear_experiment_profile_cache()
    reloaded = load_experiment_profile("exp-a", profiles_root=tmp_path)

    assert reloaded is not first
    assert reloaded.description == "second"
