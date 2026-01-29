"""Shared API dependencies for request-scoped values."""

from typing import Optional

from fastapi import Header, Query


def get_project_id_query(
    project_id: Optional[str] = Query(None, description="Project ID"),
) -> Optional[str]:
    """Provide optional project ID from query params."""
    return project_id


def get_project_id_query_required(
    project_id: str = Query(..., description="Project ID"),
) -> str:
    """Provide required project ID from query params."""
    return project_id


def get_project_id_header(
    project_id: str = Header(..., alias="X-Project-ID"),
) -> str:
    """Provide required project ID from headers."""
    return project_id
