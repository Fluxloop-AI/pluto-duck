import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { dbExec, dbQuery, sqlString } from './db.ts';
import { StoreHttpError } from './store.ts';

type JsonMap = Record<string, unknown>;
type SourceType = 'postgres' | 'sqlite' | 'mysql' | 'duckdb';
type SourceStatus = 'attached' | 'error' | 'detached';
type FolderAllowedTypes = 'csv' | 'parquet' | 'both';

type FolderFileType = 'csv' | 'parquet';

const SOURCE_TYPES: Set<SourceType> = new Set(['postgres', 'sqlite', 'mysql', 'duckdb']);
const SOURCE_STATUSES: Set<SourceStatus> = new Set(['attached', 'error', 'detached']);
const ALLOWED_FOLDER_TYPES: Set<FolderAllowedTypes> = new Set(['csv', 'parquet', 'both']);

interface RuntimeState {
  queue: Promise<void>;
  schemaReady: boolean;
}

const globalSourceState = globalThis as typeof globalThis & {
  __plutoDuckSourceState?: RuntimeState;
};

const runtimeState: RuntimeState = globalSourceState.__plutoDuckSourceState ?? {
  queue: Promise.resolve(),
  schemaReady: false,
};

if (!globalSourceState.__plutoDuckSourceState) {
  globalSourceState.__plutoDuckSourceState = runtimeState;
}

function withSourceLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = runtimeState.queue.then(operation, operation);
  runtimeState.queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StoreHttpError(400, `${fieldName} is required`);
  }
  return normalized;
}

function toInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function parseJsonValue<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (_error) {
    return fallback;
  }
}

function assertJsonObject(
  value: unknown,
  fieldName: string,
  options?: { optional?: boolean; nullable?: boolean }
): asserts value is JsonMap | null | undefined {
  if (value === undefined && options?.optional) {
    return;
  }
  if (value === null && options?.nullable) {
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoreHttpError(400, `${fieldName} must be an object`);
  }
}

function normalizeSourceType(value: string): SourceType {
  const normalized = value.trim().toLowerCase() as SourceType;
  if (!SOURCE_TYPES.has(normalized)) {
    throw new StoreHttpError(400, 'source_type must be postgres|sqlite|mysql|duckdb');
  }
  return normalized;
}

function sanitizeName(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new StoreHttpError(400, `${fieldName} is required`);
  }
  return normalized;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sanitizeTableIdentifier(value: string, fallback: string): string {
  const input = value.trim();
  const basis = input.length > 0 ? input : fallback;
  let normalized = basis
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) {
    normalized = 'cached_table';
  }
  if (/^[0-9]/.test(normalized)) {
    normalized = `_${normalized}`;
  }
  return normalized;
}

function normalizeFolderAllowedTypes(value: string | null | undefined): FolderAllowedTypes {
  const normalized = (value ?? 'both').trim().toLowerCase() as FolderAllowedTypes;
  if (!ALLOWED_FOLDER_TYPES.has(normalized)) {
    throw new StoreHttpError(400, 'allowed_types must be csv|parquet|both');
  }
  return normalized;
}

function normalizeOptionalPattern(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  try {
    void new RegExp(trimmed);
  } catch (_error) {
    throw new StoreHttpError(400, 'pattern is not a valid regular expression');
  }
  return trimmed;
}

function resolveFolderFileType(filePath: string): FolderFileType | null {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return 'csv';
  }
  if (extension === '.parquet') {
    return 'parquet';
  }
  return null;
}

function folderTypeAllowed(fileType: FolderFileType, allowed: FolderAllowedTypes): boolean {
  if (allowed === 'both') {
    return true;
  }
  return fileType === allowed;
}

interface ProjectRow {
  id: string;
}

interface SourceConnectionRow {
  id: string;
  project_id: string;
  name: string;
  source_type: string;
  status: string;
  attached_at: string;
  error_message: string | null;
  description: string | null;
  connection_config_json: string | null;
}

interface SourceConnectionWithCountRow extends SourceConnectionRow {
  table_count: number;
}

interface SourceTableRow {
  id: string;
  source_id: string;
  schema_name: string;
  table_name: string;
}

interface CachedTableRow {
  id: string;
  project_id: string;
  source_name: string;
  source_table: string;
  local_table: string;
  cached_at: string;
  row_count: number | null;
  expires_at: string | null;
  filter_sql: string | null;
}

interface FolderSourceRow {
  id: string;
  project_id: string;
  name: string;
  path: string;
  allowed_types: string;
  pattern: string | null;
  created_at: string;
  updated_at: string | null;
}

interface FolderFileSnapshotRow {
  file_path: string;
  size_bytes: number;
  modified_at: string;
}

export interface SourceRecord {
  id: string;
  name: string;
  source_type: SourceType;
  status: SourceStatus;
  attached_at: string;
  error_message: string | null;
  project_id: string | null;
  description: string | null;
  table_count: number;
  connection_config: JsonMap | null;
}

