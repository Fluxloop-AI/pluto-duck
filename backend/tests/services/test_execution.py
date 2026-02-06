from pathlib import Path
from uuid import uuid4

import duckdb

from pluto_duck_backend.app.services.execution import QueryExecutionService


def test_query_execution_success(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    service = QueryExecutionService(warehouse)

    run_id = str(uuid4())
    service.submit(run_id, "select 1 as value")
    job = service.execute(run_id)

    assert job.status == "success"
    fetched = service.fetch(run_id)
    assert fetched is not None
    assert fetched.result_table is not None


def test_query_execution_can_still_read_internal_query_history(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    service = QueryExecutionService(warehouse)

    seed_run = str(uuid4())
    service.submit(seed_run, "select 1 as value")
    service.execute(seed_run)

    probe_run = str(uuid4())
    service.submit(probe_run, "select count(*) as cnt from query_history")
    probe_job = service.execute(probe_run)

    assert probe_job.status == "success"
    assert probe_job.result_table is not None
    with duckdb.connect(str(warehouse)) as con:
        count = con.execute(f"select cnt from {probe_job.result_table}").fetchone()[0]
    assert count >= 1
