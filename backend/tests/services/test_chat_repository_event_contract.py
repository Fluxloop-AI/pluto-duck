from __future__ import annotations

from uuid import uuid4

from pluto_duck_backend.app.services.chat.repository import ChatRepository


def test_log_and_get_events_normalize_canonical_contract_fields(tmp_path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    repo = ChatRepository(warehouse)

    conversation_id = str(uuid4())
    run_id = str(uuid4())
    repo.create_conversation(conversation_id, "hello", {})
    repo.set_active_run(conversation_id, run_id)

    repo.log_event(
        conversation_id,
        {
            "type": "reasoning",
            "subtype": "start",
            "content": {"phase": "llm_start"},
            "timestamp": "2025-01-01T00:00:00+00:00",
        },
    )
    repo.log_event(
        conversation_id,
        {
            "type": "tool",
            "subtype": "start",
            "content": {"tool": "list_tables", "tool_call_id": "call-1"},
            "metadata": {"run_id": run_id},
            "timestamp": "2025-01-01T00:00:01+00:00",
        },
    )

    events = repo.get_conversation_events(conversation_id, limit=10)

    assert len(events) == 2

    first = events[0]
    second = events[1]

    for event in events:
        assert "type" in event
        assert "subtype" in event
        assert "content" in event
        assert "metadata" in event
        assert "timestamp" in event
        assert isinstance(event.get("event_id"), str)
        assert event["event_id"]
        assert isinstance(event.get("sequence"), int)
        assert event["sequence"] > 0
        assert event.get("run_id") == run_id

    assert first["sequence"] == 1
    assert first["phase"] == "llm_start"
    assert first["metadata"]["event_id"] == first["event_id"]
    assert first["metadata"]["sequence"] == first["sequence"]
    assert first["metadata"]["run_id"] == first["run_id"]

    assert second["sequence"] == 2
    assert second["tool_call_id"] == "call-1"
    assert second["metadata"]["tool_call_id"] == "call-1"

