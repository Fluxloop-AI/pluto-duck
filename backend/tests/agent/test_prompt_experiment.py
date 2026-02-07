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
    bundle: dict[str, str] | None = None,
    base: str | None = None,
    overrides: dict[str, str] | None = None,
    include_compose_order: bool = True,
    compose_order: list[str] | None = None,
    description: str = "desc",
) -> None:
    lines = [f"id: {profile_id}", f"description: {description}"]
    if base:
        lines.append(f"base: {base}")
    if include_compose_order:
        lines.append("compose_order:")
        for block in compose_order or ["runtime"]:
            lines.append(f"  - {block}")
    if bundle is not None:
        lines.append("prompt_bundle:")
        for block, path in bundle.items():
            bundle_file = root / path
            bundle_file.parent.mkdir(parents=True, exist_ok=True)
            bundle_file.write_text(f"{profile_id}:{block}", encoding="utf-8")
            lines.append(f"  {block}: {path}")
    if overrides is not None:
        lines.append("prompt_bundle_overrides:")
        for block, path in overrides.items():
            override_file = root / path
            override_file.parent.mkdir(parents=True, exist_ok=True)
            override_file.write_text(f"{profile_id}:override:{block}", encoding="utf-8")
            lines.append(f"  {block}: {path}")

    (root / f"{profile_id}.yaml").write_text("\n".join(lines), encoding="utf-8")


def test_resolve_profile_id_prefers_metadata_over_env(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile="v1")

    resolved = resolve_profile_id({"_prompt_experiment": "v2"}, settings)

    assert resolved == "v2"


def test_resolve_profile_id_uses_env_when_metadata_missing(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile="v1")

    resolved = resolve_profile_id({}, settings)

    assert resolved == "v1"


def test_resolve_profile_id_defaults_to_v3(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile=None)

    resolved = resolve_profile_id({}, settings)

    assert resolved == "v3"


def test_resolve_profile_id_falls_back_to_default_for_unknown_metadata_profile(
    monkeypatch,
) -> None:
    settings = _settings_with_env(monkeypatch, profile=None)

    resolved = resolve_profile_id({"_prompt_experiment": "does-not-exist"}, settings)

    assert resolved == "v3"


def test_resolve_profile_id_falls_back_to_env_for_unknown_metadata_profile(monkeypatch) -> None:
    settings = _settings_with_env(monkeypatch, profile="v2")

    resolved = resolve_profile_id({"_prompt_experiment": "does-not-exist"}, settings)

    assert resolved == "v2"


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
    _write_profile(
        tmp_path,
        profile_id="exp-a",
        description="first",
        bundle={"runtime": "bundles/runtime.md"},
    )

    first = load_experiment_profile("exp-a", profiles_root=tmp_path)
    _write_profile(
        tmp_path,
        profile_id="exp-a",
        description="second",
        bundle={"runtime": "bundles/runtime.md"},
    )
    cached = load_experiment_profile("exp-a", profiles_root=tmp_path)

    assert cached is first
    assert cached.description == "first"

    clear_experiment_profile_cache()
    reloaded = load_experiment_profile("exp-a", profiles_root=tmp_path)

    assert reloaded is not first
    assert reloaded.description == "second"


def test_load_experiment_profile_supports_base_and_overrides(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="base",
        bundle={"runtime": "base/runtime.md", "skills_guide": "base/skills.md"},
    )
    _write_profile(
        tmp_path,
        profile_id="child",
        base="base",
        bundle={"runtime": "child/runtime.md"},
        overrides={"skills_guide": "child/skills.md"},
    )

    loaded = load_experiment_profile("child", profiles_root=tmp_path)

    assert loaded.prompt_bundle["runtime"] == (tmp_path / "child/runtime.md").resolve()
    assert loaded.prompt_bundle["skills_guide"] == (tmp_path / "child/skills.md").resolve()


def test_load_experiment_profile_supports_base_only_child_bundle(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="base",
        bundle={"runtime": "base/runtime.md"},
    )
    _write_profile(
        tmp_path,
        profile_id="child",
        base="base",
        bundle=None,
    )

    loaded = load_experiment_profile("child", profiles_root=tmp_path)

    assert loaded.prompt_bundle["runtime"] == (tmp_path / "base/runtime.md").resolve()


def test_load_experiment_profile_raises_when_base_missing(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="child",
        base="missing",
        bundle={"runtime": "child/runtime.md"},
    )

    with pytest.raises(FileNotFoundError, match="Base profile not found"):
        load_experiment_profile("child", profiles_root=tmp_path)


def test_load_experiment_profile_raises_on_inheritance_cycle(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="a",
        base="b",
        bundle={"runtime": "a/runtime.md"},
    )
    _write_profile(
        tmp_path,
        profile_id="b",
        base="a",
        bundle={"runtime": "b/runtime.md"},
    )

    with pytest.raises(ValueError, match="Profile inheritance cycle detected"):
        load_experiment_profile("a", profiles_root=tmp_path)


