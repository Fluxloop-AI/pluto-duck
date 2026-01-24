/**
 * File Asset API - CSV/Parquet file imports.
 * 
 * File Assets go directly to Asset Zone (no ATTACH, no TTL).
 * They are permanent until explicitly deleted.
 */

import { getBackendUrl } from './api';

// =============================================================================
// Types
// =============================================================================

export type FileType = 'csv' | 'parquet';

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

export interface FilePreview {
  columns: string[];
  rows: any[][];
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

export interface FileDiagnosis {
  file_path: string;
  file_type: string;
  columns: ColumnSchema[];
  missing_values: Record<string, number>;
  row_count: number;
  file_size_bytes: number;
  type_suggestions: TypeSuggestion[];
  diagnosed_at: string;
}

export interface DiagnoseFilesRequest {
  files: DiagnoseFileRequest[];
  use_cache?: boolean;
}

export interface DiagnoseFilesResponse {
  diagnoses: FileDiagnosis[];
}

// =============================================================================
// Helper functions
// =============================================================================

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

function buildUrl(path: string, projectId: string): string {
  return `${getBackendUrl()}/api/v1/asset${path}?project_id=${encodeURIComponent(projectId)}`;
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
  const url = buildUrl('/files', projectId);
  console.log('[fileAssetApi] importFile URL:', url);
  console.log('[fileAssetApi] importFile request:', request);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  
  console.log('[fileAssetApi] importFile response status:', response.status);
  const result = await handleResponse<FileAsset>(response);
  console.log('[fileAssetApi] importFile result:', result);
  return result;
}

/**
 * List all file assets for the project.
 */
export async function listFileAssets(projectId: string): Promise<FileAsset[]> {
  const url = buildUrl('/files', projectId);
  console.log('[fileAssetApi] listFileAssets URL:', url);
  
  const response = await fetch(url);
  console.log('[fileAssetApi] listFileAssets response status:', response.status);
  
  const result = await handleResponse<FileAsset[]>(response);
  console.log('[fileAssetApi] listFileAssets result:', result);
  return result;
}

/**
 * Get a file asset by ID.
 */
export async function getFileAsset(projectId: string, fileId: string): Promise<FileAsset> {
  const url = buildUrl(`/files/${encodeURIComponent(fileId)}`, projectId);
  const response = await fetch(url);
  return handleResponse<FileAsset>(response);
}

/**
 * Delete a file asset.
 */
export async function deleteFileAsset(
  projectId: string,
  fileId: string,
  dropTable: boolean = true
): Promise<void> {
  const baseUrl = buildUrl(`/files/${encodeURIComponent(fileId)}`, projectId);
  const url = `${baseUrl}&drop_table=${dropTable}`;
  const response = await fetch(url, { method: 'DELETE' });
  await handleResponse<{ status: string }>(response);
}

/**
 * Refresh a file asset by re-importing from the source file.
 */
export async function refreshFileAsset(projectId: string, fileId: string): Promise<FileAsset> {
  const url = buildUrl(`/files/${encodeURIComponent(fileId)}/refresh`, projectId);
  const response = await fetch(url, { method: 'POST' });
  return handleResponse<FileAsset>(response);
}

/**
 * Get the schema of the imported table.
 */
export async function getFileSchema(projectId: string, fileId: string): Promise<FileSchema> {
  const url = buildUrl(`/files/${encodeURIComponent(fileId)}/schema`, projectId);
  const response = await fetch(url);
  return handleResponse<FileSchema>(response);
}

/**
 * Preview data from the imported table.
 */
export async function previewFileData(
  projectId: string,
  fileId: string,
  limit: number = 100
): Promise<FilePreview> {
  const baseUrl = buildUrl(`/files/${encodeURIComponent(fileId)}/preview`, projectId);
  const url = `${baseUrl}&limit=${limit}`;
  const response = await fetch(url);
  return handleResponse<FilePreview>(response);
}

/**
 * Diagnose files before import.
 * Extracts schema, missing values, and type suggestions.
 */
export async function diagnoseFiles(
  projectId: string,
  files: DiagnoseFileRequest[],
  useCache: boolean = true
): Promise<DiagnoseFilesResponse> {
  const baseUrl = buildUrl('/files/diagnose', projectId);
  const url = `${baseUrl}&use_cache=${useCache}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });

  const result = await handleResponse<DiagnoseFilesResponse>(response);
  return result;
}

