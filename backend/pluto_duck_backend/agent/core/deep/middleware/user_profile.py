"""User profile middleware for Pluto Duck deep agent."""

from __future__ import annotations

from typing import NotRequired, Optional, TypedDict

from langchain.agents.middleware.types import AgentMiddleware, AgentState

from pluto_duck_backend.app.services.chat import get_chat_repository


USER_PROFILE_PROMPT = """
<user_profile>
{profile_lines}
</user_profile>

<assistant_style>
Respond in {language_label}.
</assistant_style>
""".strip()

LANGUAGE_LABELS = {
    "en": "English",
    "ko": "Korean",
}


class UserProfileState(AgentState):
    user_profile_section: NotRequired[str]


class UserProfileStateUpdate(TypedDict):
    user_profile_section: str


def _normalize_user_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def _normalize_language(value: Optional[str]) -> str:
    if not value:
        return "en"
    trimmed = value.strip().lower()
    return trimmed if trimmed in LANGUAGE_LABELS else "en"


class UserProfileMiddleware(AgentMiddleware):
    state_schema = UserProfileState

    def __init__(self) -> None:
        pass

    def _build_section(self) -> Optional[str]:
        repo = get_chat_repository()
        settings = repo.get_settings()
        user_name = _normalize_user_name(settings.get("user_name"))
        language = _normalize_language(settings.get("language"))
        profile_lines = []
        if user_name:
            profile_lines.append(f"name: {user_name}")
        profile_lines.append(f"language: {language}")
        return USER_PROFILE_PROMPT.format(
            profile_lines="\n".join(profile_lines),
            language_label=LANGUAGE_LABELS[language],
        )

    def before_agent(self, state: UserProfileState, runtime) -> UserProfileStateUpdate | None:  # type: ignore[override]
        section = self._build_section()
        if not section:
            return None
        return UserProfileStateUpdate(user_profile_section=section)
