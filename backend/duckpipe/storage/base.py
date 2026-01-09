"""Abstract base class for metadata storage."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional

from duckpipe.core.analysis import Analysis


class MetadataStore(ABC):
    """
    Abstract base class for Analysis metadata storage.

    Implementations can store analyses in:
    - File system (YAML files)
    - SQLite database
    - DuckDB tables
    - etc.
    """

    @abstractmethod
    def get(self, analysis_id: str) -> Optional[Analysis]:
        """
        Retrieve an analysis by ID.

        Args:
            analysis_id: The unique identifier of the analysis

        Returns:
            Analysis if found, None otherwise
        """
        pass

    @abstractmethod
    def list_all(self) -> List[Analysis]:
        """
        List all registered analyses.

        Returns:
            List of all Analysis objects
        """
        pass

    @abstractmethod
    def save(self, analysis: Analysis) -> None:
        """
        Save an analysis (create or update).

        Args:
            analysis: The Analysis to save
        """
        pass

    @abstractmethod
    def delete(self, analysis_id: str) -> None:
        """
        Delete an analysis by ID.

        Args:
            analysis_id: The unique identifier of the analysis to delete
        """
        pass

    @abstractmethod
    def exists(self, analysis_id: str) -> bool:
        """
        Check if an analysis exists.

        Args:
            analysis_id: The unique identifier to check

        Returns:
            True if exists, False otherwise
        """
        pass

