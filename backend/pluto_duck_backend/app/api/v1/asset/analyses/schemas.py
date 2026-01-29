"""Schemas for asset analysis endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ParameterDefRequest(BaseModel):
    """Parameter definition in request."""

    name: str
    type: str = "string"
    required: bool = False
    default: Optional[Any] = None
    description: Optional[str] = None


class CreateAnalysisRequest(BaseModel):
    """Request to create an Analysis."""

    sql: str = Field(..., description="SQL query")
    name: str = Field(..., description="Human-readable name")
    analysis_id: Optional[str] = Field(None, description="Unique ID (auto-generated if not provided)")
    description: Optional[str] = Field(None, description="Description")
    materialization: Literal["view", "table", "append", "parquet"] = Field(
        "view", description="Materialization strategy"
    )
    parameters: Optional[List[ParameterDefRequest]] = Field(None, description="Parameter definitions")
    tags: Optional[List[str]] = Field(None, description="Tags for categorization")


class UpdateAnalysisRequest(BaseModel):
    """Request to update an Analysis."""

    sql: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    materialization: Optional[Literal["view", "table", "append", "parquet"]] = None
    parameters: Optional[List[ParameterDefRequest]] = None
    tags: Optional[List[str]] = None


class CompileRequest(BaseModel):
    """Request to compile an analysis."""

    params: Optional[Dict[str, Any]] = Field(None, description="Parameter values")
    force: bool = Field(False, description="Force recompilation ignoring freshness")


class ExecuteRequest(BaseModel):
    """Request to execute an analysis."""

    params: Optional[Dict[str, Any]] = Field(None, description="Parameter values")
    force: bool = Field(False, description="Force execution ignoring freshness")
    continue_on_failure: bool = Field(
        False,
        description="Continue executing remaining steps even if one fails",
    )


class AnalysisResponse(BaseModel):
    """Response for an Analysis."""

    id: str
    name: str
    sql: str
    description: Optional[str] = None
    materialization: str
    parameters: List[Dict[str, Any]] = []
    tags: List[str] = []
    result_table: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ExecutionStepResponse(BaseModel):
    """Response for an execution step."""

    analysis_id: str
    action: str
    reason: Optional[str] = None
    operation: Optional[str] = None
    target_table: Optional[str] = None

    model_config = {"from_attributes": True}


class ExecutionPlanResponse(BaseModel):
    """Response for an execution plan."""

    target_id: str
    steps: List[ExecutionStepResponse]
    params: Dict[str, Any] = {}

    model_config = {"from_attributes": True}


class StepResultResponse(BaseModel):
    """Response for a step result."""

    run_id: str
    analysis_id: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    rows_affected: Optional[int] = None
    error: Optional[str] = None

    model_config = {"from_attributes": True}


class ExecutionResultResponse(BaseModel):
    """Response for execution result."""

    success: bool
    target_id: str
    step_results: List[StepResultResponse]

    model_config = {"from_attributes": True}


class FreshnessResponse(BaseModel):
    """Response for freshness status."""

    analysis_id: str
    is_stale: bool
    last_run_at: Optional[datetime] = None
    stale_reason: Optional[str] = None

    model_config = {"from_attributes": True}


class LineageNodeResponse(BaseModel):
    """A node in lineage."""

    type: str
    id: str
    name: Optional[str] = None
    full: Optional[str] = None

    model_config = {"from_attributes": True}


class LineageResponse(BaseModel):
    """Response for lineage information."""

    analysis_id: str
    upstream: List[LineageNodeResponse]
    downstream: List[LineageNodeResponse]

    model_config = {"from_attributes": True}


class LineageGraphNode(BaseModel):
    """A node in the full lineage graph."""

    id: str
    type: str  # analysis, source, file
    name: Optional[str] = None
    materialization: Optional[str] = None
    is_stale: Optional[bool] = None
    last_run_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class LineageGraphEdge(BaseModel):
    """An edge in the full lineage graph."""

    source: str
    target: str

    model_config = {"from_attributes": True}


class LineageGraphResponse(BaseModel):
    """Response for full lineage graph."""

    nodes: List[LineageGraphNode]
    edges: List[LineageGraphEdge]

    model_config = {"from_attributes": True}


class RunHistoryResponse(BaseModel):
    """Response for run history entry."""

    run_id: str
    analysis_id: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    rows_affected: Optional[int] = None
    error_message: Optional[str] = None

    model_config = {"from_attributes": True}


class AnalysisDataResponse(BaseModel):
    """Response for analysis data."""

    columns: List[str]
    rows: List[List[Any]]
    total_rows: int

    model_config = {"from_attributes": True}


class ExportAnalysisRequest(BaseModel):
    """Request to export analysis results to a CSV file path."""

    file_path: str = Field(..., description="Destination path for the CSV file")
    force: bool = Field(False, description="Force execution even if fresh")


class ExportAnalysisResponse(BaseModel):
    """Response for analysis export."""

    status: str
    file_path: str

    model_config = {"from_attributes": True}
