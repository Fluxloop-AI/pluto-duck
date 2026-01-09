"""Typed reference model for dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RefType(Enum):
    """Type of dependency reference."""

    ANALYSIS = "analysis"  # Reference to another Analysis
    SOURCE = "source"  # Reference to external data source
    FILE = "file"  # Reference to local file


@dataclass(frozen=True)
class Ref:
    """
    Typed dependency reference.

    Examples:
        - Ref(RefType.ANALYSIS, "monthly_revenue")  -> analysis:monthly_revenue
        - Ref(RefType.SOURCE, "pg.orders")          -> source:pg.orders
        - Ref(RefType.FILE, "/data/sales.parquet")  -> file:/data/sales.parquet
    """

    type: RefType
    name: str

    @classmethod
    def parse(cls, ref_str: str) -> Ref:
        """
        Parse a reference string into a Ref object.

        Args:
            ref_str: Reference string (e.g., "analysis:monthly_revenue" or "monthly_revenue")

        Returns:
            Ref object

        Examples:
            >>> Ref.parse("analysis:monthly_revenue")
            Ref(type=RefType.ANALYSIS, name='monthly_revenue')

            >>> Ref.parse("source:pg.orders")
            Ref(type=RefType.SOURCE, name='pg.orders')

            >>> Ref.parse("monthly_revenue")  # Legacy format
            Ref(type=RefType.ANALYSIS, name='monthly_revenue')
        """
        if ":" not in ref_str:
            # Legacy compatibility: assume analysis type if no prefix
            return cls(RefType.ANALYSIS, ref_str)

        type_str, name = ref_str.split(":", 1)
        try:
            ref_type = RefType(type_str)
        except ValueError:
            # Unknown type, treat as source
            return cls(RefType.SOURCE, ref_str)

        return cls(ref_type, name)

    def __str__(self) -> str:
        """Convert to string representation."""
        return f"{self.type.value}:{self.name}"

    def to_table_name(self) -> str:
        """
        Convert to SQL table name.

        Returns:
            SQL-compatible table reference

        Examples:
            >>> Ref(RefType.ANALYSIS, "monthly_revenue").to_table_name()
            'analysis.monthly_revenue'

            >>> Ref(RefType.SOURCE, "pg_orders").to_table_name()
            'source.pg_orders'
        """
        if self.type == RefType.ANALYSIS:
            return f"analysis.{self.name}"
        elif self.type == RefType.SOURCE:
            # Replace dots with underscores for schema.table format
            safe_name = self.name.replace(".", "_")
            return f"source.{safe_name}"
        elif self.type == RefType.FILE:
            return f"read_parquet('{self.name}')"
        else:
            raise ValueError(f"Unknown ref type: {self.type}")

    def is_analysis(self) -> bool:
        """Check if this is an analysis reference."""
        return self.type == RefType.ANALYSIS

    def is_source(self) -> bool:
        """Check if this is a source reference."""
        return self.type == RefType.SOURCE

    def is_file(self) -> bool:
        """Check if this is a file reference."""
        return self.type == RefType.FILE

