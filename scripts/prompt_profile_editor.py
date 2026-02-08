"""Local Streamlit viewer/editor for prompt experiment profiles."""

from __future__ import annotations

import re
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
_DYNAMIC_BLOCK_PLACEHOLDERS: dict[str, str] = {
    "user_profile": (
        "<!-- rendered at runtime -->\n"
        "<user_profile>\n"
        "name: YooJung\n"
        "language: Korean\n"
        "</user_profile>\n\n"
        "<assistant_style>\n"
        "Respond in Korean.\n"
        "</assistant_style>"
    ),
    "memory_section": (
        "<!-- rendered at runtime -->\n"
        "<user_memory>\n"
        "(learned facts, preferences, and feedback from user interactions)\n"
        "</user_memory>\n\n"
        "<project_memory>\n"
        "(project-specific instructions and conventions)\n"
        "</project_memory>"
    ),
    "memory_context": (
        "<!-- rendered at runtime -->\n"
        "## Memory Context\n\n"
        "- user_dir: `/memories/user`\n"
        "- project_dir: `/memories/projects/sample-project`\n"
        "- project_memory: no agent.md found yet"
    ),
    "dataset": (
        "<!-- rendered at runtime -->\n"
        "## Dataset Readiness Context\n\n"
        "<dataset_readiness>\n"
        "datasets: 3\n"
        "ready: 2\n"
        "not_ready: 1\n"
        "</dataset_readiness>"
    ),
    "skills_list": (
        "<!-- rendered at runtime -->\n"
        '**User Skills**: `/skills/user/skills/`\n'
        '**Project Skills**: `/skills/projects/sample-project/skills/` (overrides user)\n\n'
        "**Available Skills:**\n\n"
        "**User Skills:**\n"
        "- **sql-analysis**: Workflow for answering analytical questions with DuckDB.\n"
        "  \u2192 Read `/skills/user/skills/sql-analysis/SKILL.md` for full instructions\n"
        "- **source-explorer**: Explore connected data sources and their tables.\n"
        "  \u2192 Read `/skills/user/skills/source-explorer/SKILL.md` for full instructions"
    ),
    "skills_full": "<!-- [skills_full] rendered at runtime (skills_guide + skills_list combined) -->",
}
PROFILE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
DEFAULT_INDEPENDENT_BUNDLE_TEXT: dict[str, str] = {
    "runtime": "# Runtime\n\nDefine runtime/system guidance here.\n",
    "base_agent_prompt": (
        "# Base Agent Prompt\n\n"
        "Define core agent behavior rules here.\n"
    ),
    "skills_guide": "# Skills Guide\n\nList skills and tool usage guidance here.\n",
    "memory_guide": (
        "# Memory Guide\n\n"
        "Project ID: {project_id}\n"
        "Project dir: {project_dir}\n\n"
        "{project_memory_info}\n"
    ),
}
PROTECTED_PROFILE_IDS = frozenset({"v1", "v2"})


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
    compose_order: list[str] | None = None,
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

    if compose_order:
        ordered_keys = [key for key in compose_order if key in specs]
        ordered_keys.extend(key for key in sorted(specs) if key not in ordered_keys)
        return [specs[key] for key in ordered_keys]

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
        height=420,
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

        if spec.block == "memory_guide" and spec.editable:
            col_edit, col_preview = st.columns([1, 1])
            with col_edit:
                st.markdown("**Edit**")
                block_text = st.text_area(
                    label=f"{spec.block} text",
                    value=default_text,
                    height=520,
                    disabled=False,
                    key=_editor_state_key(
                        profile_id=profile_id,
                        block=spec.block,
                        rel_path=spec.rel_path,
                    ),
                )
                edited_by_rel_path[spec.rel_path] = block_text
            with col_preview:
                st.markdown("**Preview**")
                _render_memory_guide_feedback(
                    profile_id=profile_id,
                    rel_path=spec.rel_path,
                    template=block_text,
                )
        else:
            block_text = st.text_area(
                label=f"{spec.block} text",
                value=default_text,
                height=420,
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


def _validate_new_profile_id(profile_id: str, existing_ids: set[str]) -> str | None:
    candidate = profile_id.strip()
    if not candidate:
        return "Profile ID is required"
    if not PROFILE_ID_PATTERN.fullmatch(candidate):
        return "Profile ID must match: lowercase letters/numbers/hyphen"
    if candidate in existing_ids:
        return f"Profile ID already exists: {candidate}"
    if (PROFILES_ROOT / f"{candidate}.yaml").exists():
        return f"Profile YAML already exists: {candidate}.yaml"
    if (PROFILES_ROOT / candidate).exists():
        return f"Profile directory already exists: {candidate}/"
    return None


def _compose_order_text(items: list[str]) -> str:
    return "\n".join(items)


def _parse_compose_order_text(raw: str) -> list[str]:
    parsed: list[str] = []
    for line in raw.replace(",", "\n").splitlines():
        item = line.strip()
        if item:
            parsed.append(item)
    return parsed


def _build_new_profile_yaml_text(
    *,
    profile_id: str,
    description: str,
    compose_order: list[str],
    base_id: str | None,
    bundle_paths: dict[str, str],
) -> str:
    payload: dict[str, Any] = {
        "id": profile_id,
        "description": description,
        "compose_order": compose_order,
    }
    if base_id:
        payload["base"] = base_id
        payload["prompt_bundle_overrides"] = bundle_paths
    else:
        payload["prompt_bundle"] = bundle_paths

    return yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)