def test_load_experiment_profile_raises_when_compose_order_missing(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="exp-a",
        bundle={"runtime": "bundles/runtime.md"},
        include_compose_order=False,
    )

    with pytest.raises(ValueError, match="must define non-empty compose_order"):
        load_experiment_profile("exp-a", profiles_root=tmp_path)


def test_load_experiment_profile_raises_when_block_key_not_allowed(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="exp-a",
        bundle={"dataset": "bundles/dataset.md"},
    )

    with pytest.raises(ValueError, match="unsupported prompt_bundle block 'dataset'"):
        load_experiment_profile("exp-a", profiles_root=tmp_path)


def test_load_experiment_profile_raises_when_bundle_and_override_overlap(
    tmp_path: Path,
) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="base",
        bundle={"runtime": "base/runtime.md"},
    )
    _write_profile(
        tmp_path,
        profile_id="child",
        base="base",
        bundle={"runtime": "child/runtime.md"},
        overrides={"runtime": "child/runtime-override.md"},
    )

    with pytest.raises(ValueError, match="duplicate prompt bundle blocks"):
        load_experiment_profile("child", profiles_root=tmp_path)


def test_load_experiment_profile_does_not_cache_failed_result(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="base",
        bundle={"runtime": "base/runtime.md"},
    )
    (tmp_path / "child.yaml").write_text(
        "\n".join(
            [
                "id: child",
                "description: desc",
                "base: base",
                "compose_order:",
                "  - runtime",
                "prompt_bundle_overrides:",
                "  skills_guide: child/missing-skills.md",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(FileNotFoundError, match="Prompt bundle file not found"):
        load_experiment_profile("child", profiles_root=tmp_path)

    skills_file = tmp_path / "child/missing-skills.md"
    skills_file.parent.mkdir(parents=True, exist_ok=True)
    skills_file.write_text("skills", encoding="utf-8")

    loaded = load_experiment_profile("child", profiles_root=tmp_path)

    assert loaded.prompt_bundle["skills_guide"] == skills_file.resolve()


def test_load_experiment_profile_supports_memory_guide_bundle(tmp_path: Path) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="exp-a",
        bundle={
            "runtime": "bundles/runtime.md",
            "memory_guide": "bundles/memory-guide.md",
        },
    )
    (tmp_path / "bundles/memory-guide.md").write_text(
        "{project_id}\n{project_memory_info}\n{project_dir}",
        encoding="utf-8",
    )

    loaded = load_experiment_profile("exp-a", profiles_root=tmp_path)

    assert loaded.prompt_bundle["memory_guide"] == (tmp_path / "bundles/memory-guide.md").resolve()


def test_load_experiment_profile_raises_for_invalid_memory_guide_placeholder(
    tmp_path: Path,
) -> None:
    clear_experiment_profile_cache()
    runtime_path = tmp_path / "bundles/runtime.md"
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_path.write_text("runtime", encoding="utf-8")

    template_path = tmp_path / "bundles/memory-guide.md"
    template_path.write_text("memory {unknown_placeholder}", encoding="utf-8")

    (tmp_path / "exp-a.yaml").write_text(
        "\n".join(
            [
                "id: exp-a",
                "description: desc",
                "compose_order:",
                "  - runtime",
                "prompt_bundle:",
                "  runtime: bundles/runtime.md",
                "  memory_guide: bundles/memory-guide.md",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unsupported=unknown_placeholder"):
        load_experiment_profile("exp-a", profiles_root=tmp_path)


def test_load_builtin_v3_profile_includes_base_agent_prompt() -> None:
    clear_experiment_profile_cache()

    profile = load_experiment_profile("v3")

    assert "base_agent_prompt" in profile.compose_order
    assert profile.prompt_bundle["base_agent_prompt"].name == "base_agent_prompt.md"


def test_load_experiment_profile_supports_base_agent_prompt_override(
    tmp_path: Path,
) -> None:
    clear_experiment_profile_cache()
    _write_profile(
        tmp_path,
        profile_id="base",
        compose_order=["runtime", "base_agent_prompt"],
        bundle={
            "runtime": "base/runtime.md",
            "base_agent_prompt": "base/base-agent.md",
        },
    )
    _write_profile(
        tmp_path,
        profile_id="child",
        base="base",
        compose_order=["runtime", "base_agent_prompt"],
        bundle=None,
        overrides={"base_agent_prompt": "child/base-agent.md"},
    )

    loaded = load_experiment_profile("child", profiles_root=tmp_path)

    assert loaded.prompt_bundle["runtime"] == (tmp_path / "base/runtime.md").resolve()
    assert loaded.prompt_bundle["base_agent_prompt"] == (
        tmp_path / "child/base-agent.md"
    ).resolve()
