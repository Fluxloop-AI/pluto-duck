from pathlib import Path

from pluto_duck_backend.app.services.actions import get_action_catalog
from pluto_duck_backend.app.services.execution.manager import QueryExecutionManager
from pluto_duck_backend.app.services.execution.service import QueryExecutionService


def test_action_catalog_contains_query_action(tmp_path: Path, monkeypatch) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    service = QueryExecutionService(warehouse)
    manager = QueryExecutionManager(service)

    monkeypatch.setattr(
        "pluto_duck_backend.app.services.actions.catalog.get_execution_manager",
        lambda *args, **kwargs: manager,
    )

    catalog = get_action_catalog()
    action = catalog.get("query", "run")
    result = action.handler("select 1 as value")
    assert result["status"] == "success"
