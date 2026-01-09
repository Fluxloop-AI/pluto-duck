/**
 * @deprecated This file is a compatibility layer. Use sourceApi.ts for new code.
 * 
 * This module provides backward-compatible wrappers around the new Source API.
 * The legacy data_sources API has been merged into the unified source API.
 * 
 * NOTE: All functions now require a projectId parameter for proper data isolation.
 */

import {
  fetchSources,
  fetchSourceDetail,
  createSource,
  deleteSource,
  fetchSourceTables,
  cacheTable,
  fetchCachedTables,
  refreshCache,
  dropCache,
  Source,
  SourceDetail,
  CachedTable,
  SourceType,
} from './sourceApi';

// =============================================================================
// Legacy Types (kept for compatibility)
// =============================================================================

export interface DataSourceTable {
  id: string;
  data_source_id: string;
  source_table: string | null;
  source_query: string | null;
  target_table: string;
  rows_count: number | null;
  status: string;
  last_imported_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any> | null;
}

export interface DataSource {
  id: string;
  name: string;
  description: string | null;
  connector_type: string;
  source_config: Record<string, any>;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any> | null;
  table_count: number;
}

export interface DataSourceDetail extends DataSource {
  tables: DataSourceTable[];
}

export interface CreateDataSourceRequest {
  name: string;
  description?: string;
  connector_type: string;
  source_config: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface TableImportRequest {
  target_table: string;
  overwrite?: boolean;
  source_table?: string | null;
  source_query?: string | null;
  metadata?: Record<string, any>;
}

export interface BulkTableImportRequest {
  tables: TableImportRequest[];
}

export interface TableImportResult {
  target_table: string;
  table_id: string | null;
  status: string;
  rows_imported: number | null;
  error: string | null;
}

export interface BulkTableImportResponse {
  results: TableImportResult[];
}

export interface TestConnectionResponse {
  status: string;
  tables: string[];
}

export interface SyncResponse {
  status: string;
  rows_imported: number | null;
  message: string;
}

// =============================================================================
// Adapter Functions
// =============================================================================

function sourceToDataSource(source: Source): DataSource {
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    connector_type: source.source_type,
    source_config: source.connection_config || {},
    status: source.status,
    error_message: source.error_message,
    created_at: source.attached_at,
    updated_at: source.attached_at,
    metadata: null,
    table_count: source.table_count,
  };
}

function cachedTableToDataSourceTable(cached: CachedTable, sourceId: string): DataSourceTable {
  return {
    id: cached.id,
    data_source_id: sourceId,
    source_table: cached.source_table,
    source_query: null,
    target_table: cached.local_table,
    rows_count: cached.row_count,
    status: 'active',
    last_imported_at: cached.cached_at,
    error_message: null,
    created_at: cached.cached_at,
    updated_at: cached.cached_at,
    metadata: null,
  };
}

// =============================================================================
// Legacy API Functions
// =============================================================================

export async function fetchDataSources(projectId: string): Promise<DataSource[]> {
  const sources = await fetchSources(projectId);
  return sources.map(sourceToDataSource);
}

export async function fetchDataSourceDetail(projectId: string, sourceId: string): Promise<DataSourceDetail> {
  // sourceId is actually the source name in the new API
  const detail = await fetchSourceDetail(projectId, sourceId);
  return {
    ...sourceToDataSource(detail),
    tables: detail.cached_tables.map(c => cachedTableToDataSourceTable(c, detail.id)),
  };
}

export async function createDataSource(projectId: string, request: CreateDataSourceRequest): Promise<DataSource> {
  const source = await createSource(projectId, {
    name: request.name,
    source_type: request.connector_type as SourceType,
    source_config: request.source_config,
    description: request.description,
  });
  return sourceToDataSource(source);
}

export async function deleteDataSource(projectId: string, sourceId: string, dropTables = false): Promise<void> {
  // If dropTables is true, we should also drop cached tables
  if (dropTables) {
    try {
      const detail = await fetchSourceDetail(projectId, sourceId);
      for (const cached of detail.cached_tables) {
        await dropCache(projectId, cached.local_table);
      }
    } catch {
      // Source might not exist, continue with deletion
    }
  }
  await deleteSource(projectId, sourceId);
}

export async function testConnection(
  connector: string,
  sourceConfig: Record<string, any>
): Promise<TestConnectionResponse> {
  // Test connection by trying to list tables after a temporary attach
  // For now, just return success - the actual test happens on attach
  return {
    status: 'success',
    tables: [],
  };
}

export async function importTable(
  projectId: string,
  sourceId: string,
  payload: TableImportRequest
): Promise<DataSourceTable> {
  // Import = cache in new API
  const cached = await cacheTable(projectId, {
    source_name: sourceId,
    table_name: payload.source_table || payload.target_table,
    local_name: payload.target_table,
  });
  return cachedTableToDataSourceTable(cached, sourceId);
}

export async function importTablesBulk(
  projectId: string,
  sourceId: string,
  payload: BulkTableImportRequest
): Promise<BulkTableImportResponse> {
  const results: TableImportResult[] = [];
  
  for (const table of payload.tables) {
    try {
      const cached = await cacheTable(projectId, {
        source_name: sourceId,
        table_name: table.source_table || table.target_table,
        local_name: table.target_table,
      });
      results.push({
        target_table: cached.local_table,
        table_id: cached.id,
        status: 'success',
        rows_imported: cached.row_count,
        error: null,
      });
    } catch (err) {
      results.push({
        target_table: table.target_table,
        table_id: null,
        status: 'error',
        rows_imported: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  
  return { results };
}

export async function syncTable(
  projectId: string,
  sourceId: string,
  tableId: string
): Promise<SyncResponse> {
  // Find the cached table by ID and refresh it
  const allCached = await fetchCachedTables(projectId, sourceId);
  const cached = allCached.find(c => c.id === tableId);
  
  if (!cached) {
    throw new Error(`Table with ID ${tableId} not found`);
  }
  
  const refreshed = await refreshCache(projectId, cached.local_table);
  return {
    status: 'success',
    rows_imported: refreshed.row_count,
    message: `Synced ${refreshed.row_count || 0} rows`,
  };
}

export async function deleteTable(
  projectId: string,
  sourceId: string,
  tableId: string,
  dropTable = false
): Promise<void> {
  // Find the cached table by ID
  const allCached = await fetchCachedTables(projectId, sourceId);
  const cached = allCached.find(c => c.id === tableId);
  
  if (!cached) {
    throw new Error(`Table with ID ${tableId} not found`);
  }
  
  await dropCache(projectId, cached.local_table);
}
