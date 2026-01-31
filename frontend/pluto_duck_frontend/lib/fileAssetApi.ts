/**
 * File Asset API - CSV/Parquet file imports.
 * 
 * File Assets go directly to Asset Zone (no ATTACH, no TTL).
 * They are permanent until explicitly deleted.
 */

import { apiJson, apiVoid } from './apiClient';
import type { ApiError } from './apiClient';

// =============================================================================
// Types
// =============================================================================

export type FileType = 'csv' | 'parquet';

export interface FileSource {
  file_path: string;
  original_name: string | null;
  row_count: number | null;
  file_size_bytes: number | null;
  added_at: string | null;
}

export interface FileAsset {
  id: string;
  name: string;
  file_path: string;
  file_type: FileType;
  table_name: string;
  description: string | null;
  row_count: number | null;
  column_count: number | null;
  file_size_bytes: number | null;
  created_at: string | null;
  updated_at: string | null;
  sources?: FileSource[] | null;
}

export type ImportMode = 'replace' | 'append' | 'merge';

export interface ImportFileRequest {
  file_path: string;
  file_type: FileType;
  table_name: string;
  name?: string;
  description?: string;
  overwrite?: boolean;
  mode?: ImportMode;
  target_table?: string;
  merge_keys?: string[];
  deduplicate?: boolean;
  diagnosis_id?: string;
}

export interface FileSchema {
  columns: Array<{
    column_name: string;
    column_type: string;
    null: string;
    key: string | null;
    default: string | null;
    extra: string | null;
  }>;
}

export type CellValue = string | number | boolean | null;

export interface FilePreview {
  columns: string[];
  rows: CellValue[][];
  total_rows: number | null;
}

// =============================================================================
// Diagnosis Types
// =============================================================================

export interface DiagnoseFileRequest {
  file_path: string;
  file_type: FileType;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TypeSuggestion {
  column_name: string;
  current_type: string;
  suggested_type: string;
  confidence: number;
  sample_values?: string[];
}

// Extended diagnosis types (for loading screen)
export interface EncodingInfo {
  detected: string;
  confidence: number;
}

export interface ParsingIntegrity {
  total_lines: number;
  parsed_rows: number;
  malformed_rows: number;
  has_errors: boolean;
  error_message?: string;
}

export interface NumericStats {
  min: number;
  max: number;
  median: number;
  mean: number;
  stddev: number;
  distinct_count: number;
}

export interface ValueFrequency {
  value: string;
  frequency: number;
}

export interface CategoricalStats {
  unique_count: number;
  top_values: ValueFrequency[];
  avg_length: number;
}

export interface DateStats {
  min_date: string;
  max_date: string;
  span_days: number;
  distinct_days: number;
}

export interface ColumnStatistics {
  column_name: string;
  column_type: string;
  semantic_type?: string;
  null_count: number;
  null_percentage: number;
  numeric_stats?: NumericStats;
  categorical_stats?: CategoricalStats;
  date_stats?: DateStats;
}

// LLM Analysis types
export interface PotentialItem {
  question: string;
  analysis: string;
}

export interface IssueItem {
  issue: string;
  issue_type: string;
  suggestion: string;
  example?: string;
}

export interface LLMAnalysis {
  suggested_name: string;
  context: string;
  potential: PotentialItem[];
  issues: IssueItem[];
  analyzed_at?: string;
  model_used: string;
}

export type DiagnosisIssueStatus = 'open' | 'confirmed' | 'dismissed' | 'resolved';

export interface DiagnosisIssue {
  id: string;
  diagnosis_id: string;
  file_asset_id: string;
  issue: string;
  issue_type: string;
  suggestion?: string | null;
  example?: string | null;
  status: DiagnosisIssueStatus;
  user_response?: string | null;
  confirmed_at?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DiagnosisIssueListResponse {
  issues: DiagnosisIssue[];
}

export interface DiagnosisIssueUpdateRequest {
  status?: DiagnosisIssueStatus;
  user_response?: string;
  resolved_by?: string;
}

export interface DiagnosisIssueDeleteRequest {
  deleted_by?: string;
  delete_reason?: string;
}

export interface FileDiagnosis {
  file_path: string;
  file_type: string;
  columns: ColumnSchema[];
  missing_values: Record<string, number>;
  row_count: number;
  file_size_bytes: number;
  type_suggestions: TypeSuggestion[];
  diagnosed_at: string;
  // Extended fields (optional - for loading screen)
  encoding?: EncodingInfo;
  parsing_integrity?: ParsingIntegrity;
  column_statistics?: ColumnStatistics[];
  sample_rows?: CellValue[][];
  // LLM analysis (optional - only when includeLlm=true)
  llm_analysis?: LLMAnalysis;
  // Diagnosis ID for linking to FileAsset
  diagnosis_id?: string;
}

// Merge context for LLM analysis
export interface MergeContext {
  total_rows: number;
  duplicate_rows: number;
  estimated_rows: number;
  skipped: boolean;
}

// Merged analysis result from LLM
export interface MergedAnalysis {
  suggested_name: string;
  context: string;
}

export interface DiagnoseFilesRequest {
  files: DiagnoseFileRequest[];
  use_cache?: boolean;
  include_llm?: boolean;
  llm_mode?: 'sync' | 'defer' | 'cache_only';
  include_merge_analysis?: boolean;
  merge_context?: MergeContext;
}

export interface DiagnoseFilesResponse {
  diagnoses: FileDiagnosis[];
  merged_analysis?: MergedAnalysis;
  llm_pending?: boolean;
}

// =============================================================================
// Duplicate Count Types
// =============================================================================

export interface DuplicateCountResponse {
  total_rows: number;
  duplicate_rows: number;
  estimated_rows: number;
  skipped: boolean;
}

// =============================================================================
// Helper functions
// =============================================================================

function isApiErrorStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as ApiError).name === 'ApiError' &&
    (error as ApiError).status === status
  );
}

