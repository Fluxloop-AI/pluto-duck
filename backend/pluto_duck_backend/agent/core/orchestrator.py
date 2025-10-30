"""Agent orchestrator managing LangGraph runs and event streaming."""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, is_dataclass
from json import dumps
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional

from datetime import datetime
from enum import Enum
from uuid import uuid4

from pluto_duck_backend.agent.core import (
    AgentEvent,
    AgentState,
    EventSubType,
    EventType,
    MessageRole,
    PlanStep,
)
from pluto_duck_backend.agent.core.graph import build_agent_graph
from pluto_duck_backend.app.services.chat import get_chat_repository


def _log(message: str, **fields: Any) -> None:
    payload = " ".join(f"{key}={value}" for key, value in fields.items()) if fields else ""
    print(f"[agent] {message} {payload}")


def _serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, AgentState):
        return value.to_dict()
    if isinstance(value, PlanStep):
        return asdict(value)
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if is_dataclass(value):
        return asdict(value)
    return value


def _extract_reasoning_message(update: Dict[str, Any]) -> Optional[str]:
    messages = update.get("messages", [])
    for msg in reversed(messages):
        role = getattr(msg, "role", None)
        if role == MessageRole.REASONING:
            return getattr(msg, "content", None)
    return None


def _serialize_plan(update: Dict[str, Any]) -> List[Dict[str, Any]]:
    plan = update.get("plan", [])
    return [_serialize(step) for step in plan]


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
        summary = repo.get_conversation_summary(conversation_id)

        if summary is None:
            if not create_if_missing:
                raise KeyError(conversation_id)
            repo.create_conversation(conversation_id, question, metadata)

        run_id = str(uuid4())
        run = AgentRun(run_id, conversation_id, question, model=model, metadata=metadata)
        self._runs[run_id] = run
        _log("run_started", run_id=run_id, conversation_id=conversation_id)
        repo.append_message(
            conversation_id,
            "user",
            {"text": question, "metadata": metadata or {}},
            run_id=run_id,
        )
        repo.set_active_run(conversation_id, run_id)
        repo.mark_run_started(conversation_id, last_message_preview=question[:160])
        asyncio.create_task(self._execute_run(run))
        return run_id

    async def _execute_run(self, run: AgentRun) -> None:
        graph = build_agent_graph()
        preferred_tables = _extract_preferred_tables(run.metadata)
        state = AgentState(
            conversation_id=run.conversation_id,
            user_query=run.question,
            model=run.model,
            preferred_tables=preferred_tables,
            metadata=run.metadata,
        )
        state.add_message(MessageRole.USER, run.question)
        repo = get_chat_repository()

        final_state: Dict[str, Any] = {}
        try:
            async for chunk in graph.astream(state, stream_mode=["updates", "values"]):
                if isinstance(chunk, tuple) and len(chunk) == 2:
                    mode, payload = chunk
                else:
                    mode, payload = "updates", chunk
                if mode == "updates" and isinstance(payload, dict):
                    for node_name, update in payload.items():
                        events = self._events_from_update(node_name, update, run)
                        for event in events:
                            event_dict = event.to_dict()
                            await run.queue.put(event_dict)
                            repo.log_event(run.conversation_id, event_dict)
                elif mode == "values":
                    if isinstance(payload, dict):
                        final_state = _serialize(payload)
        except Exception as exc:  # pragma: no cover
            event = AgentEvent(
                type=EventType.RUN,
                subtype=EventSubType.ERROR,
                content={"error": str(exc)},
                metadata={"run_id": run.run_id},
            )
            await run.queue.put(event.to_dict())
            final_state = {"error": str(exc)}
            repo.log_event(run.conversation_id, event.to_dict())
            _log("run_failed", run_id=run.run_id, conversation_id=run.conversation_id, error=str(exc))
        finally:
            run.result = final_state
            final_preview = run.flags.get("final_preview") or self._final_preview(final_state)
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

    def _events_from_update(self, node_name: str, update: Dict[str, Any], run: AgentRun) -> List[AgentEvent]:
        events: List[AgentEvent] = []
        run_metadata = {"run_id": run.run_id}
        
        if node_name == "reasoning":
            decision = update.get("context", {}).get("reasoning_decision")
            reason = _extract_reasoning_message(update) or ""
            # Send one reasoning event per node execution (avoid duplicates)
            events.append(
                AgentEvent(
                    type=EventType.REASONING,
                    subtype=EventSubType.CHUNK,
                    content={"decision": decision, "reason": reason},
                    metadata=run_metadata,
                )
            )
        elif node_name == "planner":
            plan = _serialize_plan(update)
            events.append(
                AgentEvent(
                    type=EventType.TOOL,
                    subtype=EventSubType.END,
                    content={"tool": "planner", "plan": plan},
                    metadata=run_metadata,
                )
            )
        elif node_name == "schema":
            preview = update.get("context", {}).get("schema_preview", [])
            events.append(
                AgentEvent(
                    type=EventType.TOOL,
                    subtype=EventSubType.CHUNK,
                    content={"tool": "schema", "preview": preview},
                    metadata=run_metadata,
                )
            )
        elif node_name == "sql":
            sql_text = update.get("working_sql") or ""
            events.append(
                AgentEvent(
                    type=EventType.TOOL,
                    subtype=EventSubType.CHUNK,
                    content={"tool": "sql", "sql": sql_text},
                    metadata=run_metadata,
                )
            )
        elif node_name == "verifier":
            result = update.get("verification_result", {})
            events.append(
                AgentEvent(
                    type=EventType.TOOL,
                    subtype=EventSubType.END,
                    content={"tool": "verifier", "result": _serialize(result)},
                    metadata=run_metadata,
                )
            )
        elif node_name == "finalize":
            context = update.get("context", {})
            final_answer = context.get("final_answer", "")
            
            # Create event with just the final answer
            events.append(
                AgentEvent(
                    type=EventType.MESSAGE,
                    subtype=EventSubType.FINAL,
                    content={"text": final_answer},
                    metadata=run_metadata,
                )
            )
            
            # Save only the final answer to DB, not the entire context
            repo = get_chat_repository()
            repo.append_message(run.conversation_id, "assistant", {"text": final_answer}, run_id=run.run_id)
            if isinstance(final_answer, str) and final_answer.strip():
                run.flags["final_preview"] = final_answer.strip()[:160]
        return events

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
    graph = build_agent_graph()
    state = AgentState(conversation_id=str(uuid4()), user_query=question, model=model)
    state.add_message(MessageRole.USER, question)
    final_state: Dict[str, Any] = {}
    async for chunk in graph.astream(state, stream_mode=["updates", "values"]):
        if isinstance(chunk, tuple) and len(chunk) == 2:
            mode, payload = chunk
        else:
            mode, payload = "updates", chunk
        if mode == "values" and isinstance(payload, dict):
            final_state = _serialize(payload)
    return final_state


