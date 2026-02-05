"""Backend version of deepagents-cli AgentMemoryMiddleware.

We store memory under Pluto Duck data_dir (not git project roots):
- User memory:    {data_dir.root}/deepagents/user/agent.md
- Project memory: {data_dir.root}/deepagents/projects/{project_id}/agent.md

We inject memory into the system prompt and encourage a "memory-first" workflow
using virtual paths exposed by filesystem backend routes:
- /memories/user/agent.md
- /memories/projects/{project_id}/agent.md
"""

from __future__ import annotations

import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import NotRequired, TypedDict, cast

from langchain.agents.middleware.types import AgentMiddleware, AgentState, ModelRequest, ModelResponse

from pluto_duck_backend.app.core.config import get_settings


class AgentMemoryState(AgentState):
    user_memory: NotRequired[str]
    project_memory: NotRequired[str]


class AgentMemoryStateUpdate(TypedDict):
    user_memory: NotRequired[str]
    project_memory: NotRequired[str]


LONGTERM_MEMORY_SYSTEM_PROMPT = """

## Long-term Memory

Your long-term memory is stored in files on the filesystem and persists across sessions.

**User Memory Location**: `{agent_dir_absolute}` (displays as `{agent_dir_display}`)
**Project Memory Location**: {project_memory_info}

Your system prompt is loaded from TWO sources at startup:
1. **User agent.md**: `{agent_dir_absolute}/agent.md` - Your personal preferences across all projects
2. **Project agent.md**: Loaded from the active Pluto Duck project (if any) - Project-specific instructions

Project-specific agent.md is loaded from this location:
- `{project_deepagents_dir}/agent.md`

**When to CHECK/READ memories (CRITICAL - do this FIRST):**
- **At the start of ANY new session**: Check both user and project memories
  - User: `ls {agent_dir_absolute}`
  - Project: `ls {project_deepagents_dir}` (if in a project)
- **BEFORE answering questions**: If asked "what do you know about X?" or "how do I do Y?", check project memories FIRST, then user
- **When user asks you to do something**: Check if you have project-specific guides or examples
- **When user references past work**: Search project memory files for related context

**Memory-first response pattern:**
1. User asks a question → Check project directory first: `ls {project_deepagents_dir}`
2. If relevant files exist → Read them with `read_file '{project_deepagents_dir}/[filename]'`
3. Check user memory if needed → `ls {agent_dir_absolute}`
4. Base your answer on saved knowledge supplemented by general knowledge

**When to update memories:**
- **IMMEDIATELY when the user describes your role or how you should behave**
- **IMMEDIATELY when the user gives feedback on your work** - Update memories to capture what was wrong and how to do it better
- When the user explicitly asks you to remember something
- When patterns or preferences emerge (workflows, conventions)
- After significant work where context would help in future sessions

**Learning from feedback:**
- When user says something is better/worse, capture WHY and encode it as a pattern
- Each correction is a chance to improve permanently - don't just fix the immediate issue, update your instructions
- When user says "you should remember X" or "be careful about Y", treat this as HIGH PRIORITY - update memories IMMEDIATELY
- Look for the underlying principle behind corrections, not just the specific mistake

## Deciding Where to Store Memory

When writing or updating agent memory, decide whether each fact, configuration, or behavior belongs in:

### User Agent File: `{agent_dir_absolute}/agent.md`
→ Describes the agent's **personality, style, and universal behavior** across all projects.

**Store here:**
- General tone and communication style
- Universal workflows and methodologies you follow
- Tool usage patterns that apply everywhere
- Preferences that don't change per-project

### Project Agent File: `{project_deepagents_dir}/agent.md`
→ Describes **how this specific Pluto Duck project works** and **how the agent should behave here only.**

**Store here:**
- Project-specific architecture and conventions
- Important tables / naming conventions
- How data sources and pipelines are configured for this project
- Reproducible analysis conventions for this project

### Project Memory Files: `{project_deepagents_dir}/*.md`
→ Use for **project-specific reference information** and structured notes.

**Store here:**
- API design notes, architecture decisions, runbooks
- Common debugging patterns
- Onboarding info for this project

### File Operations (virtual paths)

**User memory:**
```
ls {agent_dir_absolute}
read_file '{agent_dir_absolute}/agent.md'
edit_file '{agent_dir_absolute}/agent.md' ...
```

**Project memory (preferred for project-specific information):**
```
ls {project_deepagents_dir}
read_file '{project_deepagents_dir}/agent.md'
edit_file '{project_deepagents_dir}/agent.md' ...
write_file '{project_deepagents_dir}/agent.md' ...
```

**Important**:
- Memory files are exposed under `/memories/` (virtual filesystem)
- Updating memory requires HITL approval (file edit/write)
""".strip()


