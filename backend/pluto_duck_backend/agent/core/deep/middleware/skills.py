"""Backend version of deepagents-cli SkillsMiddleware.

Skills are stored under Pluto Duck data_dir and exposed via /skills/ virtual paths.
We use progressive disclosure:
- Inject name/description + SKILL.md path list into system prompt
- The agent reads full SKILL.md only when needed
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import NotRequired, TypedDict, cast

from langchain.agents.middleware.types import AgentMiddleware, AgentState, ModelRequest, ModelResponse

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.chat import get_chat_repository

from ..skills.load import SkillMetadata, list_skills


class SkillsState(AgentState):
    skills_metadata: NotRequired[list[SkillMetadata]]


class SkillsStateUpdate(TypedDict):
    skills_metadata: list[SkillMetadata]


SKILLS_SYSTEM_PROMPT = """

## Skills System

You have access to a skills library that provides specialized capabilities and domain knowledge.

{skills_locations}

**Available Skills:**

{skills_list}

**How to Use Skills (Progressive Disclosure):**

Skills follow a **progressive disclosure** pattern - you know they exist (name + description above), but you only read the full instructions when needed:

1. **Recognize when a skill applies**: Check if the user's task matches any skill's description
2. **Read the skill's full instructions**: The skill list above shows the exact path to use with read_file
3. **Follow the skill's instructions**: SKILL.md contains step-by-step workflows, best practices, and examples
4. **Access supporting files**: Skills may include scripts, configs, or reference docs in the skill directory

**When to Use Skills:**
- When the user's request matches a skill's domain
- When you need specialized knowledge or structured workflows
- When a skill provides proven patterns for complex tasks

**Skills are Self-Documenting:**
- Each SKILL.md tells you exactly what the skill does and how to use it
- The skill list above shows the full path for each skill's SKILL.md file

**Executing Skill Scripts:**
Skills may contain scripts or other executable files, but **script execution is not available in Pluto Duck backend mode**.
Treat skills as guidance/templates and follow the workflow using available tools.

**Example Workflow:**

User: "Can you analyze sales by region and create a summary?"

1. Check available skills above → See a relevant skill with its full path
2. Read the skill using the path shown in the list
3. Follow the skill's workflow (schema → SQL → validate → summarize)

Remember: Skills are tools to make you more capable and consistent. When in doubt, check if a skill exists for the task!
""".strip()


def _skills_root() -> Path:
    return get_settings().data_dir.root / "deepagents"


@dataclass(frozen=True)
class SkillsPaths:
    user_skills_dir: Path
    project_skills_dir: Path | None
    project_id: str | None


def resolve_skills_paths(conversation_id: str) -> SkillsPaths:
    repo = get_chat_repository()
    summary = repo.get_conversation_summary(conversation_id)
    project_id = getattr(summary, "project_id", None) if summary is not None else None
    user_dir = _skills_root() / "user" / "skills"
    project_dir = (_skills_root() / "projects" / str(project_id) / "skills") if project_id else None
    return SkillsPaths(user_skills_dir=user_dir, project_skills_dir=project_dir, project_id=project_id)


class SkillsMiddleware(AgentMiddleware):
    state_schema = SkillsState

    def __init__(self, *, conversation_id: str) -> None:
        self._conversation_id = conversation_id

    def before_agent(self, state: SkillsState, runtime) -> SkillsStateUpdate | None:  # type: ignore[override]
        paths = resolve_skills_paths(self._conversation_id)
        paths.user_skills_dir.mkdir(parents=True, exist_ok=True)
        if paths.project_skills_dir is not None:
            paths.project_skills_dir.mkdir(parents=True, exist_ok=True)
        skills = list_skills(user_skills_dir=paths.user_skills_dir, project_skills_dir=paths.project_skills_dir)
        return SkillsStateUpdate(skills_metadata=skills)

    def _format_skills_locations(self, paths: SkillsPaths) -> str:
        locs = ["**User Skills**: `/skills/user/skills/`"]
        if paths.project_id:
            locs.append(
                f"**Project Skills**: `/skills/projects/{paths.project_id}/skills/` (overrides user)"
            )
        return "\n".join(locs)

    def _format_skills_list(self, skills: list[SkillMetadata], project_id: str | None) -> str:
        if not skills:
            locations = ["/skills/user/skills/"]
            if project_id:
                locations.append(f"/skills/projects/{project_id}/skills/")
            return f"(No skills available yet. You can create skills in {' or '.join(locations)})"

        # Group skills by source (CLI parity)
        user_skills = [s for s in skills if s.get("source") == "user"]
        project_skills = [s for s in skills if s.get("source") == "project"]

        lines: list[str] = []
        deepagents_root = _skills_root().resolve()
        if user_skills:
            lines.append("**User Skills:**")
            for skill in sorted(user_skills, key=lambda s: s.get("name", "")):
                name = skill["name"]
                desc = skill["description"]

                virt_path = f"/skills/user/skills/{name}/SKILL.md"
                try:
                    real_path = Path(skill["path"]).resolve()
                    rel = real_path.relative_to(deepagents_root).as_posix()
                    virt_path = f"/skills/{rel}"
                except Exception:
                    pass

                lines.append(f"- **{name}**: {desc}")
                lines.append(f"  → Read `{virt_path}` for full instructions")
            lines.append("")

        if project_skills:
            lines.append("**Project Skills:**")
            for skill in sorted(project_skills, key=lambda s: s.get("name", "")):
                name = skill["name"]
                desc = skill["description"]

                virt_path = f"/skills/projects/{project_id}/skills/{name}/SKILL.md" if project_id else "/skills/"
                try:
                    real_path = Path(skill["path"]).resolve()
                    rel = real_path.relative_to(deepagents_root).as_posix()
                    virt_path = f"/skills/{rel}"
                except Exception:
                    pass

                lines.append(f"- **{name}**: {desc}")
                lines.append(f"  → Read `{virt_path}` for full instructions")

        return "\n".join(lines).rstrip()

    def wrap_model_call(self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]) -> ModelResponse:
        paths = resolve_skills_paths(self._conversation_id)
        state = cast("SkillsState", request.state)
        skills_metadata = state.get("skills_metadata", [])

        section = SKILLS_SYSTEM_PROMPT.format(
            skills_locations=self._format_skills_locations(paths),
            skills_list=self._format_skills_list(skills_metadata, paths.project_id),
        ).strip()

        system_prompt = (request.system_prompt + "\n\n" + section) if request.system_prompt else section
        return handler(request.override(system_prompt=system_prompt))

    async def awrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], Awaitable[ModelResponse]]
    ) -> ModelResponse:
        paths = resolve_skills_paths(self._conversation_id)
        state = cast("SkillsState", request.state)
        skills_metadata = state.get("skills_metadata", [])

        section = SKILLS_SYSTEM_PROMPT.format(
            skills_locations=self._format_skills_locations(paths),
            skills_list=self._format_skills_list(skills_metadata, paths.project_id),
        ).strip()

        system_prompt = (request.system_prompt + "\n\n" + section) if request.system_prompt else section
        return await handler(request.override(system_prompt=system_prompt))


