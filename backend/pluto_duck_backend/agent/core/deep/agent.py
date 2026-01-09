"""Deep agent builder for Pluto Duck (Phase 1).

This module wires together:
- vendored `deepagents.create_deep_agent`
- PlutoDuckChatModel wrapper
- workspace-scoped filesystem backend (no execute)
- HITL persistence middleware (creates approval rows; actual resume wiring is Phase 3)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.tools import BaseTool

from deepagents import create_deep_agent
from deepagents.backends.composite import CompositeBackend
from deepagents.backends.filesystem import FilesystemBackend

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.chat import get_chat_repository

from .hitl import ApprovalBroker
from .middleware.approvals import ApprovalPersistenceMiddleware, PlutoDuckHITLConfig
from .middleware.memory import AgentMemoryMiddleware
from .middleware.skills import SkillsMiddleware
from .prompts import load_default_agent_prompt
from .tools import build_default_tools

def get_runtime_system_prompt() -> str:
    """Backend runtime system prompt (CLI-parity, adapted to virtual FS + no shell)."""
    return """### Current Working Directory

You are operating inside the **Pluto Duck backend** with a **virtual filesystem**.

### File System and Paths

**IMPORTANT - Path Handling:**
- All file paths must be absolute **virtual** paths starting with `/`
- Use these roots:
  - `/workspace/` for working files and intermediate artifacts
  - `/memories/` for long-term memory files
  - `/skills/` for skill libraries (SKILL.md)
- Never use relative paths

### Skills Directory

Your skills are stored under `/skills/`.
Skills may contain scripts or supporting files, but **script execution is not available** in backend mode.
Treat skills as guidance/templates and follow their workflows using available tools.

### Human-in-the-Loop Tool Approval

Some tool calls require user approval before execution. When a tool call is rejected by the user:
1. Accept their decision immediately - do NOT retry the same action
2. Explain that you understand they rejected the action
3. Suggest an alternative approach or ask for clarification
4. Never attempt the exact same rejected action again

Respect the user's decisions and work with them collaboratively.

### Todo List Management

When using the write_todos tool:
1. Keep the todo list minimal - aim for 3-6 items maximum
2. Only create todos for complex, multi-step tasks that truly need tracking
3. Break down work into clear, actionable items without over-fragmenting
4. For simple tasks (1-2 steps), just do them directly without creating todos
5. Update todo status promptly as you complete each item
""".strip()


def get_workspace_root(conversation_id: str) -> Path:
    """Return the on-disk workspace root for a conversation."""
    settings = get_settings()
    return settings.data_dir.root / "agent_workspaces" / str(conversation_id)


def get_deepagents_root() -> Path:
    """Return root directory for backend memory/skills storage."""
    return get_settings().data_dir.root / "deepagents"


def build_deep_agent(
    *,
    conversation_id: str,
    run_id: str,
    broker: ApprovalBroker,
    model: Optional[str] = None,
    tools: Optional[Sequence[BaseTool | Callable[..., Any] | dict[str, Any]]] = None,
    extra_middleware: Sequence[AgentMiddleware] = (),
    checkpointer: Any = None,
) -> Any:
    """Create a deep agent runnable (CompiledStateGraph).

    Notes:
    - We always pass an explicit model instance to avoid relying on vendored defaults.
    - Filesystem backend is workspace-scoped and does not support `execute` by design.
    - `checkpointer` is accepted for Phase 1 plumbing; a DB-backed implementation is added separately.
    """
    workspace_root = get_workspace_root(conversation_id)
    workspace_root.mkdir(parents=True, exist_ok=True)

    # Map virtual paths to the workspace root (virtual_mode=True).
    fs = FilesystemBackend(root_dir=workspace_root, virtual_mode=True)
    deepagents_root = get_deepagents_root()
    deepagents_root.mkdir(parents=True, exist_ok=True)
    memories_fs = FilesystemBackend(root_dir=deepagents_root, virtual_mode=True)
    skills_fs = FilesystemBackend(root_dir=deepagents_root, virtual_mode=True)

    backend = CompositeBackend(
        default=fs,
        routes={
            "/workspace/": fs,
            "/memories/": memories_fs,
            "/skills/": skills_fs,
        },
    )

    # Tool calling requires a ChatModel that implements bind_tools().
    # Prefer provider-specific LangChain integrations when available (e.g., langchain-openai).
    settings = get_settings()
    repo = get_chat_repository()
    db_settings = repo.get_settings()

    effective_provider = (db_settings.get("llm_provider") or settings.agent.provider or "openai").lower()
    effective_model = model or db_settings.get("llm_model") or settings.agent.model or "gpt-4o-mini"
    effective_api_key = db_settings.get("llm_api_key") or settings.agent.api_key or os.getenv("OPENAI_API_KEY")

    if effective_provider == "openai":
        from langchain_openai import ChatOpenAI  # type: ignore

        if not effective_api_key:
            raise RuntimeError(
                "OpenAI API key is not configured. Set it in Settings (llm_api_key) or via OPENAI_API_KEY."
            )

        chat_model = ChatOpenAI(
            model=effective_model,
            api_key=effective_api_key,
            base_url=str(settings.agent.api_base) if settings.agent.api_base else None,
        )
    else:
        # PlutoDuckChatModel does not support tool calling (bind_tools) yet.
        # Fail loudly with a clear error instead of raising NotImplementedError deep inside LangChain.
        raise RuntimeError(
            f"LLM provider '{effective_provider}' is not supported for deep agent tool-calling yet. "
            "Use provider 'openai'."
        )

    hitl_config = PlutoDuckHITLConfig(conversation_id=conversation_id, run_id=run_id)
    default_agent_md = load_default_agent_prompt()
    middleware: list[AgentMiddleware] = [
        ApprovalPersistenceMiddleware(config=hitl_config, broker=broker),
        AgentMemoryMiddleware(conversation_id=conversation_id, default_user_agent_md=default_agent_md),
        SkillsMiddleware(conversation_id=conversation_id),
        *list(extra_middleware),
    ]

    system_prompt = get_runtime_system_prompt()

    # Get project_id from conversation for source isolation
    project_id = None
    try:
        conversation = repo.get_conversation(conversation_id)
        if conversation:
            project_id = conversation.project_id
    except Exception:
        pass  # Fallback to no project_id - source tools won't be available

    return create_deep_agent(
        model=chat_model,
        tools=list(tools) if tools is not None else build_default_tools(
            workspace_root=workspace_root,
            project_id=project_id,
        ),
        system_prompt=system_prompt,
        backend=backend,
        middleware=middleware,
        interrupt_on=None,
        checkpointer=checkpointer,
    )


