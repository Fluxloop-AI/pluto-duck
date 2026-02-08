"""Event mapping utilities."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import uuid4

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
        display_order_start: int = 1,
    ) -> None:
        super().__init__()
        self._sink = sink
        self._run_id = run_id
        self._conversation_id = conversation_id
        self._experiment_profile = experiment_profile or prompt_layout
        self._tool_stack: list[str] = []
        self._chunk_buffer: list[str] = []
        self._chunk_tokens = 0
        self._chunk_chars = 0
        self._flush_interval_s = 0.05
        self._max_chunk_tokens = 20
        self._max_buffer_chars = 4096
        self._last_flush = time.monotonic() - self._flush_interval_s
        self._event_sequence = 0
        self._display_order = max(1, int(display_order_start))

    async def _emit(self, event: AgentEvent) -> None:
        event.metadata = self._canonicalize_event_metadata(event)
        await self._sink.emit(event)

    def _canonicalize_event_metadata(self, event: AgentEvent) -> dict[str, Any]:
        metadata = dict(event.metadata or {})
        raw_event_id = metadata.get("event_id")
        metadata["event_id"] = (
            raw_event_id.strip()
            if isinstance(raw_event_id, str) and raw_event_id.strip()
            else str(uuid4())
        )
        sequence = self._coerce_int(metadata.get("sequence")) or 0
        if sequence <= 0:
            self._event_sequence += 1
            metadata["sequence"] = self._event_sequence
        else:
            self._event_sequence = max(self._event_sequence, sequence)
            metadata["sequence"] = sequence
        display_order = self._coerce_int(metadata.get("display_order")) or 0
        if display_order <= 0:
            metadata["display_order"] = self.consume_next_display_order()
        else:
            metadata["display_order"] = display_order
            self._display_order = max(self._display_order, display_order + 1)
        metadata.setdefault("run_id", self._run_id)
        if self._conversation_id and "conversation_id" not in metadata:
            metadata["conversation_id"] = self._conversation_id
        if self._experiment_profile and "experiment_profile" not in metadata:
            metadata["experiment_profile"] = self._experiment_profile
        content = event.content if isinstance(event.content, dict) else {}
        for field in ("tool_call_id", "parent_event_id", "phase"):
            value = metadata.get(field, content.get(field))
            if isinstance(value, str):
                value = value.strip()
            if value not in (None, ""):
                metadata[field] = value
        return metadata

    def consume_next_display_order(self) -> int:
        current = self._display_order
        self._display_order += 1
        return current

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

    def _normalize_stream_token(self, token: Any) -> str:  # noqa: ANN401
        if isinstance(token, str):
            return token

        if isinstance(token, dict):
            token_type = str(token.get("type") or "").lower()
            if token_type == "reasoning":
                return ""

            for key in ("text", "content", "delta"):
                value = token.get(key)
                normalized = self._normalize_stream_token(value)
                if normalized:
                    return normalized
            return ""

        if isinstance(token, list):
            parts = [self._normalize_stream_token(item) for item in token]
            return "".join(part for part in parts if part)

        return ""

    def _coerce_text(self, value: Any) -> str | None:  # noqa: ANN401
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        return text

    def _join_text_fragments(self, fragments: list[str]) -> str | None:
        normalized = [
            text
            for text in (self._coerce_text(fragment) for fragment in fragments)
            if text
        ]
        if not normalized:
            return None
        return "\n\n".join(normalized)

    def _extract_output_text_fragments(self, block: Any) -> list[str]:  # noqa: ANN401
        if isinstance(block, str):
            return [block]
        if not isinstance(block, dict):
            return []

        block_type = str(block.get("type") or "").lower()
        if block_type == "reasoning":
            return []

        if block_type in {"message", "output_message"}:
            nested = block.get("content")
            if isinstance(nested, list):
                fragments: list[str] = []
                for item in nested:
                    fragments.extend(self._extract_output_text_fragments(item))
                return fragments
            nested_text = self._coerce_text(nested)
            return [nested_text] if nested_text else []

        text_value = self._coerce_text(block.get("text"))
        if text_value:
            return [text_value]

        nested = block.get("content")
        if isinstance(nested, list):
            nested_fragments: list[str] = []
            for item in nested:
                nested_fragments.extend(self._extract_output_text_fragments(item))
            return nested_fragments

        nested_text = self._coerce_text(nested)
        return [nested_text] if nested_text else []

    def _extract_reasoning_summary_fragments(self, value: Any) -> list[str]:  # noqa: ANN401
        if isinstance(value, str):
            return [value]
        if isinstance(value, dict):
            fragments: list[str] = []
            text_value = self._coerce_text(value.get("text"))
            if text_value:
                fragments.append(text_value)
            summary_text = self._coerce_text(value.get("summary_text"))
            if summary_text:
                fragments.append(summary_text)
            nested = value.get("summary")
            if nested is not None:
                fragments.extend(self._extract_reasoning_summary_fragments(nested))
            return fragments
        if isinstance(value, list):
            summary_fragments: list[str] = []
            for item in value:
                summary_fragments.extend(self._extract_reasoning_summary_fragments(item))
            return summary_fragments
        return []

    def _extract_reasoning_fragments(self, content: Any) -> list[str]:  # noqa: ANN401
        if not isinstance(content, list):
            return []

        fragments: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if str(block.get("type") or "").lower() != "reasoning":
                continue
            summary = block.get("summary")
            if summary is not None:
                fragments.extend(self._extract_reasoning_summary_fragments(summary))
            summary_text = self._coerce_text(block.get("summary_text"))
            if summary_text:
                fragments.append(summary_text)
            text = self._coerce_text(block.get("text"))
            if text:
                fragments.append(text)
        return fragments

    def _extract_llm_text_and_reason(self, message_content: Any) -> tuple[str | None, str | None]:  # noqa: ANN401
        if isinstance(message_content, str):
            return message_content, None
        if not isinstance(message_content, list):
            return None, None

        text_fragments: list[str] = []
        for block in message_content:
            text_fragments.extend(self._extract_output_text_fragments(block))
        reason_fragments = self._extract_reasoning_fragments(message_content)
        return (
            self._join_text_fragments(text_fragments),
            self._join_text_fragments(reason_fragments),
        )

    def _extract_usage_from_mapping(self, mapping: Any) -> dict[str, Any] | None:  # noqa: ANN401
        if not isinstance(mapping, dict):
            return None
        for key in ("token_usage", "usage", "usage_metadata"):
            candidate = mapping.get(key)
            if isinstance(candidate, dict):
                return candidate
        direct_keys = (
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "input_tokens",
            "output_tokens",
        )
        if any(k in mapping for k in direct_keys):
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
            for key in (
                "cached_tokens",
                "cache_read",
                "cache_read_input_tokens",
                "cache_read_tokens",
            ):
                value = details.get(key)
                if value is not None:
                    return self._coerce_int(value)
        for key in ("cached_tokens", "cache_read_input_tokens", "cache_read_tokens"):
            value = usage.get(key)
            if value is not None:
                return self._coerce_int(value)
        return None

    def _extract_reasoning_tokens(self, usage: dict[str, Any]) -> int | None:
        for key in ("reasoning_tokens",):
            value = usage.get(key)
            if value is not None:
                return self._coerce_int(value)

        for details_key in (
            "output_tokens_details",
            "completion_tokens_details",
            "output_token_details",
        ):
            details = usage.get(details_key)
            if not isinstance(details, dict):
                continue
            value = details.get("reasoning_tokens")
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
        prompt_tokens = self._coerce_int(
            usage.get("prompt_tokens") or usage.get("input_tokens")
        )
        completion_tokens = self._coerce_int(
            usage.get("completion_tokens") or usage.get("output_tokens")
        )
        total_tokens = self._coerce_int(usage.get("total_tokens"))
        if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
            total_tokens = prompt_tokens + completion_tokens
        cached_tokens = self._extract_cached_tokens(usage) if isinstance(usage, dict) else None
        reasoning_tokens = (
            self._extract_reasoning_tokens(usage) if isinstance(usage, dict) else None
        )
        return {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cached_prompt_tokens": cached_tokens,
            "reasoning_tokens": reasoning_tokens,
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

    async def on_llm_new_token(self, token: Any, **kwargs: Any) -> None:  # noqa: ANN401
        text_token = self._normalize_stream_token(token)
        if not text_token:
            return
        self._chunk_buffer.append(text_token)
        self._chunk_tokens += 1
        self._chunk_chars += len(text_token)
        now = time.monotonic()
        if self._should_flush_chunk(now):
            await self._flush_chunk(now)

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # noqa: ANN401
        await self._flush_chunk(is_final=True)
        text = None
        reason = None
        try:
            # Try to extract first generation text
            gens = getattr(response, "generations", None) or []
            if gens and gens[0]:
                msg = getattr(gens[0][0], "message", None)
                text, reason = self._extract_llm_text_and_reason(getattr(msg, "content", None))
        except Exception:
            text = None
            reason = None
        if reason:
            await self._emit(
                AgentEvent(
                    type=EventType.REASONING,
                    subtype=EventSubType.CHUNK,
                    content={"phase": "llm_reasoning", "reason": reason},
                    metadata={"run_id": self._run_id},
                    timestamp=self._ts(),
                )
            )
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

    async def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:  # noqa: ANN401
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
