"""Tests for memory_guide template contract validation and rendering."""

from __future__ import annotations

from pathlib import Path

import pytest
from pluto_duck_backend.agent.core.deep.prompts.memory_guide_template import (
    render_memory_guide_template,
    validate_memory_guide_template_contract,
)


def test_validate_contract_rejects_unsupported_placeholder() -> None:
    with pytest.raises(ValueError, match="unsupported=unknown_key"):
        validate_memory_guide_template_contract(
            template="Hello {unknown_key}",
            profile_id="exp-a",
            template_path=Path("/tmp/memory_guide.md"),
            strict_required_variables=False,
        )


def test_validate_contract_allows_missing_required_in_compat_mode() -> None:
    missing = validate_memory_guide_template_contract(
        template="Project dir only: {project_dir}",
        profile_id="exp-a",
        template_path=Path("/tmp/memory_guide.md"),
        strict_required_variables=False,
    )

    assert missing == ("project_id", "project_memory_info")


def test_validate_contract_requires_all_required_variables_in_strict_mode() -> None:
    with pytest.raises(ValueError, match="missing required placeholders=project_memory_info"):
        validate_memory_guide_template_contract(
            template="ID={project_id} DIR={project_dir}",
            profile_id="exp-a",
            template_path=Path("/tmp/memory_guide.md"),
            strict_required_variables=True,
        )


def test_render_template_converts_none_to_empty_string() -> None:
    rendered = render_memory_guide_template(
        template="id={project_id}\ninfo={project_memory_info}\ndir={project_dir}",
        profile_id="exp-a",
        template_path=Path("/tmp/memory_guide.md"),
        variables={
            "project_id": None,
            "project_memory_info": "detected",
            "project_dir": "/memories/projects/proj-a",
        },
        strict_required_variables=True,
    )

    assert rendered == "id=\ninfo=detected\ndir=/memories/projects/proj-a"


def test_render_template_raises_when_required_variable_missing() -> None:
    with pytest.raises(ValueError, match="Missing memory_guide render variables"):
        render_memory_guide_template(
            template="{project_id}\n{project_memory_info}\n{project_dir}",
            profile_id="exp-a",
            template_path=Path("/tmp/memory_guide.md"),
            variables={
                "project_id": "proj-a",
                "project_memory_info": "detected",
            },
            strict_required_variables=True,
        )


def test_render_template_raises_when_trimmed_output_is_empty() -> None:
    with pytest.raises(ValueError, match="Rendered memory_guide template is empty"):
        render_memory_guide_template(
            template="{project_id}",
            profile_id="exp-a",
            template_path=Path("/tmp/memory_guide.md"),
            variables={
                "project_id": None,
                "project_memory_info": "detected",
                "project_dir": "/memories/projects/proj-a",
            },
            strict_required_variables=False,
        )
