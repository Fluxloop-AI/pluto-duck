"""Source service errors."""

from __future__ import annotations


class SourceError(Exception):
    """Base error for source operations."""

    pass


class AttachError(SourceError):
    """Error attaching external database."""

    def __init__(self, source_name: str, message: str):
        self.source_name = source_name
        super().__init__(f"Failed to attach '{source_name}': {message}")


class CacheError(SourceError):
    """Error caching table data."""

    def __init__(self, table_name: str, message: str):
        self.table_name = table_name
        super().__init__(f"Failed to cache '{table_name}': {message}")


class SourceNotFoundError(SourceError):
    """Source not found."""

    def __init__(self, source_name: str):
        self.source_name = source_name
        super().__init__(f"Source '{source_name}' not found")


class TableNotFoundError(SourceError):
    """Table not found in source."""

    def __init__(self, source_name: str, table_name: str):
        self.source_name = source_name
        self.table_name = table_name
        super().__init__(f"Table '{table_name}' not found in source '{source_name}'")

