"""Tests for structured reasoning extraction in event mapper."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pluto_duck_backend.agent.core.deep.event_mapper import EventSink, PlutoDuckEventCallbackHandler


@pytest.mark.asyncio
async def test_llm_end_emits_reasoning_summary_from_structured_content() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-structured",
    )

    response = SimpleNamespace(
        llm_output={},
        generations=[
            [
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=[
                            {
                                "type": "reasoning",
                                "summary": [
                                    {"type": "summary_text", "text": "First rationale"},
                                    {"type": "summary_text", "text": "Second rationale"},
                                ],
                            },
                            {"type": "output_text", "text": "Final answer"},
                        ]
                    )
                )
            ]
        ],
    )

    await handler.on_llm_end(response)

    reasoning_event = next(
        event for event in events if event.content.get("phase") == "llm_reasoning"
    )
    llm_end_event = next(event for event in events if event.content.get("phase") == "llm_end")

    assert reasoning_event.content["reason"] == "First rationale\n\nSecond rationale"
    assert llm_end_event.content["text"] == "Final answer"


@pytest.mark.asyncio
async def test_llm_end_keeps_string_fallback_without_reasoning_event() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-string",
    )

    response = SimpleNamespace(
        llm_output={},
        generations=[[SimpleNamespace(message=SimpleNamespace(content="Plain response"))]],
    )

    await handler.on_llm_end(response)

    llm_end_event = next(event for event in events if event.content.get("phase") == "llm_end")
    reasoning_events = [event for event in events if event.content.get("phase") == "llm_reasoning"]

    assert llm_end_event.content["text"] == "Plain response"
    assert reasoning_events == []
