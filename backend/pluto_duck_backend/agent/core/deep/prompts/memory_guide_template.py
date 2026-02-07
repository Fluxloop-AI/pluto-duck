"""Template contract helpers for memory_guide prompt blocks."""

from __future__ import annotations

import string
from pathlib import Path
from typing import Mapping

ALLOWED_MEMORY_GUIDE_TEMPLATE_VARIABLES = frozenset(
    {"project_id", "project_memory_info", "project_dir"}
)
REQUIRED_MEMORY_GUIDE_TEMPLATE_VARIABLES = ALLOWED_MEMORY_GUIDE_TEMPLATE_VARIABLES

_FORMATTER = string.Formatter()


def validate_memory_guide_template_contract(
    *,
    template: str,
    profile_id: str,
    template_path: Path,
    strict_required_variables: bool,
) -> tuple[str, ...]:
    """Validate placeholders used by a memory_guide template.

    Returns missing required placeholders so callers can log warnings in compat mode.
    """

    placeholders = _extract_placeholders(template)
    unsupported = sorted(placeholders.difference(ALLOWED_MEMORY_GUIDE_TEMPLATE_VARIABLES))
    if unsupported:
        joined = ", ".join(unsupported)
        raise ValueError(
            "Invalid memory_guide template placeholders for profile "
            f"'{profile_id}' at '{template_path}': unsupported={joined}; "
            "allowed=project_dir, project_id, project_memory_info"
        )

    missing_required = tuple(
        sorted(REQUIRED_MEMORY_GUIDE_TEMPLATE_VARIABLES.difference(placeholders))
    )
    if strict_required_variables and missing_required:
        joined = ", ".join(missing_required)
        raise ValueError(
            "Invalid memory_guide template contract for profile "
            f"'{profile_id}' at '{template_path}': missing required placeholders={joined}"
        )
    return missing_required


def render_memory_guide_template(
    *,
    template: str,
    profile_id: str,
    template_path: Path,
    variables: Mapping[str, object],
    strict_required_variables: bool,
) -> str:
    """Render memory_guide template with strict validation."""

    validate_memory_guide_template_contract(
        template=template,
        profile_id=profile_id,
        template_path=template_path,
        strict_required_variables=strict_required_variables,
    )

    missing_variables = tuple(
        sorted(key for key in REQUIRED_MEMORY_GUIDE_TEMPLATE_VARIABLES if key not in variables)
    )
    if missing_variables:
        joined = ", ".join(missing_variables)
        raise ValueError(
            "Missing memory_guide render variables for profile "
            f"'{profile_id}' at '{template_path}': {joined}"
        )

    normalized: dict[str, str] = {}
    for key in REQUIRED_MEMORY_GUIDE_TEMPLATE_VARIABLES:
        value = variables.get(key)
        normalized[key] = "" if value is None else str(value)

    try:
        rendered = template.format(**normalized)
    except KeyError as exc:
        missing = str(exc).strip("'")
        raise ValueError(
            "Missing memory_guide render variable for profile "
            f"'{profile_id}' at '{template_path}': {missing}"
        ) from exc
    except Exception as exc:
        raise ValueError(
            "Failed to render memory_guide template for profile "
            f"'{profile_id}' at '{template_path}': {exc}"
        ) from exc

    result = rendered.strip()
    if not result:
        raise ValueError(
            "Rendered memory_guide template is empty for profile "
            f"'{profile_id}' at '{template_path}'"
        )
    return result


def _extract_placeholders(template: str) -> set[str]:
    placeholders: set[str] = set()
    for _literal, field_name, _format_spec, _conversion in _FORMATTER.parse(template):
        if field_name is None:
            continue
        name = field_name.strip()
        if not name:
            continue
        placeholders.add(name)
    return placeholders
