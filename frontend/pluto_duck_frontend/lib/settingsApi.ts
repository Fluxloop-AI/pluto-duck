import { apiJson } from './apiClient';

export interface UserSettings {
  llm_provider: string;
  llm_api_key: string | null;
  llm_model: string | null;
  data_sources: unknown;
  dbt_project: unknown;
  ui_preferences: {
    theme: string;
  };
  default_project_id?: string | null;
  user_name?: string | null;
  language?: string | null;
}

export interface UpdateSettingsRequest {
  llm_api_key?: string;
  llm_model?: string;
  llm_provider?: string;
  user_name?: string;
  language?: string;
}

export interface UpdateSettingsResponse {
  success: boolean;
  message: string;
}

export interface ProjectDangerOperationRequest {
  confirmation: string;
}

export interface ProjectDangerOperationResponse {
  success: boolean;
  message: string;
}

export async function fetchSettings(): Promise<UserSettings> {
  return apiJson<UserSettings>('/api/v1/settings');
}

export async function updateSettings(
  settings: UpdateSettingsRequest
): Promise<UpdateSettingsResponse> {
  return apiJson<UpdateSettingsResponse>('/api/v1/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
}

export async function resetProjectData(
  projectId: string,
  confirmation: string
): Promise<ProjectDangerOperationResponse> {
  return apiJson<ProjectDangerOperationResponse>(`/api/v1/projects/${projectId}/reset-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirmation } satisfies ProjectDangerOperationRequest),
  });
}

export async function deleteProjectPermanently(
  projectId: string,
  confirmation: string
): Promise<ProjectDangerOperationResponse> {
  return apiJson<ProjectDangerOperationResponse>(
    `/api/v1/projects/${projectId}/delete-permanently`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation } satisfies ProjectDangerOperationRequest),
    }
  );
}
