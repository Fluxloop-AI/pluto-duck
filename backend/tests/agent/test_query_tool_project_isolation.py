from pathlib import Path

import duckdb
from pluto_duck_backend.agent.core.deep.tools.query import build_query_tools
from pluto_duck_backend.app.services.execution.manager import get_execution_manager


def _create_test_warehouse(path: Path) -> None:
    with duckdb.connect(str(path)) as con:
        con.execute("CREATE SCHEMA IF NOT EXISTS _file_assets")
        con.execute(
            """
            CREATE TABLE _file_assets.files (
                id TEXT,
                project_id TEXT,
                table_name TEXT
            )
            """
        )
        con.execute("CREATE TABLE orders_a (id INTEGER, amount INTEGER)")
        con.execute("CREATE TABLE orders_b (id INTEGER, amount INTEGER)")
        con.execute("INSERT INTO orders_a VALUES (1, 100), (2, 200)")
        con.execute("INSERT INTO orders_b VALUES (7, 700)")
        con.execute(
            """
            INSERT INTO _file_assets.files (id, project_id, table_name)
            VALUES
                ('f1', 'proj-a', 'orders_a'),
                ('f2', 'proj-b', 'orders_b')
            """
        )


def _run_sql_tool(warehouse: Path, project_id: str):
    get_execution_manager.cache_clear()
    tools = {
        tool.name: tool
        for tool in build_query_tools(
            warehouse_path=warehouse,
            project_id=project_id,
        )
    }
    return tools["run_sql"].func


def test_run_sql_allows_project_owned_select(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    run_sql = _run_sql_tool(warehouse, project_id="proj-a")

    result = run_sql("WITH src AS (SELECT * FROM orders_a) SELECT * FROM src ORDER BY id")

    assert result["status"] == "success"
    assert result["error"] is None
    assert result["preview"] == [{"id": 1, "amount": 100}, {"id": 2, "amount": 200}]


def test_run_sql_blocks_cross_project_table_reference(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    run_sql = _run_sql_tool(warehouse, project_id="proj-a")

    result = run_sql("SELECT * FROM orders_b")

    assert result["status"] == "error"
    assert result["error"] == "SQL references unauthorized table(s): main.orders_b"


def test_run_sql_blocks_non_read_only_statements(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    run_sql = _run_sql_tool(warehouse, project_id="proj-a")

    result = run_sql("CREATE TABLE temp_x AS SELECT 1")

    assert result["status"] == "error"
    assert result["error"] == "Only read-only SQL queries (SELECT / WITH ... SELECT) are allowed."

