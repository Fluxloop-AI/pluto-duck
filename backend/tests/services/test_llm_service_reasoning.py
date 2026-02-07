from __future__ import annotations

from types import SimpleNamespace

from pluto_duck_backend.app.services.llm.service import LLMService
from pluto_duck_backend.app.services.llm.settings import LLMSettings


def test_get_chat_model_includes_reasoning_kwargs_for_gpt5(monkeypatch) -> None:
    monkeypatch.setattr(
        LLMSettings,
        "from_config",
        classmethod(
            lambda cls: LLMSettings(
                provider="openai",
                model="gpt-5-mini",
                api_key="sk-test",
                api_base=None,
                reasoning_effort="high",
                text_verbosity="medium",
                max_output_tokens=2222,
            )
        ),
    )

    captured: dict[str, object] = {}

    def _fake_chat_openai(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr("langchain_openai.ChatOpenAI", _fake_chat_openai)

    service = LLMService()
    _ = service.get_chat_model(streaming=True)

    assert captured["model"] == "gpt-5-mini"
    assert captured["streaming"] is True
    assert captured["reasoning"] == {"effort": "high", "summary": "auto"}
    assert captured["output_version"] == "responses/v1"
    assert captured["max_output_tokens"] == 2222


def test_get_chat_model_excludes_reasoning_kwargs_for_non_gpt5(monkeypatch) -> None:
    monkeypatch.setattr(
        LLMSettings,
        "from_config",
        classmethod(
            lambda cls: LLMSettings(
                provider="openai",
                model="local:llama3.1",
                api_key="sk-test",
                api_base=None,
                reasoning_effort="low",
                text_verbosity="low",
                max_output_tokens=999,
            )
        ),
    )

    captured: dict[str, object] = {}

    def _fake_chat_openai(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(**kwargs)

    monkeypatch.setattr("langchain_openai.ChatOpenAI", _fake_chat_openai)

    service = LLMService()
    _ = service.get_chat_model(streaming=False)

    assert captured["model"] == "local:llama3.1"
    assert captured["streaming"] is False
    assert "reasoning" not in captured
    assert "output_version" not in captured
    assert "max_output_tokens" not in captured
