"""Tests for LLM streaming chunk emission."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pluto_duck_backend.agent.core.deep.event_mapper import EventSink, PlutoDuckEventCallbackHandler
from pluto_duck_backend.agent.core.events import EventSubType, EventType


@pytest.mark.asyncio
async def test_emits_chunk_on_token_threshold() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-1",
        conversation_id="conv-1",
        experiment_profile="v1",
    )
    handler._max_chunk_tokens = 2
    handler._flush_interval_s = 999

    await handler.on_llm_new_token("Hi")
    await handler.on_llm_new_token("!")

    chunk_events = [event for event in events if event.type == EventType.MESSAGE]

    assert len(chunk_events) == 1
    assert chunk_events[0].subtype == EventSubType.CHUNK
    assert chunk_events[0].content["text_delta"] == "Hi!"
    assert chunk_events[0].content["is_final"] is False
    assert chunk_events[0].metadata["run_id"] == "run-1"
    assert chunk_events[0].metadata["conversation_id"] == "conv-1"
    assert chunk_events[0].metadata["experiment_profile"] == "v1"


@pytest.mark.asyncio
async def test_emits_final_chunk_on_llm_end() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-2",
        conversation_id="conv-2",
    )
    handler._max_chunk_tokens = 100
    handler._max_buffer_chars = 3
    handler._flush_interval_s = 999

    await handler.on_llm_new_token("ab")
    await handler.on_llm_new_token("cd")

    response = SimpleNamespace(llm_output={}, generations=[])
    await handler.on_llm_new_token("e")
    await handler.on_llm_end(response)

    chunk_events = [event for event in events if event.type == EventType.MESSAGE]

    assert chunk_events[0].content["text_delta"] == "abcd"
    assert chunk_events[0].content["is_final"] is False
    assert chunk_events[-1].content["text_delta"] == "e"
    assert chunk_events[-1].content["is_final"] is True


@pytest.mark.asyncio
async def test_handles_structured_token_chunks_without_type_error() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-3",
    )
    handler._max_chunk_tokens = 2
    handler._flush_interval_s = 999

    await handler.on_llm_new_token([{"type": "text", "text": "안녕"}])
    await handler.on_llm_new_token(
        [{"type": "reasoning", "summary": []}, {"type": "text", "text": "하세요"}]
    )

    chunk_events = [event for event in events if event.type == EventType.MESSAGE]

    assert len(chunk_events) == 1
    assert chunk_events[0].content["text_delta"] == "안녕하세요"
