from pathlib import Path

import duckdb
import pytest
from pluto_duck_backend.agent.core.deep.tools.project_scope import (
    clear_project_table_scope_cache,
    resolve_project_table_scope,
)


@pytest.fixture(autouse=True)
def _clear_scope_cache_between_tests():
    clear_project_table_scope_cache()
    yield
    clear_project_table_scope_cache()


def _create_test_warehouse(path: Path) -> None:
    with duckdb.connect(str(path)) as con:
        con.execute("CREATE SCHEMA IF NOT EXISTS _file_assets")
        con.execute("CREATE SCHEMA IF NOT EXISTS analysis")

        con.execute(
            """
            CREATE TABLE _file_assets.files (
                id TEXT,
                project_id TEXT,
                table_name TEXT
            )
            """
        )
        con.execute("CREATE TABLE orders (id INTEGER)")
        con.execute("CREATE TABLE customers (id INTEGER)")
        con.execute("CREATE TABLE main.projects (id INTEGER)")
        con.execute("CREATE TABLE analysis.sales_a (id INTEGER)")
        con.execute("CREATE VIEW analysis.sales_v AS SELECT 1 AS value")

        con.execute(
            """
            INSERT INTO _file_assets.files (id, project_id, table_name)
            VALUES
                ('f1', 'proj-a', 'orders'),
                ('f2', 'proj-b', 'customers')
            """
        )


def test_resolver_returns_project_owned_and_analysis_tables(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)

    scope = resolve_project_table_scope(
        warehouse_path=warehouse,
        project_id="proj-a",
    )

    assert "main.orders" in scope
    assert "main.customers" not in scope
    assert "main.projects" not in scope
    assert "analysis.sales_a" in scope
    assert "analysis.sales_v" in scope


def test_resolver_can_exclude_analysis_schema(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)

    scope = resolve_project_table_scope(
        warehouse_path=warehouse,
        project_id="proj-a",
        include_analysis_schema=False,
    )

    assert "main.orders" in scope
    assert "analysis.sales_a" not in scope
    assert "analysis.sales_v" not in scope


def test_resolver_handles_missing_file_assets_table(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    with duckdb.connect(str(warehouse)) as con:
        con.execute("CREATE SCHEMA IF NOT EXISTS analysis")
        con.execute("CREATE TABLE analysis.sales_only (id INTEGER)")

    scope = resolve_project_table_scope(
        warehouse_path=warehouse,
        project_id="proj-a",
    )

    assert scope == {"analysis.sales_only"}


def test_resolver_uses_short_ttl_cache(tmp_path: Path) -> None:
    warehouse = tmp_path / "warehouse.duckdb"
    _create_test_warehouse(warehouse)

    first_scope = resolve_project_table_scope(
        warehouse_path=warehouse,
        project_id="proj-a",
        cache_ttl_seconds=60.0,
    )
    assert "main.payments" not in first_scope

    with duckdb.connect(str(warehouse)) as con:
        con.execute("CREATE TABLE payments (id INTEGER)")
        con.execute(
            """
            INSERT INTO _file_assets.files (id, project_id, table_name)
            VALUES ('f3', 'proj-a', 'payments')
            """
        )

    cached_scope = resolve_project_table_scope(
        warehouse_path=warehouse,
        project_id="proj-a",
        cache_ttl_seconds=60.0,
    )
    uncached_scope = resolve_project_table_scope(
        warehouse_path=warehouse,
        project_id="proj-a",
        cache_ttl_seconds=0.0,
    )

    assert "main.payments" not in cached_scope
    assert "main.payments" in uncached_scope