export interface SourceTableRecord {
  source_name: string;
  schema_name: string;
  table_name: string;
  mode: 'live' | 'cached';
  local_table: string | null;
}

export interface CachedTableRecord {
  id: string;
  source_name: string;
  source_table: string;
  local_table: string;
  cached_at: string;
  row_count: number | null;
  expires_at: string | null;
  filter_sql: string | null;
}

export interface SourceDetailRecord extends SourceRecord {
  cached_tables: CachedTableRecord[];
}

export interface SizeEstimateRecord {
  source_name: string;
  table_name: string;
  estimated_rows: number | null;
  recommend_cache: boolean;
  recommend_filter: boolean;
  suggestion: string;
  error: string | null;
}

export interface CachedTablePreviewRecord {
  columns: string[];
  rows: unknown[][];
  total_rows: number | null;
}

export interface FolderSourceRecord {
  id: string;
  name: string;
  path: string;
  allowed_types: FolderAllowedTypes;
  pattern: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface FolderFileRecord {
  path: string;
  name: string;
  file_type: FolderFileType;
  size_bytes: number;
  modified_at: string;
}

export interface FolderScanResultRecord {
  folder_id: string;
  scanned_at: string;
  new_files: number;
  changed_files: number;
  deleted_files: number;
}

async function ensureSourceSchema(): Promise<void> {
  if (runtimeState.schemaReady) {
    return;
  }

  await dbExec(
    `
CREATE TABLE IF NOT EXISTS source_connections (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  source_type VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  attached_at VARCHAR NOT NULL,
  error_message VARCHAR,
  description VARCHAR,
  connection_config_json VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS source_tables (
  id VARCHAR PRIMARY KEY,
  source_id VARCHAR NOT NULL,
  schema_name VARCHAR NOT NULL,
  table_name VARCHAR NOT NULL,
  created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS source_cached_tables (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  source_name VARCHAR NOT NULL,
  source_table VARCHAR NOT NULL,
  local_table VARCHAR NOT NULL,
  cached_at VARCHAR NOT NULL,
  row_count INTEGER,
  expires_at VARCHAR,
  filter_sql VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS source_folders (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  path VARCHAR NOT NULL,
  allowed_types VARCHAR NOT NULL,
  pattern VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR
);

CREATE TABLE IF NOT EXISTS source_folder_file_snapshot (
  folder_id VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  file_name VARCHAR NOT NULL,
  file_type VARCHAR NOT NULL,
  size_bytes BIGINT NOT NULL,
  modified_at VARCHAR NOT NULL,
  scanned_at VARCHAR NOT NULL,
  PRIMARY KEY (folder_id, file_path)
);
`
  );

  runtimeState.schemaReady = true;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const rows = await dbQuery<ProjectRow>(
    `SELECT id FROM projects WHERE id = ${sqlString(projectId)} LIMIT 1;`
  );
  if (!rows[0]) {
    throw new StoreHttpError(404, 'Project not found');
  }
}

async function resolveDefaultProjectIdUnlocked(): Promise<string> {
  const settingsRows = await dbQuery<{ default_project_id: string | null }>(
    'SELECT default_project_id FROM settings WHERE id = 1 LIMIT 1;'
  );
  const candidate = settingsRows[0]?.default_project_id ?? null;
  if (candidate) {
    const exists = await dbQuery<{ id: string }>(
      `SELECT id FROM projects WHERE id = ${sqlString(candidate)} LIMIT 1;`
    );
    if (exists[0]) {
      return candidate;
    }
  }

  const projectRows = await dbQuery<{ id: string }>(
    'SELECT id FROM projects ORDER BY created_at ASC, id ASC LIMIT 1;'
  );
  const projectId = projectRows[0]?.id;
  if (!projectId) {
    throw new StoreHttpError(500, 'No project is available');
  }
  return projectId;
}

async function resolveProjectIdUnlocked(scopeProjectId: string | null): Promise<string> {
  if (scopeProjectId) {
    await assertProjectExists(scopeProjectId);
    return scopeProjectId;
  }
  return resolveDefaultProjectIdUnlocked();
}

function toSourceRecord(row: SourceConnectionWithCountRow): SourceRecord {
  const sourceType = row.source_type as SourceType;
  const status = row.status as SourceStatus;
  return {
    id: row.id,
    name: row.name,
    source_type: SOURCE_TYPES.has(sourceType) ? sourceType : 'duckdb',
    status: SOURCE_STATUSES.has(status) ? status : 'error',
    attached_at: row.attached_at,
    error_message: row.error_message,
    project_id: row.project_id,
    description: row.description,
    table_count: toInteger(row.table_count, 0),
    connection_config: parseJsonValue<JsonMap | null>(row.connection_config_json, null),
  };
}

function toCachedTableRecord(row: CachedTableRow): CachedTableRecord {
  return {
    id: row.id,
    source_name: row.source_name,
    source_table: row.source_table,
    local_table: row.local_table,
    cached_at: row.cached_at,
    row_count: row.row_count === null ? null : toInteger(row.row_count, 0),
    expires_at: row.expires_at,
    filter_sql: row.filter_sql,
  };
}

function toFolderSourceRecord(row: FolderSourceRow): FolderSourceRecord {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    allowed_types: normalizeFolderAllowedTypes(row.allowed_types),
    pattern: row.pattern,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadSourceByNameUnlocked(sourceName: string, projectId: string): Promise<SourceConnectionWithCountRow> {
  const rows = await dbQuery<SourceConnectionWithCountRow>(
    `
SELECT
  s.id,
  s.project_id,
  s.name,
  s.source_type,
  s.status,
  s.attached_at,
  s.error_message,
  s.description,
  s.connection_config_json,
  COALESCE(COUNT(st.id), 0)::INTEGER AS table_count
FROM source_connections s
LEFT JOIN source_tables st ON st.source_id = s.id
WHERE s.project_id = ${sqlString(projectId)}
  AND s.name = ${sqlString(sourceName)}
GROUP BY
  s.id,
  s.project_id,
  s.name,
  s.source_type,
  s.status,
  s.attached_at,
  s.error_message,
  s.description,
  s.connection_config_json
LIMIT 1;
`
  );

  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Source not found');
  }
  return row;
}

async function listCachedTablesBySourceNameUnlocked(
  projectId: string,
  sourceName: string
): Promise<CachedTableRecord[]> {
  const rows = await dbQuery<CachedTableRow>(
    `
SELECT
  id,
  project_id,
  source_name,
  source_table,
  local_table,
  cached_at,
  row_count,
  expires_at,
  filter_sql
FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
  AND source_name = ${sqlString(sourceName)}
ORDER BY cached_at DESC, id DESC;
`
  );
  return rows.map(toCachedTableRecord);
}

function buildSeedTables(sourceType: SourceType, sourceConfig: JsonMap | null): Array<{ schema: string; table: string }> {
  const configured = Array.isArray(sourceConfig?.tables) ? sourceConfig?.tables : null;
  if (configured) {
    const parsed: Array<{ schema: string; table: string }> = [];
    for (const entry of configured) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        if (entry.includes('.')) {
          const [schema, table] = entry.split('.', 2);
          parsed.push({ schema: schema.trim() || 'public', table: table.trim() || 'table' });
        } else {
          parsed.push({ schema: 'public', table: entry.trim() });
        }
      }
    }
    if (parsed.length > 0) {
      return parsed;
    }
  }

  if (sourceType === 'sqlite' || sourceType === 'duckdb') {
    return [
      { schema: 'main', table: 'customers' },
      { schema: 'main', table: 'orders' },
      { schema: 'main', table: 'events' },
    ];
  }

  return [
    { schema: 'public', table: 'customers' },
    { schema: 'public', table: 'orders' },
    { schema: 'public', table: 'events' },
  ];
}

