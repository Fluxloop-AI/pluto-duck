"""Prompt experiment profile resolver and registry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, MutableMapping

import yaml  # type: ignore[import-untyped]

from pluto_duck_backend.app.core.config import PlutoDuckSettings, get_settings

_DEFAULT_PROFILE_ID = "v2"
_METADATA_KEY = "_prompt_experiment"
_LEGACY_PROFILE_IDS = {"v1", "v2"}
_ALLOWED_PROMPT_BUNDLE_BLOCKS = frozenset({"runtime", "skills_guide"})
_RUNTIME_PROMPT_PATH = Path(__file__).parent / "prompts" / "runtime_system_prompt.md"
_LEGACY_COMPOSE_ORDERS: Mapping[str, tuple[str, ...]] = {
    "v1": (
        "user_profile",
        "memory_section",
        "runtime",
        "memory_guide",
        "dataset",
        "skills_full",
    ),
    "v2": (
        "runtime",
        "skills_guide",
        "memory_guide",
        "user_profile",
        "memory_section",
        "memory_context",
        "dataset",
        "skills_list",
    ),
}


@dataclass(frozen=True)
class ExperimentProfile:
    """Declarative prompt experiment profile."""

    id: str
    description: str
    compose_order: tuple[str, ...]
    prompt_bundle: Mapping[str, Path]


_PROFILE_CACHE: MutableMapping[tuple[str, Path], ExperimentProfile] = {}


def _profiles_root() -> Path:
    return Path(__file__).parent / "prompts" / "profiles"


def clear_experiment_profile_cache() -> None:
    """Clear in-process profile cache."""

    _PROFILE_CACHE.clear()


def resolve_profile_id(
    metadata: Mapping[str, object] | None,
    settings: PlutoDuckSettings | None = None,
) -> str:
    """Resolve prompt experiment profile id using metadata > env > default."""

    selected = _extract_profile_id_from_metadata(metadata)
    if selected:
        return _validate_profile_id(selected)

    app_settings = settings or get_settings()
    env_profile = (app_settings.agent.prompt_experiment or "").strip()
    if env_profile:
        return _validate_profile_id(env_profile)

    return _DEFAULT_PROFILE_ID


def load_experiment_profile(
    profile_id: str,
    *,
    profiles_root: Path | None = None,
) -> ExperimentProfile:
    """Load and validate an experiment profile from YAML + bundle files."""

    root = (profiles_root or _profiles_root()).resolve()
    return _load_experiment_profile(profile_id, root, stack=())


def _load_experiment_profile(
    profile_id: str,
    profiles_root: Path,
    *,
    stack: tuple[str, ...],
) -> ExperimentProfile:
    cache_key = (profile_id, profiles_root)
    cached = _PROFILE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    if profile_id in stack:
        cycle = " -> ".join((*stack, profile_id))
        raise ValueError(f"Profile inheritance cycle detected: {cycle}")

    definition_path = profiles_root / f"{profile_id}.yaml"
    if not definition_path.exists():
        if not stack and profile_id in _LEGACY_PROFILE_IDS and profiles_root == _profiles_root().resolve():
            legacy = _legacy_profile(profile_id)
            _PROFILE_CACHE[cache_key] = legacy
            return legacy
        if stack:
            parent = stack[-1]
            raise FileNotFoundError(
                f"Base profile not found for '{parent}' base '{profile_id}': {definition_path}"
            )
        raise FileNotFoundError(
            f"Profile definition not found for '{profile_id}': {definition_path}"
        )

    loaded = yaml.safe_load(definition_path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError(f"Invalid profile definition format for '{profile_id}'")

    declared_id = str(loaded.get("id") or "").strip()
    if declared_id != profile_id:
        raise ValueError(
            f"Profile id mismatch for '{profile_id}': declared='{declared_id or '<empty>'}'"
        )

    compose_order = loaded.get("compose_order")
    if not isinstance(compose_order, list) or not compose_order:
        raise ValueError(f"Profile '{profile_id}' must define non-empty compose_order")
    parsed_order = tuple(str(item).strip() for item in compose_order if str(item).strip())
    if not parsed_order:
        raise ValueError(f"Profile '{profile_id}' has no valid compose_order items")

    base_id = str(loaded.get("base") or "").strip() or None
    declared_bundle = _parse_prompt_bundle_entries(
        profile_id,
        "prompt_bundle",
        loaded.get("prompt_bundle"),
        profiles_root=profiles_root,
        required=base_id is None,
    )
    override_bundle = _parse_prompt_bundle_entries(
        profile_id,
        "prompt_bundle_overrides",
        loaded.get("prompt_bundle_overrides"),
        profiles_root=profiles_root,
        required=False,
    )

    duplicate_blocks = sorted(set(declared_bundle) & set(override_bundle))
    if duplicate_blocks:
        blocks = ", ".join(duplicate_blocks)
        raise ValueError(
            f"Profile '{profile_id}' has duplicate prompt bundle blocks in "
            f"'prompt_bundle' and 'prompt_bundle_overrides': {blocks}"
        )

    merged_bundle: dict[str, Path] = {}
    if base_id:
        base_profile = _load_experiment_profile(
            base_id,
            profiles_root,
            stack=(*stack, profile_id),
        )
        merged_bundle.update(base_profile.prompt_bundle)
    merged_bundle.update(declared_bundle)
    merged_bundle.update(override_bundle)

    profile = ExperimentProfile(
        id=profile_id,
        description=str(loaded.get("description") or "").strip(),
        compose_order=parsed_order,
        prompt_bundle=merged_bundle,
    )
    _PROFILE_CACHE[cache_key] = profile
    return profile


def _parse_prompt_bundle_entries(
    profile_id: str,
    field_name: str,
    raw: object,
    *,
    profiles_root: Path,
    required: bool,
) -> dict[str, Path]:
    if raw is None:
        if required:
            raise ValueError(f"Profile '{profile_id}' must define non-empty {field_name}")
        return {}
    if not isinstance(raw, dict):
        raise ValueError(f"Profile '{profile_id}' has invalid {field_name}: expected mapping")
    if required and not raw:
        raise ValueError(f"Profile '{profile_id}' must define non-empty {field_name}")

    parsed: dict[str, Path] = {}
    for key, value in raw.items():
        block = str(key).strip()
        rel_path = str(value).strip()
        if not block:
            raise ValueError(f"Profile '{profile_id}' has invalid {field_name} block key")
        if block not in _ALLOWED_PROMPT_BUNDLE_BLOCKS:
            allowed = ", ".join(sorted(_ALLOWED_PROMPT_BUNDLE_BLOCKS))
            raise ValueError(
                f"Profile '{profile_id}' has unsupported {field_name} block '{block}'. "
                f"Allowed blocks: {allowed}"
            )
        if not rel_path:
            raise ValueError(
                f"Profile '{profile_id}' has empty {field_name} path for block '{block}'"
            )
        resolved = (profiles_root / rel_path).resolve()
        if not resolved.exists():
            raise FileNotFoundError(
                f"Prompt bundle file not found for '{profile_id}' block '{block}': {resolved}"
            )
        parsed[block] = resolved
    return parsed


def _extract_profile_id_from_metadata(metadata: Mapping[str, object] | None) -> str | None:
    if not metadata:
        return None
    value = metadata.get(_METADATA_KEY)
    if value is None:
        return None
    candidate = str(value).strip()
    return candidate or None


def _validate_profile_id(profile_id: str) -> str:
    if profile_id in _LEGACY_PROFILE_IDS:
        return profile_id
    if (_profiles_root() / f"{profile_id}.yaml").exists():
        return profile_id
    raise ValueError(f"Unknown prompt experiment profile: {profile_id}")


def _legacy_profile(profile_id: str) -> ExperimentProfile:
    if not _RUNTIME_PROMPT_PATH.exists():
        raise FileNotFoundError(
            f"Legacy runtime prompt file is missing for '{profile_id}': {_RUNTIME_PROMPT_PATH}"
        )
    compose_order = _LEGACY_COMPOSE_ORDERS.get(profile_id)
    if compose_order is None:
        raise ValueError(f"Unknown prompt experiment profile: {profile_id}")
    return ExperimentProfile(
        id=profile_id,
        description=f"Legacy built-in profile '{profile_id}'",
        compose_order=compose_order,
        prompt_bundle={"runtime": _RUNTIME_PROMPT_PATH.resolve()},
    )
