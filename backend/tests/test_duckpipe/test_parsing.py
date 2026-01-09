"""Tests for SQL parsing and compilation."""

import pytest

from duckpipe.core.ref import RefType
from duckpipe.errors import ValidationError
from duckpipe.parsing.compiler import compile_sql, validate_identifier
from duckpipe.parsing.sql import extract_dependencies, validate_sql


class TestExtractDependencies:
    """Test dependency extraction from SQL."""

    def test_simple_table(self):
        """Test extracting simple table reference."""
        refs = extract_dependencies("SELECT * FROM orders")
        assert len(refs) == 1
        assert refs[0].type == RefType.SOURCE
        assert refs[0].name == "orders"

    def test_analysis_schema(self):
        """Test extracting analysis schema reference."""
        refs = extract_dependencies("SELECT * FROM analysis.monthly_revenue")
        assert len(refs) == 1
        assert refs[0].type == RefType.ANALYSIS
        assert refs[0].name == "monthly_revenue"

    def test_source_schema(self):
        """Test extracting source schema reference."""
        refs = extract_dependencies("SELECT * FROM source.pg_orders")
        assert len(refs) == 1
        assert refs[0].type == RefType.SOURCE
        assert refs[0].name == "pg_orders"

    def test_multiple_tables(self):
        """Test extracting multiple table references."""
        sql = """
        SELECT o.*, c.name
        FROM analysis.orders o
        JOIN source.customers c ON o.customer_id = c.id
        """
        refs = extract_dependencies(sql)
        assert len(refs) == 2

        types = {ref.type for ref in refs}
        assert RefType.ANALYSIS in types
        assert RefType.SOURCE in types

    def test_cte_excluded(self):
        """Test that CTE names are excluded."""
        sql = """
        WITH temp_data AS (
            SELECT * FROM analysis.source_data
        )
        SELECT * FROM temp_data
        """
        refs = extract_dependencies(sql)
        # Should only have source_data, not temp_data
        assert len(refs) == 1
        assert refs[0].name == "source_data"

    def test_invalid_sql(self):
        """Test handling of invalid SQL."""
        refs = extract_dependencies("NOT VALID SQL AT ALL")
        assert refs == []

    def test_deduplication(self):
        """Test that duplicate references are removed."""
        sql = """
        SELECT * FROM analysis.foo
        UNION ALL
        SELECT * FROM analysis.foo
        """
        refs = extract_dependencies(sql)
        assert len(refs) == 1


class TestValidateSql:
    """Test SQL validation."""

    def test_valid_sql(self):
        """Test valid SQL passes."""
        valid, error = validate_sql("SELECT 1")
        assert valid
        assert error is None

    def test_invalid_sql(self):
        """Test invalid SQL fails."""
        valid, error = validate_sql("SELEC 1")  # Typo
        assert not valid
        assert error is not None


class TestCompileSql:
    """Test SQL compilation."""

    def test_compile_view(self):
        """Test compiling VIEW materialization."""
        sql, params = compile_sql(
            "SELECT 1 as value",
            "view",
            "analysis.test",
            None,
        )
        assert "CREATE OR REPLACE VIEW" in sql
        assert "analysis.test" in sql
        assert params is None

    def test_compile_table(self):
        """Test compiling TABLE materialization."""
        sql, params = compile_sql(
            "SELECT 1 as value",
            "table",
            "analysis.test",
            None,
        )
        assert "CREATE OR REPLACE TABLE" in sql
        assert "analysis.test" in sql

    def test_compile_append(self):
        """Test compiling APPEND materialization."""
        sql, params = compile_sql(
            "SELECT 1 as value",
            "append",
            "analysis.test",
            None,
        )
        assert "INSERT INTO" in sql
        assert "analysis.test" in sql

    def test_compile_parquet(self):
        """Test compiling PARQUET materialization."""
        sql, params = compile_sql(
            "SELECT 1 as value",
            "parquet",
            "/path/to/file.parquet",
            None,
        )
        assert "COPY" in sql
        assert "FORMAT PARQUET" in sql

    def test_compile_preview(self):
        """Test compiling in preview mode."""
        sql, params = compile_sql(
            "SELECT 1 as value",
            "preview",
            None,
            None,
        )
        assert sql == "SELECT 1 as value"
        assert params is None

    def test_parameter_binding(self):
        """Test parameter binding."""
        sql, params = compile_sql(
            "SELECT :value as v",
            "preview",
            None,
            {"value": 42},
        )
        assert "$1" in sql or "42" in sql  # Depends on binding method
        assert params is not None or "42" in sql

    def test_list_parameter(self):
        """Test list parameter binding."""
        sql, params = compile_sql(
            "SELECT * FROM t WHERE id IN :ids",
            "preview",
            None,
            {"ids": [1, 2, 3]},
        )
        # Should expand to multiple placeholders
        assert params is not None
        assert len(params) == 3


class TestValidateIdentifier:
    """Test identifier validation."""

    def test_valid_simple(self):
        """Test valid simple identifier."""
        validate_identifier("test")  # Should not raise

    def test_valid_with_underscore(self):
        """Test valid identifier with underscore."""
        validate_identifier("monthly_revenue")  # Should not raise

    def test_valid_schema_table(self):
        """Test valid schema.table identifier."""
        validate_identifier("analysis.monthly_revenue")  # Should not raise

    def test_invalid_starts_with_number(self):
        """Test invalid identifier starting with number."""
        with pytest.raises(ValidationError):
            validate_identifier("123test")

    def test_invalid_special_chars(self):
        """Test invalid identifier with special characters."""
        with pytest.raises(ValidationError):
            validate_identifier("test-value")

    def test_empty(self):
        """Test empty identifier."""
        with pytest.raises(ValidationError):
            validate_identifier("")

