"""Tests for display_order behavior in event mapper."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pluto_duck_backend.agent.core.deep.event_mapper import EventSink, PlutoDuckEventCallbackHandler


@pytest.mark.asyncio
async def test_event_mapper_emits_monotonic_display_order() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-display-order",
        display_order_start=7,
    )

    await handler.on_llm_start()
    await handler.on_llm_new_token("hello")
    await handler.on_llm_end(SimpleNamespace(llm_output={}, generations=[]))

    display_orders = [
        int(event.metadata["display_order"])
        for event in events
        if isinstance(event.metadata.get("display_order"), int)
    ]

    assert display_orders
    assert display_orders[0] == 7
    assert display_orders == sorted(display_orders)
    assert len(display_orders) == len(set(display_orders))


@pytest.mark.asyncio
async def test_event_mapper_consume_next_display_order_advances_counter() -> None:
    events = []

    async def _emit(event) -> None:
        events.append(event)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=_emit),
        run_id="run-display-order-counter",
        display_order_start=3,
    )

    await handler.on_llm_start()
    next_value = handler.consume_next_display_order()

    assert next_value == 4
