from __future__ import annotations

from types import SimpleNamespace

import pytest
from pluto_duck_backend.app.services.llm.service import LLMService
from pluto_duck_backend.app.services.llm.settings import LLMSettings


class _FakeChatRepository:
    def __init__(self, settings: dict[str, object]) -> None:
        self._settings = settings

    def get_settings(self) -> dict[str, object]:
        return self._settings


def _patch_config_sources(
    monkeypatch,
    *,
    db_settings: dict[str, object],
    provider: str = "openai",
    model: str | None = "gpt-5-mini",
    api_key: str | None = "sk-agent-key",
    api_base: str | None = None,
    reasoning_effort: str | None = "high",
    text_verbosity: str | None = "low",
    max_output_tokens: int | None = 2048,
) -> None:
    from pluto_duck_backend.app.core import config as config_module
    from pluto_duck_backend.app.services import chat as chat_module

    agent = SimpleNamespace(
        provider=provider,
        model=model,
        api_key=api_key,
        api_base=api_base,
        reasoning_effort=reasoning_effort,
        text_verbosity=text_verbosity,
        max_output_tokens=max_output_tokens,
    )
    settings = SimpleNamespace(agent=agent)

    monkeypatch.setattr(config_module, "get_settings", lambda: settings)
    monkeypatch.setattr(
        chat_module,
        "get_chat_repository",
        lambda: _FakeChatRepository(db_settings),
    )


def test_llm_settings_from_config_maps_agent_reasoning_fields(monkeypatch) -> None:
    _patch_config_sources(
        monkeypatch,
        db_settings={"llm_provider": "OPENAI", "llm_model": "gpt-5"},
        reasoning_effort="minimal",
        text_verbosity="high",
        max_output_tokens=777,
    )

    resolved = LLMSettings.from_config()

    assert resolved.provider == "openai"
    assert resolved.model == "gpt-5"
    assert resolved.reasoning_effort == "minimal"
    assert resolved.text_verbosity == "high"
    assert resolved.max_output_tokens == 777


def test_llm_settings_from_config_uses_gpt5_mini_default_when_model_missing(monkeypatch) -> None:
    _patch_config_sources(
        monkeypatch,
        db_settings={},
        model=None,
    )

    resolved = LLMSettings.from_config()

    assert resolved.model == "gpt-5-mini"


@pytest.mark.parametrize("legacy_model", ["gpt-4o", "gpt-4o-mini"])
def test_llm_settings_from_config_normalizes_legacy_models(
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
    legacy_model: str,
) -> None:
    _patch_config_sources(
        monkeypatch,
        db_settings={"llm_model": legacy_model},
    )
    caplog.set_level("WARNING")

    resolved = LLMSettings.from_config()

    assert resolved.model == "gpt-5-mini"
    assert "Unsupported llm_model" in caplog.text
    assert legacy_model in caplog.text


def test_llm_service_model_override_preserves_reasoning_fields(monkeypatch) -> None:
    monkeypatch.setattr(
        LLMSettings,
        "from_config",
        classmethod(
            lambda cls: LLMSettings(
                provider="openai",
                model="gpt-5-mini",
                api_key="sk-test",
                api_base=None,
                reasoning_effort="low",
                text_verbosity="medium",
                max_output_tokens=1234,
            )
        ),
    )

    service = LLMService(model_override="gpt-5")
    resolved = service._resolve_settings()

    assert resolved.model == "gpt-5"
    assert resolved.reasoning_effort == "low"
    assert resolved.text_verbosity == "medium"
    assert resolved.max_output_tokens == 1234
