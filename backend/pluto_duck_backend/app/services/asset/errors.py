"""Asset service errors."""

from __future__ import annotations


class AssetError(Exception):
    """Base error for asset operations."""

    pass


class AssetNotFoundError(AssetError):
    """Analysis not found."""

    def __init__(self, analysis_id: str):
        self.analysis_id = analysis_id
        super().__init__(f"Analysis '{analysis_id}' not found")


class AssetExecutionError(AssetError):
    """Error during analysis execution."""

    def __init__(self, analysis_id: str, message: str):
        self.analysis_id = analysis_id
        super().__init__(f"Execution failed for '{analysis_id}': {message}")


class AssetValidationError(AssetError):
    """Invalid analysis definition."""

    def __init__(self, message: str):
        super().__init__(f"Validation error: {message}")

