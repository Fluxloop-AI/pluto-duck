import { apiFetch, apiJson } from './apiClient';

export interface AgentRunResponse {
  run_id: string;
  events_url: string;
}

export async function fetchBackendHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    await apiFetch('/health', { method: 'GET', responseType: 'none', signal });
    return true;
  } catch (error) {
    console.error('Health check failed', error);
    return false;
  }
}

export async function startAgentRun(question: string, signal?: AbortSignal): Promise<AgentRunResponse> {
  return apiJson<AgentRunResponse>('/api/v1/agent/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question }),
    signal,
  });
}
