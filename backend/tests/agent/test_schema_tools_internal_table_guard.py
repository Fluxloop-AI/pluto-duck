from pathlib import Path

import duckdb
from pluto_duck_backend.agent.core.deep.tools.schema import build_schema_tools


def _create_test_warehouse(path: Path) -> None:
    with duckdb.connect(str(path)) as con:
        con.execute("CREATE SCHEMA IF NOT EXISTS analysis")
        con.execute("CREATE SCHEMA IF NOT EXISTS _file_assets")
        con.execute("CREATE TABLE projects (id INTEGER)")
        con.execute("CREATE TABLE agent_messages (id INTEGER)")
        con.execute("CREATE TABLE query_history (id INTEGER)")
        con.execute("CREATE TABLE _file_assets.files (id INTEGER)")
        con.execute("CREATE TABLE orders (id INTEGER, amount INTEGER)")
        con.execute("CREATE TABLE analysis.sales (id INTEGER, amount INTEGER)")
        con.execute("CREATE TABLE analysis.projects (id INTEGER)")
        con.execute("INSERT INTO orders VALUES (1, 100)")
        con.execute("INSERT INTO analysis.sales VALUES (7, 700)")


def _schema_tool_funcs(warehouse: Path):
    tools = {tool.name: tool for tool in build_schema_tools(warehouse_path=warehouse)}
    return (
        tools["list_tables"].func,
        tools["describe_table"].func,
        tools["sample_rows"].func,
    )


def test_list_tables_hides_internal_tables(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    list_tables, _, _ = _schema_tool_funcs(warehouse)

    result = list_tables(schema="main")
    names = [item["name"] for item in result["tables"]]

    assert "orders" in names
    assert "projects" not in names
    assert "agent_messages" not in names
    assert "query_history" not in names


def test_list_tables_hides_internal_metadata_schema_tables(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    list_tables, _, _ = _schema_tool_funcs(warehouse)

    result = list_tables(schema="_file_assets")
    names = [item["name"] for item in result["tables"]]

    assert "files" not in names


def test_describe_and_sample_block_internal_table(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    _, describe_table, sample_rows = _schema_tool_funcs(warehouse)

    describe_result = describe_table(table="projects")
    sample_result = sample_rows(table="projects")

    expected_error = (
        "Access to internal metadata table 'main.projects' is blocked in schema tools. "
        "Use run_sql for explicit inspection."
    )
    assert describe_result["status"] == "error"
    assert describe_result["table"] == "main.projects"
    assert describe_result["error"] == expected_error
    assert sample_result["status"] == "error"
    assert sample_result["table"] == "main.projects"
    assert sample_result["error"] == expected_error


def test_schema_fallback_and_qualified_name_boundary(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)
    _, describe_table, sample_rows = _schema_tool_funcs(warehouse)

    fallback_result = describe_table(table="sales", schema="main")
    qualified_result = describe_table(table="analysis.projects")
    sample_result = sample_rows(table="sales", schema="main", limit=1)

    assert fallback_result["table"] == "analysis.sales"
    assert len(fallback_result["columns"]) == 2
    assert qualified_result["table"] == "analysis.projects"
    assert qualified_result.get("status") is None
    assert sample_result["table"] == "analysis.sales"
    assert sample_result["rows"] == [{"id": 7, "amount": 700}]
