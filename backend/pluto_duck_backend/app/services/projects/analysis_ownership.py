"""Helpers for safe analysis artifact cleanup across project boundaries."""

from __future__ import annotations

from pathlib import Path
from typing import Tuple


def _analysis_ids_in_dir(directory: Path) -> set[str]:
    if not directory.exists():
        return set()
    return {
        path.stem
        for path in directory.glob("*.yaml")
        if path.is_file()
    }


def resolve_owned_and_shared_analysis_ids(
    *,
    project_id: str,
    analyses_root: Path,
) -> Tuple[list[str], list[str]]:
    """Split a project's analysis IDs into owned and shared ID sets.

    Shared IDs are present in at least one other project directory.
    """
    project_dir = analyses_root / project_id
    project_ids = _analysis_ids_in_dir(project_dir)
    if not project_ids:
        return [], []

    foreign_ids: set[str] = set()
    if analyses_root.exists():
        for child in analyses_root.iterdir():
            if not child.is_dir() or child.name == project_id:
                continue
            foreign_ids.update(_analysis_ids_in_dir(child))

    shared_ids = sorted(project_ids & foreign_ids)
    owned_ids = sorted(project_ids - foreign_ids)
    return owned_ids, shared_ids
