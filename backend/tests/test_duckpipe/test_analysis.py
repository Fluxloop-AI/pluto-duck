"""Tests for Analysis model."""

from datetime import datetime

import pytest

from duckpipe.core.analysis import Analysis, ParameterDef
from duckpipe.core.ref import Ref, RefType


class TestParameterDef:
    """Test ParameterDef class."""

    def test_basic_creation(self):
        """Test basic parameter creation."""
        param = ParameterDef(name="start_date", type="date")
        assert param.name == "start_date"
        assert param.type == "date"
        assert param.default is None

    def test_with_default(self):
        """Test parameter with default value."""
        param = ParameterDef(name="limit", type="int", default=100)
        assert param.default == 100

    def test_to_dict(self):
        """Test serialization to dict."""
        param = ParameterDef(
            name="value",
            type="int",
            default=42,
            description="Test param",
        )
        data = param.to_dict()
        assert data["name"] == "value"
        assert data["type"] == "int"
        assert data["default"] == 42
        assert data["description"] == "Test param"

    def test_from_dict(self):
        """Test deserialization from dict."""
        data = {
            "name": "value",
            "type": "float",
            "default": 3.14,
        }
        param = ParameterDef.from_dict(data)
        assert param.name == "value"
        assert param.type == "float"
        assert param.default == 3.14


class TestAnalysis:
    """Test Analysis class."""

    def test_basic_creation(self):
        """Test basic analysis creation."""
        analysis = Analysis(
            id="test",
            name="Test Analysis",
            sql="SELECT 1",
        )
        assert analysis.id == "test"
        assert analysis.name == "Test Analysis"
        assert analysis.sql == "SELECT 1"
        assert analysis.materialize == "table"

    def test_result_table(self):
        """Test result_table property."""
        analysis = Analysis(id="monthly_revenue", name="Test", sql="SELECT 1")
        assert analysis.result_table == "analysis.monthly_revenue"

    def test_get_analysis_dependencies(self):
        """Test getting analysis-type dependencies."""
        analysis = Analysis(
            id="test",
            name="Test",
            sql="SELECT 1",
            depends_on=[
                Ref(RefType.ANALYSIS, "dep1"),
                Ref(RefType.SOURCE, "source1"),
                Ref(RefType.ANALYSIS, "dep2"),
            ],
        )
        deps = analysis.get_analysis_dependencies()
        assert deps == ["dep1", "dep2"]

    def test_get_source_dependencies(self):
        """Test getting source-type dependencies."""
        analysis = Analysis(
            id="test",
            name="Test",
            sql="SELECT 1",
            depends_on=[
                Ref(RefType.ANALYSIS, "dep1"),
                Ref(RefType.SOURCE, "source1"),
                Ref(RefType.SOURCE, "source2"),
            ],
        )
        deps = analysis.get_source_dependencies()
        assert deps == ["source1", "source2"]

    def test_to_dict(self):
        """Test serialization to dict."""
        analysis = Analysis(
            id="test",
            name="Test Analysis",
            sql="SELECT :value",
            materialize="view",
            description="A test",
            parameters=[ParameterDef(name="value", type="int")],
            depends_on=[Ref(RefType.ANALYSIS, "dep1")],
            tags=["test"],
            created_at=datetime(2025, 1, 1),
            updated_at=datetime(2025, 1, 2),
        )
        data = analysis.to_dict()

        assert data["id"] == "test"
        assert data["name"] == "Test Analysis"
        assert data["sql"] == "SELECT :value"
        assert data["materialize"] == "view"
        assert data["description"] == "A test"
        assert "value" in data["parameters"]
        assert data["depends_on"] == ["analysis:dep1"]
        assert data["tags"] == ["test"]

    def test_from_dict(self):
        """Test deserialization from dict."""
        data = {
            "id": "test",
            "name": "Test Analysis",
            "sql": "SELECT 1",
            "materialize": "table",
            "parameters": {
                "value": {"type": "int", "default": 42}
            },
            "depends_on": ["analysis:dep1", "source:pg.orders"],
            "tags": ["test"],
            "created_at": "2025-01-01T00:00:00",
        }
        analysis = Analysis.from_dict(data)

        assert analysis.id == "test"
        assert analysis.name == "Test Analysis"
        assert len(analysis.parameters) == 1
        assert analysis.parameters[0].name == "value"
        assert len(analysis.depends_on) == 2
        assert analysis.depends_on[0].type == RefType.ANALYSIS
        assert analysis.depends_on[1].type == RefType.SOURCE
        assert analysis.created_at == datetime(2025, 1, 1)

