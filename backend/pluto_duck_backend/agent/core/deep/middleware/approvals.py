"""HITL approval persistence middleware (Phase 1).

Responsibilities:
- Detect tool calls that are subject to HITL approval (write_file/edit_file/task)
- Create a persistent approval row in DuckDB via ChatRepository
- Attach a lightweight mapping of tool_call_id -> approval_id into runtime state (best-effort)

Phase 3 update:
- This middleware ALSO gates tool execution: it will await a decision via ApprovalBroker
  and only then run the tool (or return a rejection message).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional
from uuid import uuid4

from langchain.agents.middleware.types import AgentMiddleware, ModelRequest, ModelResponse
from langchain.tools.tool_node import ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from pluto_duck_backend.app.services.chat import get_chat_repository
from pluto_duck_backend.agent.core.deep.hitl import ApprovalBroker, ApprovalDecision


@dataclass(frozen=True)
class PlutoDuckHITLConfig:
    conversation_id: str
    run_id: str
    decided_by: str = "user"


def _needs_approval(tool_name: str) -> bool:
    return tool_name in {"write_file", "edit_file", "task"}


def _preview_for_tool(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    if tool_name in {"write_file", "edit_file"}:
        return {
            "file_path": args.get("file_path"),
            "replace_all": bool(args.get("replace_all", False)) if tool_name == "edit_file" else None,
            "content_lines": len(str(args.get("content", "")).splitlines()) if tool_name == "write_file" else None,
        }
    if tool_name == "task":
        description = str(args.get("description", "") or "")
        return {
            "subagent_type": args.get("subagent_type"),
            "description_preview": description[:500],
        }
    return {"args": args}


class ApprovalPersistenceMiddleware(AgentMiddleware):
    """Persist approval requests for HITL tools."""

    def __init__(self, *, config: PlutoDuckHITLConfig, broker: ApprovalBroker) -> None:
        self._config = config
        self._broker = broker

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        # No prompt modification here; policy prompts are handled in agent builder.
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(request)

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        self._persist_if_needed(request)
        return handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        tool_call = request.tool_call
        tool_name = str(tool_call.get("name") or "")
        if not tool_name or not _needs_approval(tool_name):
            return await handler(request)

        args = tool_call.get("args") or {}
        if not isinstance(args, dict):
            args = {"_raw_args": args}

        tool_call_id = getattr(request.runtime, "tool_call_id", None) or tool_call.get("id") or ""
        approval_id = str(uuid4())

        repo = get_chat_repository()
        preview = _preview_for_tool(tool_name, args)
        try:
            repo.create_tool_approval(
                approval_id=approval_id,
                conversation_id=self._config.conversation_id,
                run_id=self._config.run_id,
                tool_name=tool_name,
                tool_call_id=str(tool_call_id),
                request_args=args,
                request_preview=preview,
                policy={"hitl_required": True},
            )
        except Exception:
            # Best-effort persistence; still gate execution if possible.
            pass

        await self._broker.emit_approval_required(
            approval_id=approval_id,
            tool_name=tool_name,
            preview=preview,
        )

        decision = await self._broker.wait(approval_id)

        effective_args = args
        if decision.decision == "reject":
            await self._broker.emit_decision_applied(
                approval_id=approval_id,
                tool_name=tool_name,
                decision=decision,
                effective_args=None,
            )
            return ToolMessage(
                content=f"User rejected tool call: {tool_name}. You must not retry the same action.",
                tool_call_id=str(tool_call_id) if tool_call_id else None,  # type: ignore[arg-type]
            )

        if decision.decision == "edit" and decision.edited_args is not None:
            effective_args = decision.edited_args
            tool_call["args"] = effective_args

        await self._broker.emit_decision_applied(
            approval_id=approval_id,
            tool_name=tool_name,
            decision=decision,
            effective_args=effective_args,
        )

        return await handler(request)

    # Note: we keep the sync wrap_tool_call path as "persist-only" because we can't await in sync mode.


