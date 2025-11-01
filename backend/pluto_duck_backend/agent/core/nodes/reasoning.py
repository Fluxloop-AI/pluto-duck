"""Reasoning node for deciding the next agent action."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from pluto_duck_backend.agent.core import AgentState, MessageRole
from pluto_duck_backend.agent.core.llm.providers import get_llm_provider
from pluto_duck_backend.agent.core.prompts import try_load_prompt

logger = logging.getLogger(__name__)


DEFAULT_MASTER_PROMPT = (
    "You are the Pluto-Duck OSS agent controller. "
    "Given the plan, recent messages, and execution context, "
    "decide the next action to take. Respond as compact JSON: "
    '{"next": "planner|schema|sql|verifier|finalize", "reason": "..."}.'
)


def build_reasoning_node():
    """Return an async function compatible with LangGraph nodes."""

    async def reasoning_node(state: AgentState) -> AgentState:
        provider = get_llm_provider(model=state.model)
        master_prompt = try_load_prompt("master_prompt") or DEFAULT_MASTER_PROMPT
        prompt = _compose_prompt(state, master_prompt)
        
        logger.info(
            f"[REASONING] INPUT STATE - conversation_id={state.conversation_id}, "
            f"plan_count={len(state.plan)}, "
            f"schema_preview={state.context.get('schema_preview', [])[: 3]}, "
            f"table_columns_keys={list(state.context.get('table_columns', {}).keys())}, "
            f"schema_completed={state.context.get('schema_completed')}, "
            f"working_sql={bool(state.working_sql)}, "
            f"verification_result={bool(state.verification_result)}"
        )
        
        response = await provider.ainvoke(prompt)
        parsed = _parse_decision(response)
        decision = parsed["next"]
        
        logger.info(
            f"[REASONING] LLM RAW DECISION - decision={decision}, reason={parsed['reason'][:100]}"
        )
        
        if decision == "planner" and state.plan:
            decision = _auto_progress(state)
            logger.info(f"[REASONING] AUTO-PROGRESS OVERRIDE - new_decision={decision}")
        
        state.add_message(MessageRole.REASONING, parsed["reason"])
        state.context["reasoning_decision"] = decision
        # Store final message if provided (for finalize node)
        if parsed.get("message"):
            state.context["final_message"] = parsed["message"]
        logger.debug(
            "Reasoning decision",
            extra={
                "conversation_id": state.conversation_id,
                "decision": decision,
                "reason": parsed["reason"],
            },
        )
        
        logger.info(
            f"[REASONING] FINAL DECISION - decision={decision}, "
            f"stored in context['reasoning_decision']"
        )
        
        return state

    return reasoning_node


def route_after_reasoning(state: AgentState) -> str:
    decision = state.context.get("reasoning_decision")
    if decision:
        return decision
    return _auto_progress(state)


def _auto_progress(state: AgentState) -> str:
    logger.info(
        f"[REASONING] _auto_progress check - "
        f"plan={bool(state.plan)}, "
        f"schema_preview={bool(state.context.get('schema_preview'))}, "
        f"table_columns={bool(state.context.get('table_columns'))}, "
        f"schema_completed={state.context.get('schema_completed')}, "
        f"needs_table_confirmation={state.context.get('needs_table_confirmation')}, "
        f"working_sql={bool(state.working_sql)}, "
        f"verification_result={bool(state.verification_result)}"
    )
    
    if not state.plan:
        return "planner"
    if "schema_preview" not in state.context:
        return "schema"
    # If schema says user needs to pick a table, ask them via finalize
    if state.context.get("needs_table_confirmation") and state.context.get("schema_completed"):
        if not state.context.get("final_message"):
            tables = state.context.get("schema_preview", [])
            table_hint = ", ".join(tables[:5]) if tables else "(no tables)"
            state.context["final_message"] = (
                f"I found these tables: {table_hint}. "
                f"Please specify which table you'd like to analyze."
            )
        return "finalize"
    # If schema is already completed, skip re-running schema
    if state.context.get("schema_completed") and not state.working_sql:
        return "sql"
    if not state.working_sql:
        return "sql"
    if not state.verification_result:
        return "verifier"
    return "finalize"


def _compose_prompt(state: AgentState, master_prompt: str) -> str:
    plan_summary = "\n".join(f"- {step.description} ({step.status})" for step in state.plan) or "(no plan yet)"
    recent_messages = "\n".join(f"[{msg.role.value}] {msg.content}" for msg in state.messages[-5:])
    verification = state.verification_result or {}
    context_flags = []
    sanitized_query = state.context.get("sanitized_user_query") or state.user_query
    if state.context.get("needs_table_confirmation"):
        context_flags.append("needs_table_confirmation=True")
    if state.context.get("schema_completed"):
        context_flags.append("schema_completed=True")
    preferred_tables = state.context.get("preferred_tables") or state.preferred_tables or []
    if preferred_tables:
        context_flags.append("preferred_tables=" + ",".join(preferred_tables))
    schema_preview = state.context.get("schema_preview", [])
    table_columns = state.context.get("table_columns", {})
    column_snippets = []
    if isinstance(table_columns, dict):
        for table_name, columns in table_columns.items():
            if not columns:
                continue
            preview = ", ".join(columns[:8])
            if len(columns) > 8:
                preview += ", …"
            column_snippets.append(f"{table_name}: {preview}")
    context_summary = " | ".join(context_flags) if context_flags else "(none)"
    column_summary = "; ".join(column_snippets) if column_snippets else "(none)"
    
    prompt_text = (
        f"{master_prompt}\n"
        f"Sanitized user question: {sanitized_query}\n"
        f"Context flags: {context_summary}\n"
        f"Schema preview: {schema_preview}\n"
        f"Column preview: {column_summary}\n"
        f"Current plan:\n{plan_summary}\n"
        f"Recent messages:\n{recent_messages}\n"
        f"Working SQL: {state.working_sql or 'N/A'}\n"
        f"Verification: {verification}\n"
    )
    
    logger.info(f"[REASONING] PROMPT TO LLM:\n{prompt_text}\n{'='*80}")
    
    return prompt_text


def _parse_decision(response: str) -> Dict[str, str]:
    try:
        payload = json.loads(response)
        next_action = payload.get("next", "planner")
        reason = payload.get("reason", "No rationale provided")
        message = payload.get("message", "")
    except json.JSONDecodeError:
        next_action = "planner"
        reason = response.strip() or "No rationale provided"
        message = ""
    normalized = next_action.strip().lower()
    aliases = {
        "final": "finalize",
        "finish": "finalize",
        "complete": "finalize",
        "verification": "verifier",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in {"planner", "schema", "sql", "verifier", "finalize"}:
        normalized = "planner"
    return {"next": normalized, "reason": reason, "message": message}


