"""Analysis model - the core unit of work in duckpipe."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, List, Optional

from duckpipe.core.ref import Ref, RefType


@dataclass
class ParameterDef:
    """
    Parameter definition for an Analysis.

    Attributes:
        name: Parameter name (used as :name in SQL)
        type: Parameter type (string, int, float, date, datetime, list)
        default: Default value if not provided at runtime
        description: Human-readable description
    """

    name: str
    type: str = "string"  # string | int | float | date | datetime | list
    default: Optional[Any] = None
    description: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        result = {"name": self.name, "type": self.type}
        if self.default is not None:
            result["default"] = self.default
        if self.description:
            result["description"] = self.description
        return result

    @classmethod
    def from_dict(cls, data: dict) -> ParameterDef:
        """Create from dictionary."""
        return cls(
            name=data["name"],
            type=data.get("type", "string"),
            default=data.get("default"),
            description=data.get("description"),
        )


@dataclass
class Analysis:
    """
    Analysis definition - a reusable SQL-based analysis unit.

    An Analysis represents a SQL query that can be:
    - Registered in the pipeline
    - Compiled into an execution plan
    - Materialized as a view, table, or parquet file

    Attributes:
        id: Unique identifier (used as analysis.<id> in SQL)
        name: Human-readable name
        sql: SQL query (may contain :param placeholders)
        materialize: Materialization strategy (view, table, append, parquet)
        description: Human-readable description
        parameters: List of parameter definitions
        depends_on: List of typed dependencies (auto-extracted if not provided)
        tags: List of tags for organization
        created_at: Creation timestamp
        updated_at: Last update timestamp
    """

    id: str
    name: str
    sql: str
    materialize: str = "table"  # view | table | append | parquet

    description: Optional[str] = None
    parameters: List[ParameterDef] = field(default_factory=list)
    depends_on: List[Ref] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @property
    def result_table(self) -> str:
        """
        Get the result table name.

        Always returns analysis.<id> format.
        """
        return f"analysis.{self.id}"

    def get_analysis_dependencies(self) -> List[str]:
        """
        Get only the Analysis-type dependencies.

        Returns:
            List of analysis IDs that this analysis depends on
        """
        return [ref.name for ref in self.depends_on if ref.type == RefType.ANALYSIS]

    def get_source_dependencies(self) -> List[str]:
        """
        Get only the Source-type dependencies.

        Returns:
            List of source names that this analysis depends on
        """
        return [ref.name for ref in self.depends_on if ref.type == RefType.SOURCE]

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        result = {
            "id": self.id,
            "name": self.name,
            "sql": self.sql,
            "materialize": self.materialize,
        }

        if self.description:
            result["description"] = self.description

        if self.parameters:
            result["parameters"] = {p.name: p.to_dict() for p in self.parameters}

        if self.depends_on:
            result["depends_on"] = [str(ref) for ref in self.depends_on]

        if self.tags:
            result["tags"] = self.tags

        if self.created_at:
            result["created_at"] = self.created_at.isoformat()

        if self.updated_at:
            result["updated_at"] = self.updated_at.isoformat()

        return result

    @classmethod
    def from_dict(cls, data: dict) -> Analysis:
        """Create from dictionary."""
        # Parse parameters
        parameters = []
        if "parameters" in data and data["parameters"]:
            params_data = data["parameters"]
            if isinstance(params_data, dict):
                # New format: {"param_name": {"type": ..., "default": ...}}
                for name, param_dict in params_data.items():
                    if isinstance(param_dict, dict):
                        param_dict["name"] = name
                        parameters.append(ParameterDef.from_dict(param_dict))
            elif isinstance(params_data, list):
                # Legacy format: [{"name": ..., "type": ...}]
                for param_dict in params_data:
                    parameters.append(ParameterDef.from_dict(param_dict))

        # Parse depends_on
        depends_on = []
        if "depends_on" in data and data["depends_on"]:
            for ref_str in data["depends_on"]:
                depends_on.append(Ref.parse(ref_str))

        # Parse timestamps
        created_at = None
        if "created_at" in data and data["created_at"]:
            if isinstance(data["created_at"], str):
                created_at = datetime.fromisoformat(data["created_at"])
            elif isinstance(data["created_at"], datetime):
                created_at = data["created_at"]

        updated_at = None
        if "updated_at" in data and data["updated_at"]:
            if isinstance(data["updated_at"], str):
                updated_at = datetime.fromisoformat(data["updated_at"])
            elif isinstance(data["updated_at"], datetime):
                updated_at = data["updated_at"]

        return cls(
            id=data["id"],
            name=data["name"],
            sql=data["sql"],
            materialize=data.get("materialize", "table"),
            description=data.get("description"),
            parameters=parameters,
            depends_on=depends_on,
            tags=data.get("tags", []),
            created_at=created_at,
            updated_at=updated_at,
        )

