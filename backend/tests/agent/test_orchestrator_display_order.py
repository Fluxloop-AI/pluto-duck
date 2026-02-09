"""Tests for central-gate display_order assignment in orchestrator emit()."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pytest

from pluto_duck_backend.agent.core.events import AgentEvent, EventSubType, EventType
from pluto_duck_backend.agent.core.deep.event_mapper import EventSink, PlutoDuckEventCallbackHandler
from pluto_duck_backend.agent.core.deep.hitl import ApprovalBroker


# ---------------------------------------------------------------------------
# Helpers: replicate the emit() closure from orchestrator._execute_run
# ---------------------------------------------------------------------------

def _build_emit(
    *,
    collected: List[Dict[str, Any]],
    callback_ref: list[PlutoDuckEventCallbackHandler | None],
    queue: Optional[asyncio.Queue] = None,
):
    """Build an emit() closure equivalent to the one in orchestrator._execute_run."""

    async def emit(event: AgentEvent) -> None:
        metadata = event.metadata if event.metadata is not None else {}
        existing_order = metadata.get("display_order")
        if existing_order is None or (isinstance(existing_order, int) and existing_order <= 0):
            cb = callback_ref[0]
            if cb is not None:
                metadata["display_order"] = cb.consume_next_display_order()
        event.metadata = metadata
        payload = event.to_dict()
        collected.append(payload)
        if queue is not None:
            await queue.put(payload)

    return emit


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_emit_assigns_display_order_when_missing() -> None:
    """When callback_ref is set, events without display_order get one assigned."""
    collected: List[Dict[str, Any]] = []
    callback_ref: list[PlutoDuckEventCallbackHandler | None] = [None]

    emit = _build_emit(collected=collected, callback_ref=callback_ref)

    # Create a callback handler and wire it up
    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=emit),
        run_id="run-1",
        display_order_start=10,
    )
    callback_ref[0] = handler

    # Emit an event without display_order
    event = AgentEvent(
        type=EventType.RUN,
        subtype=EventSubType.END,
        content={"finished": True},
        metadata={"run_id": "run-1"},
    )
    await emit(event)

    assert len(collected) == 1
    assert collected[0]["metadata"]["display_order"] == 10


@pytest.mark.asyncio
async def test_emit_preserves_existing_display_order() -> None:
    """Events that already have a positive display_order keep their value."""
    collected: List[Dict[str, Any]] = []
    callback_ref: list[PlutoDuckEventCallbackHandler | None] = [None]

    emit = _build_emit(collected=collected, callback_ref=callback_ref)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=emit),
        run_id="run-1",
        display_order_start=10,
    )
    callback_ref[0] = handler

    # Emit an event WITH existing display_order
    event = AgentEvent(
        type=EventType.TOOL,
        subtype=EventSubType.START,
        content={"tool": "query_sql"},
        metadata={"run_id": "run-1", "display_order": 42},
    )
    await emit(event)

    assert len(collected) == 1
    assert collected[0]["metadata"]["display_order"] == 42


@pytest.mark.asyncio
async def test_emit_skips_when_no_callback() -> None:
    """When callback_ref is None (pre-agent-build errors), emit works without error."""
    collected: List[Dict[str, Any]] = []
    callback_ref: list[PlutoDuckEventCallbackHandler | None] = [None]

    emit = _build_emit(collected=collected, callback_ref=callback_ref)

    # callback_ref[0] remains None — simulates error before agent build
    event = AgentEvent(
        type=EventType.RUN,
        subtype=EventSubType.ERROR,
        content={"error": "build failed"},
        metadata={"run_id": "run-1"},
    )
    await emit(event)

    assert len(collected) == 1
    # display_order should not be set (DB fallback will handle it)
    assert "display_order" not in collected[0]["metadata"]


@pytest.mark.asyncio
async def test_hitl_events_get_unique_display_order() -> None:
    """HITL flow: tool.start → approval_required → tool.end → decision_applied all get unique display_orders."""
    collected: List[Dict[str, Any]] = []
    callback_ref: list[PlutoDuckEventCallbackHandler | None] = [None]

    emit = _build_emit(collected=collected, callback_ref=callback_ref)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=emit),
        run_id="run-hitl",
        display_order_start=1,
    )
    callback_ref[0] = handler

    broker = ApprovalBroker(emit=emit, run_id="run-hitl")

    # 1. tool.start via callback handler (goes through _canonicalize)
    await handler.on_tool_start({"name": "write_file"}, '{"path": "test.txt"}')

    # 2. approval_required via broker (bypasses _canonicalize, goes directly through emit)
    await broker.emit_approval_required(
        approval_id="approval-1",
        tool_name="write_file",
        preview={"path": "test.txt"},
    )

    # 3. decision_applied via broker
    from pluto_duck_backend.agent.core.deep.hitl import ApprovalDecision

    await broker.emit_decision_applied(
        approval_id="approval-1",
        tool_name="write_file",
        decision=ApprovalDecision(decision="approve"),
    )

    # 4. tool.end via callback handler
    await handler.on_tool_end("success")

    display_orders = [
        evt["metadata"]["display_order"]
        for evt in collected
        if "display_order" in evt["metadata"]
    ]

    # All display_orders must be unique
    assert len(display_orders) == len(set(display_orders)), (
        f"Duplicate display_orders found: {display_orders}"
    )
    # All display_orders must be monotonically increasing
    assert display_orders == sorted(display_orders), (
        f"display_orders not monotonic: {display_orders}"
    )
    # Should have at least 4 events
    assert len(display_orders) >= 4


@pytest.mark.asyncio
async def test_finally_events_get_display_order() -> None:
    """MESSAGE/FINAL and RUN/END events emitted via emit() get display_order assigned."""
    collected: List[Dict[str, Any]] = []
    callback_ref: list[PlutoDuckEventCallbackHandler | None] = [None]

    emit = _build_emit(collected=collected, callback_ref=callback_ref)

    handler = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=emit),
        run_id="run-finally",
        display_order_start=1,
    )
    callback_ref[0] = handler

    # Simulate finally block events
    msg_event = AgentEvent(
        type=EventType.MESSAGE,
        subtype=EventSubType.FINAL,
        content={"text": "Final answer"},
        metadata={"run_id": "run-finally"},
    )
    await emit(msg_event)

    end_event = AgentEvent(
        type=EventType.RUN,
        subtype=EventSubType.END,
        content={"finished": True},
        metadata={"run_id": "run-finally"},
    )
    await emit(end_event)

    assert len(collected) == 2
    assert collected[0]["metadata"]["display_order"] == 1
    assert collected[1]["metadata"]["display_order"] == 2
    assert collected[0]["type"] == "message"
    assert collected[0]["subtype"] == "final"
    assert collected[1]["type"] == "run"
    assert collected[1]["subtype"] == "end"


@pytest.mark.asyncio
async def test_subsequent_run_continues_display_order() -> None:
    """Simulates two consecutive runs: the second run should continue display_order from where the first left off."""
    collected: List[Dict[str, Any]] = []
    callback_ref: list[PlutoDuckEventCallbackHandler | None] = [None]

    # --- First run: starts at 1, emits 3 events → uses 1, 2, 3 ---
    emit = _build_emit(collected=collected, callback_ref=callback_ref)
    handler1 = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=emit),
        run_id="run-1",
        display_order_start=1,
    )
    callback_ref[0] = handler1

    for i in range(3):
        await emit(
            AgentEvent(
                type=EventType.REASONING,
                subtype=EventSubType.CHUNK,
                content={"phase": f"step-{i}"},
                metadata={"run_id": "run-1"},
            )
        )

    first_run_orders = [e["metadata"]["display_order"] for e in collected]
    assert first_run_orders == [1, 2, 3]

    # --- Second run: starts where first run left off (next = 4) ---
    next_start = handler1.consume_next_display_order()  # simulates repo.get_next_display_order()
    collected.clear()

    handler2 = PlutoDuckEventCallbackHandler(
        sink=EventSink(emit=emit),
        run_id="run-2",
        display_order_start=next_start,
    )
    callback_ref[0] = handler2

    for i in range(2):
        await emit(
            AgentEvent(
                type=EventType.TOOL,
                subtype=EventSubType.START,
                content={"tool": f"tool-{i}"},
                metadata={"run_id": "run-2"},
            )
        )

    second_run_orders = [e["metadata"]["display_order"] for e in collected]
    # Should continue from 4 (not restart at 1)
    assert second_run_orders[0] >= 4
    assert second_run_orders == sorted(second_run_orders)
    assert len(second_run_orders) == len(set(second_run_orders))
