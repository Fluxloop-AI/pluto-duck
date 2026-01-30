"""Shared API dependencies for request-scoped values."""

from typing import Optional
from uuid import UUID

from fastapi import Header, Path, Query


def get_project_id_path(
    project_id: UUID = Path(..., description="Project ID"),
) -> str:
    """Provide required project ID from path params."""
    return str(project_id)


def get_project_id_query(
    project_id: Optional[UUID] = Query(None, description="Project ID"),
) -> Optional[str]:
    """Provide optional project ID from query params."""
    return str(project_id) if project_id else None


def get_project_id_query_required(
    project_id: UUID = Query(..., description="Project ID"),
) -> str:
    """Provide required project ID from query params."""
    return str(project_id)


def get_project_id_header(
    project_id: UUID = Header(..., alias="X-Project-ID"),
) -> str:
    """Provide required project ID from headers."""
    return str(project_id)
