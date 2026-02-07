"""Backend version of deepagents-cli SkillsMiddleware.

Skills are stored under Pluto Duck data_dir and exposed via /skills/ virtual paths.
We use progressive disclosure:
- Inject name/description + SKILL.md path list into system prompt
- The agent reads full SKILL.md only when needed
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import NotRequired, TypedDict

from langchain.agents.middleware.types import AgentMiddleware, AgentState

from pluto_duck_backend.app.core.config import get_settings

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

def format_skills_locations(paths: SkillsPaths) -> str:
    locs = ["**User Skills**: `/skills/user/skills/`"]
    if paths.project_id:
        locs.append(
            f"**Project Skills**: `/skills/projects/{paths.project_id}/skills/` (overrides user)"
        )
    return "\n".join(locs)

def format_skills_list(skills: list[SkillMetadata], project_id: str | None) -> str:
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

def build_skills_section(*, skills_metadata: list[SkillMetadata], project_id: str | None) -> str:
    paths = resolve_skills_paths(project_id)
    return SKILLS_SYSTEM_PROMPT.format(
        skills_locations=format_skills_locations(paths),
        skills_list=format_skills_list(skills_metadata, paths.project_id),
    ).strip()


def build_skills_list_block(*, skills_metadata: list[SkillMetadata], project_id: str | None) -> str:
    paths = resolve_skills_paths(project_id)
    return (
        f"{format_skills_locations(paths)}\n\n"
        "**Available Skills:**\n\n"
        f"{format_skills_list(skills_metadata, paths.project_id)}"
    ).strip()


@dataclass(frozen=True)
class SkillsPaths:
    user_skills_dir: Path
    project_skills_dir: Path | None
    project_id: str | None


def resolve_skills_paths(project_id: str | None) -> SkillsPaths:
    user_dir = _skills_root() / "user" / "skills"
    project_dir = (_skills_root() / "projects" / str(project_id) / "skills") if project_id else None
    return SkillsPaths(user_skills_dir=user_dir, project_skills_dir=project_dir, project_id=project_id)


class SkillsMiddleware(AgentMiddleware):
    state_schema = SkillsState

    def __init__(self, *, project_id: str | None) -> None:
        self._project_id = project_id

    def before_agent(self, state: SkillsState, runtime) -> SkillsStateUpdate | None:  # type: ignore[override]
        import time
        start = time.perf_counter()

        paths = resolve_skills_paths(self._project_id)
        paths.user_skills_dir.mkdir(parents=True, exist_ok=True)
        if paths.project_skills_dir is not None:
            paths.project_skills_dir.mkdir(parents=True, exist_ok=True)
        skills = list_skills(user_skills_dir=paths.user_skills_dir, project_skills_dir=paths.project_skills_dir)

        elapsed_ms = (time.perf_counter() - start) * 1000
        print(f"[TIMING] SkillsMiddleware.before_agent: {elapsed_ms:.3f}ms", flush=True)
        return SkillsStateUpdate(skills_metadata=skills)
