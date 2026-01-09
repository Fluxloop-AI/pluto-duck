"""Source service - DuckDB ATTACH-based external database federation."""

from .service import (
    SourceService,
    SourceType,
    TableMode,
    AttachedSource,
    CachedTable,
    SourceTable,
    get_source_service,
)
from .errors import (
    SourceError,
    AttachError,
    CacheError,
    SourceNotFoundError,
    TableNotFoundError,
)

__all__ = [
    "SourceService",
    "SourceType",
    "TableMode",
    "AttachedSource",
    "CachedTable",
    "SourceTable",
    "get_source_service",
    "SourceError",
    "AttachError",
    "CacheError",
    "SourceNotFoundError",
    "TableNotFoundError",
]

