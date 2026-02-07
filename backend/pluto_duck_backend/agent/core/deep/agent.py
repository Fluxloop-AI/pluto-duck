"""Deep agent builder for Pluto Duck (Phase 1).

This module wires together:
- vendored `deepagents.create_deep_agent`
- PlutoDuckChatModel wrapper
- workspace-scoped filesystem backend (no execute)
- HITL persistence middleware (creates approval rows; actual resume wiring is Phase 3)
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

from deepagents import create_deep_agent
from deepagents.backends.composite import CompositeBackend
from deepagents.backends.filesystem import FilesystemBackend
from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.tools import BaseTool

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.llm import LLMService

from .context import RunContext, SessionContext
from .middleware.approvals import ApprovalPersistenceMiddleware, PlutoDuckHITLConfig
from .middleware.dataset_context import DatasetContextMiddleware
from .middleware.memory import AgentMemoryMiddleware
from .middleware.skills import SkillsMiddleware
from .middleware.system_prompt_composer import SystemPromptComposerMiddleware
from .middleware.user_profile import UserProfileMiddleware
from .prompt_experiment import load_experiment_profile
from .prompts import load_default_agent_prompt, load_prompt_bundle
from .tools import build_default_tools

logger = logging.getLogger("pluto_duck_backend.agent.deep")


def get_deepagents_root() -> Path:
    """Return root directory for backend memory/skills storage."""
    return get_settings().data_dir.root / "deepagents"


def build_deep_agent(
    *,
    session_ctx: SessionContext,
    run_ctx: RunContext,
    tools: Optional[Sequence[BaseTool | Callable[..., Any] | dict[str, Any]]] = None,
    extra_middleware: Sequence[AgentMiddleware] = (),
    checkpointer: Any = None,
) -> Any:
    """Create a deep agent runnable (CompiledStateGraph).

    Notes:
    - We always pass an explicit model instance to avoid relying on vendored defaults.
    - Filesystem backend is workspace-scoped and does not support `execute` by design.
    - `checkpointer` is accepted for Phase 1 plumbing.
      A DB-backed implementation is added separately.
    """
    workspace_root = session_ctx.workspace_root

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
    # Use unified LLMService for provider-agnostic model access.
    llm_service = LLMService(model_override=run_ctx.model)
    chat_model = llm_service.get_chat_model(streaming=True)

    hitl_config = PlutoDuckHITLConfig(
        conversation_id=session_ctx.conversation_id,
        run_id=run_ctx.run_id,
    )
    settings = get_settings()
    profile = load_experiment_profile(session_ctx.experiment_profile_id)
    required_static_blocks = tuple(
        block
        for block in profile.compose_order
        if block in {"runtime", "skills_guide", "base_agent_prompt"}
    )
    prompt_bundle = load_prompt_bundle(profile, required_keys=required_static_blocks)
    for block in required_static_blocks:
        block_text = (prompt_bundle.get(block) or "").strip()
        if block_text:
            continue
        raise ValueError(
            f"Prompt profile '{profile.id}' does not provide a non-empty '{block}' bundle"
        )
    runtime_system_prompt = prompt_bundle["runtime"].strip()
    memory_guide_template = prompt_bundle.get("memory_guide")
    memory_guide_template_path = profile.prompt_bundle.get("memory_guide")
    memory_guide_template_strict = settings.agent.memory_guide_template_strict

    default_agent_md = load_default_agent_prompt()
    middleware: list[AgentMiddleware] = [
        ApprovalPersistenceMiddleware(config=hitl_config, broker=run_ctx.broker),
        AgentMemoryMiddleware(
            project_id=session_ctx.project_id,
            default_user_agent_md=default_agent_md,
        ),
        DatasetContextMiddleware(project_id=session_ctx.project_id),
        SkillsMiddleware(project_id=session_ctx.project_id),
        UserProfileMiddleware(),
        *list(extra_middleware),
        SystemPromptComposerMiddleware(
            project_id=session_ctx.project_id,
            profile=profile,
            static_blocks=prompt_bundle,
            memory_guide_template=memory_guide_template,
            memory_guide_template_path=memory_guide_template_path,
            memory_guide_template_strict=memory_guide_template_strict,
        ),
    ]

    return create_deep_agent(
        model=chat_model,
        tools=list(tools) if tools is not None else build_default_tools(
            workspace_root=workspace_root,
            project_id=session_ctx.project_id,
        ),
        system_prompt=runtime_system_prompt,
        backend=backend,
        middleware=middleware,
        interrupt_on=None,
        checkpointer=checkpointer,
    )
