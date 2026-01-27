"""Prompt templates for dataset analysis."""

from __future__ import annotations

from importlib import resources


def load_prompt(filename: str, *, encoding: str = "utf-8") -> str:
    """Load a prompt file from this package."""
    package = __name__
    resource = resources.files(package).joinpath(filename)
    with resources.as_file(resource) as path:
        return path.read_text(encoding=encoding)


def load_dataset_analysis_prompt() -> str:
    """Load the dataset analysis prompt template."""
    return load_prompt("dataset_analysis_prompt.md")