async function seedSourceTablesUnlocked(
  sourceId: string,
  sourceType: SourceType,
  sourceConfig: JsonMap | null
): Promise<void> {
  const seedTables = buildSeedTables(sourceType, sourceConfig);
  const existing = new Set<string>();

  const existingRows = await dbQuery<{ schema_name: string; table_name: string }>(
    `
SELECT schema_name, table_name
FROM source_tables
WHERE source_id = ${sqlString(sourceId)};
`
  );

  for (const row of existingRows) {
    existing.add(`${row.schema_name}.${row.table_name}`.toLowerCase());
  }

  const now = nowIso();
  const statements: string[] = [];
  for (const table of seedTables) {
    const schema = sanitizeName(table.schema, 'schema_name');
    const tableName = sanitizeName(table.table, 'table_name');
    const key = `${schema}.${tableName}`.toLowerCase();
    if (existing.has(key)) {
      continue;
    }
    statements.push(`
INSERT INTO source_tables (id, source_id, schema_name, table_name, created_at)
VALUES (
  ${sqlString(randomUUID())},
  ${sqlString(sourceId)},
  ${sqlString(schema)},
  ${sqlString(tableName)},
  ${sqlString(now)}
);`);
  }

  if (statements.length > 0) {
    await dbExec(statements.join('\n'));
  }
}

