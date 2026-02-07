"""Agent orchestrator managing deep-agent runs and event streaming."""

from __future__ import annotations

import asyncio
import json
import re
import logging
import traceback
from dataclasses import asdict, is_dataclass
from json import dumps
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional, Sequence

from datetime import datetime
from enum import Enum
from uuid import uuid4

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage

from pluto_duck_backend.agent.core import (
    AgentEvent,
    EventSubType,
    EventType,
)
from pluto_duck_backend.agent.core.deep.agent import build_deep_agent
from pluto_duck_backend.agent.core.deep.context import RunContext, build_session_context
from pluto_duck_backend.agent.core.deep.event_mapper import EventSink, PlutoDuckEventCallbackHandler
from pluto_duck_backend.agent.core.deep.hitl import ApprovalBroker, ApprovalDecision
from pluto_duck_backend.agent.core.deep.prompt_experiment import resolve_profile_id
from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.chat import get_chat_repository

logger = logging.getLogger("pluto_duck_backend.agent")

def _log(message: str, **fields: Any) -> None:
    # Use logging so messages go to backend.log (stdout print can be lost in some launch modes).
    payload = " ".join(f"{key}={value}" for key, value in fields.items()) if fields else ""
    logger.info("%s %s", message, payload)


def _serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if is_dataclass(value):
        return asdict(value)
    return value


def _should_persist_event(event: AgentEvent) -> bool:
    return not (event.type == EventType.MESSAGE and event.subtype == EventSubType.CHUNK)


def safe_dump_event(event: Dict[str, Any]) -> str:
    """Serialize an event dictionary into an SSE data payload."""

    return f"data: {dumps(_serialize(event))}\n\n"


