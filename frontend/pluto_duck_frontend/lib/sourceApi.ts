/**
 * Source API - External database federation and caching.
 * 
 * This API provides a unified interface for managing attached sources and cached tables.
 * All operations are project-scoped for proper data isolation.
 */

import { apiJson, apiVoid } from './apiClient';

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

function buildPath(path: string, params?: Record<string, string>): string {
  if (!params || Object.keys(params).length === 0) {
    return path;
  }
  const query = new URLSearchParams(params).toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

// =============================================================================
// Source Operations
// =============================================================================

export async function fetchSources(projectId: string): Promise<Source[]> {
  return apiJson<Source[]>('/api/v1/source', { projectId });
}

export async function fetchSourceDetail(projectId: string, sourceName: string): Promise<SourceDetail> {
  return apiJson<SourceDetail>(`/api/v1/source/${encodeURIComponent(sourceName)}`, { projectId });
}

export async function createSource(projectId: string, request: CreateSourceRequest): Promise<Source> {
  return apiJson<Source>('/api/v1/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    projectId,
  });
}

export async function updateSource(
  projectId: string,
  sourceName: string,
  request: UpdateSourceRequest
): Promise<Source> {
  return apiJson<Source>(`/api/v1/source/${encodeURIComponent(sourceName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    projectId,
  });
}

export async function deleteSource(projectId: string, sourceName: string): Promise<void> {
  await apiVoid(`/api/v1/source/${encodeURIComponent(sourceName)}`, {
    method: 'DELETE',
    projectId,
  });
}

export async function fetchSourceTables(projectId: string, sourceName: string): Promise<SourceTable[]> {
  return apiJson<SourceTable[]>(`/api/v1/source/${encodeURIComponent(sourceName)}/tables`, {
    projectId,
  });
}

export async function estimateTableSize(
  projectId: string,
  sourceName: string,
  tableName: string
): Promise<SizeEstimate> {
  return apiJson<SizeEstimate>(
    `/api/v1/source/${encodeURIComponent(sourceName)}/tables/${encodeURIComponent(tableName)}/estimate`,
    { projectId }
  );
}

// =============================================================================
// Cache Operations
// =============================================================================

export async function cacheTable(projectId: string, request: CacheTableRequest): Promise<CachedTable> {
  return apiJson<CachedTable>('/api/v1/source/cache', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    projectId,
  });
}

export async function fetchCachedTables(projectId: string, sourceName?: string): Promise<CachedTable[]> {
  const path = buildPath('/api/v1/source/cache/', sourceName ? { source_name: sourceName } : undefined);
  return apiJson<CachedTable[]>(path, { projectId });
}

export async function fetchCachedTable(projectId: string, localTable: string): Promise<CachedTable> {
  return apiJson<CachedTable>(`/api/v1/source/cache/${encodeURIComponent(localTable)}`, {
    projectId,
  });
}

export async function refreshCache(projectId: string, localTable: string): Promise<CachedTable> {
  return apiJson<CachedTable>(`/api/v1/source/cache/${encodeURIComponent(localTable)}/refresh`, {
    method: 'POST',
    projectId,
  });
}

export async function dropCache(projectId: string, localTable: string): Promise<void> {
  await apiVoid(`/api/v1/source/cache/${encodeURIComponent(localTable)}`, {
    method: 'DELETE',
    projectId,
  });
}

export async function cleanupExpiredCaches(projectId: string): Promise<{ cleaned_count: number }> {
  return apiJson<{ cleaned_count: number }>('/api/v1/source/cache/cleanup', {
    method: 'POST',
    projectId,
  });
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
  const path = buildPath(`/api/v1/source/cache/${encodeURIComponent(localTable)}/preview`, {
    limit: String(limit),
  });
  return apiJson<CachedTablePreview>(path, { projectId });
}

// =============================================================================
// Folder Source Operations
// =============================================================================

export async function listFolderSources(projectId: string): Promise<FolderSource[]> {
  return apiJson<FolderSource[]>('/api/v1/source/folders', { projectId });
}

export async function createFolderSource(
  projectId: string,
  request: CreateFolderSourceRequest
): Promise<FolderSource> {
  return apiJson<FolderSource>('/api/v1/source/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    projectId,
  });
}

export async function deleteFolderSource(projectId: string, folderId: string): Promise<void> {
  await apiVoid(`/api/v1/source/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
    projectId,
  });
}

export async function listFolderFiles(
  projectId: string,
  folderId: string,
  limit: number = 500
): Promise<FolderFile[]> {
  const path = buildPath(`/api/v1/source/folders/${encodeURIComponent(folderId)}/files`, {
    limit: String(limit),
  });
  return apiJson<FolderFile[]>(path, { projectId });
}

export async function scanFolderSource(projectId: string, folderId: string): Promise<FolderScanResult> {
  return apiJson<FolderScanResult>(`/api/v1/source/folders/${encodeURIComponent(folderId)}/scan`, {
    method: 'POST',
    projectId,
  });
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
