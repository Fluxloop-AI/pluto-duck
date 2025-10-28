"""SQLite connector."""

from __future__ import annotations

import sqlite3
from typing import Dict, Iterable, List

from ..base import BaseConnector


class SQLiteConnector(BaseConnector):
    name = "sqlite"

    def __init__(self, config: Dict[str, object]) -> None:
        super().__init__(config)
        self.path = str(config.get("path"))
        self.query = str(config.get("query", "SELECT 1"))
        self._conn: sqlite3.Connection | None = None

    def open(self) -> None:
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()

    def fetch_metadata(self) -> Dict[str, object]:
        return {
            "path": self.path,
            "query": self.query,
        }

    def stream_rows(self) -> Iterable[Dict[str, object]]:
        if self._conn is None:
            raise RuntimeError("Connector not opened")
        cursor = self._conn.execute(self.query)
        for row in cursor:
            yield dict(row)

    def list_available_tables(self) -> List[str]:
        if self._conn is None:
            raise RuntimeError("Connector not opened")

        cursor = self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name"
        )
        return [row[0] for row in cursor.fetchall()]


