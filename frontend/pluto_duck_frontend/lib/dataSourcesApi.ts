import { getBackendUrl } from './api';

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

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchDataSources(): Promise<DataSource[]> {
  const response = await fetch(`${getBackendUrl()}/api/v1/data-sources`);
  return handleResponse(response);
}

export async function fetchDataSourceDetail(sourceId: string): Promise<DataSourceDetail> {
  const response = await fetch(`${getBackendUrl()}/api/v1/data-sources/${sourceId}`);
  return handleResponse(response);
}

export async function createDataSource(
  request: CreateDataSourceRequest
): Promise<DataSource> {
  const response = await fetch(`${getBackendUrl()}/api/v1/data-sources`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

export async function deleteDataSource(sourceId: string, dropTables = false): Promise<void> {
  const url = `${getBackendUrl()}/api/v1/data-sources/${sourceId}${dropTables ? '?drop_tables=true' : ''}`;
  const response = await fetch(url, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to delete data source: ${response.status}`);
  }
}

export async function testConnection(
  connector: string,
  sourceConfig: Record<string, any>
): Promise<TestConnectionResponse> {
  const response = await fetch(`${getBackendUrl()}/api/v1/data-sources/test-connection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ connector_type: connector, source_config: sourceConfig }),
  });
  return handleResponse(response);
}

export async function importTable(
  sourceId: string,
  payload: TableImportRequest
): Promise<DataSourceTable> {
  const response = await fetch(`${getBackendUrl()}/api/v1/data-sources/${sourceId}/tables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function importTablesBulk(
  sourceId: string,
  payload: BulkTableImportRequest
): Promise<BulkTableImportResponse> {
  const response = await fetch(`${getBackendUrl()}/api/v1/data-sources/${sourceId}/tables/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function syncTable(
  sourceId: string,
  tableId: string
): Promise<SyncResponse> {
  const response = await fetch(`${getBackendUrl()}/api/v1/data-sources/${sourceId}/tables/${tableId}/sync`, {
    method: 'POST',
  });
  return handleResponse(response);
}

export async function deleteTable(
  sourceId: string,
  tableId: string,
  dropTable = false
): Promise<void> {
  const url = `${getBackendUrl()}/api/v1/data-sources/${sourceId}/tables/${tableId}${
    dropTable ? '?drop_table=true' : ''
  }`;
  const response = await fetch(url, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Failed to delete table: ${response.status}`);
  }
}

