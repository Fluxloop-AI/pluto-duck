"""File-based metadata storage using YAML files."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import List, Optional

import yaml

from duckpipe.core.analysis import Analysis
from duckpipe.storage.base import MetadataStore


class FileMetadataStore(MetadataStore):
    """
    YAML file-based metadata storage.

    Stores each Analysis as a separate YAML file:
        {base_path}/{analysis_id}.yaml

    This enables:
    - Git version control of analysis definitions
    - Easy manual editing
    - Portability between projects
    """

    def __init__(self, base_path: Path) -> None:
        """
        Initialize the file store.

        Args:
            base_path: Directory to store YAML files
        """
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _get_path(self, analysis_id: str) -> Path:
        """Get the file path for an analysis."""
        return self.base_path / f"{analysis_id}.yaml"

    def get(self, analysis_id: str) -> Optional[Analysis]:
        """Retrieve an analysis by ID."""
        path = self._get_path(analysis_id)
        if not path.exists():
            return None

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if not data:
            return None

        return Analysis.from_dict(data)

    def list_all(self) -> List[Analysis]:
        """List all registered analyses."""
        analyses = []
        for path in self.base_path.glob("*.yaml"):
            analysis = self.get(path.stem)
            if analysis:
                analyses.append(analysis)
        return analyses

    def save(self, analysis: Analysis) -> None:
        """Save an analysis (create or update)."""
        path = self._get_path(analysis.id)

        # Set timestamps
        if not analysis.created_at:
            # Check if file exists to preserve created_at
            if path.exists():
                existing = self.get(analysis.id)
                if existing and existing.created_at:
                    analysis.created_at = existing.created_at
                else:
                    analysis.created_at = datetime.now()
            else:
                analysis.created_at = datetime.now()

        analysis.updated_at = datetime.now()

        # Convert to dict
        data = analysis.to_dict()

        # Write YAML
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(
                data,
                f,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            )

    def delete(self, analysis_id: str) -> None:
        """Delete an analysis by ID."""
        path = self._get_path(analysis_id)
        if path.exists():
            path.unlink()

    def exists(self, analysis_id: str) -> bool:
        """Check if an analysis exists."""
        return self._get_path(analysis_id).exists()

