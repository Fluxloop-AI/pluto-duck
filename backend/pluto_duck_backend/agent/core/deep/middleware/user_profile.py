"""User profile middleware for Pluto Duck deep agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Optional

from langchain.agents.middleware.types import AgentMiddleware, ModelRequest, ModelResponse

from pluto_duck_backend.app.services.chat import get_chat_repository


USER_PROFILE_PROMPT = """
<user_profile>
name: {user_name}
</user_profile>
""".strip()


def _normalize_user_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


class UserProfileMiddleware(AgentMiddleware):
    def __init__(self) -> None:
        pass

    def _build_section(self) -> Optional[str]:
        repo = get_chat_repository()
        settings = repo.get_settings()
        user_name = _normalize_user_name(settings.get("user_name"))
        if not user_name:
            return None
        return USER_PROFILE_PROMPT.format(user_name=user_name)

    def wrap_model_call(self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]) -> ModelResponse:
        section = self._build_section()
        if not section:
            return handler(request)
        system_prompt = section
        if request.system_prompt:
            system_prompt = section + "\n\n" + request.system_prompt
        return handler(request.override(system_prompt=system_prompt))

    async def awrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], Awaitable[ModelResponse]]
    ) -> ModelResponse:
        section = self._build_section()
        if not section:
            return await handler(request)
        system_prompt = section
        if request.system_prompt:
            system_prompt = section + "\n\n" + request.system_prompt
        return await handler(request.override(system_prompt=system_prompt))
