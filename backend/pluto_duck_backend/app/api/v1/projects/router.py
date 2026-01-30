from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

from pluto_duck_backend.app.api.deps import get_project_id_path
from pluto_duck_backend.app.services.projects import ProjectRepository, get_project_repository

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


@router.get("", response_model=List[ProjectListResponse])
def list_projects(
    repo: ProjectRepository = Depends(get_project_repository),
) -> List[ProjectListResponse]:
    """List all projects with metadata."""
    projects = repo.list_projects()
    return [ProjectListResponse(**project) for project in projects]


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: str = Depends(get_project_id_path),
    repo: ProjectRepository = Depends(get_project_repository),
) -> ProjectResponse:
    """Get project details by ID."""
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return ProjectResponse(**project)


@router.post("", response_model=ProjectResponse)
def create_project(
    request: CreateProjectRequest,
    repo: ProjectRepository = Depends(get_project_repository),
) -> ProjectResponse:
    """Create a new project."""
    project_id = repo.create_project(
        name=request.name,
        description=request.description
    )
    
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(status_code=500, detail="Failed to create project")
    
    return ProjectResponse(**project)


@router.patch("/{project_id}/settings")
def update_project_settings(
    request: UpdateProjectSettingsRequest,
    project_id: str = Depends(get_project_id_path),
    repo: ProjectRepository = Depends(get_project_repository),
) -> Dict[str, str]:
    """Update project settings."""
    settings = {}
    if request.ui_state is not None:
        settings["ui_state"] = request.ui_state
    if request.preferences is not None:
        settings["preferences"] = request.preferences
    
    try:
        repo.update_project_settings(project_id, settings)
        return {"status": "success"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{project_id}")
def delete_project(
    project_id: str = Depends(get_project_id_path),
    repo: ProjectRepository = Depends(get_project_repository),
) -> Dict[str, str]:
    """Delete a project and all associated data."""
    try:
        repo.delete_project(project_id)
        return {"status": "success"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
