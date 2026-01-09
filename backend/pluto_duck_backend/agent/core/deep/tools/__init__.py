"""Tooling for Pluto Duck deep agent (Phase 2).

We build tools as factories so we can:
- capture warehouse path
- capture project-scoped source connections
- capture conversation-scoped workspace root (virtual /workspace paths)
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from langchain_core.tools import BaseTool

from pluto_duck_backend.app.core.config import get_settings

from .asset import build_asset_tools
from .query import build_query_tools
from .schema import build_schema_tools
from .source import build_source_tools


def build_default_tools(*, workspace_root: Path, project_id: Optional[str] = None) -> List[BaseTool]:
    """Build default tools for the agent.
    
    Args:
        workspace_root: Path to the workspace root
        project_id: Project identifier for source isolation (if None, sources tools are skipped)
    """
    settings = get_settings()
    warehouse_path = settings.duckdb.path
    
    tools = [
        *build_schema_tools(warehouse_path=warehouse_path),
        *build_query_tools(warehouse_path=warehouse_path),
        *build_asset_tools(warehouse_path=warehouse_path),  # Saved Analysis tools
    ]
    
    # Add source tools only if project_id is provided
    if project_id:
        tools.extend(build_source_tools(project_id=project_id))  # ATTACH + cache tools
    
    return tools


