from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from pluto_duck_backend.app.services.chat.repository import ChatRepository


def test_append_message_persists_display_order_and_returns_it(tmp_path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    repo = ChatRepository(warehouse)

    conversation_id = str(uuid4())
    run_id = str(uuid4())
    repo.create_conversation(conversation_id, "hello", {})

    repo.append_message(
        conversation_id,
        "assistant",
        {"text": "first"},
        run_id=run_id,
        display_order=9,
    )
    repo.append_message(
        conversation_id,
        "assistant",
        {"text": "second"},
        run_id=run_id,
    )

    messages = repo.get_conversation_messages(conversation_id)

    assert len(messages) == 2
    assert messages[0]["display_order"] == 9
    assert messages[0]["content"]["display_order"] == 9
    assert messages[1]["display_order"] == 10
    assert messages[1]["content"]["display_order"] == 10



def test_get_next_display_order_uses_legacy_seq_and_sequence_fallback(tmp_path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    repo = ChatRepository(warehouse)

    conversation_id = str(uuid4())
    repo.create_conversation(conversation_id, "hello", {})

    with repo._write_connection() as con:
        legacy_run_id = str(uuid4())
        con.execute(
            """
            INSERT INTO agent_messages (id, conversation_id, role, content, created_at, seq, run_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                str(uuid4()),
                conversation_id,
                "assistant",
                json.dumps({"text": "legacy"}),
                datetime.now(UTC),
                7,
                legacy_run_id,
            ],
        )
        con.execute(
            """
            INSERT INTO agent_events (id, conversation_id, type, subtype, payload, metadata, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                str(uuid4()),
                conversation_id,
                "run",
                "end",
                json.dumps({}),
                json.dumps({"sequence": 11, "run_id": legacy_run_id}),
                datetime.now(UTC),
            ],
        )

    assert repo.get_next_display_order(conversation_id) == 12



def test_message_display_order_is_never_less_than_seq(tmp_path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    repo = ChatRepository(warehouse)

    conversation_id = str(uuid4())
    run_id = str(uuid4())
    repo.create_conversation(conversation_id, "hello", {})
    repo.set_active_run(conversation_id, run_id)

    repo.append_message(conversation_id, "user", {"text": "q1"}, run_id=run_id)
    repo.log_event(
        conversation_id,
        {
            "type": "run",
            "subtype": "start",
            "content": {"phase": "run_start"},
            "metadata": {"run_id": run_id},
        },
    )
    repo.append_message(conversation_id, "assistant", {"text": "a1"}, run_id=run_id)

    messages = repo.get_conversation_messages(conversation_id)

    assert len(messages) == 2
    for message in messages:
        assert message["display_order"] >= message["seq"]
