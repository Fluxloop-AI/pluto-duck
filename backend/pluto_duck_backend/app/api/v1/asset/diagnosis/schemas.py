"""Schemas for asset diagnosis endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class CountDuplicatesFileRequest(BaseModel):
    """Request for a single file in count duplicates request."""

    file_path: str = Field(..., description="Path to the file")
    file_type: Literal["csv", "parquet"] = Field(..., description="Type of file")


class CountDuplicatesRequest(BaseModel):
    """Request to count duplicate rows across multiple files."""

    files: List[CountDuplicatesFileRequest] = Field(..., description="List of files to check for duplicates")


class CountDuplicatesResponse(BaseModel):
    """Response for duplicate row count."""

    total_rows: int = Field(..., description="Total number of rows across all files")
    duplicate_rows: int = Field(..., description="Number of duplicate rows")
    estimated_rows: int = Field(..., description="Estimated rows after deduplication (total - duplicates)")
    skipped: bool = Field(False, description="Whether calculation was skipped due to row limit")

    model_config = {"from_attributes": True}


class DiagnoseFileRequestModel(BaseModel):
    """Request for diagnosing a single file."""

    file_path: str = Field(..., description="Path to the file to diagnose")
    file_type: Literal["csv", "parquet"] = Field(..., description="Type of file")


class MergeContextRequest(BaseModel):
    """Request for merge context when files have identical schemas."""

    total_rows: int = Field(..., description="Total rows across all files")
    duplicate_rows: int = Field(..., description="Number of duplicate rows")
    estimated_rows: int = Field(..., description="Estimated rows after deduplication")
    skipped: bool = Field(False, description="Whether duplicate calculation was skipped due to row limit")


class DiagnoseFilesRequest(BaseModel):
    """Request to diagnose multiple files."""

    files: List[DiagnoseFileRequestModel] = Field(..., description="List of files to diagnose")
    use_cache: bool = Field(True, description="Use cached results if available")
    include_llm: bool = Field(False, description="Include LLM analysis (slower, provides insights)")
    llm_mode: Literal["sync", "defer", "cache_only"] = Field(
        "sync",
        description="LLM execution mode: sync waits for results, defer runs in background, cache_only returns cached LLM only",
    )
    include_merge_analysis: bool = Field(
        False,
        description="Include merged dataset analysis (requires include_llm=true)",
    )
    merge_context: Optional[MergeContextRequest] = Field(
        None,
        description="Context for merging files with identical schemas",
    )


class ColumnSchemaResponse(BaseModel):
    """Schema information for a single column."""

    name: str
    type: str
    nullable: bool = True

    model_config = {"from_attributes": True}


class TypeSuggestionResponse(BaseModel):
    """Suggestion for a better column type."""

    column_name: str
    current_type: str
    suggested_type: str
    confidence: float
    sample_values: List[str] = []

    model_config = {"from_attributes": True}


class EncodingInfoResponse(BaseModel):
    """Response for detected file encoding."""

    detected: str
    confidence: float

    model_config = {"from_attributes": True}


class ParsingIntegrityResponse(BaseModel):
    """Response for parsing integrity check."""

    total_lines: int
    parsed_rows: int
    malformed_rows: int
    has_errors: bool
    error_message: Optional[str] = None

    model_config = {"from_attributes": True}


class NumericStatsResponse(BaseModel):
    """Response for numeric column statistics."""

    min: Optional[float] = None
    max: Optional[float] = None
    median: Optional[float] = None
    mean: Optional[float] = None
    stddev: Optional[float] = None
    distinct_count: int = 0

    model_config = {"from_attributes": True}


class ValueFrequencyResponse(BaseModel):
    """Response for value frequency."""

    value: str
    frequency: int

    model_config = {"from_attributes": True}


class CategoricalStatsResponse(BaseModel):
    """Response for categorical column statistics."""

    unique_count: int
    top_values: List[ValueFrequencyResponse] = []
    avg_length: float = 0

    model_config = {"from_attributes": True}


class DateStatsResponse(BaseModel):
    """Response for date column statistics."""

    min_date: Optional[str] = None
    max_date: Optional[str] = None
    span_days: Optional[int] = None
    distinct_days: int = 0

    model_config = {"from_attributes": True}


class ColumnStatisticsResponse(BaseModel):
    """Response for column statistics."""

    column_name: str
    column_type: str
    semantic_type: str
    null_count: int
    null_percentage: float
    numeric_stats: Optional[NumericStatsResponse] = None
    categorical_stats: Optional[CategoricalStatsResponse] = None
    date_stats: Optional[DateStatsResponse] = None

    model_config = {"from_attributes": True}


class PotentialItemResponse(BaseModel):
    """Response for a potential analysis question."""

    question: str
    analysis: str

    model_config = {"from_attributes": True}


class IssueItemResponse(BaseModel):
    """Response for a data quality issue."""

    issue: str
    issue_type: str
    suggestion: str
    example: Optional[str] = None

    model_config = {"from_attributes": True}


class LLMAnalysisResponse(BaseModel):
    """Response for LLM-generated dataset analysis."""

    suggested_name: str
    context: str
    potential: List[PotentialItemResponse] = []
    issues: List[IssueItemResponse] = []
    analyzed_at: Optional[datetime] = None
    model_used: str

    model_config = {"from_attributes": True}


class FileDiagnosisResponse(BaseModel):
    """Response for a single file diagnosis."""

    file_path: str
    file_type: str
    columns: List[ColumnSchemaResponse] = Field(..., description="Column schema information")
    missing_values: Dict[str, int]
    row_count: int
    file_size_bytes: int
    type_suggestions: List[TypeSuggestionResponse] = []
    diagnosed_at: Optional[datetime] = None
    encoding: Optional[EncodingInfoResponse] = None
    parsing_integrity: Optional[ParsingIntegrityResponse] = None
    column_statistics: List[ColumnStatisticsResponse] = []
    sample_rows: List[List[Any]] = []
    llm_analysis: Optional[LLMAnalysisResponse] = None
    diagnosis_id: Optional[str] = None

    model_config = {"from_attributes": True}


class MergedAnalysisResponse(BaseModel):
    """Response for LLM-generated merged dataset analysis."""

    suggested_name: str = Field(..., description="Suggested name for the merged dataset")
    context: str = Field(..., description="Description of the merged dataset")

    model_config = {"from_attributes": True}


class DiagnoseFilesResponse(BaseModel):
    """Response for multiple file diagnoses."""

    diagnoses: List[FileDiagnosisResponse]
    merged_analysis: Optional[MergedAnalysisResponse] = Field(
        None,
        description="Merged dataset analysis (when include_merge_analysis=true)",
    )
    llm_pending: bool = Field(
        False,
        description="Whether LLM analysis is still running (defer/cache_only modes)",
    )

    model_config = {"from_attributes": True}


DiagnosisIssueStatus = Literal["open", "confirmed", "dismissed", "resolved"]


class DiagnosisIssueResponse(BaseModel):
    """Response for a stored diagnosis issue."""

    id: str
    diagnosis_id: str
    file_asset_id: str
    issue: str
    issue_type: str
    suggestion: Optional[str] = None
    example: Optional[str] = None
    status: DiagnosisIssueStatus
    user_response: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[str] = None
    delete_reason: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class DiagnosisIssueListResponse(BaseModel):
    """Response for listing issues for a file asset."""

    issues: List[DiagnosisIssueResponse]

    model_config = {"from_attributes": True}


class DiagnosisIssueUpdateRequest(BaseModel):
    """Request to update an issue status/response."""

    status: Optional[DiagnosisIssueStatus] = None
    user_response: Optional[str] = None
    resolved_by: Optional[str] = None


class DiagnosisIssueDeleteRequest(BaseModel):
    """Request to soft delete an issue."""

    deleted_by: Optional[str] = None
    delete_reason: Optional[str] = None
