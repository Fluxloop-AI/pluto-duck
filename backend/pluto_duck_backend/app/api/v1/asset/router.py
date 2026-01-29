"""Asset API Router - Saved Analysis and File Asset management.

Provides REST endpoints for:
1. Analysis CRUD (create, read, update, delete)
2. Execution (compile, execute, run)
3. Status queries (freshness, lineage, history)
4. File Asset management (CSV/Parquet imports)
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends

from pluto_duck_backend.app.api.deps import get_project_id_query
from pluto_duck_backend.app.api.v1.asset.analyses.schemas import (
    LineageGraphEdge,
    LineageGraphNode,
    LineageGraphResponse,
)
from pluto_duck_backend.app.core.config import get_settings
from pluto_duck_backend.app.services.duckdb_utils import connect_warehouse
from pluto_duck_backend.app.services.asset import AssetService, get_asset_service

router = APIRouter(tags=["asset"])


# Local import after model declarations to avoid circular dependencies.
from pluto_duck_backend.app.api.v1.asset.analyses import router as analyses_router
from pluto_duck_backend.app.api.v1.asset.diagnosis import router as diagnosis_router
from pluto_duck_backend.app.api.v1.asset.files import router as files_router

router.include_router(analyses_router, prefix="/analyses", tags=["asset"])
router.include_router(files_router, prefix="/files", tags=["asset"])
router.include_router(diagnosis_router, prefix="/files", tags=["asset"])


def get_asset_service_dep(
    project_id: Optional[str] = Depends(get_project_id_query),
) -> AssetService:
    """Provide an AssetService scoped to the project."""
    return get_asset_service(project_id)


@router.get("/lineage-graph", response_model=LineageGraphResponse)
def get_lineage_graph(
    service: AssetService = Depends(get_asset_service_dep),
) -> LineageGraphResponse:
    """Get the full lineage graph for all analyses.

    Returns all analyses as nodes and their dependencies as edges.
    Useful for visualizing the entire data pipeline.
    """
    analyses = service.list_analyses()

    nodes: List[LineageGraphNode] = []
    edges: List[LineageGraphEdge] = []
    seen_sources: set = set()

    settings = get_settings()
    with connect_warehouse(settings.duckdb.path) as conn:
        for analysis in analyses:
            # Get freshness status
            try:
                freshness = service.get_freshness(analysis.id, conn)
                is_stale = freshness.is_stale
                last_run_at = freshness.last_run_at
            except Exception:
                is_stale = None
                last_run_at = None

            # Add analysis node
            nodes.append(
                LineageGraphNode(
                    id=f"analysis:{analysis.id}",
                    type="analysis",
                    name=analysis.name,
                    materialization=analysis.materialize,
                    is_stale=is_stale,
                    last_run_at=last_run_at,
                )
            )

            # Add edges for dependencies
            for ref in analysis.depends_on:
                source_id = f"{ref.type.value}:{ref.name}"

                # Add source/file nodes if not seen
                if ref.type.value != "analysis" and source_id not in seen_sources:
                    seen_sources.add(source_id)
                    nodes.append(
                        LineageGraphNode(
                            id=source_id,
                            type=ref.type.value,
                            name=ref.name,
                        )
                    )

                # Add edge
                edges.append(
                    LineageGraphEdge(
                        source=source_id,
                        target=f"analysis:{analysis.id}",
                    )
                )

    return LineageGraphResponse(nodes=nodes, edges=edges)
