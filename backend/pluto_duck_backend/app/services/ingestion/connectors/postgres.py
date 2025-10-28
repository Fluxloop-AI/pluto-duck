"""PostgreSQL connector."""

from __future__ import annotations

from typing import Dict, Iterable, List

import psycopg

from ..base import BaseConnector


class PostgresConnector(BaseConnector):
    name = "postgres"

    def __init__(self, config: Dict[str, object]) -> None:
        super().__init__(config)
        self.dsn = str(config.get("dsn"))
        self.query = str(config.get("query", "SELECT 1"))
        self._conn: psycopg.Connection | None = None

    def open(self) -> None:
        self._conn = psycopg.connect(self.dsn)

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()

    def fetch_metadata(self) -> Dict[str, object]:
        return {
            "dsn": self.dsn,
            "query": self.query,
        }

    def stream_rows(self) -> Iterable[Dict[str, object]]:
        if self._conn is None:
            raise RuntimeError("Connector not opened")
        with self._conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(self.query)
            yield from cur

    def list_available_tables(self) -> List[str]:
        if self._conn is None:
            raise RuntimeError("Connector not opened")

        query = (
            "SELECT table_schema || '.' || table_name AS table_name "
            "FROM information_schema.tables "
            "WHERE table_type = 'BASE TABLE' "
            "ORDER BY table_schema, table_name"
        )

        with self._conn.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()

        return [row[0] for row in rows]


