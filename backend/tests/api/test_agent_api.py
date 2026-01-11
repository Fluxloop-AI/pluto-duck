from __future__ import annotations

from typing import AsyncIterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from pluto_duck_backend.app.api.router import api_router


class DummyManager:
    def __init__(self) -> None:
        self.latest_run: str | None = None
        self._runs: dict[str, dict] = {}

    def start_run(self, question: str, *, model: str | None = None) -> tuple[str, str]:
        conversation_id = str(uuid4())
        run_id = str(uuid4())
        self.latest_run = run_id
        self._runs[run_id] = {"question": question, "conversation_id": conversation_id, "model": model}
        return conversation_id, run_id

    def start_run_for_conversation(self, conversation_id: str, question: str, *, create_if_missing: bool = False) -> str:
        _, run_id = self.start_run(question)
        self._runs[run_id]["conversation_id"] = conversation_id
        return run_id

    async def get_result(self, run_id: str) -> dict:
        if run_id != self.latest_run:
            raise KeyError(run_id)
        return {"finished": True}

    async def stream_events(self, run_id: str) -> AsyncIterator[dict]:
        if run_id != self.latest_run:
            raise KeyError(run_id)
        yield {"type": "reasoning", "subtype": "chunk", "content": {"reason": "mock"}}
        yield {"type": "run", "subtype": "end", "content": {"finished": True}}


def make_client(manager: DummyManager) -> TestClient:
    from fastapi import FastAPI

    app = FastAPI()

    from pluto_duck_backend.agent.core import orchestrator

    orchestrator._AGENT_MANAGER = manager  # type: ignore[attr-defined]
    app.include_router(api_router)
    return TestClient(app)


@pytest.fixture
def client() -> TestClient:
    return make_client(DummyManager())


def test_start_agent_run(client: TestClient) -> None:
    response = client.post("/api/v1/agent/run", json={"question": "List customers"})
    assert response.status_code == 202
    body = response.json()
    assert "run_id" in body
    assert body["events_url"].endswith(f"/api/v1/agent/{body['run_id']}/events")


def test_get_agent_result_not_found(client: TestClient) -> None:
    response = client.get(f"/api/v1/agent/{uuid4()}")
    assert response.status_code == 404


def test_stream_events(client: TestClient) -> None:
    run_id = client.post("/api/v1/agent/run", json={"question": "List"}).json()["run_id"]

    with client.stream("GET", f"/api/v1/agent/{run_id}/events") as response:
        lines = [line for line in response.iter_lines() if line]
    assert lines
    assert lines[0].startswith("data: ")


