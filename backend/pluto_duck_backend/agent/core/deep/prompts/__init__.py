"""Prompt templates for the Pluto Duck deep agent."""

from __future__ import annotations

from importlib import resources
from pathlib import Path

from ..prompt_experiment import ExperimentProfile


def load_prompt(filename: str, *, encoding: str = "utf-8") -> str:
    package = __name__
    resource = resources.files(package).joinpath(filename)
    with resources.as_file(resource) as path:
        return path.read_text(encoding=encoding)


def load_default_agent_prompt() -> str:
    return load_prompt("default_agent_prompt.md")


def load_prompt_bundle(profile: ExperimentProfile, *, encoding: str = "utf-8") -> dict[str, str]:
    bundle: dict[str, str] = {}
    for key, path in profile.prompt_bundle.items():
        file_path = Path(path)
        if not file_path.exists():
            raise FileNotFoundError(
                f"Prompt bundle file not found for profile '{profile.id}' key '{key}': {file_path}"
            )
        try:
            bundle[key] = file_path.read_text(encoding=encoding)
        except UnicodeDecodeError as exc:
            raise ValueError(
                "Prompt bundle file decode failed for profile "
                f"'{profile.id}' key '{key}': {file_path}"
            ) from exc
    return bundle
