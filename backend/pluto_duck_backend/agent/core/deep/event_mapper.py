"""Event mapping utilities (Phase 1).

This module provides a LangChain callback handler that converts runtime events
into Pluto Duck `AgentEvent` objects for SSE streaming.

Phase 1 scope:
- Define the handler and event shapes.
- Keep implementation conservative to avoid tight coupling to LangChain internals.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from langchain_core.callbacks.base import AsyncCallbackHandler
from langchain_core.messages import BaseMessage, ToolMessage

from pluto_duck_backend.agent.core.events import AgentEvent, EventSubType, EventType


@dataclass(frozen=True)
class EventSink:
    """Pluggable sink for AgentEvents."""

    emit: Callable[[AgentEvent], Awaitable[None]]


class PlutoDuckEventCallbackHandler(AsyncCallbackHandler):
    """Best-effort callback handler emitting Pluto Duck AgentEvents."""

    def __init__(
        self,
        *,
        sink: EventSink,
        run_id: str,
        conversation_id: str | None = None,
        experiment_profile: str | None = None,
        prompt_layout: str | None = None,
    ) -> None:
        super().__init__()
        self._sink = sink
        self._run_id = run_id
        self._conversation_id = conversation_id
        # Keep `prompt_layout` as fallback input during migration.
        self._experiment_profile = experiment_profile or prompt_layout
        self._tool_stack: list[str] = []  # Track active tool names for matching start/end
        self._chunk_buffer: list[str] = []
        self._chunk_tokens = 0
        self._chunk_chars = 0
        # Defaults: 50ms flush, 20 tokens, 4KB buffer cap.
        self._flush_interval_s = 0.05
        self._max_chunk_tokens = 20
        self._max_buffer_chars = 4096
        self._last_flush = time.monotonic() - self._flush_interval_s

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

    def _chunk_metadata(self) -> dict[str, Any]:
        metadata: dict[str, Any] = {"run_id": self._run_id}
        if self._conversation_id:
            metadata["conversation_id"] = self._conversation_id
        if self._experiment_profile:
            metadata["experiment_profile"] = self._experiment_profile
        return metadata

    def _should_flush_chunk(self, now: float) -> bool:
        return (
            (now - self._last_flush) >= self._flush_interval_s
            or self._chunk_tokens >= self._max_chunk_tokens
            or self._chunk_chars >= self._max_buffer_chars
        )

    async def _flush_chunk(self, now: float | None = None, *, is_final: bool = False) -> None:
        if not self._chunk_buffer:
            return
        if now is None:
            now = time.monotonic()
        text_delta = "".join(self._chunk_buffer)
        self._chunk_buffer.clear()
        self._chunk_tokens = 0
        self._chunk_chars = 0
        self._last_flush = now
        await self._emit(
            AgentEvent(
                type=EventType.MESSAGE,
                subtype=EventSubType.CHUNK,
                content={"text_delta": text_delta, "is_final": is_final},
                metadata=self._chunk_metadata(),
                timestamp=self._ts(),
            )
        )

    def _coerce_int(self, value: Any) -> int | None:  # noqa: ANN401
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _extract_usage_from_mapping(self, mapping: Any) -> dict[str, Any] | None:  # noqa: ANN401
        if not isinstance(mapping, dict):
            return None
        for key in ("token_usage", "usage", "usage_metadata"):
            candidate = mapping.get(key)
            if isinstance(candidate, dict):
                return candidate
        if any(k in mapping for k in ("prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens")):
            return mapping
        return None

    def _extract_cached_tokens(self, usage: dict[str, Any]) -> int | None:
        details = None
        for key in ("prompt_tokens_details", "input_token_details"):
            value = usage.get(key)
            if isinstance(value, dict):
                details = value
                break
        if details:
            for key in ("cached_tokens", "cache_read", "cache_read_input_tokens", "cache_read_tokens"):
                value = details.get(key)
                if value is not None:
                    return self._coerce_int(value)
        for key in ("cached_tokens", "cache_read_input_tokens", "cache_read_tokens"):
            value = usage.get(key)
            if value is not None:
                return self._coerce_int(value)
        return None

    def _extract_model(self, response: Any) -> str | None:  # noqa: ANN401
        llm_output = getattr(response, "llm_output", None)
        if isinstance(llm_output, dict):
            for key in ("model_name", "model", "model_id"):
                value = llm_output.get(key)
                if value:
                    return str(value)
        gens = getattr(response, "generations", None) or []
        if gens and gens[0]:
            msg = getattr(gens[0][0], "message", None)
            if msg is not None:
                for attr in ("response_metadata", "usage_metadata", "additional_kwargs"):
                    mapping = getattr(msg, attr, None)
                    if isinstance(mapping, dict):
                        for key in ("model_name", "model", "model_id"):
                            value = mapping.get(key)
                            if value:
                                return str(value)
        return None

    def _extract_usage(self, response: Any) -> dict[str, int | None]:  # noqa: ANN401
        usage = None
        llm_output = getattr(response, "llm_output", None)
        usage = self._extract_usage_from_mapping(llm_output)
        if usage is None:
            usage = self._extract_usage_from_mapping(getattr(response, "response_metadata", None))
        gens = getattr(response, "generations", None) or []
        if usage is None and gens and gens[0]:
            msg = getattr(gens[0][0], "message", None)
            if msg is not None:
                for attr in ("usage_metadata", "response_metadata", "additional_kwargs"):
                    usage = self._extract_usage_from_mapping(getattr(msg, attr, None))
                    if usage is not None:
                        break
        usage = usage or {}
        prompt_tokens = self._coerce_int(usage.get("prompt_tokens") or usage.get("input_tokens"))
        completion_tokens = self._coerce_int(usage.get("completion_tokens") or usage.get("output_tokens"))
        total_tokens = self._coerce_int(usage.get("total_tokens"))
        if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens
        cached_tokens = self._extract_cached_tokens(usage) if isinstance(usage, dict) else None
        return {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cached_prompt_tokens": cached_tokens,
        }

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

    async def on_llm_new_token(self, token: str, **kwargs: Any) -> None:  # noqa: ANN401
        if not token:
            return
        self._chunk_buffer.append(token)
        self._chunk_tokens += 1
        self._chunk_chars += len(token)
        now = time.monotonic()
        if self._should_flush_chunk(now):
            await self._flush_chunk(now)

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # noqa: ANN401
        await self._flush_chunk(is_final=True)
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
        usage_payload = self._extract_usage(response)
        await self._emit(
            AgentEvent(
                type=EventType.REASONING,
                subtype=EventSubType.CHUNK,
                content={
                    "phase": "llm_usage",
                    "usage": usage_payload,
                    "model": self._extract_model(response),
                },
                metadata=self._chunk_metadata(),
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
