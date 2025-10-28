"""Schema exploration node."""

from __future__ import annotations

from typing import List

import duckdb

from pluto_duck_backend.agent.core import AgentState, MessageRole
from pluto_duck_backend.agent.core.prompts import try_load_prompt
from pluto_duck_backend.app.core.config import get_settings

DEFAULT_SCHEMA_PROMPT = "Summarize available tables for the user."


def build_schema_node():
    settings = get_settings()
    prompt = try_load_prompt("schema_prompt") or DEFAULT_SCHEMA_PROMPT

    async def schema_node(state: AgentState) -> AgentState:
        with duckdb.connect(str(settings.duckdb.path)) as con:
            rows = con.execute("SHOW TABLES").fetchall()
        all_tables = [row[0] for row in rows]

        preferred = state.preferred_tables or []
        preferred_set = set(preferred)

        prioritized_tables = [table for table in all_tables if table in preferred_set]
        other_tables = [table for table in all_tables if table not in preferred_set]

        state.context["schema_preview"] = prioritized_tables + other_tables
        state.context["preferred_tables"] = prioritized_tables
        state.context["other_tables"] = other_tables

        if prioritized_tables:
            summary_lines = [
                "Priority tables: " + ", ".join(prioritized_tables),
            ]
            if other_tables:
                summary_lines.append("Other tables: " + ", ".join(other_tables))
            summary = "\n".join(summary_lines)
            _log(
                "schema_preview_prioritized",
                conversation_id=state.conversation_id,
                preferred_count=len(prioritized_tables),
                other_count=len(other_tables),
            )
        else:
            summary = f"Schema preview: {', '.join(all_tables)}" if all_tables else "No tables found."
            _log(
                "schema_preview",
                conversation_id=state.conversation_id,
                table_count=len(all_tables),
            )

        state.add_message(MessageRole.ASSISTANT, summary)
        return state

    return schema_node


def _log(message: str, **fields: object) -> None:
    payload = " ".join(f"{key}={value}" for key, value in fields.items()) if fields else ""
    print(f"[agent][schema] {message} {payload}")


