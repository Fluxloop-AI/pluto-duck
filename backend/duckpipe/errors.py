"""duckpipe exception classes."""

from __future__ import annotations


class DuckpipeError(Exception):
    """Base exception for all duckpipe errors."""

    pass


class AnalysisNotFoundError(DuckpipeError):
    """Raised when an analysis cannot be found."""

    def __init__(self, analysis_id: str) -> None:
        self.analysis_id = analysis_id
        super().__init__(f"Analysis '{analysis_id}' not found")


class CircularDependencyError(DuckpipeError):
    """Raised when a circular dependency is detected in the DAG."""

    def __init__(self, cycle_info: str) -> None:
        self.cycle_info = cycle_info
        super().__init__(f"Circular dependency detected: {cycle_info}")


class ExecutionError(DuckpipeError):
    """Raised when SQL execution fails."""

    def __init__(self, analysis_id: str, original_error: Exception) -> None:
        self.analysis_id = analysis_id
        self.original_error = original_error
        super().__init__(f"Failed to execute '{analysis_id}': {original_error}")


class ValidationError(DuckpipeError):
    """Raised when analysis definition validation fails."""

    pass


class ParameterError(DuckpipeError):
    """Raised when parameter binding fails."""

    def __init__(self, param_name: str, message: str) -> None:
        self.param_name = param_name
        super().__init__(f"Parameter '{param_name}': {message}")


class CompilationError(DuckpipeError):
    """Raised when SQL compilation fails."""

    def __init__(self, analysis_id: str, message: str) -> None:
        self.analysis_id = analysis_id
        super().__init__(f"Failed to compile '{analysis_id}': {message}")

