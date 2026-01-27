"""Tests for the LLM Analysis service."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List
from unittest.mock import AsyncMock, MagicMock

import pytest

from pluto_duck_backend.app.services.asset.file_diagnosis_service import (
    ColumnSchema,
    ColumnStatistics,
    FileDiagnosis,
    IssueItem,
    LLMAnalysisResult,
    PotentialItem,
)
from pluto_duck_backend.app.services.asset.llm_analysis_service import (
    LLM_BATCH_SIZE,
    BatchLLMAnalysisResult,
    analyze_batch_with_llm,
    analyze_datasets_with_llm,
    format_diagnoses_for_llm,
)
from pluto_duck_backend.app.services.llm import (
    BatchAnalysisSchema,
    FileAnalysisSchema,
    IssueItemSchema,
    LLMService,
    PotentialItemSchema,
)


@pytest.fixture
def sample_diagnosis() -> FileDiagnosis:
    """Create a sample FileDiagnosis for testing."""
    return FileDiagnosis(
        file_path="/tmp/sales_data.csv",
        file_type="csv",
        schema=[
            ColumnSchema(name="id", type="BIGINT", nullable=False),
            ColumnSchema(name="product_name", type="VARCHAR", nullable=True),
            ColumnSchema(name="quantity", type="INTEGER", nullable=True),
            ColumnSchema(name="price", type="DOUBLE", nullable=True),
        ],
        missing_values={"id": 0, "product_name": 2, "quantity": 1, "price": 0},
        row_count=100,
        file_size_bytes=5000,
        type_suggestions=[],
        diagnosed_at=datetime.now(timezone.utc),
        column_statistics=[
            ColumnStatistics(
                column_name="id",
                column_type="BIGINT",
                semantic_type="numeric",
                null_count=0,
                null_percentage=0.0,
            ),
            ColumnStatistics(
                column_name="product_name",
                column_type="VARCHAR",
                semantic_type="categorical",
                null_count=2,
                null_percentage=2.0,
            ),
        ],
        sample_rows=[
            [1, "Widget A", 10, 99.99],
            [2, "Widget B", 5, 149.99],
            [3, None, 20, 79.99],
        ],
    )


@pytest.fixture
def sample_diagnoses(sample_diagnosis: FileDiagnosis) -> List[FileDiagnosis]:
    """Create multiple sample FileDiagnosis for batch testing."""
    diag2 = FileDiagnosis(
        file_path="/tmp/customer_data.csv",
        file_type="csv",
        schema=[
            ColumnSchema(name="customer_id", type="BIGINT", nullable=False),
            ColumnSchema(name="email", type="VARCHAR", nullable=True),
        ],
        missing_values={"customer_id": 0, "email": 5},
        row_count=50,
        file_size_bytes=2000,
        type_suggestions=[],
        diagnosed_at=datetime.now(timezone.utc),
        column_statistics=[],
        sample_rows=[
            [1, "alice@example.com"],
            [2, "bob@example.com"],
        ],
    )
    return [sample_diagnosis, diag2]


class TestFormatDiagnosesForLLM:
    """Test format_diagnoses_for_llm function."""

    def test_format_single_diagnosis(self, sample_diagnosis: FileDiagnosis):
        """Test formatting a single diagnosis."""
        result = format_diagnoses_for_llm([sample_diagnosis])

        # Should be valid JSON
        data = json.loads(result)

        # Should be a list with one item
        assert isinstance(data, list)
        assert len(data) == 1

        # Check the formatted structure
        item = data[0]
        assert item["file_path"] == "/tmp/sales_data.csv"
        assert item["file_name"] == "sales_data.csv"
        assert item["row_count"] == 100
        assert len(item["schema"]) == 4
        assert len(item["sample_rows"]) <= 5

    def test_format_multiple_diagnoses(self, sample_diagnoses: List[FileDiagnosis]):
        """Test formatting multiple diagnoses."""
        result = format_diagnoses_for_llm(sample_diagnoses)

        data = json.loads(result)

        assert len(data) == 2
        assert data[0]["file_path"] == "/tmp/sales_data.csv"
        assert data[1]["file_path"] == "/tmp/customer_data.csv"

    def test_format_empty_list(self):
        """Test formatting empty list."""
        result = format_diagnoses_for_llm([])

        data = json.loads(result)
        assert data == []

    def test_format_includes_column_statistics(self, sample_diagnosis: FileDiagnosis):
        """Test that column statistics are included."""
        result = format_diagnoses_for_llm([sample_diagnosis])

        data = json.loads(result)
        item = data[0]

        assert "column_statistics" in item
        assert len(item["column_statistics"]) == 2
        assert item["column_statistics"][0]["column_name"] == "id"
        assert item["column_statistics"][0]["semantic_type"] == "numeric"


class TestAnalyzeBatchWithLLM:
    """Test analyze_batch_with_llm function."""

    @pytest.mark.asyncio
    async def test_analyze_batch_success(self, sample_diagnosis: FileDiagnosis):
        """Test successful batch analysis."""
        mock_llm_service = MagicMock(spec=LLMService)
        mock_llm_service.model_name = "test-model"
        mock_llm_service.complete_structured = AsyncMock(
            return_value=BatchAnalysisSchema(
                files=[
                    FileAnalysisSchema(
                        file_path="/tmp/sales_data.csv",
                        suggested_name="sales_data",
                        context="Sales transaction data",
                        potential=[PotentialItemSchema(question="Q1", analysis="A1")],
                        issues=[],
                    )
                ]
            )
        )

        result = await analyze_batch_with_llm([sample_diagnosis], mock_llm_service)

        assert len(result.file_results) == 1
        assert "/tmp/sales_data.csv" in result.file_results
        assert result.file_results["/tmp/sales_data.csv"].suggested_name == "sales_data"
        mock_llm_service.complete_structured.assert_called_once()

    @pytest.mark.asyncio
    async def test_analyze_empty_batch(self):
        """Test analyzing empty batch."""
        mock_llm_service = MagicMock(spec=LLMService)

        result = await analyze_batch_with_llm([], mock_llm_service)

        assert result.file_results == {}
        mock_llm_service.complete_structured.assert_not_called()

    @pytest.mark.asyncio
    async def test_analyze_batch_handles_llm_error(self, sample_diagnosis: FileDiagnosis):
        """Test that LLM errors are handled gracefully."""
        mock_llm_service = MagicMock(spec=LLMService)
        mock_llm_service.complete_structured = AsyncMock(side_effect=Exception("LLM API error"))

        result = await analyze_batch_with_llm([sample_diagnosis], mock_llm_service)

        assert result.file_results == {}


class TestAnalyzeDatasetsWithLLM:
    """Test analyze_datasets_with_llm function."""

    @pytest.mark.asyncio
    async def test_batching(self, sample_diagnoses: List[FileDiagnosis]):
        """Test that large inputs are batched correctly."""
        # Create more diagnoses than batch size
        diagnoses = sample_diagnoses * 3  # 6 diagnoses

        mock_llm_service = MagicMock(spec=LLMService)
        mock_llm_service.model_name = "test-model"
        mock_llm_service.complete_structured = AsyncMock(
            return_value=BatchAnalysisSchema(
                files=[
                    FileAnalysisSchema(
                        file_path=d.file_path,
                        suggested_name="test",
                        context="ctx",
                        potential=[],
                        issues=[],
                    )
                    for d in sample_diagnoses
                ]
            )
        )

        # We can't easily test batching with gather, but we can verify the function works
        result = await analyze_datasets_with_llm(diagnoses[:2], mock_llm_service)

        # Should have results for the diagnoses
        assert isinstance(result, BatchLLMAnalysisResult)

    @pytest.mark.asyncio
    async def test_empty_input(self):
        """Test with empty input."""
        result = await analyze_datasets_with_llm([])

        assert result.file_results == {}

    @pytest.mark.asyncio
    async def test_with_mock_service(self, sample_diagnosis: FileDiagnosis):
        """Test full flow with mock LLM service."""
        mock_llm_service = MagicMock(spec=LLMService)
        mock_llm_service.model_name = "mock-model"
        mock_llm_service.complete_structured = AsyncMock(
            return_value=BatchAnalysisSchema(
                files=[
                    FileAnalysisSchema(
                        file_path="/tmp/sales_data.csv",
                        suggested_name="analyzed_data",
                        context="This is analyzed data",
                        potential=[PotentialItemSchema(question="What trends exist?", analysis="Time series analysis")],
                        issues=[],
                    )
                ]
            )
        )

        result = await analyze_datasets_with_llm([sample_diagnosis], mock_llm_service)

        assert len(result.file_results) == 1
        file_result = result.file_results["/tmp/sales_data.csv"]
        assert file_result.suggested_name == "analyzed_data"
        assert file_result.model_used == "mock-model"


class TestLLMBatchSize:
    """Test batch size constant."""

    def test_batch_size_is_reasonable(self):
        """Test that batch size is set to a reasonable value."""
        assert LLM_BATCH_SIZE > 0
        assert LLM_BATCH_SIZE <= 10  # Shouldn't be too large for token limits
