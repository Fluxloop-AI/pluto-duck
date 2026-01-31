"""Asset service - Saved Analysis and File Asset management.

Provides Pluto Duck integration with duckpipe:
- Analysis CRUD operations (Saved Analysis)
- File Asset management (CSV/Parquet imports)
- Execution with HITL support
- Freshness and lineage tracking
- Agent tool integration
"""

from .service import AssetService, get_asset_service
from .file_service import FileAssetService, FileAsset, get_file_asset_service
from .file_diagnosis_service import (
    FileDiagnosisService,
    FileDiagnosis,
    ColumnSchema,
    TypeSuggestion,
    DiagnoseFileRequest,
    get_file_diagnosis_service,
)
from .diagnosis_issue_service import (
    DiagnosisIssueService,
    DiagnosisIssue,
    get_diagnosis_issue_service,
)
from .errors import AssetError, AssetNotFoundError, AssetExecutionError, AssetValidationError, DiagnosisError

__all__ = [
    # Analysis (Saved Analysis)
    "AssetService",
    "get_asset_service",
    # File Asset (CSV/Parquet)
    "FileAssetService",
    "FileAsset",
    "get_file_asset_service",
    # File Diagnosis
    "FileDiagnosisService",
    "FileDiagnosis",
    "ColumnSchema",
    "TypeSuggestion",
    "DiagnoseFileRequest",
    "get_file_diagnosis_service",
    # Diagnosis Issues
    "DiagnosisIssueService",
    "DiagnosisIssue",
    "get_diagnosis_issue_service",
    # Errors
    "AssetError",
    "AssetNotFoundError",
    "AssetExecutionError",
    "AssetValidationError",
    "DiagnosisError",
]
