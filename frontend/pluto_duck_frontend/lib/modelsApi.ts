import { apiJson, apiVoid } from './apiClient';

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
  return apiJson<LocalModelInfo[]>('/api/v1/models/local');
}

export async function downloadLocalModel(payload: DownloadLocalModelRequest): Promise<DownloadLocalModelResponse> {
  return apiJson<DownloadLocalModelResponse>('/api/v1/models/local/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchLocalDownloadStatuses(): Promise<Record<string, LocalDownloadStatus>> {
  return apiJson<Record<string, LocalDownloadStatus>>('/api/v1/models/local/status');
}

export async function loadLocalModel(modelId: string): Promise<void> {
  await apiVoid('/api/v1/models/local/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId }),
  });
}

export async function unloadLocalModel(): Promise<void> {
  await apiVoid('/api/v1/models/local/unload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function deleteLocalModel(modelId: string): Promise<void> {
  await apiVoid(`/api/v1/models/local/${encodeURIComponent(modelId)}`, {
    method: 'DELETE',
  });
}

