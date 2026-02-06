"""Background execution manager for query jobs."""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Optional

from .service import QueryExecutionService

logger = logging.getLogger(__name__)


class QueryExecutionManager:
    """Simple background worker that executes queued query jobs."""

    def __init__(self, service: QueryExecutionService, worker_count: int = 1) -> None:
        self.service = service
        self._queue: Queue[str] = Queue()
        self._workers = [
            Thread(target=self._worker, name=f"query-worker-{idx}", daemon=True)
            for idx in range(worker_count)
        ]
        for worker in self._workers:
            worker.start()

    def enqueue(self, run_id: str) -> None:
        logger.debug("Enqueuing query job %s", run_id)
        self._queue.put(run_id)

    def submit_sql(self, sql: str, run_id: Optional[str] = None) -> str:
        from uuid import uuid4

        run_identifier = run_id or str(uuid4())
        self.service.submit(run_identifier, sql)
        self.enqueue(run_identifier)
        return run_identifier

    def wait_for(self, run_id: str, timeout: float = 10.0, poll_interval: float = 0.1):
        deadline = time.time() + timeout
        while time.time() < deadline:
            job = self.service.fetch(run_id)
            if job and job.status != "pending":
                return job
            time.sleep(poll_interval)
        return self.service.fetch(run_id)

    def _worker(self) -> None:
        while True:
            run_id = self._queue.get()
            try:
                logger.debug("Executing queued query job %s", run_id)
                self.service.execute(run_id)
            except Exception:  # pragma: no cover - logging only
                logger.exception("Query job %s failed during execution", run_id)
            finally:
                self._queue.task_done()


@lru_cache(maxsize=32)
def get_execution_manager(*, warehouse_path: Path) -> QueryExecutionManager:
    service = QueryExecutionService(warehouse_path)
    return QueryExecutionManager(service)
