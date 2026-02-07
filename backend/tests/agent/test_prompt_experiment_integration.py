"""Integration tests for orchestrator prompt experiment propagation."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from pluto_duck_backend.agent.core import orchestrator
from pluto_duck_backend.agent.core.deep import agent as agent_module
from pluto_duck_backend.agent.core.deep.middleware.system_prompt_composer import (
    SystemPromptComposerMiddleware,
)
from pluto_duck_backend.app.core.config import get_settings


@dataclass
class _Conversation:
    project_id: str | None
    messages: list[dict[str, Any]]
    events: list[dict[str, Any]]


class _FakeChatRepo:
    def __init__(self) -> None:
        self._conversations: dict[str, _Conversation] = {}

    def get_conversation_summary(self, conversation_id: str):
        conv = self._conversations.get(conversation_id)
        if conv is None:
            return None
        return SimpleNamespace(project_id=conv.project_id)

    def create_conversation(
        self,
        conversation_id: str,
        _question: str,
        _metadata: dict[str, Any],
    ) -> None:
        self._conversations[conversation_id] = _Conversation(
            project_id=None,
            messages=[],
            events=[],
        )

    def append_message(
        self,
        conversation_id: str,
        role: str,
        content: dict[str, Any],
        *,
        run_id: str | None = None,
    ) -> None:
        _ = run_id
        self._conversations[conversation_id].messages.append(
            {"role": role, "content": content}
        )

    def get_conversation_messages(self, conversation_id: str) -> list[dict[str, Any]]:
        return list(self._conversations[conversation_id].messages)

    def set_active_run(self, _conversation_id: str, _run_id: str) -> None:
        return None

    def mark_run_started(
        self,
        _conversation_id: str,
        *,
        last_message_preview: str | None = None,
    ) -> None:
        _ = last_message_preview
        return None

    def log_event(self, conversation_id: str, payload: dict[str, Any]) -> None:
        self._conversations[conversation_id].events.append(payload)

    def mark_run_completed(
        self,
        _conversation_id: str,
        *,
        status: str,
        final_preview: str | None = None,
    ) -> None:
        _ = (status, final_preview)
        return None


def _set_data_root(tmp_path: Path, monkeypatch, *, env_profile: str | None) -> None:
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(tmp_path / "data-root"))
    if env_profile is None:
        monkeypatch.delenv("PLUTODUCK_AGENT__PROMPT_EXPERIMENT", raising=False)
    else:
        monkeypatch.setenv("PLUTODUCK_AGENT__PROMPT_EXPERIMENT", env_profile)
    get_settings.cache_clear()


def _patch_agent_builder(monkeypatch, captured_profiles: list[str]) -> None:
    class _FakeLLMService:
        def __init__(self, model_override: str | None = None) -> None:
            _ = model_override

        def get_chat_model(self, *, streaming: bool = False) -> object:
            _ = streaming
            return object()

    class _FakeAgent:
        async def ainvoke(self, _payload, config=None):
            _ = config
            return {"messages": [AIMessage(content="ok")]}

    def fake_create_deep_agent(**kwargs):
        middleware = kwargs.get("middleware", [])
        composer = middleware[-1]
        assert isinstance(composer, SystemPromptComposerMiddleware)
        captured_profiles.append(composer._profile.id)
        return _FakeAgent()

    monkeypatch.setattr(agent_module, "LLMService", _FakeLLMService)
    monkeypatch.setattr(agent_module, "build_default_tools", lambda **kwargs: [])
    monkeypatch.setattr(agent_module, "create_deep_agent", fake_create_deep_agent)


def _patch_cleanup_task(monkeypatch) -> None:
    real_create_task = orchestrator.asyncio.create_task

    def _create_task(coro):
        if getattr(coro, "cr_code", None) and coro.cr_code.co_name == "cleanup_run":
            task = asyncio.get_running_loop().create_future()
            task.set_result(None)
            coro.close()
            return task
        return real_create_task(coro)

    monkeypatch.setattr(orchestrator.asyncio, "create_task", _create_task)


@pytest.mark.asyncio
async def test_profile_switches_between_runs_with_same_conversation(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _set_data_root(tmp_path, monkeypatch, env_profile=None)
    fake_repo = _FakeChatRepo()
    captured_profiles: list[str] = []

    monkeypatch.setattr(orchestrator, "get_chat_repository", lambda: fake_repo)
    _patch_agent_builder(monkeypatch, captured_profiles)
    _patch_cleanup_task(monkeypatch)

    manager = orchestrator.AgentRunManager()
    conversation_id = "conv-integration"
    run_1 = manager.start_run_for_conversation(
        conversation_id,
        "first question",
        metadata={"_prompt_experiment": "v1"},
        create_if_missing=True,
    )
    await manager.get_result(run_1)

    run_2 = manager.start_run_for_conversation(
        conversation_id,
        "second question",
        metadata={"_prompt_experiment": "v2"},
        create_if_missing=False,
    )
    await manager.get_result(run_2)

    assert captured_profiles == ["v1", "v2"]


@pytest.mark.asyncio
async def test_env_profile_applies_when_metadata_missing(tmp_path: Path, monkeypatch) -> None:
    _set_data_root(tmp_path, monkeypatch, env_profile="v1")
    fake_repo = _FakeChatRepo()
    captured_profiles: list[str] = []

    monkeypatch.setattr(orchestrator, "get_chat_repository", lambda: fake_repo)
    _patch_agent_builder(monkeypatch, captured_profiles)
    _patch_cleanup_task(monkeypatch)

    manager = orchestrator.AgentRunManager()
    conversation_id = "conv-env"
    run_1 = manager.start_run_for_conversation(
        conversation_id,
        "first question",
        metadata={},
        create_if_missing=True,
    )
    await manager.get_result(run_1)

    run_2 = manager.start_run_for_conversation(
        conversation_id,
        "second question",
        metadata={},
        create_if_missing=False,
    )
    await manager.get_result(run_2)

    assert captured_profiles == ["v1", "v1"]
