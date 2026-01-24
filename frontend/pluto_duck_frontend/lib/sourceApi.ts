/**
 * Source API - External database federation and caching.
 * 
 * This API provides a unified interface for managing attached sources and cached tables.
 * All operations are project-scoped for proper data isolation.
 */

import { getBackendUrl } from './api';

// =============================================================================
// Types
// =============================================================================

export type SourceType = 'postgres' | 'sqlite' | 'mysql' | 'duckdb';

export interface Source {
  id: string;
  name: string;
  source_type: SourceType;
  status: 'attached' | 'error' | 'detached';
  attached_at: string;
  error_message: string | null;
  project_id: string | null;
  description: string | null;
  table_count: number;
  connection_config: Record<string, any> | null;
}

export interface SourceDetail extends Source {
  cached_tables: CachedTable[];
}

export interface CachedTable {
  id: string;
  source_name: string;
  source_table: string;
  local_table: string;
  cached_at: string;
  row_count: number | null;
  expires_at: string | null;
  filter_sql: string | null;
}

export interface SourceTable {
  source_name: string;
  schema_name: string;
  table_name: string;
  mode: 'live' | 'cached';
  local_table: string | null;
}

export interface CreateSourceRequest {
  name: string;
  source_type: SourceType;
  source_config: Record<string, any>;
  description?: string;
}

export interface UpdateSourceRequest {
  description?: string;
}

export interface CacheTableRequest {
  source_name: string;
  table_name: string;
  local_name?: string;
  filter_sql?: string;
  expires_hours?: number;
}

export interface SizeEstimate {
  source_name: string;
  table_name: string;
  estimated_rows: number | null;
  recommend_cache: boolean;
  recommend_filter: boolean;
  suggestion: string;
  error: string | null;
}

export type FolderAllowedTypes = 'csv' | 'parquet' | 'both';

