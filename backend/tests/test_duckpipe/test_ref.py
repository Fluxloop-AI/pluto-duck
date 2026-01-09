"""Tests for Ref and RefType."""

import pytest

from duckpipe.core.ref import Ref, RefType


class TestRef:
    """Test Ref class."""

    def test_parse_analysis_ref(self):
        """Test parsing analysis reference."""
        ref = Ref.parse("analysis:monthly_revenue")
        assert ref.type == RefType.ANALYSIS
        assert ref.name == "monthly_revenue"

    def test_parse_source_ref(self):
        """Test parsing source reference."""
        ref = Ref.parse("source:pg.orders")
        assert ref.type == RefType.SOURCE
        assert ref.name == "pg.orders"

    def test_parse_file_ref(self):
        """Test parsing file reference."""
        ref = Ref.parse("file:/data/sales.parquet")
        assert ref.type == RefType.FILE
        assert ref.name == "/data/sales.parquet"

    def test_parse_legacy_format(self):
        """Test parsing legacy format (no prefix)."""
        ref = Ref.parse("monthly_revenue")
        assert ref.type == RefType.ANALYSIS
        assert ref.name == "monthly_revenue"

    def test_str(self):
        """Test string conversion."""
        ref = Ref(RefType.ANALYSIS, "test")
        assert str(ref) == "analysis:test"

        ref = Ref(RefType.SOURCE, "pg.orders")
        assert str(ref) == "source:pg.orders"

    def test_to_table_name_analysis(self):
        """Test table name for analysis ref."""
        ref = Ref(RefType.ANALYSIS, "monthly_revenue")
        assert ref.to_table_name() == "analysis.monthly_revenue"

    def test_to_table_name_source(self):
        """Test table name for source ref."""
        ref = Ref(RefType.SOURCE, "pg_orders")
        assert ref.to_table_name() == "source.pg_orders"

    def test_to_table_name_file(self):
        """Test table name for file ref."""
        ref = Ref(RefType.FILE, "/data/sales.parquet")
        assert ref.to_table_name() == "read_parquet('/data/sales.parquet')"

    def test_is_analysis(self):
        """Test is_analysis method."""
        assert Ref(RefType.ANALYSIS, "test").is_analysis()
        assert not Ref(RefType.SOURCE, "test").is_analysis()

    def test_is_source(self):
        """Test is_source method."""
        assert Ref(RefType.SOURCE, "test").is_source()
        assert not Ref(RefType.ANALYSIS, "test").is_source()

    def test_is_file(self):
        """Test is_file method."""
        assert Ref(RefType.FILE, "test").is_file()
        assert not Ref(RefType.ANALYSIS, "test").is_file()

    def test_frozen(self):
        """Test that Ref is frozen (immutable)."""
        ref = Ref(RefType.ANALYSIS, "test")
        with pytest.raises(Exception):  # FrozenInstanceError
            ref.name = "changed"