async function loadCachedTableByLocalNameUnlocked(
  projectId: string,
  localTable: string
): Promise<CachedTableRow> {
  const rows = await dbQuery<CachedTableRow>(
    `
SELECT
  id,
  project_id,
  source_name,
  source_table,
  local_table,
  cached_at,
  row_count,
  expires_at,
  filter_sql
FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
  AND local_table = ${sqlString(localTable)}
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Cached table not found');
  }
  return row;
}

async function replaceCachedDuckDbTableData(params: {
  local_table: string;
  source_name: string;
  source_table: string;
  filter_sql?: string | null;
}): Promise<number> {
  const executedAt = nowIso();
  const tableIdentifier = quoteIdentifier(params.local_table);
  const filterText = params.filter_sql?.trim() || '';

  await dbExec(
    `
DROP TABLE IF EXISTS ${tableIdentifier};

CREATE TABLE ${tableIdentifier} AS
SELECT
  i AS id,
  ${sqlString(params.source_name)} AS source_name,
  ${sqlString(params.source_table)} AS source_table,
  ${sqlString(filterText)} AS filter_sql,
  ${sqlString(executedAt)} AS cached_at,
  CONCAT(${sqlString(params.source_table + '_row_')}, CAST(i AS VARCHAR)) AS value
FROM range(1, 51) AS t(i);
`
  );

  const rowCountRows = await dbQuery<{ count: number }>(
    `SELECT COUNT(*)::INTEGER AS count FROM ${tableIdentifier};`
  );
  return rowCountRows[0]?.count ?? 0;
}

async function listSourceTablesUnlocked(
  projectId: string,
  sourceNameInput: string
): Promise<SourceTableRecord[]> {
  const sourceName = normalizeId(sourceNameInput, 'Source name');
  const source = await loadSourceByNameUnlocked(sourceName, projectId);

  const tableRows = await dbQuery<SourceTableRow>(
    `
SELECT id, source_id, schema_name, table_name
FROM source_tables
WHERE source_id = ${sqlString(source.id)}
ORDER BY schema_name ASC, table_name ASC, id ASC;
`
  );

  const cachedRows = await dbQuery<{ source_table: string; local_table: string }>(
    `
SELECT source_table, local_table
FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
  AND source_name = ${sqlString(source.name)};
`
  );

  const cachedBySourceTable = new Map<string, string>();
  for (const row of cachedRows) {
    cachedBySourceTable.set(row.source_table.toLowerCase(), row.local_table);
  }

  return tableRows.map((tableRow) => {
    const sourceTable = `${tableRow.schema_name}.${tableRow.table_name}`;
    const localTable =
      cachedBySourceTable.get(sourceTable.toLowerCase()) ??
      cachedBySourceTable.get(tableRow.table_name.toLowerCase()) ??
      null;

    return {
      source_name: source.name,
      schema_name: tableRow.schema_name,
      table_name: tableRow.table_name,
      mode: localTable ? 'cached' : 'live',
      local_table: localTable,
    };
  });
}

function toCachedSourceTableName(sourceTables: SourceTableRecord[], tableNameInput: string): string {
  const normalized = tableNameInput.trim();
  if (!normalized) {
    throw new StoreHttpError(400, 'table_name is required');
  }

  const exact = sourceTables.find((table) => `${table.schema_name}.${table.table_name}` === normalized);
  if (exact) {
    return `${exact.schema_name}.${exact.table_name}`;
  }

  const byTableName = sourceTables.find((table) => table.table_name === normalized);
  if (byTableName) {
    return `${byTableName.schema_name}.${byTableName.table_name}`;
  }

  if (normalized.includes('.')) {
    return normalized;
  }
  return `public.${normalized}`;
}

function buildSuggestion(estimatedRows: number): string {
  if (estimatedRows > 250000) {
    return 'Large table detected. Use filter_sql to reduce snapshot size.';
  }
  if (estimatedRows > 50000) {
    return 'Medium table. Snapshot is recommended for stable dashboard performance.';
  }
  return 'Small table. Live query is acceptable, snapshot remains optional.';
}

async function collectFolderFiles(params: {
  folderPath: string;
  allowedTypes: FolderAllowedTypes;
  pattern: string | null;
  limit: number;
}): Promise<FolderFileRecord[]> {
  const files: FolderFileRecord[] = [];
  const directories: string[] = [params.folderPath];
  const compiledPattern = params.pattern ? new RegExp(params.pattern) : null;

  while (directories.length > 0 && files.length < params.limit) {
    const current = directories.pop();
    if (!current) {
      break;
    }

    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= params.limit) {
        break;
      }

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        directories.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const fileType = resolveFolderFileType(fullPath);
      if (!fileType) {
        continue;
      }
      if (!folderTypeAllowed(fileType, params.allowedTypes)) {
        continue;
      }
      if (compiledPattern && !compiledPattern.test(fullPath)) {
        continue;
      }

      let metadata: Awaited<ReturnType<typeof stat>>;
      try {
        metadata = await stat(fullPath);
      } catch (_error) {
        continue;
      }

      files.push({
        path: fullPath,
        name: entry.name,
        file_type: fileType,
        size_bytes: metadata.size,
        modified_at: metadata.mtime.toISOString(),
      });
    }
  }

  files.sort((a, b) => {
    if (a.modified_at !== b.modified_at) {
      return a.modified_at < b.modified_at ? 1 : -1;
    }
    return a.path.localeCompare(b.path);
  });

  return files;
}

async function loadFolderSourceUnlocked(folderId: string, projectId: string): Promise<FolderSourceRow> {
  const rows = await dbQuery<FolderSourceRow>(
    `
SELECT id, project_id, name, path, allowed_types, pattern, created_at, updated_at
FROM source_folders
WHERE id = ${sqlString(folderId)}
  AND project_id = ${sqlString(projectId)}
LIMIT 1;
`
  );

  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Folder source not found');
  }
  return row;
}

export async function listSources(scopeProjectId: string | null): Promise<SourceRecord[]> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);

    const rows = await dbQuery<SourceConnectionWithCountRow>(
      `
SELECT
  s.id,
  s.project_id,
  s.name,
  s.source_type,
  s.status,
  s.attached_at,
  s.error_message,
  s.description,
  s.connection_config_json,
  COALESCE(COUNT(st.id), 0)::INTEGER AS table_count
FROM source_connections s
LEFT JOIN source_tables st ON st.source_id = s.id
WHERE s.project_id = ${sqlString(projectId)}
GROUP BY
  s.id,
  s.project_id,
  s.name,
  s.source_type,
  s.status,
  s.attached_at,
  s.error_message,
  s.description,
  s.connection_config_json
ORDER BY s.attached_at DESC, s.id DESC;
`
    );

    return rows.map(toSourceRecord);
  });
}

export async function getSourceDetail(
  sourceNameInput: string,
  scopeProjectId: string | null
): Promise<SourceDetailRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const sourceName = normalizeId(sourceNameInput, 'Source name');

    const source = await loadSourceByNameUnlocked(sourceName, projectId);
    const cachedTables = await listCachedTablesBySourceNameUnlocked(projectId, source.name);

    return {
      ...toSourceRecord(source),
      cached_tables: cachedTables,
    };
  });
}

export async function createSourceConnection(
  payload: {
    name: string;
    source_type: string;
    source_config: JsonMap;
    description?: string | null;
  },
  scopeProjectId: string | null
): Promise<SourceRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    assertJsonObject(payload.source_config, 'source_config');

    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const name = sanitizeName(payload.name, 'name');
    const sourceType = normalizeSourceType(payload.source_type);
    const description = payload.description?.trim() || null;

    const existing = await dbQuery<{ id: string }>(
      `
SELECT id
FROM source_connections
WHERE project_id = ${sqlString(projectId)}
  AND name = ${sqlString(name)}
LIMIT 1;
`
    );
    if (existing[0]) {
      throw new StoreHttpError(409, 'Source with the same name already exists');
    }

    const sourceId = randomUUID();
    const now = nowIso();

    await dbExec(
      `
INSERT INTO source_connections (
  id,
  project_id,
  name,
  source_type,
  status,
  attached_at,
  error_message,
  description,
  connection_config_json,
  created_at,
  updated_at
) VALUES (
  ${sqlString(sourceId)},
  ${sqlString(projectId)},
  ${sqlString(name)},
  ${sqlString(sourceType)},
  'attached',
  ${sqlString(now)},
  NULL,
  ${sqlString(description)},
  ${sqlString(JSON.stringify(payload.source_config))},
  ${sqlString(now)},
  ${sqlString(now)}
);
`
    );

    await seedSourceTablesUnlocked(sourceId, sourceType, payload.source_config);
    return toSourceRecord(await loadSourceByNameUnlocked(name, projectId));
  });
}

export async function updateSourceConnection(
  sourceNameInput: string,
  patch: {
    description?: string | null;
  },
  scopeProjectId: string | null
): Promise<SourceRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const sourceName = normalizeId(sourceNameInput, 'Source name');
    const source = await loadSourceByNameUnlocked(sourceName, projectId);

    const updates: string[] = [];
    if (patch.description !== undefined) {
      updates.push(`description = ${sqlString(patch.description?.trim() || null)}`);
    }

    if (updates.length === 0) {
      return toSourceRecord(source);
    }

    updates.push(`updated_at = ${sqlString(nowIso())}`);
    await dbExec(
      `
UPDATE source_connections
SET ${updates.join(', ')}
WHERE id = ${sqlString(source.id)};
`
    );

    return toSourceRecord(await loadSourceByNameUnlocked(sourceName, projectId));
  });
}

export async function deleteSourceConnection(
  sourceNameInput: string,
  scopeProjectId: string | null
): Promise<void> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const sourceName = normalizeId(sourceNameInput, 'Source name');
    const source = await loadSourceByNameUnlocked(sourceName, projectId);

    const cachedTables = await listCachedTablesBySourceNameUnlocked(projectId, source.name);
    for (const cached of cachedTables) {
      await dbExec(`DROP TABLE IF EXISTS ${quoteIdentifier(cached.local_table)};`);
    }

    await dbExec(
      `
DELETE FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
  AND source_name = ${sqlString(source.name)};

DELETE FROM source_tables
WHERE source_id = ${sqlString(source.id)};

DELETE FROM source_connections
WHERE id = ${sqlString(source.id)};
`
    );
  });
}

export async function listSourceTables(
  sourceNameInput: string,
  scopeProjectId: string | null
): Promise<SourceTableRecord[]> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    return listSourceTablesUnlocked(projectId, sourceNameInput);
  });
}

export async function estimateSourceTableSize(
  sourceNameInput: string,
  tableNameInput: string,
  scopeProjectId: string | null
): Promise<SizeEstimateRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const sourceTables = await listSourceTablesUnlocked(projectId, sourceNameInput);
    const sourceTable = toCachedSourceTableName(sourceTables, tableNameInput);

    const lowerTable = sourceTable.toLowerCase();
    const estimatedRows =
      lowerTable.includes('event') || lowerTable.includes('log')
        ? 500000
        : lowerTable.includes('order')
          ? 120000
          : 50000;

    return {
      source_name: normalizeId(sourceNameInput, 'Source name'),
      table_name: normalizeId(tableNameInput, 'Table name'),
      estimated_rows: estimatedRows,
      recommend_cache: estimatedRows <= 200000,
      recommend_filter: estimatedRows > 200000,
      suggestion: buildSuggestion(estimatedRows),
      error: null,
    };
  });
}

export async function cacheSourceTable(
  payload: {
    source_name: string;
    table_name: string;
    local_name?: string;
    filter_sql?: string;
    expires_hours?: number;
  },
  scopeProjectId: string | null
): Promise<CachedTableRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);

    const sourceName = normalizeId(payload.source_name, 'source_name');
    const source = await loadSourceByNameUnlocked(sourceName, projectId);
    const sourceTables = await listSourceTablesUnlocked(projectId, sourceName);
    const sourceTable = toCachedSourceTableName(sourceTables, payload.table_name);

    const fallbackLocalName = `${source.name}_${payload.table_name}_cache`;
    const localTable = sanitizeTableIdentifier(payload.local_name ?? '', fallbackLocalName);
    const now = nowIso();

    const existingByLocal = await dbQuery<{ id: string; source_name: string; source_table: string }>(
      `
SELECT id, source_name, source_table
FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
  AND local_table = ${sqlString(localTable)}
LIMIT 1;
`
    );

    if (
      existingByLocal[0] &&
      (existingByLocal[0].source_name !== source.name || existingByLocal[0].source_table !== sourceTable)
    ) {
      throw new StoreHttpError(409, 'local_name already exists for another source table');
    }

    const expiresHours =
      payload.expires_hours === undefined || payload.expires_hours === null
        ? null
        : Math.max(1, toInteger(payload.expires_hours, 0));
    const expiresAt =
      expiresHours === null
        ? null
        : new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString();

    const rowCount = await replaceCachedDuckDbTableData({
      local_table: localTable,
      source_name: source.name,
      source_table: sourceTable,
      filter_sql: payload.filter_sql ?? null,
    });

    const existingByPair = await dbQuery<{ id: string }>(
      `
SELECT id
FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
  AND source_name = ${sqlString(source.name)}
  AND source_table = ${sqlString(sourceTable)}
LIMIT 1;
`
    );

    const targetId = existingByLocal[0]?.id ?? existingByPair[0]?.id ?? randomUUID();

    if (existingByLocal[0] || existingByPair[0]) {
      await dbExec(
        `
UPDATE source_cached_tables
SET
  local_table = ${sqlString(localTable)},
  cached_at = ${sqlString(now)},
  row_count = ${rowCount},
  expires_at = ${sqlString(expiresAt)},
  filter_sql = ${sqlString(payload.filter_sql?.trim() || null)},
  updated_at = ${sqlString(now)}
WHERE id = ${sqlString(targetId)};
`
      );
    } else {
      await dbExec(
        `
INSERT INTO source_cached_tables (
  id,
  project_id,
  source_name,
  source_table,
  local_table,
  cached_at,
  row_count,
  expires_at,
  filter_sql,
  created_at,
  updated_at
) VALUES (
  ${sqlString(targetId)},
  ${sqlString(projectId)},
  ${sqlString(source.name)},
  ${sqlString(sourceTable)},
  ${sqlString(localTable)},
  ${sqlString(now)},
  ${rowCount},
  ${sqlString(expiresAt)},
  ${sqlString(payload.filter_sql?.trim() || null)},
  ${sqlString(now)},
  ${sqlString(now)}
);
`
      );
    }

    return toCachedTableRecord(await loadCachedTableByLocalNameUnlocked(projectId, localTable));
  });
}

export async function listCachedTables(
  scopeProjectId: string | null,
  sourceNameFilter?: string | null
): Promise<CachedTableRecord[]> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);

    const filter = sourceNameFilter?.trim() || null;
    const rows = await dbQuery<CachedTableRow>(
      `
SELECT
  id,
  project_id,
  source_name,
  source_table,
  local_table,
  cached_at,
  row_count,
  expires_at,
  filter_sql
FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
${filter ? `  AND source_name = ${sqlString(filter)}` : ''}
ORDER BY cached_at DESC, id DESC;
`
    );
    return rows.map(toCachedTableRecord);
  });
}

export async function getCachedTable(
  localTableInput: string,
  scopeProjectId: string | null
): Promise<CachedTableRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const localTable = normalizeId(localTableInput, 'local_table');
    return toCachedTableRecord(await loadCachedTableByLocalNameUnlocked(projectId, localTable));
  });
}

export async function refreshCachedTable(
  localTableInput: string,
  scopeProjectId: string | null
): Promise<CachedTableRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const localTable = normalizeId(localTableInput, 'local_table');
    const cached = await loadCachedTableByLocalNameUnlocked(projectId, localTable);

    const rowCount = await replaceCachedDuckDbTableData({
      local_table: cached.local_table,
      source_name: cached.source_name,
      source_table: cached.source_table,
      filter_sql: cached.filter_sql,
    });

    const refreshedAt = nowIso();
    await dbExec(
      `
UPDATE source_cached_tables
SET
  cached_at = ${sqlString(refreshedAt)},
  row_count = ${rowCount},
  updated_at = ${sqlString(refreshedAt)}
WHERE id = ${sqlString(cached.id)};
`
    );

    return toCachedTableRecord(await loadCachedTableByLocalNameUnlocked(projectId, localTable));
  });
}

export async function dropCachedTable(localTableInput: string, scopeProjectId: string | null): Promise<void> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const localTable = normalizeId(localTableInput, 'local_table');
    const cached = await loadCachedTableByLocalNameUnlocked(projectId, localTable);

    await dbExec(
      `
DELETE FROM source_cached_tables
WHERE id = ${sqlString(cached.id)};

DROP TABLE IF EXISTS ${quoteIdentifier(cached.local_table)};
`
    );
  });
}

export async function cleanupExpiredCachedTables(
  scopeProjectId: string | null
): Promise<{ cleaned_count: number }> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const now = nowIso();

    const expiredRows = await dbQuery<{ id: string; local_table: string }>(
      `
SELECT id, local_table
FROM source_cached_tables
WHERE project_id = ${sqlString(projectId)}
  AND expires_at IS NOT NULL
  AND expires_at < ${sqlString(now)};
`
    );

    if (expiredRows.length === 0) {
      return { cleaned_count: 0 };
    }

    const statements: string[] = [];
    for (const row of expiredRows) {
      statements.push(`DELETE FROM source_cached_tables WHERE id = ${sqlString(row.id)};`);
      statements.push(`DROP TABLE IF EXISTS ${quoteIdentifier(row.local_table)};`);
    }

    await dbExec(statements.join('\n'));
    return { cleaned_count: expiredRows.length };
  });
}

export async function previewCachedTable(
  localTableInput: string,
  scopeProjectId: string | null,
  limitInput: number
): Promise<CachedTablePreviewRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const localTable = normalizeId(localTableInput, 'local_table');
    const cached = await loadCachedTableByLocalNameUnlocked(projectId, localTable);
    const limit = Math.min(2000, Math.max(1, toInteger(limitInput, 100)));

    const tableIdentifier = quoteIdentifier(cached.local_table);
    const rows = await dbQuery<Record<string, unknown>>(
      `SELECT * FROM ${tableIdentifier} LIMIT ${limit};`
    );
    const totalRows = await dbQuery<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count FROM ${tableIdentifier};`
    );

    const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
    const matrix = rows.map((row) => columns.map((column) => row[column]));

    return {
      columns,
      rows: matrix,
      total_rows: totalRows[0]?.count ?? null,
    };
  });
}

