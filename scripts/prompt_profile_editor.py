"""Local Streamlit viewer/editor for prompt experiment profiles."""

from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import streamlit as st
import yaml  # type: ignore[import-untyped]
from pluto_duck_backend.agent.core.deep.prompt_experiment import (  # noqa: PLC2701
    _ALLOWED_PROMPT_BUNDLE_BLOCKS,
    clear_experiment_profile_cache,
    load_experiment_profile,
)
from pluto_duck_backend.agent.core.deep.prompts import load_prompt_bundle
from pluto_duck_backend.agent.core.deep.prompts.memory_guide_template import (
    ALLOWED_MEMORY_GUIDE_TEMPLATE_VARIABLES,
    render_memory_guide_template,
    validate_memory_guide_template_contract,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
PROFILES_ROOT = (
    BACKEND_ROOT / "pluto_duck_backend" / "agent" / "core" / "deep" / "prompts" / "profiles"
)
SAMPLE_MEMORY_GUIDE_VARIABLES: dict[str, str] = {
    "project_id": "sample-project",
    "project_memory_info": "- sample memory item\n- sample insight",
    "project_dir": "/tmp/sample-project",
}


@dataclass
class YamlValidationResult:
    """Validation result for edited YAML payload."""

    parsed: dict[str, Any] | None
    declared_paths: dict[str, str]
    errors: list[str]
    warnings: list[str]


@dataclass
class BlockEditorSpec:
    """Editor metadata for one prompt bundle block."""

    block: str
    rel_path: str
    editable: bool
    source: str


def _list_profile_ids(profiles_root: Path) -> list[str]:
    """Collect profile ids from YAML files in profiles root."""

    return sorted(path.stem for path in profiles_root.glob("*.yaml") if path.is_file())


def _read_profile_yaml(profile_id: str, profiles_root: Path) -> str:
    """Read raw YAML definition for profile."""

    return (profiles_root / f"{profile_id}.yaml").read_text(encoding="utf-8")


def _read_profile_base(profile_id: str, profiles_root: Path) -> str | None:
    """Read base id from raw YAML definition."""

    data = yaml.safe_load(_read_profile_yaml(profile_id, profiles_root))
    if not isinstance(data, dict):
        raise ValueError(f"Invalid YAML structure for profile '{profile_id}'")
    base = str(data.get("base") or "").strip()
    return base or None


def _build_inheritance_chain(profile_id: str, profiles_root: Path) -> list[str]:
    """Return parent->child chain from YAML base references."""

    chain_from_child: list[str] = [profile_id]
    seen = {profile_id}
    current = profile_id

    while True:
        base = _read_profile_base(current, profiles_root)
        if not base:
            break
        if base in seen:
            cycle = " -> ".join((*reversed(chain_from_child), base))
            raise ValueError(f"Profile inheritance cycle detected: {cycle}")

        chain_from_child.append(base)
        seen.add(base)

        if not (profiles_root / f"{base}.yaml").exists():
            break
        current = base

    return list(reversed(chain_from_child))


def _to_display_path(path: Path, profiles_root: Path) -> str:
    """Return path relative to profiles root when possible."""

    try:
        return str(path.relative_to(profiles_root))
    except ValueError:
        return str(path)


def _resolve_target_path(profiles_root: Path, rel_path: str) -> Path:
    """Resolve a profile file path and keep it inside profiles root."""

    if Path(rel_path).is_absolute():
        raise ValueError(f"Absolute path is not allowed in prompt bundle: {rel_path}")

    root = profiles_root.resolve()
    resolved = (profiles_root / rel_path).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Path escapes profiles root: {rel_path}") from exc
    return resolved


def _parse_bundle_mapping(
    raw: object,
    *,
    field_name: str,
    errors: list[str],
) -> dict[str, str]:
    """Parse and validate one bundle mapping field."""

    if raw is None:
        return {}
    if not isinstance(raw, dict):
        errors.append(f"{field_name} must be a mapping")
        return {}

    parsed: dict[str, str] = {}
    for key, value in raw.items():
        block = str(key).strip()
        rel_path = str(value).strip()

        if not block:
            errors.append(f"{field_name} has empty block key")
            continue
        if block not in _ALLOWED_PROMPT_BUNDLE_BLOCKS:
            allowed = ", ".join(sorted(_ALLOWED_PROMPT_BUNDLE_BLOCKS))
            errors.append(f"{field_name}.{block}: unsupported block (allowed: {allowed})")
            continue
        if not rel_path:
            errors.append(f"{field_name}.{block}: empty path")
            continue
        parsed[block] = rel_path

    return parsed


def _validate_edited_yaml(
    *,
    yaml_text: str,
    selected_profile: str,
    profiles_root: Path,
) -> YamlValidationResult:
    """Validate edited YAML before save."""

    errors: list[str] = []
    warnings: list[str] = []

    try:
        loaded = yaml.safe_load(yaml_text)
    except Exception as exc:
        return YamlValidationResult(
            parsed=None,
            declared_paths={},
            errors=[f"YAML parse error: {exc}"],
            warnings=[],
        )

    if not isinstance(loaded, dict):
        return YamlValidationResult(
            parsed=None,
            declared_paths={},
            errors=["YAML root must be a mapping"],
            warnings=[],
        )

    parsed = dict(loaded)

    declared_id = str(parsed.get("id") or "").strip()
    if not declared_id:
        errors.append("id is required")
    elif declared_id != selected_profile:
        errors.append(
            "For Phase 2 editing, id must match selected profile "
            f"('{selected_profile}'). Use Phase 3 for new profile creation."
        )

    compose_order = parsed.get("compose_order")
    if not isinstance(compose_order, list) or not compose_order:
        errors.append("compose_order must be a non-empty list")
    else:
        cleaned = [str(item).strip() for item in compose_order if str(item).strip()]
        if not cleaned:
            errors.append("compose_order has no valid entries")

    base_id = str(parsed.get("base") or "").strip()
    if base_id == selected_profile:
        errors.append("base cannot reference itself")
    elif base_id and not (profiles_root / f"{base_id}.yaml").exists():
        errors.append(f"base profile not found: {base_id}")

    prompt_bundle = _parse_bundle_mapping(
        parsed.get("prompt_bundle"),
        field_name="prompt_bundle",
        errors=errors,
    )
    overrides = _parse_bundle_mapping(
        parsed.get("prompt_bundle_overrides"),
        field_name="prompt_bundle_overrides",
        errors=errors,
    )

    duplicates = sorted(set(prompt_bundle).intersection(overrides))
    if duplicates:
        joined = ", ".join(duplicates)
        errors.append(
            "duplicate blocks across prompt_bundle and "
            f"prompt_bundle_overrides: {joined}"
        )

    if not base_id and not prompt_bundle:
        errors.append("prompt_bundle is required when base is not set")

    declared_paths = {**prompt_bundle, **overrides}
    for block, rel_path in sorted(declared_paths.items()):
        try:
            resolved = _resolve_target_path(profiles_root, rel_path)
        except ValueError as exc:
            errors.append(f"{block}: {exc}")
            continue

        if not resolved.exists():
            warnings.append(f"{block}: file will be created ({rel_path})")

    return YamlValidationResult(
        parsed=parsed,
        declared_paths=declared_paths,
        errors=errors,
        warnings=warnings,
    )


def _render_validation_messages(result: YamlValidationResult) -> None:
    """Render YAML validation messages."""

    if result.errors:
        for message in result.errors:
            st.error(message)
    else:
        st.success("YAML validation passed")

    for message in result.warnings:
        st.warning(message)


def _load_current_resolved_bundle(
    profile_id: str,
    profiles_root: Path,
) -> tuple[dict[str, str], dict[str, str], str | None]:
    """Load current on-disk resolved bundle for editor defaults."""

    try:
        profile = load_experiment_profile(profile_id, profiles_root=profiles_root)
        bundle_text = load_prompt_bundle(profile)
    except Exception as exc:
        return {}, {}, str(exc)

    bundle_paths = {
        block: _to_display_path(Path(path), profiles_root)
        for block, path in sorted(profile.prompt_bundle.items())
    }
    return bundle_paths, bundle_text, None


def _build_block_specs(
    *,
    declared_paths: dict[str, str],
    resolved_paths: dict[str, str],
) -> list[BlockEditorSpec]:
    """Merge declared + resolved blocks into editor specs."""

    specs: dict[str, BlockEditorSpec] = {}

    for block, rel_path in sorted(declared_paths.items()):
        specs[block] = BlockEditorSpec(
            block=block,
            rel_path=rel_path,
            editable=True,
            source="declared",
        )

    for block, rel_path in sorted(resolved_paths.items()):
        if block in specs:
            continue
        specs[block] = BlockEditorSpec(
            block=block,
            rel_path=rel_path,
            editable=False,
            source="inherited",
        )

    return [specs[key] for key in sorted(specs)]


def _editor_state_key(*, profile_id: str, block: str, rel_path: str) -> str:
    """Create a stable state key for Streamlit text areas."""

    normalized = rel_path.replace("/", "__").replace("\\", "__").replace(".", "_")
    normalized = normalized.replace("-", "_")
    return f"edit_block_{profile_id}_{block}_{normalized}"


def _render_memory_guide_feedback(*, profile_id: str, rel_path: str, template: str) -> None:
    """Render placeholder validation + sample preview for memory_guide."""

    template_path = Path(rel_path)
    try:
        missing = validate_memory_guide_template_contract(
            template=template,
            profile_id=profile_id,
            template_path=template_path,
            strict_required_variables=False,
        )
    except Exception as exc:
        st.error(f"memory_guide contract error: {exc}")
        return

    if missing:
        st.warning(
            "memory_guide missing placeholders (compat mode): "
            + ", ".join(sorted(missing))
        )
    else:
        allowed = ", ".join(sorted(ALLOWED_MEMORY_GUIDE_TEMPLATE_VARIABLES))
        st.success(f"memory_guide placeholders valid (allowed: {allowed})")

    try:
        preview = render_memory_guide_template(
            template=template,
            profile_id=profile_id,
            template_path=template_path,
            variables=SAMPLE_MEMORY_GUIDE_VARIABLES,
            strict_required_variables=False,
        )
    except Exception as exc:
        st.error(f"memory_guide render preview error: {exc}")
        return

    st.text_area(
        "memory_guide rendered preview",
        value=preview,
        height=220,
        disabled=True,
        key=f"preview_{profile_id}_{rel_path}",
    )


def _render_block_editors(
    *,
    profile_id: str,
    profiles_root: Path,
    block_specs: list[BlockEditorSpec],
    resolved_text: dict[str, str],
) -> dict[str, str]:
    """Render block editors and return declared path -> edited text."""

    edited_by_rel_path: dict[str, str] = {}

    for spec in block_specs:
        st.markdown(f"#### `{spec.block}`")
        st.caption(f"Path: `{spec.rel_path}` ({spec.source})")

        default_text = resolved_text.get(spec.block, "")
        if spec.editable:
            try:
                resolved_path = _resolve_target_path(profiles_root, spec.rel_path)
                if resolved_path.exists():
                    default_text = resolved_path.read_text(encoding="utf-8")
            except Exception:
                pass

        block_text = st.text_area(
            label=f"{spec.block} text",
            value=default_text,
            height=260,
            disabled=not spec.editable,
            key=_editor_state_key(
                profile_id=profile_id,
                block=spec.block,
                rel_path=spec.rel_path,
            ),
        )

        if spec.editable:
            edited_by_rel_path[spec.rel_path] = block_text
        else:
            st.info("Inherited block (read-only). Add override in YAML to edit here.")

        if spec.block == "memory_guide":
            _render_memory_guide_feedback(
                profile_id=profile_id,
                rel_path=spec.rel_path,
                template=block_text,
            )

        if spec.block in {"runtime", "skills_guide"} and spec.editable and not block_text.strip():
            st.warning(f"{spec.block} is empty")

    return edited_by_rel_path


def _write_profile_files(
    *,
    profile_id: str,
    yaml_text: str,
    edited_block_text: dict[str, str],
    profiles_root: Path,
) -> None:
    """Write YAML and prompt bundle text files."""

    yaml_path = profiles_root / f"{profile_id}.yaml"
    yaml_path.write_text(yaml_text, encoding="utf-8")

    for rel_path, text in sorted(edited_block_text.items()):
        target = _resolve_target_path(profiles_root, rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")


def _preflight_validate_save(
    *,
    profile_id: str,
    yaml_text: str,
    edited_block_text: dict[str, str],
    profiles_root: Path,
) -> None:
    """Validate save operation in a temporary copy before real write."""

    with tempfile.TemporaryDirectory(prefix="prompt-profile-editor-") as temp_dir:
        temp_profiles_root = Path(temp_dir) / "profiles"
        shutil.copytree(profiles_root, temp_profiles_root)
        _write_profile_files(
            profile_id=profile_id,
            yaml_text=yaml_text,
            edited_block_text=edited_block_text,
            profiles_root=temp_profiles_root,
        )
        clear_experiment_profile_cache()
        load_experiment_profile(profile_id, profiles_root=temp_profiles_root)


def _render_loaded_profile(profile_id: str, profiles_root: Path) -> None:
    """Render parsed profile details and resolved prompt blocks."""

    try:
        profile = load_experiment_profile(profile_id, profiles_root=profiles_root)
    except Exception as exc:
        st.error(f"Failed to load profile '{profile_id}': {exc}")
        return

    st.subheader("Parsed Profile")
    profile_payload: dict[str, Any] = {
        "id": profile.id,
        "description": profile.description,
        "compose_order": list(profile.compose_order),
        "resolved_prompt_bundle": {
            key: _to_display_path(path, profiles_root)
            for key, path in sorted(profile.prompt_bundle.items())
        },
    }
    st.json(profile_payload)

    st.subheader("Inheritance")
    try:
        chain = _build_inheritance_chain(profile_id, profiles_root)
    except Exception as exc:
        st.error(f"Failed to resolve inheritance chain for '{profile_id}': {exc}")
        return

    if len(chain) == 1:
        st.info("No base profile")
    else:
        st.markdown(" -> ".join(f"`{name}`" for name in chain))

    st.subheader("Resolved Bundle Text")
    try:
        resolved_bundle = load_prompt_bundle(profile)
    except Exception as exc:
        st.error(f"Failed to read prompt bundle for '{profile_id}': {exc}")
        return

    for block_name in sorted(resolved_bundle):
        block_text = resolved_bundle[block_name]
        block_path = Path(profile.prompt_bundle[block_name])
        st.markdown(f"#### `{block_name}`")
        st.caption(f"Source: `{_to_display_path(block_path, profiles_root)}`")
        st.text_area(
            label=f"{block_name} text",
            value=block_text,
            height=260,
            disabled=True,
            key=f"view_text_{profile_id}_{block_name}",
        )


def _render_editor_mode(*, selected_profile: str, profiles_root: Path) -> None:
    """Render edit mode UI for one selected profile."""

    st.subheader("YAML (edit)")
    try:
        initial_yaml = _read_profile_yaml(selected_profile, profiles_root)
    except Exception as exc:
        st.error(f"Failed to read YAML for '{selected_profile}': {exc}")
        return

    edited_yaml = st.text_area(
        "Profile YAML",
        value=initial_yaml,
        height=320,
        key=f"edit_yaml_{selected_profile}",
    )

    validation = _validate_edited_yaml(
        yaml_text=edited_yaml,
        selected_profile=selected_profile,
        profiles_root=profiles_root,
    )
    _render_validation_messages(validation)

    resolved_paths, resolved_text, resolved_error = _load_current_resolved_bundle(
        selected_profile,
        profiles_root,
    )
    if resolved_error:
        st.warning(f"Current resolved profile load failed: {resolved_error}")

    block_specs = _build_block_specs(
        declared_paths=validation.declared_paths,
        resolved_paths=resolved_paths,
    )

    st.subheader("Prompt Blocks (edit)")
    edited_block_text = _render_block_editors(
        profile_id=selected_profile,
        profiles_root=profiles_root,
        block_specs=block_specs,
        resolved_text=resolved_text,
    )

    save_disabled = bool(validation.errors)
    if st.button("Save", disabled=save_disabled, type="primary"):
        try:
            _preflight_validate_save(
                profile_id=selected_profile,
                yaml_text=edited_yaml,
                edited_block_text=edited_block_text,
                profiles_root=profiles_root,
            )
            _write_profile_files(
                profile_id=selected_profile,
                yaml_text=edited_yaml,
                edited_block_text=edited_block_text,
                profiles_root=profiles_root,
            )
            clear_experiment_profile_cache()
            load_experiment_profile(selected_profile, profiles_root=profiles_root)
        except Exception as exc:
            st.error(f"Save failed: {exc}")
        else:
            st.success(f"Saved profile '{selected_profile}'")


def main() -> None:
    """Run Streamlit app."""

    st.set_page_config(page_title="Prompt Profile Editor", layout="wide")
    st.title("Prompt Profile Editor")
    st.caption(f"Profiles root: `{PROFILES_ROOT}`")

    if not PROFILES_ROOT.exists():
        st.error(f"Profiles directory not found: {PROFILES_ROOT}")
        return

    profile_ids = _list_profile_ids(PROFILES_ROOT)
    if not profile_ids:
        st.error(f"No profile YAML files found under: {PROFILES_ROOT}")
        return

    default_index = profile_ids.index("v2") if "v2" in profile_ids else 0
    selected_profile = st.sidebar.selectbox(
        "Profile",
        options=profile_ids,
        index=default_index,
    )
    st.sidebar.caption(f"Detected profiles: {len(profile_ids)}")

    edit_mode = st.sidebar.toggle("Edit mode", value=False)

    if edit_mode:
        _render_editor_mode(selected_profile=selected_profile, profiles_root=PROFILES_ROOT)
    else:
        st.subheader("YAML (read-only)")
        try:
            yaml_text = _read_profile_yaml(selected_profile, PROFILES_ROOT)
        except Exception as exc:
            st.error(f"Failed to read YAML for '{selected_profile}': {exc}")
            return

        st.code(yaml_text, language="yaml")
        _render_loaded_profile(selected_profile, PROFILES_ROOT)


if __name__ == "__main__":
    main()
