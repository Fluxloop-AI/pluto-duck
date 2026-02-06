"""Catalog mapping logical subjects/actions to service calls."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

import duckdb

from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from pluto_duck_backend.app.services.execution.manager import get_execution_manager


@dataclass
class ActionDefinition:
    subject: str
    action: str
    description: str
    handler: Callable[..., dict]

    def to_dict(self) -> Dict[str, object]:
        return {
            "subject": self.subject,
            "action": self.action,
            "description": self.description,
        }


class ActionCatalog:
    """In-memory catalog of actions available to the agent/API."""

    def __init__(self) -> None:
        self._actions: Dict[str, ActionDefinition] = {}

    def register(self, definition: ActionDefinition) -> None:
        key = self._key(definition.subject, definition.action)
        self._actions[key] = definition

    def list_actions(self, subject: Optional[str] = None) -> List[ActionDefinition]:
        if subject is None:
            return list(self._actions.values())
        return [action for action in self._actions.values() if action.subject == subject]

    def get(self, subject: str, action: str) -> ActionDefinition:
        key = self._key(subject, action)
        return self._actions[key]

    @staticmethod
    def _key(subject: str, action: str) -> str:
        return f"{subject}:{action}"


def _build_default_catalog() -> ActionCatalog:
    catalog = ActionCatalog()

    def query_handler(sql: str) -> dict:
        settings = get_settings()
        manager = get_execution_manager(warehouse_path=settings.duckdb.path)
        run_id = manager.submit_sql(sql)
        job = manager.wait_for(run_id)
        if not job:
            raise RuntimeError("Query job missing")
        return {
            "run_id": job.run_id,
            "status": job.status,
            "result_table": job.result_table,
            "error": job.error,
        }

    catalog.register(
        ActionDefinition(
            subject="query",
            action="run",
            description="Execute SQL against the local DuckDB warehouse.",
            handler=query_handler,
        )
    )

    _persist_catalog(catalog)

    return catalog


def _persist_catalog(catalog: ActionCatalog) -> None:
    settings = get_settings()
    warehouse_path = settings.duckdb.path
    if not warehouse_path.exists():
        return
    try:
        with connect_warehouse(warehouse_path) as con:
            con.execute(
            """
            CREATE TABLE IF NOT EXISTS action_catalog (
                subject TEXT,
                action TEXT,
                description TEXT,
                PRIMARY KEY (subject, action)
            )
            """
            )
            con.execute("DELETE FROM action_catalog")
            for action in catalog.list_actions():
                con.execute(
                    "INSERT INTO action_catalog (subject, action, description) VALUES (?, ?, ?)",
                    [action.subject, action.action, action.description],
                )
    except duckdb.IOException:
        # Warehouse might not exist yet (e.g., during tests); skip persistence.
        pass


_DEFAULT_CATALOG = _build_default_catalog()


def get_action_catalog() -> ActionCatalog:
    return _DEFAULT_CATALOG
