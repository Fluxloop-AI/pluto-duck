"""
duckpipe: Lightweight SQL Pipeline Engine for DuckDB

A minimal, DuckDB-native pipeline engine that provides:
- SQL-based Analysis definitions with automatic dependency extraction
- DAG construction and topological execution
- Plan-before-execute pattern for HITL integration
- Safe parameter binding with prepared statements
"""

from duckpipe.core.ref import Ref, RefType
from duckpipe.core.analysis import Analysis, ParameterDef
from duckpipe.core.plan import ExecutionPlan, ExecutionStep, StepAction
from duckpipe.core.result import ExecutionResult, StepResult, AnalysisStatus
from duckpipe.core.pipeline import Pipeline
from duckpipe.storage.base import MetadataStore
from duckpipe.storage.file_store import FileMetadataStore
from duckpipe.errors import (
    DuckpipeError,
    AnalysisNotFoundError,
    CircularDependencyError,
    ExecutionError,
    ValidationError,
    ParameterError,
    CompilationError,
)

__version__ = "0.1.0"

__all__ = [
    # Core models
    "Ref",
    "RefType",
    "Analysis",
    "ParameterDef",
    "ExecutionPlan",
    "ExecutionStep",
    "StepAction",
    "ExecutionResult",
    "StepResult",
    "AnalysisStatus",
    # Pipeline
    "Pipeline",
    # Storage
    "MetadataStore",
    "FileMetadataStore",
    # Errors
    "DuckpipeError",
    "AnalysisNotFoundError",
    "CircularDependencyError",
    "ExecutionError",
    "ValidationError",
    "ParameterError",
    "CompilationError",
]

