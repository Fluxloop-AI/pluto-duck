import { apiJson, apiVoid } from './apiClient';

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
  return apiJson<ProjectListItem[]>('/api/v1/projects');
}

export async function fetchProject(projectId: string): Promise<Project> {
  return apiJson<Project>(`/api/v1/projects/${projectId}`);
}

export async function createProject(data: {
  name: string;
  description?: string;
}): Promise<Project> {
  return apiJson<Project>('/api/v1/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}

export async function updateProjectSettings(
  projectId: string,
  settings: {
    ui_state?: ProjectUIState;
    preferences?: Record<string, any>;
  }
): Promise<void> {
  await apiVoid(`/api/v1/projects/${projectId}/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiVoid(`/api/v1/projects/${projectId}`, {
    method: 'DELETE',
  });
}
