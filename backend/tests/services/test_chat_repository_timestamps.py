from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pluto_duck_backend.app.services.chat.repository import ChatRepository


def test_list_conversations_converts_naive_local_timestamps_to_utc(tmp_path) -> None:
    if not hasattr(time, "tzset"):
        pytest.skip("tzset is not available on this platform")

    original_tz = os.environ.get("TZ")
    try:
        os.environ["TZ"] = "Asia/Seoul"
        time.tzset()

        warehouse = tmp_path / "warehouse.duckdb"
        repo = ChatRepository(warehouse)
        conversation_id = str(uuid4())
        naive_local = datetime(2026, 2, 8, 18, 0, 0)

        with repo._write_connection() as con:
            con.execute(
                """
                INSERT INTO agent_conversations
                (
                    id, project_id, title, created_at, updated_at,
                    status, last_message_preview, run_id, metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    conversation_id,
                    repo._default_project_id,
                    "local-time test",
                    naive_local,
                    naive_local,
                    "active",
                    None,
                    None,
                    None,
                ],
            )

        summaries = repo.list_conversations(project_id=repo._default_project_id, limit=10, offset=0)
        summary = next((item for item in summaries if str(item.id) == conversation_id), None)
        assert summary is not None

        expected_utc = datetime.fromtimestamp(naive_local.timestamp(), UTC)
        assert summary.created_at == expected_utc
        assert summary.updated_at == expected_utc
        assert summary.updated_at <= datetime.now(UTC)
    finally:
        if original_tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = original_tz
        time.tzset()