export interface FolderSource {
  id: string;
  name: string;
  path: string;
  allowed_types: FolderAllowedTypes;
  pattern: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateFolderSourceRequest {
  name: string;
  path: string;
  allowed_types?: FolderAllowedTypes;
  pattern?: string | null;
}

export interface FolderFile {
  path: string;
  name: string;
  file_type: 'csv' | 'parquet';
  size_bytes: number;
  modified_at: string;
}

export interface FolderScanResult {
  folder_id: string;
  scanned_at: string;
  new_files: number;
  changed_files: number;
  deleted_files: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

function buildUrl(path: string, projectId: string, params?: Record<string, string>): string {
  const url = new URL(`${getBackendUrl()}${path}`);
  url.searchParams.set('project_id', projectId);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

// =============================================================================
// Source Operations
// =============================================================================

export async function fetchSources(projectId: string): Promise<Source[]> {
  const url = buildUrl('/api/v1/source', projectId);
  const response = await fetch(url);
  return handleResponse(response);
}

export async function fetchSourceDetail(projectId: string, sourceName: string): Promise<SourceDetail> {
  const url = buildUrl(`/api/v1/source/${encodeURIComponent(sourceName)}`, projectId);
  const response = await fetch(url);
  return handleResponse(response);
}

export async function createSource(projectId: string, request: CreateSourceRequest): Promise<Source> {
  const url = buildUrl('/api/v1/source', projectId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

export async function updateSource(
  projectId: string,
  sourceName: string,
  request: UpdateSourceRequest
): Promise<Source> {
  const url = buildUrl(`/api/v1/source/${encodeURIComponent(sourceName)}`, projectId);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

export async function deleteSource(projectId: string, sourceName: string): Promise<void> {
  const url = buildUrl(`/api/v1/source/${encodeURIComponent(sourceName)}`, projectId);
  const response = await fetch(url, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to delete source: ${response.status}`);
  }
}

export async function fetchSourceTables(projectId: string, sourceName: string): Promise<SourceTable[]> {
  const url = buildUrl(`/api/v1/source/${encodeURIComponent(sourceName)}/tables`, projectId);
  const response = await fetch(url);
  return handleResponse(response);
}

export async function estimateTableSize(
  projectId: string,
  sourceName: string,
  tableName: string
): Promise<SizeEstimate> {
  const url = buildUrl(
    `/api/v1/source/${encodeURIComponent(sourceName)}/tables/${encodeURIComponent(tableName)}/estimate`,
    projectId
  );
  const response = await fetch(url);
  return handleResponse(response);
}

// =============================================================================
// Cache Operations
// =============================================================================

export async function cacheTable(projectId: string, request: CacheTableRequest): Promise<CachedTable> {
  const url = buildUrl('/api/v1/source/cache', projectId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

export async function fetchCachedTables(projectId: string, sourceName?: string): Promise<CachedTable[]> {
  const url = buildUrl(
    '/api/v1/source/cache/',
    projectId,
    sourceName ? { source_name: sourceName } : undefined
  );
  const response = await fetch(url);
  return handleResponse(response);
}

export async function fetchCachedTable(projectId: string, localTable: string): Promise<CachedTable> {
  const url = buildUrl(`/api/v1/source/cache/${encodeURIComponent(localTable)}`, projectId);
  const response = await fetch(url);
  return handleResponse(response);
}

export async function refreshCache(projectId: string, localTable: string): Promise<CachedTable> {
  const url = buildUrl(`/api/v1/source/cache/${encodeURIComponent(localTable)}/refresh`, projectId);
  const response = await fetch(url, { method: 'POST' });
  return handleResponse(response);
}

export async function dropCache(projectId: string, localTable: string): Promise<void> {
  const url = buildUrl(`/api/v1/source/cache/${encodeURIComponent(localTable)}`, projectId);
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to drop cache: ${response.status}`);
  }
}

export async function cleanupExpiredCaches(projectId: string): Promise<{ cleaned_count: number }> {
  const url = buildUrl('/api/v1/source/cache/cleanup', projectId);
  const response = await fetch(url, { method: 'POST' });
  return handleResponse(response);
}

export interface CachedTablePreview {
  columns: string[];
  rows: any[][];
  total_rows: number | null;
}

export async function fetchCachedTablePreview(
  projectId: string,
  localTable: string,
  limit: number = 100
): Promise<CachedTablePreview> {
  const url = buildUrl(
    `/api/v1/source/cache/${encodeURIComponent(localTable)}/preview`,
    projectId,
    { limit: String(limit) }
  );
  const response = await fetch(url);
  return handleResponse(response);
}

// =============================================================================
// Folder Source Operations
// =============================================================================

export async function listFolderSources(projectId: string): Promise<FolderSource[]> {
  const url = buildUrl('/api/v1/source/folders', projectId);
  const response = await fetch(url);
  return handleResponse(response);
}

export async function createFolderSource(
  projectId: string,
  request: CreateFolderSourceRequest
): Promise<FolderSource> {
  const url = buildUrl('/api/v1/source/folders', projectId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

export async function deleteFolderSource(projectId: string, folderId: string): Promise<void> {
  const url = buildUrl(`/api/v1/source/folders/${encodeURIComponent(folderId)}`, projectId);
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to delete folder source: ${response.status}`);
  }
}

export async function listFolderFiles(
  projectId: string,
  folderId: string,
  limit: number = 500
): Promise<FolderFile[]> {
  const url = buildUrl(`/api/v1/source/folders/${encodeURIComponent(folderId)}/files`, projectId, {
    limit: String(limit),
  });
  const response = await fetch(url);
  return handleResponse(response);
}

export async function scanFolderSource(projectId: string, folderId: string): Promise<FolderScanResult> {
  const url = buildUrl(`/api/v1/source/folders/${encodeURIComponent(folderId)}/scan`, projectId);
  const response = await fetch(url, { method: 'POST' });
  return handleResponse(response);
}

// =============================================================================
// Convenience Attach Functions (for specific database types)
// =============================================================================

export interface PostgresConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  schema?: string;
}

export async function attachPostgres(
  projectId: string,
  name: string,
  config: PostgresConfig,
  options?: { description?: string }
): Promise<Source> {
  return createSource(projectId, {
    name,
    source_type: 'postgres',
    source_config: {
      host: config.host,
      port: config.port ?? 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      schema: config.schema ?? 'public',
    },
    description: options?.description,
  });
}

export interface SqliteConfig {
  path: string;
}

export async function attachSqlite(
  projectId: string,
  name: string,
  config: SqliteConfig,
  options?: { description?: string }
): Promise<Source> {
  return createSource(projectId, {
    name,
    source_type: 'sqlite',
    source_config: { path: config.path },
    description: options?.description,
  });
}
