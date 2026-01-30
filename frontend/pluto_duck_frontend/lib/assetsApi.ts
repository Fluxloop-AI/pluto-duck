/**
 * Asset Library API Client
 *
 * Provides access to Saved Analyses (duckpipe integration):
 * - CRUD operations for Analysis definitions
 * - Execution with freshness tracking
 * - Lineage and history queries
 */

import { getBackendUrl } from './api';
import { apiJson, apiVoid } from './apiClient';
import type { ApiError } from './apiClient';

function isApiErrorStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as ApiError).name === 'ApiError' &&
    (error as ApiError).status === status
  );
}

// ========== Types ==========

export interface ParameterDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  default?: string | number | boolean;
  description?: string;
}

export interface Analysis {
  id: string;
  name: string;
  sql: string;
  description: string | null;
  materialization: 'view' | 'table' | 'append' | 'parquet';
  parameters: ParameterDef[];
  tags: string[];
  result_table: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExecutionStep {
  analysis_id: string;
  action: 'run' | 'skip' | 'fail';
  reason: string | null;
  operation: string | null;
  target_table: string | null;
}

export interface ExecutionPlan {
  target_id: string;
  steps: ExecutionStep[];
  params: Record<string, unknown>;
}

export interface StepResult {
  run_id: string;
  analysis_id: string;
  status: 'success' | 'skipped' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_affected: number | null;
  error: string | null;
}

export interface ExecutionResult {
  success: boolean;
  target_id: string;
  step_results: StepResult[];
}

export interface FreshnessStatus {
  analysis_id: string;
  is_stale: boolean;
  last_run_at: string | null;
  stale_reason: string | null;
}

export interface LineageNode {
  type: 'analysis' | 'source' | 'file';
  id: string;
  name?: string;
  full?: string;
}

export interface LineageInfo {
  analysis_id: string;
  upstream: LineageNode[];
  downstream: LineageNode[];
}

export interface RunHistoryEntry {
  run_id: string;
  analysis_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_affected: number | null;
  error_message: string | null;
}

// Lineage Graph types
export interface LineageGraphNode {
  id: string;
  type: 'analysis' | 'source' | 'file';
  name: string | null;
  materialization: string | null;
  is_stale: boolean | null;
  last_run_at: string | null;
}

export interface LineageGraphEdge {
  source: string;
  target: string;
}

export interface LineageGraph {
  nodes: LineageGraphNode[];
  edges: LineageGraphEdge[];
}

// ========== Request Types ==========

export interface CreateAnalysisRequest {
  sql: string;
  name: string;
  analysis_id?: string;
  description?: string;
  materialization?: 'view' | 'table' | 'append' | 'parquet';
  parameters?: ParameterDef[];
  tags?: string[];
}

export interface UpdateAnalysisRequest {
  sql?: string;
  name?: string;
  description?: string;
  materialization?: 'view' | 'table' | 'append' | 'parquet';
  parameters?: ParameterDef[];
  tags?: string[];
}

export interface ExecuteRequest {
  params?: Record<string, unknown>;
  force?: boolean;
  continue_on_failure?: boolean;
}

// ========== API Functions ==========

/**
 * Create a new Analysis
 */
export async function createAnalysis(
  data: CreateAnalysisRequest,
  projectId?: string
): Promise<Analysis> {
  return apiJson<Analysis>('/api/v1/asset/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    projectId,
  });
}

/**
 * List all analyses
 */
export async function listAnalyses(
  options?: { tags?: string[]; projectId?: string }
): Promise<Analysis[]> {
  const params = new URLSearchParams();
  options?.tags?.forEach((tag) => params.append('tags', tag));
  const query = params.toString();
  const path = query.length > 0 ? `/api/v1/asset/analyses?${query}` : '/api/v1/asset/analyses';
  return apiJson<Analysis[]>(path, { projectId: options?.projectId });
}

/**
 * Get a single Analysis by ID
 */
export async function getAnalysis(
  analysisId: string,
  projectId?: string
): Promise<Analysis> {
  try {
    return await apiJson<Analysis>(`/api/v1/asset/analyses/${analysisId}`, { projectId });
  } catch (error) {
    if (isApiErrorStatus(error, 404)) {
      throw new Error(`Analysis '${analysisId}' not found`);
    }
    throw error;
  }
}

/**
 * Update an existing Analysis
 */