def _materialize_new_profile(
    *,
    profile_id: str,
    yaml_text: str,
    bundle_text_by_rel_path: dict[str, str],
    profiles_root: Path,
) -> None:
    yaml_path = profiles_root / f"{profile_id}.yaml"
    yaml_path.write_text(yaml_text, encoding="utf-8")

    for rel_path, text in sorted(bundle_text_by_rel_path.items()):
        target = _resolve_target_path(profiles_root, rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")


def _preflight_validate_new_profile(
    *,
    profile_id: str,
    yaml_text: str,
    bundle_text_by_rel_path: dict[str, str],
    profiles_root: Path,
) -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-profile-create-") as temp_dir:
        temp_profiles_root = Path(temp_dir) / "profiles"
        shutil.copytree(profiles_root, temp_profiles_root)
        _materialize_new_profile(
            profile_id=profile_id,
            yaml_text=yaml_text,
            bundle_text_by_rel_path=bundle_text_by_rel_path,
            profiles_root=temp_profiles_root,
        )
        clear_experiment_profile_cache()
        load_experiment_profile(profile_id, profiles_root=temp_profiles_root)


def _default_compose_order_for_new_profile(
    profile_ids: list[str],
    profiles_root: Path,
) -> list[str]:
    if "v3" in profile_ids:
        seed = "v3"
    elif "v2" in profile_ids:
        seed = "v2"
    else:
        seed = profile_ids[0]
    try:
        seed_profile = load_experiment_profile(seed, profiles_root=profiles_root)
    except Exception:
        return ["runtime", "base_agent_prompt", "skills_guide", "memory_guide"]
    return list(seed_profile.compose_order)


def _render_new_profile_section(profile_ids: list[str], profiles_root: Path) -> None:
    existing_ids = set(profile_ids)
    with st.sidebar.expander("New Profile", expanded=False):
        new_profile_id = st.text_input(
            "Profile ID",
            key="new_profile_id",
            placeholder="example: v3-dev",
        )
        base_options = ["(none)", *profile_ids]
        selected_base = st.selectbox(
            "Base profile (optional)",
            options=base_options,
            key="new_profile_base",
        )
        base_id = None if selected_base == "(none)" else selected_base
        description = st.text_input(
            "Description",
            key="new_profile_description",
            placeholder="New prompt profile",
        )

        compose_input = ""
        compose_order: list[str] = []
        bundle_text_by_block: dict[str, str] = {}
        if base_id:
            try:
                base_profile = load_experiment_profile(base_id, profiles_root=profiles_root)
                compose_order = list(base_profile.compose_order)
                bundle_text_by_block = load_prompt_bundle(base_profile)
                st.caption("compose_order copied from base profile")
                st.code(_compose_order_text(compose_order), language="text")
                st.info(
                    "Base selected: prompt_bundle remains empty and "
                    "prompt_bundle_overrides will be generated."
                )
            except Exception as exc:
                st.error(f"Failed to load base profile '{base_id}': {exc}")
        else:
            default_order = _default_compose_order_for_new_profile(profile_ids, profiles_root)
            compose_input = st.text_area(
                "Compose order (comma or newline separated)",
                value=_compose_order_text(default_order),
                height=140,
                key="new_profile_compose_order",
            )
            compose_order = _parse_compose_order_text(compose_input)
            bundle_text_by_block = dict(DEFAULT_INDEPENDENT_BUNDLE_TEXT)
            st.info("No base selected: prompt_bundle entries will be created.")

        if st.button("Create", key="create_profile_button", type="primary"):
            profile_id = new_profile_id.strip()
            description_text = description.strip() or f"{profile_id} profile"
            validation_error = _validate_new_profile_id(profile_id, existing_ids)
            if validation_error:
                st.error(validation_error)
                return
            if not compose_order:
                st.error("compose_order must contain at least one item")
                return
            if not bundle_text_by_block:
                st.error("Failed to prepare prompt bundle block content")
                return

            bundle_paths = {
                block: f"{profile_id}/{block}.md"
                for block in sorted(bundle_text_by_block.keys())
            }
            yaml_text = _build_new_profile_yaml_text(
                profile_id=profile_id,
                description=description_text,
                compose_order=compose_order,
                base_id=base_id,
                bundle_paths=bundle_paths,
            )
            bundle_text_by_rel_path = {
                rel_path: bundle_text_by_block[block]
                for block, rel_path in bundle_paths.items()
            }

            try:
                _preflight_validate_new_profile(
                    profile_id=profile_id,
                    yaml_text=yaml_text,
                    bundle_text_by_rel_path=bundle_text_by_rel_path,
                    profiles_root=profiles_root,
                )
                _materialize_new_profile(
                    profile_id=profile_id,
                    yaml_text=yaml_text,
                    bundle_text_by_rel_path=bundle_text_by_rel_path,
                    profiles_root=profiles_root,
                )
                clear_experiment_profile_cache()
                load_experiment_profile(profile_id, profiles_root=profiles_root)
            except Exception as exc:
                st.error(f"Create failed: {exc}")
                return

            st.session_state["selected_profile"] = profile_id
            st.session_state["edit_mode"] = True
            st.success(f"Created profile '{profile_id}'")
            st.rerun()


def _profile_children_map(profile_ids: list[str], profiles_root: Path) -> dict[str, list[str]]:
    children: dict[str, list[str]] = {profile_id: [] for profile_id in profile_ids}
    for profile_id in profile_ids:
        yaml_path = profiles_root / f"{profile_id}.yaml"
        try:
            raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        base_id = str(raw.get("base") or "").strip()
        if base_id and base_id in children:
            children[base_id].append(profile_id)
    return children


def _delete_profile_materials(profile_id: str, profiles_root: Path) -> None:
    yaml_path = profiles_root / f"{profile_id}.yaml"
    if yaml_path.exists():
        yaml_path.unlink()

    profile_dir = profiles_root / profile_id
    if profile_dir.exists() and profile_dir.is_dir():
        shutil.rmtree(profile_dir)


def _render_delete_profile_section(profile_ids: list[str], profiles_root: Path) -> None:
    children_map = _profile_children_map(profile_ids, profiles_root)
    deletable = [
        profile_id for profile_id in profile_ids if profile_id not in PROTECTED_PROFILE_IDS
    ]

    with st.sidebar.expander("Delete Profile", expanded=False):
        if not deletable:
            st.info("No deletable profiles")
            return

        target = st.selectbox(
            "Delete target",
            options=deletable,
            key="delete_profile_target",
        )
        dependents = children_map.get(target, [])
        if dependents:
            st.error(
                "Cannot delete: referenced as base by "
                + ", ".join(f"`{child}`" for child in sorted(dependents))
            )

        st.caption("Type profile ID to confirm deletion")
        confirmation = st.text_input(
            "Confirm ID",
            key="delete_profile_confirm",
            placeholder=target,
        ).strip()

        disabled = confirmation != target or bool(dependents)
        if st.button("Delete", key="delete_profile_button", type="secondary", disabled=disabled):
            try:
                _delete_profile_materials(target, profiles_root)
                clear_experiment_profile_cache()
            except Exception as exc:
                st.error(f"Delete failed: {exc}")
                return

            remaining = [profile_id for profile_id in _list_profile_ids(profiles_root)]
            if remaining:
                st.session_state["selected_profile"] = (
                    remaining[-1]
                )
            st.success(f"Deleted profile '{target}'")
            st.rerun()


def _build_composed_preview(
    profile_id: str,
    compose_order: tuple[str, ...],
    resolved_bundle: dict[str, str],
    profiles_root: Path,
) -> str:
    """Build a composed system prompt preview following compose_order."""

    rendered: list[str] = []
    for block in compose_order:
        if block in resolved_bundle:
            text = resolved_bundle[block].strip()
            if block == "memory_guide":
                try:
                    template_path = Path("preview")
                    text = render_memory_guide_template(
                        template=resolved_bundle[block],
                        profile_id=profile_id,
                        template_path=template_path,
                        variables=SAMPLE_MEMORY_GUIDE_VARIABLES,
                        strict_required_variables=False,
                    ).strip()
                except Exception:
                    pass
        else:
            text = _DYNAMIC_BLOCK_PLACEHOLDERS.get(block, f"<!-- [{block}] -->").strip()
        if text:
            rendered.append(f"# ---- [{block}] ----\n{text}")
    return "\n\n".join(rendered)


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
            height=420,
            disabled=True,
            key=f"view_text_{profile_id}_{block_name}",
        )

    st.subheader("Build Preview")
    st.caption(
        "compose_order 순서로 조합된 최종 시스템 프롬프트 미리보기. "
        "동적 블록은 샘플 플레이스홀더로 표시됩니다."
    )
    if st.button("Build Preview", key=f"build_preview_{profile_id}"):
        composed = _build_composed_preview(
            profile_id=profile_id,
            compose_order=profile.compose_order,
            resolved_bundle=resolved_bundle,
            profiles_root=profiles_root,
        )
        static_chars = sum(
            len(resolved_bundle.get(b, ""))
            for b in profile.compose_order
            if b in resolved_bundle
        )
        st.metric("Static blocks approx.", f"~{static_chars:,} chars")
        st.code(composed, language="markdown")


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
        height=480,
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

    edited_compose_order: list[str] | None = None
    if validation.parsed:
        raw_order = validation.parsed.get("compose_order")
        if isinstance(raw_order, list):
            edited_compose_order = [str(item).strip() for item in raw_order if str(item).strip()]

    block_specs = _build_block_specs(
        declared_paths=validation.declared_paths,
        resolved_paths=resolved_paths,
        compose_order=edited_compose_order,
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

    if "selected_profile" not in st.session_state:
        st.session_state["selected_profile"] = profile_ids[-1]
    if st.session_state["selected_profile"] not in profile_ids:
        st.session_state["selected_profile"] = profile_ids[-1]

    _render_new_profile_section(profile_ids, PROFILES_ROOT)
    _render_delete_profile_section(profile_ids, PROFILES_ROOT)

    selected_profile = st.sidebar.selectbox(
        "Profile",
        options=profile_ids,
        key="selected_profile",
    )
    st.sidebar.caption(f"Detected profiles: {len(profile_ids)}")

    edit_mode = st.sidebar.toggle("Edit mode", key="edit_mode", value=False)

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
