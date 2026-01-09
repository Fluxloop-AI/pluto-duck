"""SQL compilation with safe parameter binding."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

import sqlglot
from sqlglot import exp

from duckpipe.errors import CompilationError, ValidationError


def compile_sql(
    sql: str,
    materialize: str,
    result_table: Optional[str],
    params: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Optional[List[Any]]]:
    """
    Compile SQL with parameter binding and materialization wrapping.

    This function:
    1. Binds :param placeholders to $N positional parameters
    2. Wraps SQL with appropriate materialization statement

    Args:
        sql: Source SQL query with :param placeholders
        materialize: Materialization strategy (view, table, append, parquet, preview)
        result_table: Target table name (e.g., "analysis.monthly_revenue")
        params: Parameter values to bind

    Returns:
        Tuple of (compiled_sql, bound_params)
        - bound_params is None if no parameters
        - bound_params is a list for positional binding

    Examples:
        >>> compile_sql("SELECT :value", "table", "analysis.test", {"value": 42})
        ('CREATE OR REPLACE TABLE analysis.test AS SELECT $1', [42])
    """
    # 1. Bind parameters
    bound_sql, bound_params = _bind_parameters(sql, params)

    # 2. Wrap with materialization
    if materialize == "preview":
        # Preview mode: return SQL as-is
        return bound_sql, bound_params

    elif materialize == "view":
        quoted_table = _quote_identifier(result_table)
        final_sql = f"CREATE OR REPLACE VIEW {quoted_table} AS {bound_sql}"

    elif materialize == "table":
        quoted_table = _quote_identifier(result_table)
        final_sql = f"CREATE OR REPLACE TABLE {quoted_table} AS {bound_sql}"

    elif materialize == "append":
        quoted_table = _quote_identifier(result_table)
        final_sql = f"INSERT INTO {quoted_table} {bound_sql}"

    elif materialize == "parquet":
        # result_table is used as file path
        final_sql = f"COPY ({bound_sql}) TO '{result_table}' (FORMAT PARQUET)"

    else:
        raise CompilationError("unknown", f"Unknown materialization: {materialize}")

    return final_sql, bound_params


def _bind_parameters(
    sql: str,
    params: Optional[Dict[str, Any]],
) -> Tuple[str, Optional[List[Any]]]:
    """
    Bind :param_name placeholders to $N positional parameters.

    Uses regex-based binding for reliability with DuckDB.
    sqlglot doesn't reliably detect :param as Placeholder in all cases.

    Args:
        sql: SQL with :param placeholders
        params: Parameter values

    Returns:
        Tuple of (sql_with_positional_params, param_list)
    """
    if not params:
        return sql, None

    # Use regex-based binding for reliability
    return _bind_parameters_regex(sql, params)


def _bind_parameters_ast(
    parsed: exp.Expression,
    params: Dict[str, Any],
) -> Tuple[str, Optional[List[Any]]]:
    """
    AST-based parameter binding (safe).

    Finds Placeholder nodes in the AST and replaces them with positional params.
    """
    bound_params: List[Any] = []
    param_index = 1
    replacements = []

    # Find all placeholders
    for node in parsed.walk():
        if isinstance(node, exp.Placeholder):
            name = node.name or (node.this if isinstance(node.this, str) else None)
            if name and name in params:
                replacements.append((node, name))

    if not replacements:
        return parsed.sql(dialect="duckdb"), None

    # Replace placeholders
    for node, name in replacements:
        value = params[name]

        if isinstance(value, (list, tuple)):
            # List parameter: expand to (?, ?, ?)
            placeholders = ", ".join([f"${param_index + i}" for i in range(len(value))])
            replacement = sqlglot.parse_one(f"({placeholders})", dialect="duckdb")
            node.replace(replacement)
            bound_params.extend([_convert_value(v) for v in value])
            param_index += len(value)
        else:
            # Single value
            replacement = sqlglot.parse_one(f"${param_index}", dialect="duckdb")
            node.replace(replacement)
            bound_params.append(_convert_value(value))
            param_index += 1

    return parsed.sql(dialect="duckdb"), bound_params


def _bind_parameters_regex(
    sql: str,
    params: Dict[str, Any],
) -> Tuple[str, Optional[List[Any]]]:
    """
    Regex-based parameter binding (fallback).

    Warning: This may incorrectly match :param inside strings or comments.
    Used only when AST parsing fails.
    """
    bound_params: List[Any] = []
    param_index = 1

    def replacer(match: re.Match) -> str:
        nonlocal param_index
        name = match.group(1)

        if name not in params:
            return match.group(0)  # Keep as-is

        value = params[name]

        if isinstance(value, (list, tuple)):
            placeholders = ", ".join([f"${param_index + i}" for i in range(len(value))])
            bound_params.extend([_convert_value(v) for v in value])
            param_index += len(value)
            return f"({placeholders})"
        else:
            bound_params.append(_convert_value(value))
            result = f"${param_index}"
            param_index += 1
            return result

    # Match :name but not ::type_cast
    pattern = r"(?<!:):(\w+)(?!:)"
    bound_sql = re.sub(pattern, replacer, sql)

    return bound_sql, bound_params if bound_params else None


def _convert_value(value: Any) -> Any:
    """Convert Python value to DuckDB-compatible value."""
    if value is None:
        return None
    elif isinstance(value, (int, float, str, bool)):
        return value
    elif hasattr(value, "isoformat"):  # date, datetime
        return value.isoformat()
    else:
        return str(value)


def _quote_identifier(identifier: str) -> str:
    """
    Quote identifier if needed.

    Handles schema.table format and reserved words.

    Args:
        identifier: Table name (e.g., "analysis.monthly_revenue")

    Returns:
        Properly quoted identifier

    Raises:
        ValidationError: If identifier is invalid
    """
    if not identifier:
        raise ValidationError("Identifier cannot be empty")

    parts = identifier.split(".")
    quoted_parts = []

    for part in parts:
        if not _is_valid_identifier(part):
            raise ValidationError(
                f"Invalid identifier '{part}'. "
                "Must start with letter or underscore, "
                "contain only letters, numbers, and underscores."
            )

        if _needs_quoting(part):
            quoted_parts.append(f'"{part}"')
        else:
            quoted_parts.append(part)

    return ".".join(quoted_parts)


def _is_valid_identifier(s: str) -> bool:
    """Check if string is a valid SQL identifier."""
    if not s:
        return False
    # Must start with letter or underscore
    # Rest can be letters, numbers, underscores
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", s))


def _needs_quoting(s: str) -> bool:
    """Check if identifier needs quoting (reserved word)."""
    reserved = {
        "select",
        "from",
        "where",
        "table",
        "view",
        "create",
        "insert",
        "update",
        "delete",
        "drop",
        "alter",
        "index",
        "order",
        "group",
        "by",
        "having",
        "limit",
        "offset",
        "join",
        "on",
        "and",
        "or",
        "not",
        "null",
        "true",
        "false",
        "as",
        "in",
        "is",
        "like",
        "between",
        "case",
        "when",
        "then",
        "else",
        "end",
        "union",
        "all",
        "distinct",
        "values",
        "set",
        "into",
        "primary",
        "key",
        "foreign",
        "references",
        "default",
        "constraint",
        "check",
        "unique",
    }
    return s.lower() in reserved


def validate_identifier(identifier: str) -> None:
    """
    Validate identifier and raise if invalid.

    Args:
        identifier: Identifier to validate

    Raises:
        ValidationError: If identifier is invalid
    """
    if not identifier:
        raise ValidationError("Identifier cannot be empty")

    parts = identifier.split(".")
    for part in parts:
        if not _is_valid_identifier(part):
            raise ValidationError(
                f"Invalid identifier '{part}'. "
                "Must start with letter or underscore, "
                "contain only letters, numbers, and underscores."
            )

