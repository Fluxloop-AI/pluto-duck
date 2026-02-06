from typing import Annotated, Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from pluto_duck_backend.app.api.deps import get_project_id_path
from pluto_duck_backend.app.services.projects import ProjectRepository, get_project_repository
from pluto_duck_backend.app.services.projects.danger_operations import (
    expected_confirmation_phrase,
    reset_project_data,
)

router = APIRouter(tags=["projects"])


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]
    settings: Dict[str, Any]
    is_default: bool


class ProjectListResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]
    settings: Dict[str, Any]
    is_default: bool
    board_count: int
    conversation_count: int


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None


class UpdateProjectSettingsRequest(BaseModel):
    ui_state: Optional[Dict[str, Any]] = None
    preferences: Optional[Dict[str, Any]] = None


class ProjectDangerOperationRequest(BaseModel):
    confirmation: str


class ProjectDangerOperationResponse(BaseModel):
    success: bool
    message: str


def _require_project(repo: ProjectRepository, project_id: str) -> Dict[str, Any]:
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _validate_confirmation_phrase(
    operation: Literal["reset", "delete"],
    project_name: str,
    confirmation: str,
) -> None:
    expected_phrase = expected_confirmation_phrase(project_name=project_name, operation=operation)
    if confirmation != expected_phrase:
        raise HTTPException(
            status_code=400,
            detail=f"Confirmation phrase mismatch. Expected '{expected_phrase}'.",
        )


@router.get("", response_model=List[ProjectListResponse])
def list_projects(
    repo: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> List[ProjectListResponse]:
    """List all projects with metadata."""
    projects = repo.list_projects()
    return [ProjectListResponse(**project) for project in projects]


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: Annotated[str, Depends(get_project_id_path)],
    repo: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> ProjectResponse:
    """Get project details by ID."""
    project = _require_project(repo, project_id)
    return ProjectResponse(**project)


@router.post("", response_model=ProjectResponse)
def create_project(
    request: CreateProjectRequest,
    repo: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> ProjectResponse:
    """Create a new project."""
    project_id = repo.create_project(
        name=request.name,
        description=request.description
    )

    project = _require_project(repo, project_id)
    return ProjectResponse(**project)


@router.patch("/{project_id}/settings")
def update_project_settings(
    request: UpdateProjectSettingsRequest,
    project_id: Annotated[str, Depends(get_project_id_path)],
    repo: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> Dict[str, str]:
    """Update project settings."""
    settings: Dict[str, Any] = {}
    if request.ui_state is not None:
        settings["ui_state"] = request.ui_state
    if request.preferences is not None:
        settings["preferences"] = request.preferences

    try:
        repo.update_project_settings(project_id, settings)
        return {"status": "success"}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{project_id}/reset-data", response_model=ProjectDangerOperationResponse)
def reset_project_data_for_project(
    request: ProjectDangerOperationRequest,
    project_id: Annotated[str, Depends(get_project_id_path)],
    repo: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> ProjectDangerOperationResponse:
    """Reset project-scoped data while preserving the project row."""
    project = _require_project(repo, project_id)
    _validate_confirmation_phrase("reset", project["name"], request.confirmation)

    try:
        message = reset_project_data(project_id)
        return ProjectDangerOperationResponse(success=True, message=message)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset project data: {str(exc)}",
        ) from exc


@router.post("/{project_id}/delete-permanently", response_model=ProjectDangerOperationResponse)
def delete_project_permanently(
    request: ProjectDangerOperationRequest,
    project_id: Annotated[str, Depends(get_project_id_path)],
    repo: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> ProjectDangerOperationResponse:
    """Delete a project permanently after typed confirmation."""
    project = _require_project(repo, project_id)
    _validate_confirmation_phrase("delete", project["name"], request.confirmation)

    try:
        repo.delete_project(project_id)
        return ProjectDangerOperationResponse(
            success=True,
            message="Project deleted permanently.",
        )
    except ValueError as exc:
        status_code = 409 if str(exc) == "Cannot delete the default project" else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.delete("/{project_id}")
def delete_project(
    project_id: Annotated[str, Depends(get_project_id_path)],
    repo: Annotated[ProjectRepository, Depends(get_project_repository)],
) -> Dict[str, str]:
    """Delete a project and all associated data."""
    try:
        repo.delete_project(project_id)
        return {"status": "success"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
