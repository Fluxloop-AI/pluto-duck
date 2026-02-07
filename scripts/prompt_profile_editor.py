"""Local Streamlit viewer for prompt experiment profiles."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import streamlit as st
import yaml  # type: ignore[import-untyped]
from pluto_duck_backend.agent.core.deep.prompt_experiment import load_experiment_profile
from pluto_duck_backend.agent.core.deep.prompts import load_prompt_bundle

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
PROFILES_ROOT = (
    BACKEND_ROOT / "pluto_duck_backend" / "agent" / "core" / "deep" / "prompts" / "profiles"
)


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