export async function listFolderSources(scopeProjectId: string | null): Promise<FolderSourceRecord[]> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);

    const rows = await dbQuery<FolderSourceRow>(
      `
SELECT id, project_id, name, path, allowed_types, pattern, created_at, updated_at
FROM source_folders
WHERE project_id = ${sqlString(projectId)}
ORDER BY created_at DESC, id DESC;
`
    );

    return rows.map(toFolderSourceRecord);
  });
}

export async function createFolderSourceRecord(
  payload: {
    name: string;
    path: string;
    allowed_types?: string;
    pattern?: string | null;
  },
  scopeProjectId: string | null
): Promise<FolderSourceRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);

    const name = sanitizeName(payload.name, 'name');
    const folderPath = sanitizeName(payload.path, 'path');
    const allowedTypes = normalizeFolderAllowedTypes(payload.allowed_types);
    const pattern = normalizeOptionalPattern(payload.pattern);

    let folderStats;
    try {
      folderStats = await stat(folderPath);
    } catch (_error) {
      throw new StoreHttpError(400, 'Folder path does not exist');
    }
    if (!folderStats.isDirectory()) {
      throw new StoreHttpError(400, 'path must be a directory');
    }

    const existing = await dbQuery<{ id: string }>(
      `
SELECT id
FROM source_folders
WHERE project_id = ${sqlString(projectId)}
  AND (name = ${sqlString(name)} OR path = ${sqlString(folderPath)})
LIMIT 1;
`
    );
    if (existing[0]) {
      throw new StoreHttpError(409, 'Folder source with the same name or path already exists');
    }

    const folderId = randomUUID();
    const createdAt = nowIso();

    await dbExec(
      `
INSERT INTO source_folders (
  id,
  project_id,
  name,
  path,
  allowed_types,
  pattern,
  created_at,
  updated_at
) VALUES (
  ${sqlString(folderId)},
  ${sqlString(projectId)},
  ${sqlString(name)},
  ${sqlString(folderPath)},
  ${sqlString(allowedTypes)},
  ${sqlString(pattern)},
  ${sqlString(createdAt)},
  NULL
);
`
    );

    return toFolderSourceRecord(await loadFolderSourceUnlocked(folderId, projectId));
  });
}