function buildAssetPath(path: string, params?: URLSearchParams): string {
  const query = params?.toString();
  return query && query.length > 0 ? `/api/v1/asset${path}?${query}` : `/api/v1/asset${path}`;
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Import a CSV or Parquet file into DuckDB.
 * Creates a table from the file and registers it as a File Asset.
 */
export async function importFile(
  projectId: string,
  request: ImportFileRequest
): Promise<FileAsset> {
  return apiJson<FileAsset>(buildAssetPath('/files'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    projectId,
  });
}

/**
 * List all file assets for the project.
 */
export async function listFileAssets(projectId: string): Promise<FileAsset[]> {
  return apiJson<FileAsset[]>(buildAssetPath('/files'), { projectId });
}

/**
 * Get a file asset by ID.
 */
export async function getFileAsset(projectId: string, fileId: string): Promise<FileAsset> {
  return apiJson<FileAsset>(buildAssetPath(`/files/${encodeURIComponent(fileId)}`), { projectId });
}

/**
 * Delete a file asset.
 */
export async function deleteFileAsset(
  projectId: string,
  fileId: string,
  dropTable: boolean = true
): Promise<void> {
  const params = new URLSearchParams({ drop_table: String(dropTable) });
  await apiVoid(buildAssetPath(`/files/${encodeURIComponent(fileId)}`, params), {
    method: 'DELETE',
    projectId,
  });
}

/**
 * Refresh a file asset by re-importing from the source file.
 */
export async function refreshFileAsset(projectId: string, fileId: string): Promise<FileAsset> {
  return apiJson<FileAsset>(buildAssetPath(`/files/${encodeURIComponent(fileId)}/refresh`), {
    method: 'POST',
    projectId,
  });
}

/**
 * Get the schema of the imported table.
 */
export async function getFileSchema(projectId: string, fileId: string): Promise<FileSchema> {
  return apiJson<FileSchema>(buildAssetPath(`/files/${encodeURIComponent(fileId)}/schema`), {
    projectId,
  });
}

/**
 * Preview data from the imported table.
 */
export async function previewFileData(
  projectId: string,
  fileId: string,
  limit: number = 100
): Promise<FilePreview> {
  const params = new URLSearchParams({ limit: String(limit) });
  return apiJson<FilePreview>(buildAssetPath(`/files/${encodeURIComponent(fileId)}/preview`, params), {
    projectId,
  });
}

/**
 * Diagnose files before import.
 * Extracts schema, missing values, and type suggestions.
 *
 * @param projectId - Project ID
 * @param files - List of files to diagnose
 * @param useCache - Whether to use cached results (default: true)
 * @param includeLlm - Whether to include LLM analysis (default: false, slower)
 * @param includeMergeAnalysis - Whether to include merge analysis when schemas match (default: false)
 * @param mergeContext - Merge context with duplicate info (only when includeMergeAnalysis=true)
 */
export async function diagnoseFiles(
  projectId: string,
  files: DiagnoseFileRequest[],
  useCache: boolean = true,
  includeLlm: boolean = false,
  includeMergeAnalysis: boolean = false,
  mergeContext?: MergeContext,
  llmMode: 'sync' | 'defer' | 'cache_only' = 'sync'
): Promise<DiagnoseFilesResponse> {
  const requestBody: DiagnoseFilesRequest = {
    files,
    use_cache: useCache,
    include_llm: includeLlm,
  };

  if (includeLlm) {
    requestBody.llm_mode = llmMode;
  }

  // Only include merge analysis fields when requested
  if (includeMergeAnalysis) {
    requestBody.include_merge_analysis = true;
    if (mergeContext) {
      requestBody.merge_context = mergeContext;
    }
  }
  return apiJson<DiagnoseFilesResponse>(buildAssetPath('/files/diagnose'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    projectId,
  });
}

/**
 * Count duplicate rows across multiple files.
 * Used to preview deduplication results before import.
 *
 * @param projectId - Project ID
 * @param files - List of files to check for duplicates
 * @returns Duplicate count statistics
 */
export async function countDuplicateRows(
  projectId: string,
  files: DiagnoseFileRequest[]
): Promise<DuplicateCountResponse> {
  return apiJson<DuplicateCountResponse>(buildAssetPath('/files/count-duplicates'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
    projectId,
  });
}

/**
 * Get diagnosis for an existing file asset.
 * Returns null if no diagnosis exists (404).
 *
 * @param projectId - Project ID
 * @param fileId - File asset ID
 * @param options - Optional settings (useCache=false to force fresh diagnosis)
 * @returns FileDiagnosis or null if not found
 */
export async function getFileDiagnosis(
  projectId: string,
  fileId: string,
  options?: { useCache?: boolean }
): Promise<FileDiagnosis | null> {
  const params = new URLSearchParams();
  if (options?.useCache === false) {
    params.set('use_cache', 'false');
  }
  try {
    return await apiJson<FileDiagnosis>(
      buildAssetPath(`/files/${encodeURIComponent(fileId)}/diagnosis`, params),
      { projectId }
    );
  } catch (error) {
    if (isApiErrorStatus(error, 404)) {
      return null;
    }
    throw error;
  }
}

export async function regenerateSummary(
  projectId: string,
  fileId: string
): Promise<FileDiagnosis> {
  return apiJson<FileDiagnosis>(
    buildAssetPath(`/files/${encodeURIComponent(fileId)}/summary/regenerate`),
    {
      method: 'POST',
      projectId,
    }
  );
}

export async function rescanQuickScan(
  projectId: string,
  fileId: string
): Promise<FileDiagnosis> {
  return apiJson<FileDiagnosis>(
    buildAssetPath(`/files/${encodeURIComponent(fileId)}/diagnosis/rescan`),
    {
      method: 'POST',
      projectId,
    }
  );
}

export async function listDiagnosisIssues(
  projectId: string,
  fileId: string,
  options?: { status?: DiagnosisIssueStatus; includeDeleted?: boolean }
): Promise<DiagnosisIssueListResponse> {
  const params = new URLSearchParams();
  if (options?.status) {
    params.set('status', options.status);
  }
  if (options?.includeDeleted) {
    params.set('include_deleted', 'true');
  }
  return apiJson<DiagnosisIssueListResponse>(
    buildAssetPath(`/files/${encodeURIComponent(fileId)}/issues`, params),
    { projectId }
  );
}

export async function findDiagnosisIssues(
  projectId: string,
  fileId: string
): Promise<DiagnosisIssueListResponse> {
  return apiJson<DiagnosisIssueListResponse>(
    buildAssetPath(`/files/${encodeURIComponent(fileId)}/issues/find`),
    {
      method: 'POST',
      projectId,
    }
  );
}

export async function updateDiagnosisIssue(
  projectId: string,
  issueId: string,
  request: DiagnosisIssueUpdateRequest
): Promise<DiagnosisIssue> {
  return apiJson<DiagnosisIssue>(
    buildAssetPath(`/files/issues/${encodeURIComponent(issueId)}`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      projectId,
    }
  );
}

export async function deleteDiagnosisIssue(
  projectId: string,
  issueId: string,
  request: DiagnosisIssueDeleteRequest = {}
): Promise<DiagnosisIssue> {
  return apiJson<DiagnosisIssue>(
    buildAssetPath(`/files/issues/${encodeURIComponent(issueId)}`),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      projectId,
    }
  );
}