export async function updateAnalysis(
  analysisId: string,
  data: UpdateAnalysisRequest,
  projectId?: string
): Promise<Analysis> {
  return apiJson<Analysis>(`/api/v1/asset/analyses/${analysisId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    projectId,
  });
}

/**
 * Delete an Analysis
 */
export async function deleteAnalysis(
  analysisId: string,
  projectId?: string
): Promise<void> {
  await apiVoid(`/api/v1/asset/analyses/${analysisId}`, {
    method: 'DELETE',
    projectId,
  });
}

/**
 * Compile an execution plan (for preview/approval)
 */
export async function compileAnalysis(
  analysisId: string,
  options?: { params?: Record<string, unknown>; force?: boolean; projectId?: string }
): Promise<ExecutionPlan> {
  return apiJson<ExecutionPlan>(`/api/v1/asset/analyses/${analysisId}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      params: options?.params,
      force: options?.force ?? false,
    }),
    projectId: options?.projectId,
  });
}

/**
 * Execute an Analysis
 */
export async function executeAnalysis(
  analysisId: string,
  options?: {
    params?: Record<string, unknown>;
    force?: boolean;
    continueOnFailure?: boolean;
    projectId?: string;
  }
): Promise<ExecutionResult> {
  return apiJson<ExecutionResult>(`/api/v1/asset/analyses/${analysisId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      params: options?.params,
      force: options?.force ?? false,
      continue_on_failure: options?.continueOnFailure ?? false,
    }),
    projectId: options?.projectId,
  });
}

/**
 * Get freshness status for an Analysis
 */
export async function getFreshness(
  analysisId: string,
  projectId?: string
): Promise<FreshnessStatus> {
  return apiJson<FreshnessStatus>(`/api/v1/asset/analyses/${analysisId}/freshness`, { projectId });
}

/**
 * Get lineage information for an Analysis
 */
export async function getLineage(
  analysisId: string,
  projectId?: string
): Promise<LineageInfo> {
  return apiJson<LineageInfo>(`/api/v1/asset/analyses/${analysisId}/lineage`, { projectId });
}

/**
 * Get run history for an Analysis
 */
export async function getRunHistory(
  analysisId: string,
  options?: { limit?: number; projectId?: string }
): Promise<RunHistoryEntry[]> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', options.limit.toString());
  }
  const query = params.toString();
  const path = query.length > 0
    ? `/api/v1/asset/analyses/${analysisId}/history?${query}`
    : `/api/v1/asset/analyses/${analysisId}/history`;
  return apiJson<RunHistoryEntry[]>(path, { projectId: options?.projectId });
}

/**
 * Get full lineage graph for all analyses
 */
export async function getLineageGraph(
  projectId?: string
): Promise<LineageGraph> {
  return apiJson<LineageGraph>('/api/v1/asset/lineage-graph', { projectId });
}

// ========== Data Fetching ==========

export interface AnalysisData {
  columns: string[];
  rows: any[][];
  total_rows: number;
}

export interface ExportAnalysisRequest {
  file_path: string;
  force?: boolean;
}

export interface ExportAnalysisResponse {
  status: string;
  file_path: string;
}

/**
 * Get the result data from an analysis.
 * Must execute the analysis first to have data available.
 */
export async function getAnalysisData(
  analysisId: string,
  options?: { projectId?: string; limit?: number; offset?: number }
): Promise<AnalysisData> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', options.limit.toString());
  }
  if (options?.offset) {
    params.set('offset', options.offset.toString());
  }
  const query = params.toString();
  const path = query.length > 0
    ? `/api/v1/asset/analyses/${analysisId}/data?${query}`
    : `/api/v1/asset/analyses/${analysisId}/data`;
  return apiJson<AnalysisData>(path, { projectId: options?.projectId });
}

/**
 * Export analysis results to a CSV file path (Tauri runtime).
 */
export async function exportAnalysisCsv(
  analysisId: string,
  data: ExportAnalysisRequest,
  projectId?: string
): Promise<ExportAnalysisResponse> {
  return apiJson<ExportAnalysisResponse>(`/api/v1/asset/analyses/${analysisId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    projectId,
  });
}

/**
 * Get a download URL for an Analysis CSV export.
 */
export function getAnalysisDownloadUrl(
  analysisId: string,
  options?: { projectId?: string; force?: boolean }
): string {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}/download`);
  if (options?.projectId) {
    url.searchParams.set('project_id', options.projectId);
  }
  if (options?.force !== undefined) {
    url.searchParams.set('force', options.force ? 'true' : 'false');
  }
  return url.toString();
}

// ========== Helper Functions ==========

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get status badge color
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'failed':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'skipped':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'running':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

/**
 * Get materialization icon
 */
export function getMaterializationIcon(materialization: string): string {
  switch (materialization) {
    case 'view':
      return '👁️';
    case 'table':
      return '📊';
    case 'append':
      return '➕';
    case 'parquet':
      return '📦';
    default:
      return '📄';
  }
}
