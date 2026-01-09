"""SQL parsing for dependency extraction."""

from __future__ import annotations

from typing import List, Optional, Tuple

import sqlglot
from sqlglot import exp

from duckpipe.core.ref import Ref, RefType


def extract_dependencies(sql: str, dialect: str = "duckdb") -> List[Ref]:
    """
    Extract table dependencies from SQL query as typed Refs.

    Parsing rules:
    - analysis.* tables → RefType.ANALYSIS
    - source.* tables → RefType.SOURCE
    - Other tables → RefType.SOURCE (assumed external)
    - CTE names are excluded from dependencies

    Args:
        sql: SQL query string
        dialect: SQL dialect for parsing (default: duckdb)

    Returns:
        List of Ref objects representing dependencies

    Examples:
        >>> sql = "SELECT * FROM analysis.monthly_revenue"
        >>> extract_dependencies(sql)
        [Ref(type=RefType.ANALYSIS, name='monthly_revenue')]

        >>> sql = "SELECT * FROM source.pg_orders"
        >>> extract_dependencies(sql)
        [Ref(type=RefType.SOURCE, name='pg_orders')]

        >>> sql = '''
        ...     WITH temp AS (SELECT 1)
        ...     SELECT * FROM temp, analysis.foo
        ... '''
        >>> extract_dependencies(sql)
        [Ref(type=RefType.ANALYSIS, name='foo')]
    """
    try:
        parsed = sqlglot.parse_one(sql, dialect=dialect)
    except Exception:
        # Parsing failed, return empty list
        # Caller should use explicit depends_on
        return []

    # Collect CTE names (to exclude from dependencies)
    cte_names = set()
    for cte in parsed.find_all(exp.CTE):
        if cte.alias:
            cte_names.add(cte.alias.lower())

    refs = []
    seen = set()

    for table in parsed.find_all(exp.Table):
        # Extract schema.table format
        schema = table.db or ""
        name = table.name or ""

        if not name:
            continue

        full_name = f"{schema}.{name}" if schema else name

        # Exclude CTEs
        if full_name.lower() in cte_names or name.lower() in cte_names:
            continue

        # Dedup
        if full_name in seen:
            continue
        seen.add(full_name)

        # Determine ref type based on schema
        schema_lower = schema.lower()
        if schema_lower == "analysis":
            refs.append(Ref(RefType.ANALYSIS, name))
        elif schema_lower == "source":
            refs.append(Ref(RefType.SOURCE, name))
        elif full_name.startswith("/") or full_name.endswith((".parquet", ".csv")):
            refs.append(Ref(RefType.FILE, full_name))
        else:
            # Default: external source
            refs.append(Ref(RefType.SOURCE, full_name))

    return refs


def validate_sql(sql: str, dialect: str = "duckdb") -> Tuple[bool, Optional[str]]:
    """
    Validate SQL syntax.

    Args:
        sql: SQL query string
        dialect: SQL dialect for parsing

    Returns:
        Tuple of (is_valid, error_message)
        - (True, None) if valid
        - (False, error_message) if invalid
    """
    try:
        sqlglot.parse_one(sql, dialect=dialect)
        return True, None
    except Exception as e:
        return False, str(e)

