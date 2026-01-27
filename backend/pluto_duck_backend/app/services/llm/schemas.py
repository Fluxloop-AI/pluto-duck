"""Pydantic schemas for LLM structured output.

These schemas are used with LangChain's `with_structured_output()` method
to ensure consistent JSON responses from LLM.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class PotentialItemSchema(BaseModel):
    """Schema for a potential analysis question and answer."""

    question: str = Field(description="A potential question that can be answered with this data")
    analysis: str = Field(description="Analysis or insight related to this question")


class IssueItemSchema(BaseModel):
    """Schema for a data quality issue and suggestion."""

    issue: str = Field(description="Description of the data quality issue")
    suggestion: str = Field(description="Suggestion to fix or improve the issue")


class FileAnalysisSchema(BaseModel):
    """Schema for a single file's LLM analysis result."""

    file_path: str = Field(description="Path to the analyzed file")
    suggested_name: str = Field(description="Suggested semantic name for the dataset")
    context: str = Field(description="Context or description of what this dataset contains")
    potential: List[PotentialItemSchema] = Field(
        default_factory=list,
        description="List of potential analyses for this dataset"
    )
    issues: List[IssueItemSchema] = Field(
        default_factory=list,
        description="List of data quality issues found"
    )


class BatchAnalysisSchema(BaseModel):
    """Schema for batch file analysis result."""

    files: List[FileAnalysisSchema] = Field(
        description="List of file analysis results"
    )
    merged_suggested_name: Optional[str] = Field(
        default=None,
        description="Suggested name for merged dataset (only when merge_context is provided)"
    )
    merged_context: Optional[str] = Field(
        default=None,
        description="Description of merged dataset (only when merge_context is provided)"
    )
