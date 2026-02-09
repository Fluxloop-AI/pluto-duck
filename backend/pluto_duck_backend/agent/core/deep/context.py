"""Context models for deep agent lifetimes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pluto_duck_backend.app.core.config import get_settings

from .hitl import ApprovalBroker
from .prompt_experiment import DEFAULT_PROFILE_ID


@dataclass(frozen=True)
class SessionContext:
    conversation_id: str
    project_id: str | None
    workspace_root: Path
    experiment_profile_id: str

    @property
    def prompt_layout(self) -> str:
        """Legacy alias kept for compatibility until Phase 2 migration."""

        return self.experiment_profile_id


@dataclass(frozen=True)
class RunContext:
    run_id: str
    broker: ApprovalBroker
    model: Optional[str] = None


def get_workspace_root(conversation_id: str) -> Path:
    settings = get_settings()
    return settings.data_dir.root / "agent_workspaces" / str(conversation_id)


def build_session_context(
    *,
    conversation_id: str,
    project_id: str | None,
    experiment_profile_id: str = DEFAULT_PROFILE_ID,
) -> SessionContext:
    workspace_root = get_workspace_root(conversation_id)
    workspace_root.mkdir(parents=True, exist_ok=True)
    return SessionContext(
        conversation_id=conversation_id,
        project_id=project_id,
        workspace_root=workspace_root,
        experiment_profile_id=experiment_profile_id,
    )
