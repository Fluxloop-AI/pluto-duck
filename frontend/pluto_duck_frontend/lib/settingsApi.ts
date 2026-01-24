import { getBackendUrl } from './api';

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
}

export interface UpdateSettingsRequest {
  llm_api_key?: string;
  llm_model?: string;
  llm_provider?: string;
  user_name?: string;
}

export interface UpdateSettingsResponse {
  success: boolean;
  message: string;
}

export interface ResetDatabaseResponse {
  success: boolean;
  message: string;
}

export async function fetchSettings(): Promise<UserSettings> {
  const response = await fetch(`${getBackendUrl()}/api/v1/settings`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch settings: ${response.status}`);
  }
  
  return response.json();
}

export async function updateSettings(
  settings: UpdateSettingsRequest
): Promise<UpdateSettingsResponse> {
  const response = await fetch(`${getBackendUrl()}/api/v1/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to update settings: ${response.status}`);
  }
  
  return response.json();
}

export async function resetDatabase(): Promise<ResetDatabaseResponse> {
  const response = await fetch(`${getBackendUrl()}/api/v1/settings/reset-database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to reset database: ${response.status}`);
  }
  
  return response.json();
}

