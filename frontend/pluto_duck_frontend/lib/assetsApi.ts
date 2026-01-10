/**
 * Asset Library API Client
 *
 * Provides access to Saved Analyses (duckpipe integration):
 * - CRUD operations for Analysis definitions
 * - Execution with freshness tracking
 * - Lineage and history queries
 */

import { getBackendUrl } from './api';

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
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to create analysis');
  }

  return response.json();
}

/**
 * List all analyses
 */
export async function listAnalyses(
  options?: { tags?: string[]; projectId?: string }
): Promise<Analysis[]> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses`);

  if (options?.tags) {
    options.tags.forEach((tag) => url.searchParams.append('tags', tag));
  }
  if (options?.projectId) {
    url.searchParams.set('project_id', options.projectId);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('Failed to fetch analyses');
  }

  return response.json();
}

/**
 * Get a single Analysis by ID
 */
export async function getAnalysis(
  analysisId: string,
  projectId?: string
): Promise<Analysis> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Analysis '${analysisId}' not found`);
    }
    throw new Error('Failed to fetch analysis');
  }

  return response.json();
}

/**
 * Update an existing Analysis
 */
export async function updateAnalysis(
  analysisId: string,
  data: UpdateAnalysisRequest,
  projectId?: string
): Promise<Analysis> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }

  const response = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to update analysis');
  }

  return response.json();
}

/**
 * Delete an Analysis
 */
export async function deleteAnalysis(
  analysisId: string,
  projectId?: string
): Promise<void> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }

  const response = await fetch(url.toString(), {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete analysis');
  }
}

/**
 * Compile an execution plan (for preview/approval)
 */
export async function compileAnalysis(
  analysisId: string,
  options?: { params?: Record<string, unknown>; force?: boolean; projectId?: string }
): Promise<ExecutionPlan> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}/compile`);
  if (options?.projectId) {
    url.searchParams.set('project_id', options.projectId);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      params: options?.params,
      force: options?.force ?? false,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to compile analysis');
  }

  return response.json();
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
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}/execute`);
  if (options?.projectId) {
    url.searchParams.set('project_id', options.projectId);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      params: options?.params,
      force: options?.force ?? false,
      continue_on_failure: options?.continueOnFailure ?? false,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to execute analysis');
  }

  return response.json();
}

/**
 * Get freshness status for an Analysis
 */
export async function getFreshness(
  analysisId: string,
  projectId?: string
): Promise<FreshnessStatus> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}/freshness`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('Failed to fetch freshness status');
  }

  return response.json();
}

/**
 * Get lineage information for an Analysis
 */
export async function getLineage(
  analysisId: string,
  projectId?: string
): Promise<LineageInfo> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}/lineage`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('Failed to fetch lineage');
  }

  return response.json();
}

/**
 * Get run history for an Analysis
 */
export async function getRunHistory(
  analysisId: string,
  options?: { limit?: number; projectId?: string }
): Promise<RunHistoryEntry[]> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}/history`);
  if (options?.limit) {
    url.searchParams.set('limit', options.limit.toString());
  }
  if (options?.projectId) {
    url.searchParams.set('project_id', options.projectId);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('Failed to fetch run history');
  }

  return response.json();
}

/**
 * Get full lineage graph for all analyses
 */
export async function getLineageGraph(
  projectId?: string
): Promise<LineageGraph> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/lineage-graph`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error('Failed to fetch lineage graph');
  }

  return response.json();
}

// ========== Data Fetching ==========

export interface AnalysisData {
  columns: string[];
  rows: any[][];
  total_rows: number;
}

/**
 * Get the result data from an analysis.
 * Must execute the analysis first to have data available.
 */
export async function getAnalysisData(
  analysisId: string,
  options?: { projectId?: string; limit?: number; offset?: number }
): Promise<AnalysisData> {
  const url = new URL(`${getBackendUrl()}/api/v1/asset/analyses/${analysisId}/data`);
  if (options?.projectId) {
    url.searchParams.set('project_id', options.projectId);
  }
  if (options?.limit) {
    url.searchParams.set('limit', options.limit.toString());
  }
  if (options?.offset) {
    url.searchParams.set('offset', options.offset.toString());
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to fetch analysis data');
  }

  return response.json();
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

