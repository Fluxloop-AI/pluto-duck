"""Tests for LLM usage extraction in event mapper."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pluto_duck_backend.agent.core.deep.event_mapper import EventSink, PlutoDuckEventCallbackHandler


@pytest.mark.asyncio
async def test_llm_usage_emits_cached_tokens() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-1",
        conversation_id="conv-1",
        experiment_profile="v1",
    )

    response = SimpleNamespace(
        llm_output={
            "model_name": "gpt-4o",
            "token_usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
                "prompt_tokens_details": {"cached_tokens": 4},
            },
        },
        generations=[],
    )

    await handler.on_llm_end(response)

    usage_event = next(event for event in events if event.content.get("phase") == "llm_usage")

    assert usage_event.content["usage"]["cached_prompt_tokens"] == 4
    assert usage_event.content["usage"]["prompt_tokens"] == 10
    assert usage_event.content["model"] == "gpt-4o"
    assert usage_event.metadata["conversation_id"] == "conv-1"
    assert usage_event.metadata["experiment_profile"] == "v1"


@pytest.mark.asyncio
async def test_llm_usage_emits_nulls_when_missing() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-2",
        conversation_id="conv-2",
        experiment_profile="v2",
    )

    response = SimpleNamespace(
        llm_output={},
        generations=[],
    )

    await handler.on_llm_end(response)

    usage_event = next(event for event in events if event.content.get("phase") == "llm_usage")

    assert usage_event.content["usage"]["prompt_tokens"] is None
    assert usage_event.content["usage"]["completion_tokens"] is None
    assert usage_event.content["usage"]["total_tokens"] is None
