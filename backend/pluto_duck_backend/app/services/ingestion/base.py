"""Base connector protocol for Pluto-Duck ingestion."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Protocol


@dataclass
class IngestionContext:
    """Context passed to connectors during ingestion."""

    target_table: str
    warehouse_path: Path
    overwrite: bool = False


class BaseConnector(ABC):
    """Abstract base for all ingestion connectors."""

    name: str

    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config

    def open(self) -> None:  # pragma: no cover - overridable hook
        """Optional setup hook before ingestion begins."""

    def close(self) -> None:  # pragma: no cover - overridable hook
        """Optional teardown hook after ingestion completes."""

    @abstractmethod
    def fetch_metadata(self) -> Dict[str, Any]:
        """Return metadata about the source (schema, sample, etc.)."""

    @abstractmethod
    def stream_rows(self) -> Iterable[Dict[str, Any]]:
        """Yield rows as dictionaries."""

    def list_available_tables(self) -> Optional[Iterable[str]]:  # pragma: no cover - optional
        """Return a list of tables available from this connector if supported."""
        return None

    def materialize(self, context: IngestionContext) -> int:
        """Materialize the streamed rows into DuckDB (default implementation)."""

        from .duckdb_loader import DuckDBLoader

        loader = DuckDBLoader(context.warehouse_path)
        return loader.load_dicts(
            context.target_table,
            self.stream_rows(),
            overwrite=context.overwrite,
        )


class SupportsConnector(Protocol):
    name: str

    def __call__(self, config: Dict[str, Any]) -> BaseConnector:
        ...


