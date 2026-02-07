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


def _set_data_root(
    tmp_path: Path,
    monkeypatch,
    *,
    env_profile: str | None,
    strict_memory_guide: bool | None = None,
) -> None:
    monkeypatch.setenv("PLUTODUCK_DATA_DIR__ROOT", str(tmp_path / "data-root"))
    if env_profile is None:
        monkeypatch.delenv("PLUTODUCK_AGENT__PROMPT_EXPERIMENT", raising=False)
    else:
        monkeypatch.setenv("PLUTODUCK_AGENT__PROMPT_EXPERIMENT", env_profile)
    if strict_memory_guide is None:
        monkeypatch.delenv("PLUTODUCK_AGENT__MEMORY_GUIDE_TEMPLATE_STRICT", raising=False)
    else:
        monkeypatch.setenv(
            "PLUTODUCK_AGENT__MEMORY_GUIDE_TEMPLATE_STRICT",
            "true" if strict_memory_guide else "false",
        )
    get_settings.cache_clear()


def _patch_agent_builder(
    monkeypatch,
    captured_profiles: list[str],
    captured_skills_guides: list[str] | None = None,
    captured_base_agent_prompts: list[str] | None = None,
    captured_memory_guides: list[str] | None = None,
    captured_memory_guide_strict_flags: list[bool] | None = None,
) -> None:
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
        if captured_skills_guides is not None:
            captured_skills_guides.append(
                str(composer._static_blocks.get("skills_guide") or "")
            )
        if captured_base_agent_prompts is not None:
            captured_base_agent_prompts.append(
                str(composer._static_blocks.get("base_agent_prompt") or "")
            )
        if captured_memory_guides is not None:
            captured_memory_guides.append(str(composer._memory_guide_template or ""))
        if captured_memory_guide_strict_flags is not None:
            captured_memory_guide_strict_flags.append(composer._memory_guide_template_strict)
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


@pytest.mark.asyncio
async def test_profile_switches_base_and_override_skills_guide_with_same_conversation(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _set_data_root(tmp_path, monkeypatch, env_profile=None)
    fake_repo = _FakeChatRepo()
    captured_profiles: list[str] = []
    captured_skills_guides: list[str] = []

    monkeypatch.setattr(orchestrator, "get_chat_repository", lambda: fake_repo)
    _patch_agent_builder(monkeypatch, captured_profiles, captured_skills_guides)
    _patch_cleanup_task(monkeypatch)

    manager = orchestrator.AgentRunManager()
    conversation_id = "conv-integration-override"
    run_1 = manager.start_run_for_conversation(
        conversation_id,
        "first question",
        metadata={"_prompt_experiment": "v2"},
        create_if_missing=True,
    )
    await manager.get_result(run_1)

    run_2 = manager.start_run_for_conversation(
        conversation_id,
        "second question",
        metadata={"_prompt_experiment": "v2-strong-skills-guide"},
        create_if_missing=False,
    )
    await manager.get_result(run_2)

    assert captured_profiles == ["v2", "v2-strong-skills-guide"]
    assert len(captured_skills_guides) == 2
    assert captured_skills_guides[0] != captured_skills_guides[1]
    assert "skill-guided execution is the default" in captured_skills_guides[1].lower()


@pytest.mark.asyncio
async def test_profile_switches_memory_guide_template_between_v1_and_v2(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _set_data_root(tmp_path, monkeypatch, env_profile=None)
    fake_repo = _FakeChatRepo()
    captured_profiles: list[str] = []
    captured_memory_guides: list[str] = []

    monkeypatch.setattr(orchestrator, "get_chat_repository", lambda: fake_repo)
    _patch_agent_builder(
        monkeypatch,
        captured_profiles,
        captured_memory_guides=captured_memory_guides,
    )
    _patch_cleanup_task(monkeypatch)

    manager = orchestrator.AgentRunManager()
    conversation_id = "conv-memory-guide-template"
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
    assert len(captured_memory_guides) == 2
    assert captured_memory_guides[0] != captured_memory_guides[1]
    assert "Prompt Profile: v1" in captured_memory_guides[0]
    assert "Prompt Profile: v2" in captured_memory_guides[1]


@pytest.mark.asyncio
async def test_v3_profile_passes_base_agent_prompt_to_composer(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _set_data_root(tmp_path, monkeypatch, env_profile=None)
    fake_repo = _FakeChatRepo()
    captured_profiles: list[str] = []
    captured_base_agent_prompts: list[str] = []

    monkeypatch.setattr(orchestrator, "get_chat_repository", lambda: fake_repo)
    _patch_agent_builder(
        monkeypatch,
        captured_profiles,
        captured_base_agent_prompts=captured_base_agent_prompts,
    )
    _patch_cleanup_task(monkeypatch)

    manager = orchestrator.AgentRunManager()
    conversation_id = "conv-v3-base-agent-prompt"
    run_id = manager.start_run_for_conversation(
        conversation_id,
        "question",
        metadata={"_prompt_experiment": "v3"},
        create_if_missing=True,
    )
    await manager.get_result(run_id)

    assert captured_profiles == ["v3"]
    assert len(captured_base_agent_prompts) == 1
    assert "core role" in captured_base_agent_prompts[0].lower()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("strict_memory_guide", "expected"),
    [
        (False, False),
        (True, True),
    ],
)
async def test_memory_guide_strict_env_flag_propagates_to_composer(
    tmp_path: Path,
    monkeypatch,
    strict_memory_guide: bool,
    expected: bool,
) -> None:
    _set_data_root(
        tmp_path,
        monkeypatch,
        env_profile="v2",
        strict_memory_guide=strict_memory_guide,
    )
    fake_repo = _FakeChatRepo()
    captured_profiles: list[str] = []
    captured_strict_flags: list[bool] = []

    monkeypatch.setattr(orchestrator, "get_chat_repository", lambda: fake_repo)
    _patch_agent_builder(
        monkeypatch,
        captured_profiles,
        captured_memory_guide_strict_flags=captured_strict_flags,
    )
    _patch_cleanup_task(monkeypatch)

    manager = orchestrator.AgentRunManager()
    conversation_id = f"conv-memory-guide-strict-{expected}"
    run_id = manager.start_run_for_conversation(
        conversation_id,
        "question",
        metadata={},
        create_if_missing=True,
    )
    await manager.get_result(run_id)

    assert captured_profiles == ["v2"]
    assert captured_strict_flags == [expected]
