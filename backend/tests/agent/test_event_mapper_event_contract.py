"""Tests for canonical event contract fields in event mapper."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pluto_duck_backend.agent.core.deep.event_mapper import (
    EventSink,
    PlutoDuckEventCallbackHandler,
)


@pytest.mark.asyncio
async def test_event_mapper_emits_canonical_metadata_fields() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-contract",
        conversation_id="conv-contract",
        experiment_profile="v1",
    )

    await handler.on_llm_start()
    await handler.on_llm_end(SimpleNamespace(llm_output={}, generations=[]))

    assert len(events) >= 3
    first = events[0]
    second = events[1]

    assert isinstance(first.metadata.get("event_id"), str)
    assert first.metadata["event_id"]
    assert first.metadata.get("sequence") == 1
    assert first.metadata.get("display_order") == 1
    assert first.metadata.get("run_id") == "run-contract"
    assert first.metadata.get("conversation_id") == "conv-contract"
    assert first.metadata.get("experiment_profile") == "v1"
    assert first.metadata.get("phase") == "llm_start"

    assert isinstance(second.metadata.get("event_id"), str)
    assert second.metadata["event_id"] != first.metadata["event_id"]
    assert second.metadata.get("sequence") == 2
    assert second.metadata.get("display_order") == 2