DEFAULT_MEMORY_SNIPPET = """<user_memory>
{user_memory}
</user_memory>

<project_memory>
{project_memory}
</project_memory>"""


def _memory_root() -> Path:
    return get_settings().data_dir.root / "deepagents"


def _user_agent_md_path() -> Path:
    return _memory_root() / "user" / "agent.md"


def _project_agent_md_path(project_id: str) -> Path:
    return _memory_root() / "projects" / str(project_id) / "agent.md"


def _ensure_file(path: Path, *, default_content: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(default_content, encoding="utf-8")


@dataclass(frozen=True)
class MemoryPaths:
    user_agent_md: Path
    project_agent_md: Path | None
    project_id: str | None


def resolve_memory_paths(project_id: str | None) -> MemoryPaths:
    user_path = _user_agent_md_path()
    project_path = _project_agent_md_path(project_id) if project_id else None
    return MemoryPaths(user_agent_md=user_path, project_agent_md=project_path, project_id=project_id)


class AgentMemoryMiddleware(AgentMiddleware):
    state_schema = AgentMemoryState

    def __init__(self, *, project_id: str | None, default_user_agent_md: str) -> None:
        self._project_id = project_id
        self._default_user_agent_md = default_user_agent_md
        self.system_prompt_template = DEFAULT_MEMORY_SNIPPET

    def before_agent(self, state: AgentMemoryState, runtime) -> AgentMemoryStateUpdate:  # type: ignore[override]
        import time
        start = time.perf_counter()

        paths = resolve_memory_paths(self._project_id)

        # Ensure files exist (empty by default except user agent.md seeded with default prompt)
        _ensure_file(paths.user_agent_md, default_content=self._default_user_agent_md)
        if paths.project_agent_md is not None:
            _ensure_file(paths.project_agent_md, default_content="")

        update: AgentMemoryStateUpdate = {}
        # Reload every turn to pick up edits made during the conversation (CLI parity).
        if paths.user_agent_md.exists():
            with contextlib.suppress(OSError, UnicodeDecodeError):
                update["user_memory"] = paths.user_agent_md.read_text(encoding="utf-8")
        if paths.project_agent_md and paths.project_agent_md.exists():
            with contextlib.suppress(OSError, UnicodeDecodeError):
                update["project_memory"] = paths.project_agent_md.read_text(encoding="utf-8")

        elapsed_ms = (time.perf_counter() - start) * 1000
        print(f"[TIMING] AgentMemoryMiddleware.before_agent: {elapsed_ms:.3f}ms", flush=True)
        return update

    def _build_system_prompt(self, request: ModelRequest) -> str:
        state = cast("AgentMemoryState", request.state)
        user_memory = state.get("user_memory") or ""
        project_memory = state.get("project_memory") or ""

        # Decide displayed locations (virtual)
        paths = resolve_memory_paths(self._project_id)
        agent_dir_display = "/memories/user"
        agent_dir_absolute = "/memories/user"
        project_deepagents_dir = (
            f"/memories/projects/{paths.project_id}" if paths.project_id else "/memories/projects/(none)"
        )

        if paths.project_id and project_memory.strip():
            project_memory_info = f"`{project_deepagents_dir}` (detected)"
        elif paths.project_id:
            project_memory_info = f"`{project_deepagents_dir}` (no agent.md found yet)"
        else:
            project_memory_info = "None (conversation not linked to a project)"

        memory_section = self.system_prompt_template.format(
            user_memory=user_memory.strip(),
            project_memory=project_memory.strip(),
        ).strip()

        system_prompt = memory_section
        if request.system_prompt:
            system_prompt += "\n\n" + request.system_prompt

        system_prompt += "\n\n" + LONGTERM_MEMORY_SYSTEM_PROMPT.format(
            agent_dir_absolute=agent_dir_absolute,
            agent_dir_display=agent_dir_display,
            project_memory_info=project_memory_info,
            project_deepagents_dir=project_deepagents_dir,
        )
        return system_prompt

    def wrap_model_call(self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]) -> ModelResponse:
        import time
        start = time.perf_counter()
        system_prompt = self._build_system_prompt(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        print(f"[TIMING] AgentMemoryMiddleware._build_system_prompt: {elapsed_ms:.3f}ms", flush=True)
        return handler(request.override(system_prompt=system_prompt))

    async def awrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], Awaitable[ModelResponse]]
    ) -> ModelResponse:
        import time
        start = time.perf_counter()
        system_prompt = self._build_system_prompt(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        print(f"[TIMING] AgentMemoryMiddleware._build_system_prompt (async): {elapsed_ms:.3f}ms | prompt_len={len(system_prompt)} chars", flush=True)
        return await handler(request.override(system_prompt=system_prompt))

