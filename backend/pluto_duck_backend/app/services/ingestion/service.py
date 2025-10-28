"""High-level ingestion service orchestrating connectors."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from .base import BaseConnector, IngestionContext
from .registry import ConnectorRegistry


@dataclass
class IngestionJob:
    connector: str
    warehouse_path: Path
    config: Dict[str, object] | None = None

    target_table: Optional[str] = None
    overwrite: bool = False
    source_table: Optional[str] = None
    source_query: Optional[str] = None


class IngestionService:
    """Coordinates ingestion workflows using registered connectors."""

    def __init__(self, registry: ConnectorRegistry) -> None:
        self.registry = registry

    def run(self, job: IngestionJob) -> Dict[str, object]:
        connector = self.registry.create(job.connector, job.config or {})
        connector.open()
        try:
            return self._run_single(connector, job)
        finally:
            connector.close()

    def list_available_tables(self, connector: str, config: Dict[str, object]) -> List[str]:
        connector_instance = self.registry.create(connector, config or {})
        connector_instance.open()
        try:
            tables = connector_instance.list_available_tables()
            if tables is None:
                return []
            return list(tables)
        finally:
            connector_instance.close()

    def _run_single(self, connector: BaseConnector, job: IngestionJob) -> Dict[str, object]:
        if not job.target_table:
            raise ValueError("target_table is required for ingestion")

        context = IngestionContext(
            target_table=job.target_table,
            warehouse_path=job.warehouse_path,
            overwrite=job.overwrite,
        )

        row_count = connector.materialize(context)
        metadata = connector.fetch_metadata()
        if job.source_table or job.source_query:
            metadata.setdefault("source", {})
            if job.source_table:
                metadata["source"]["table"] = job.source_table
            if job.source_query:
                metadata["source"]["query"] = job.source_query

        return {
            "rows_ingested": row_count,
            "metadata": metadata,
        }