class AgentRun:
    def __init__(
        self,
        run_id: str,
        conversation_id: str,
        question: str,
        *,
        model: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.run_id = run_id
        self.conversation_id = conversation_id
        self.question = question
        self.model = model
        self.metadata = metadata or {}
        self.queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue()
        self.done = asyncio.Event()
        self.result: Optional[Dict[str, Any]] = None
        self.flags: Dict[str, Any] = {}
        self.broker: Optional[ApprovalBroker] = None


class AgentRunManager:
    def __init__(self) -> None:
        self._runs: Dict[str, AgentRun] = {}

    def start_run(
        self,
        question: str,
        model: Optional[str] = None,
        *,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> tuple[str, str]:
        conversation_id = str(uuid4())
        run_id = self.start_run_for_conversation(
            conversation_id,
            question,
            model=model,
            metadata=metadata,
            create_if_missing=True,
        )
        return conversation_id, run_id

    def start_run_for_conversation(
        self,
        conversation_id: str,
        question: str,
        *,
        model: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        create_if_missing: bool = False,
    ) -> str:
        repo = get_chat_repository()
        prepared = _prepare_question_and_metadata(question, metadata)
        sanitized_question = prepared["question"]
        metadata = prepared["metadata"]
        extracted_tables = prepared["extracted_tables"]
        public_metadata = {k: v for k, v in metadata.items() if not str(k).startswith("_")}
        summary = repo.get_conversation_summary(conversation_id)

        if summary is None:
            if not create_if_missing:
                raise KeyError(conversation_id)
            repo.create_conversation(conversation_id, sanitized_question, public_metadata)

        run_id = str(uuid4())
        run = AgentRun(run_id, conversation_id, sanitized_question, model=model, metadata=metadata)
        self._runs[run_id] = run
        _log("run_started", run_id=run_id, conversation_id=conversation_id)
        repo.append_message(
            conversation_id,
            "user",
            {"text": question, "metadata": public_metadata},
            run_id=run_id,
        )
        repo.set_active_run(conversation_id, run_id)
        preview_source = question if question else sanitized_question
        repo.mark_run_started(conversation_id, last_message_preview=preview_source[:160])
        task = asyncio.create_task(self._execute_run(run))

        def _done_callback(t: asyncio.Task) -> None:  # pragma: no cover
            try:
                exc = t.exception()
            except asyncio.CancelledError:
                return
            except Exception as callback_exc:
                _log("run_task_callback_error", run_id=run_id, error=str(callback_exc))
                return
            if exc is not None:
                _log("run_task_unhandled_exception", run_id=run_id, error=str(exc))

        task.add_done_callback(_done_callback)
        return run_id

    async def _execute_run(self, run: AgentRun) -> None:
        repo = get_chat_repository()
        _log("run_execute_start", run_id=run.run_id, conversation_id=run.conversation_id)

        async def emit(event: AgentEvent) -> None:
            payload = event.to_dict()
            await run.queue.put(payload)
            if _should_persist_event(event):
                repo.log_event(run.conversation_id, payload)

        run.broker = ApprovalBroker(emit=emit, run_id=run.run_id)

        messages: list[BaseMessage] = []
        for msg in repo.get_conversation_messages(run.conversation_id):
            role = (msg.get("role") or "").lower()
            content_payload = msg.get("content")
            text = ""
            if isinstance(content_payload, dict):
                text = str(content_payload.get("text") or "")
            elif content_payload is not None:
                text = str(content_payload)
            if role == "user":
                messages.append(HumanMessage(content=text))
            elif role == "assistant":
                messages.append(AIMessage(content=text))
            elif role == "system":
                messages.append(SystemMessage(content=text))
            elif role == "tool":
                messages.append(ToolMessage(content=text, tool_call_id="tool"))

        if not messages or not isinstance(messages[-1], HumanMessage):
            messages.append(HumanMessage(content=run.question))

        # Inject context_assets from metadata into the last user message (for LLM only, not stored)
        context_assets = run.metadata.get("context_assets")
        if context_assets and isinstance(messages[-1], HumanMessage):
            original_content = messages[-1].content
            context_block = f"\n\n<context_assets>\n{context_assets}\n</context_assets>"
            messages[-1] = HumanMessage(content=f"{original_content}{context_block}")
            print(f"[Orchestrator] ✅ Context injected from metadata:\n{context_assets}", flush=True)
        else:
            print(f"[Orchestrator] ⚠️ No context_assets in metadata", flush=True)

        final_state: Dict[str, Any] = {"finished": False}
        try:
            summary = repo.get_conversation_summary(run.conversation_id)
            project_id = summary.project_id if summary else None
            if project_id is None:
                _log("project_id_missing", run_id=run.run_id, conversation_id=run.conversation_id)

            experiment_profile_id = resolve_profile_id(run.metadata, get_settings())
            session_ctx = build_session_context(
                conversation_id=run.conversation_id,
                project_id=project_id,
                experiment_profile_id=experiment_profile_id,
            )
            run_ctx = RunContext(
                run_id=run.run_id,
                broker=run.broker,
                model=run.model,
            )

            _log(
                "run_build_agent",
                run_id=run.run_id,
                conversation_id=run.conversation_id,
                model=run.model,
                experiment_profile=experiment_profile_id,
            )
            agent = build_deep_agent(
                session_ctx=session_ctx,
                run_ctx=run_ctx,
            )
            callback = PlutoDuckEventCallbackHandler(
                sink=EventSink(emit=emit),
                run_id=run.run_id,
                conversation_id=run.conversation_id,
                experiment_profile=session_ctx.experiment_profile_id,
            )

            _log("run_invoke_start", run_id=run.run_id, conversation_id=run.conversation_id)
            result = await agent.ainvoke({"messages": messages}, config={"callbacks": [callback]})
            answer = _extract_final_answer(result)
            final_state = {"finished": True, "answer": answer}
        except Exception as exc:  # pragma: no cover
            # Some exceptions (e.g., AssertionError) have an empty str(). Always log repr + traceback.
            err_type = type(exc).__name__
            err_text = str(exc).strip()
            err_repr = repr(exc)
            _log(
                "run_exception",
                run_id=run.run_id,
                conversation_id=run.conversation_id,
                error_type=err_type,
                error=err_text or err_repr,
            )
            logger.error(
                "run_failed traceback run_id=%s conversation_id=%s\n%s",
                run.run_id,
                run.conversation_id,
                "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
            )
            event = AgentEvent(
                type=EventType.RUN,
                subtype=EventSubType.ERROR,
                content={"error": err_text or err_repr, "error_type": err_type},
                metadata={"run_id": run.run_id},
            )
            await run.queue.put(event.to_dict())
            final_state = {"error": err_text or err_repr, "error_type": err_type}
            repo.log_event(run.conversation_id, event.to_dict())
            _log("run_failed", run_id=run.run_id, conversation_id=run.conversation_id, error=err_text or err_repr)
        finally:
            run.result = final_state
            final_preview = run.flags.get("final_preview") or self._final_preview(final_state)
            if "answer" in final_state and isinstance(final_state.get("answer"), str):
                final_answer = final_state["answer"]
                repo.append_message(run.conversation_id, "assistant", {"text": final_answer}, run_id=run.run_id)
                if final_answer.strip():
                    run.flags["final_preview"] = final_answer.strip()[:160]
                msg_event = AgentEvent(
                    type=EventType.MESSAGE,
                    subtype=EventSubType.FINAL,
                    content={"text": final_answer},
                    metadata={"run_id": run.run_id},
                )
                await run.queue.put(msg_event.to_dict())
                repo.log_event(run.conversation_id, msg_event.to_dict())

            end_event = AgentEvent(
                type=EventType.RUN,
                subtype=EventSubType.END,
                content=_serialize(final_state),
                metadata={"run_id": run.run_id},
            )
            await run.queue.put(end_event.to_dict())
            repo.log_event(run.conversation_id, end_event.to_dict())
            repo.mark_run_completed(
                run.conversation_id,
                status="failed" if "error" in final_state else "completed",
                final_preview=final_preview,
            )
            await run.queue.put(None)
            run.done.set()
            _log(
                "run_completed",
                run_id=run.run_id,
                conversation_id=run.conversation_id,
                status="failed" if "error" in final_state else "completed",
            )
            
            # Clean up run from memory after 10 minutes to prevent memory leaks
            async def cleanup_run():
                await asyncio.sleep(600)  # 10 minutes
                if run.run_id in self._runs:
                    _log("run_cleanup", run_id=run.run_id, conversation_id=run.conversation_id)
                    self._runs.pop(run.run_id, None)
            
            asyncio.create_task(cleanup_run())

    def _final_preview(self, final_state: Dict[str, Any]) -> Optional[str]:
        if not final_state:
            return None
        if isinstance(final_state, dict):
            text = final_state.get("answer") or final_state.get("summary")
            if isinstance(text, str):
                return text[:160]
        try:
            return json.dumps(_serialize(final_state))[:160]
        except Exception:
            return str(final_state)[:160]

    async def stream_events(self, run_id: str) -> AsyncIterator[Dict[str, Any]]:
        run = self._runs.get(run_id)
        if run is None:
            raise KeyError(run_id)
        while True:
            item = await run.queue.get()
            if item is None:
                break
            yield item

    async def get_result(self, run_id: str) -> Dict[str, Any]:
        run = self._runs.get(run_id)
        if run is None:
            raise KeyError(run_id)
        await run.done.wait()
        return run.result or {}

    def decide_approval(
        self,
        run_id: str,
        approval_id: str,
        decision: str,
        edited_args: Optional[Dict[str, Any]] = None,
    ) -> None:
        run = self._runs.get(run_id)
        if run is None or run.broker is None:
            raise KeyError(run_id)
        run.broker.decide(approval_id, ApprovalDecision(decision=decision, edited_args=edited_args))


_TABLE_TOKEN_PATTERN = re.compile(r"@(?:chat/)?([A-Za-z0-9_]+)")


def _prepare_question_and_metadata(
    question: str,
    metadata: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    metadata_copy: Dict[str, Any] = dict(metadata or {})
    sanitized, extracted_tables = _sanitize_question_tokens(question)
    if extracted_tables:
        metadata_copy["mentioned_tables"] = _merge_distinct_tables(
            metadata_copy.get("mentioned_tables"),
            extracted_tables,
        )
    metadata_copy.setdefault("original_question", question)
    metadata_copy["_extracted_tables"] = extracted_tables
    return {
        "question": sanitized,
        "metadata": metadata_copy,
        "extracted_tables": extracted_tables,
    }


def _sanitize_question_tokens(question: str) -> tuple[str, List[str]]:
    extracted: List[str] = []

    def _replacement(match: re.Match[str]) -> str:
        table = match.group(1)
        extracted.append(table)
        return table

    sanitized = _TABLE_TOKEN_PATTERN.sub(_replacement, question)
    return sanitized.strip(), _unique_preserve_order(extracted)


def _merge_distinct_tables(
    existing: Optional[Iterable[str]],
    new_items: Iterable[str],
) -> List[str]:
    return _unique_preserve_order(list(existing or []) + list(new_items))


def _unique_preserve_order(items: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    ordered: List[str] = []
    for item in items:
        normalized = item.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(normalized)
    return ordered


def _extract_preferred_tables(metadata: Optional[Dict[str, Any]]) -> Optional[List[str]]:
    if not metadata:
        return None

    # Explicit table mentions take priority
    if "mentioned_tables" in metadata and metadata["mentioned_tables"]:
        tables = metadata["mentioned_tables"]
        if isinstance(tables, str):
            return [tables]
        if isinstance(tables, list):
            return [str(table) for table in tables]

    # Fallback to data source tables if provided
    if "preferred_tables" in metadata and metadata["preferred_tables"]:
        tables = metadata["preferred_tables"]
        if isinstance(tables, str):
            return [tables]
        if isinstance(tables, list):
            return [str(table) for table in tables]

    return None


_AGENT_MANAGER: Optional[AgentRunManager] = None


def get_agent_manager() -> AgentRunManager:
    global _AGENT_MANAGER
    if _AGENT_MANAGER is None:
        _AGENT_MANAGER = AgentRunManager()
    return _AGENT_MANAGER


async def run_agent_once(question: str, model: Optional[str] = None) -> Dict[str, Any]:
    manager = get_agent_manager()
    conversation_id, run_id = manager.start_run(question, model=model)
    await manager._runs[run_id].done.wait()  # type: ignore[attr-defined]
    return await manager.get_result(run_id)


def _extract_final_answer(result: Any) -> str:
    def _extract_text_from_content(content: Any) -> Optional[str]:
        if isinstance(content, str):
            text = content.strip()
            return text or None

        if isinstance(content, list):
            text_fragments: List[str] = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                if str(block.get("type") or "").lower() == "reasoning":
                    continue
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    text_fragments.append(text.strip())
            if text_fragments:
                return "\n\n".join(text_fragments)

            for block in content:
                nested = _extract_text_from_content(block)
                if nested:
                    return nested
            return None

        if isinstance(content, dict):
            if str(content.get("type") or "").lower() == "reasoning":
                return None

            for key in (
                "final_answer",
                "answer",
                "output_text",
                "text",
                "content",
                "summary",
                "message",
            ):
                nested = _extract_text_from_content(content.get(key))
                if nested:
                    return nested
            return None

        return None

    if isinstance(result, dict):
        msgs = result.get("messages")
        if isinstance(msgs, list) and msgs:
            for message in reversed(msgs):
                if isinstance(message, dict):
                    role = str(message.get("role") or "").lower()
                    if role and role != "assistant":
                        continue
                    extracted = _extract_text_from_content(message.get("content"))
                elif isinstance(message, AIMessage):
                    extracted = _extract_text_from_content(getattr(message, "content", None))
                else:
                    continue

                if extracted:
                    return extracted

        extracted = _extract_text_from_content(result.get("output"))
        if extracted:
            return extracted

        extracted = _extract_text_from_content(result.get("answer"))
        if extracted:
            return extracted

    return str(result)
