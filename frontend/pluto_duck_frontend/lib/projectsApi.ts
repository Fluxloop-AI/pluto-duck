import { getBackendUrl } from './api';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  settings: Record<string, any>;
  is_default: boolean;
}

export interface ProjectListItem extends Project {
  board_count: number;
  conversation_count: number;
}

export interface ProjectUIState {
  chat?: {
    open_tabs?: Array<{ id: string; order: number }>;
    active_tab_id?: string;
  };
}

export async function fetchProjects(): Promise<ProjectListItem[]> {
  const response = await fetch(`${getBackendUrl()}/api/v1/projects`);
  if (!response.ok) {
    throw new Error('Failed to fetch projects');
  }
  return response.json();
}

export async function fetchProject(projectId: string): Promise<Project> {
  const response = await fetch(`${getBackendUrl()}/api/v1/projects/${projectId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch project');
  }
  return response.json();
}

export async function createProject(data: {
  name: string;
  description?: string;
}): Promise<Project> {
  const response = await fetch(`${getBackendUrl()}/api/v1/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    throw new Error('Failed to create project');
  }
  
  return response.json();
}

export async function updateProjectSettings(
  projectId: string,
  settings: {
    ui_state?: ProjectUIState;
    preferences?: Record<string, any>;
  }
): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/projects/${projectId}/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
  
  if (!response.ok) {
    throw new Error('Failed to update project settings');
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/projects/${projectId}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error('Failed to delete project');
  }
}

