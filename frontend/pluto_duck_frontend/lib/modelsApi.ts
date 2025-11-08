import { getBackendUrl } from './api';

export interface LocalModelInfo {
  id: string;
  name: string;
  path: string;
  size_bytes?: number | null;
  quantization?: string | null;
}

export interface DownloadLocalModelRequest {
  repo_id: string;
  filename: string;
  model_id?: string;
}

export type DownloadStatusState = 'queued' | 'downloading' | 'completed' | 'error';

export interface DownloadLocalModelResponse {
  model_id: string;
  status: DownloadStatusState | 'in_progress';
  detail?: string;
}

export interface LocalDownloadStatus {
  status: DownloadStatusState;
  detail?: string | null;
  updated_at: string;
}

export async function listLocalModels(): Promise<LocalModelInfo[]> {
  const response = await fetch(`${getBackendUrl()}/api/v1/models/local`);
  if (!response.ok) {
    throw new Error(`Failed to list local models: ${response.status}`);
  }
  return response.json();
}

export async function downloadLocalModel(payload: DownloadLocalModelRequest): Promise<DownloadLocalModelResponse> {
  const response = await fetch(`${getBackendUrl()}/api/v1/models/local/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to download model: ${response.status}`);
  }
  return response.json();
}

export async function fetchLocalDownloadStatuses(): Promise<Record<string, LocalDownloadStatus>> {
  const response = await fetch(`${getBackendUrl()}/api/v1/models/local/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch download status: ${response.status}`);
  }
  return response.json();
}

export async function loadLocalModel(modelId: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/models/local/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to load model: ${response.status}`);
  }
}

export async function unloadLocalModel(): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/models/local/unload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to unload model: ${response.status}`);
  }
}

export async function deleteLocalModel(modelId: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/models/local/${encodeURIComponent(modelId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to delete model: ${response.status}`);
  }
}


