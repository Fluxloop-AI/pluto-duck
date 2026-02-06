from pathlib import Path

import duckdb
from pluto_duck_backend.agent.core.deep.tools.project_scope import clear_project_table_scope_cache
from pluto_duck_backend.agent.core.deep.tools.schema import build_schema_tools


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
        con.execute("INSERT INTO orders_a VALUES (1, 100)")
        con.execute("INSERT INTO orders_b VALUES (2, 200)")
        con.execute(
            """
            INSERT INTO _file_assets.files (id, project_id, table_name)
            VALUES
                ('f1', 'proj-a', 'orders_a'),
                ('f2', 'proj-b', 'orders_b')
            """
        )


def _schema_tool_funcs(warehouse: Path, project_id: str):
    clear_project_table_scope_cache()
    tools = {
        tool.name: tool
        for tool in build_schema_tools(
            warehouse_path=warehouse,
            project_id=project_id,
        )
    }
    return (
        tools["list_tables"].func,
        tools["describe_table"].func,
        tools["sample_rows"].func,
    )


def test_list_tables_filters_out_other_project_tables(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    list_tables, _, _ = _schema_tool_funcs(warehouse, project_id="proj-a")

    result = list_tables(schema="main")
    names = [item["name"] for item in result["tables"]]

    assert "orders_a" in names
    assert "orders_b" not in names


def test_describe_and_sample_block_cross_project_table(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    _, describe_table, sample_rows = _schema_tool_funcs(warehouse, project_id="proj-a")

    describe_result = describe_table(table="orders_b", schema="main")
    sample_result = sample_rows(table="orders_b", schema="main")

    expected_error = "Access to table 'main.orders_b' is not allowed for this project."
    assert describe_result["status"] == "error"
    assert describe_result["table"] == "main.orders_b"
    assert describe_result["error"] == expected_error
    assert sample_result["status"] == "error"
    assert sample_result["table"] == "main.orders_b"
    assert sample_result["error"] == expected_error


def test_analysis_schema_request_for_cross_project_table_is_blocked(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    _, describe_table, _ = _schema_tool_funcs(warehouse, project_id="proj-a")

    result = describe_table(table="orders_b", schema="analysis")

    assert result["status"] == "error"
    assert result["table"] == "analysis.orders_b"
    assert result["error"] == "Access to table 'analysis.orders_b' is not allowed for this project."