export async function deleteFolderSourceRecord(
  folderIdInput: string,
  scopeProjectId: string | null
): Promise<void> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const folderId = normalizeId(folderIdInput, 'folder_id');
    await loadFolderSourceUnlocked(folderId, projectId);

    await dbExec(
      `
DELETE FROM source_folder_file_snapshot WHERE folder_id = ${sqlString(folderId)};
DELETE FROM source_folders WHERE id = ${sqlString(folderId)};
`
    );
  });
}

export async function listFolderFilesForSource(
  folderIdInput: string,
  scopeProjectId: string | null,
  limitInput: number
): Promise<FolderFileRecord[]> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const folderId = normalizeId(folderIdInput, 'folder_id');
    const folder = await loadFolderSourceUnlocked(folderId, projectId);
    const limit = Math.min(5000, Math.max(1, toInteger(limitInput, 500)));

    return collectFolderFiles({
      folderPath: folder.path,
      allowedTypes: normalizeFolderAllowedTypes(folder.allowed_types),
      pattern: folder.pattern,
      limit,
    });
  });
}

export async function scanFolderSourceFiles(
  folderIdInput: string,
  scopeProjectId: string | null
): Promise<FolderScanResultRecord> {
  return withSourceLock(async () => {
    await ensureSourceSchema();
    const projectId = await resolveProjectIdUnlocked(scopeProjectId);
    const folderId = normalizeId(folderIdInput, 'folder_id');
    const folder = await loadFolderSourceUnlocked(folderId, projectId);

    const files = await collectFolderFiles({
      folderPath: folder.path,
      allowedTypes: normalizeFolderAllowedTypes(folder.allowed_types),
      pattern: folder.pattern,
      limit: 50000,
    });

    const existingRows = await dbQuery<FolderFileSnapshotRow>(
      `
SELECT file_path, size_bytes, modified_at
FROM source_folder_file_snapshot
WHERE folder_id = ${sqlString(folderId)};
`
    );

    const existing = new Map<string, FolderFileSnapshotRow>();
    for (const row of existingRows) {
      existing.set(row.file_path, row);
    }

    const currentPathSet = new Set<string>();
    let newFiles = 0;
    let changedFiles = 0;

    for (const file of files) {
      currentPathSet.add(file.path);
      const previous = existing.get(file.path);
      if (!previous) {
        newFiles += 1;
        continue;
      }
      if (previous.size_bytes !== file.size_bytes || previous.modified_at !== file.modified_at) {
        changedFiles += 1;
      }
    }

    let deletedFiles = 0;
    for (const path of existing.keys()) {
      if (!currentPathSet.has(path)) {
        deletedFiles += 1;
      }
    }

    const scannedAt = nowIso();
    const statements: string[] = [
      `DELETE FROM source_folder_file_snapshot WHERE folder_id = ${sqlString(folderId)};`,
    ];

    for (const file of files) {
      statements.push(`
INSERT INTO source_folder_file_snapshot (
  folder_id,
  file_path,
  file_name,
  file_type,
  size_bytes,
  modified_at,
  scanned_at
) VALUES (
  ${sqlString(folderId)},
  ${sqlString(file.path)},
  ${sqlString(file.name)},
  ${sqlString(file.file_type)},
  ${file.size_bytes},
  ${sqlString(file.modified_at)},
  ${sqlString(scannedAt)}
);`);
    }

    statements.push(`
UPDATE source_folders
SET updated_at = ${sqlString(scannedAt)}
WHERE id = ${sqlString(folderId)};
`);

    await dbExec(statements.join('\n'));

    return {
      folder_id: folderId,
      scanned_at: scannedAt,
      new_files: newFiles,
      changed_files: changedFiles,
      deleted_files: deletedFiles,
    };
  });
}

export function resetSourceSchemaForTests(): void {
  runtimeState.schemaReady = false;
}
