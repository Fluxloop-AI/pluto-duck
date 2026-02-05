"""Context models for deep agent lifetimes."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pluto_duck_backend.app.core.config import get_settings

from .hitl import ApprovalBroker


@dataclass(frozen=True)
class SessionContext:
    conversation_id: str
    project_id: str | None
    workspace_root: Path
    prompt_layout: str


@dataclass(frozen=True)
class RunContext:
    run_id: str
    broker: ApprovalBroker
    model: Optional[str] = None


def get_workspace_root(conversation_id: str) -> Path:
    settings = get_settings()
    return settings.data_dir.root / "agent_workspaces" / str(conversation_id)


def build_session_context(*, conversation_id: str, project_id: str | None) -> SessionContext:
    workspace_root = get_workspace_root(conversation_id)
    workspace_root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(f"prompt-layout-v1:{conversation_id}".encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % 100
    prompt_layout = "v1" if bucket < 50 else "v2"
    return SessionContext(
        conversation_id=conversation_id,
        project_id=project_id,
        workspace_root=workspace_root,
        prompt_layout=prompt_layout,
    )
