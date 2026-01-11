"""Event mapping utilities (Phase 1).

This module provides a LangChain callback handler that converts runtime events
into Pluto Duck `AgentEvent` objects for SSE streaming.

Phase 1 scope:
- Define the handler and event shapes.
- Keep implementation conservative to avoid tight coupling to LangChain internals.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from langchain_core.callbacks.base import AsyncCallbackHandler
from langchain_core.messages import BaseMessage, ToolMessage

from pluto_duck_backend.agent.core.events import AgentEvent, EventSubType, EventType


@dataclass(frozen=True)
class EventSink:
    """Pluggable sink for AgentEvents."""

    emit: Callable[[AgentEvent], Awaitable[None]]


class PlutoDuckEventCallbackHandler(AsyncCallbackHandler):
    """Best-effort callback handler emitting Pluto Duck AgentEvents."""

    def __init__(self, *, sink: EventSink, run_id: str) -> None:
        super().__init__()
        self._sink = sink
        self._run_id = run_id
        self._tool_stack: list[str] = []  # Track active tool names for matching start/end

    async def _emit(self, event: AgentEvent) -> None:
        await self._sink.emit(event)

    def _ts(self) -> datetime:
        return datetime.now(timezone.utc)

    def _json_safe(self, value: Any) -> Any:  # noqa: ANN401
        """Best-effort conversion to JSON-serializable structures for SSE payloads."""
        if value is None or isinstance(value, (str, int, float, bool)):
            return value

        # LangChain messages (ToolMessage, AIMessage, etc.)
        if isinstance(value, BaseMessage):
            payload: dict[str, Any] = {
                "type": getattr(value, "type", value.__class__.__name__),
                "content": getattr(value, "content", None),
            }
            if isinstance(value, ToolMessage):
                payload["tool_call_id"] = getattr(value, "tool_call_id", None)
            return payload

        if isinstance(value, dict):
            return {str(k): self._json_safe(v) for k, v in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [self._json_safe(v) for v in value]

        # If it's already JSON-serializable, keep it.
        try:
            json.dumps(value)
            return value
        except TypeError:
            return repr(value)

    async def on_llm_start(self, *args: Any, **kwargs: Any) -> None:  # noqa: ANN401
        await self._emit(
            AgentEvent(
                type=EventType.REASONING,
                subtype=EventSubType.START,
                content={"phase": "llm_start"},
                metadata={"run_id": self._run_id},
                timestamp=self._ts(),
            )
        )

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # noqa: ANN401
        text = None
        try:
            # Try to extract first generation text
            gens = getattr(response, "generations", None) or []
            if gens and gens[0]:
                msg = getattr(gens[0][0], "message", None)
                text = getattr(msg, "content", None)
        except Exception:
            text = None
        await self._emit(
            AgentEvent(
                type=EventType.REASONING,
                subtype=EventSubType.CHUNK,
                content={"phase": "llm_end", "text": text},
                metadata={"run_id": self._run_id},
                timestamp=self._ts(),
            )
        )

    async def on_tool_start(self, serialized: dict[str, Any], input_str: str, **kwargs: Any) -> None:  # noqa: ANN401
        tool_name = serialized.get("name") or serialized.get("id") or "tool"
        self._tool_stack.append(tool_name)
        await self._emit(
            AgentEvent(
                type=EventType.TOOL,
                subtype=EventSubType.START,
                content={"tool": tool_name, "input": input_str},
                metadata={"run_id": self._run_id},
                timestamp=self._ts(),
            )
        )

    async def on_tool_end(self, output: Any, **kwargs: Any) -> None:  # noqa: ANN401
        # Pop the tool name from the stack to match with start event
        tool_name = self._tool_stack.pop() if self._tool_stack else "tool"
        await self._emit(
            AgentEvent(
                type=EventType.TOOL,
                subtype=EventSubType.END,
                content={"tool": tool_name, "output": self._json_safe(output)},
                metadata={"run_id": self._run_id},
                timestamp=self._ts(),
            )
        )


