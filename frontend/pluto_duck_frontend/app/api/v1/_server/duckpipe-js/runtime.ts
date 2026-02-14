import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { dbExec, dbQuery, sqlString } from '../db.ts';
import { StoreHttpError } from '../store.ts';
import type { DownloadStatus, FileType, IssueStatus, Materialization } from './contracts.ts';

const MATERIALIZATIONS: Set<Materialization> = new Set(['view', 'table', 'append', 'parquet']);
const FILE_TYPES: Set<FileType> = new Set(['csv', 'parquet']);
const ISSUE_STATUSES: Set<IssueStatus> = new Set(['open', 'confirmed', 'dismissed', 'resolved']);

export const MAX_ANALYSIS_SQL_CHARS = 200_000;
export const MAX_ANALYSIS_TAG_COUNT = 64;
export const MAX_ANALYSIS_PARAMETER_COUNT = 128;
export const MAX_PATH_LENGTH = 4096;
export const MAX_IMPORT_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_DIAGNOSE_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_DIAGNOSE_FILES = 20;
export const MAX_DUPLICATE_COUNT_FILES = 20;
export const MAX_MODEL_FIELD_LENGTH = 256;

export interface AssetsRuntimeState {
  schemaReady: boolean;
  loadedModelId: string | null;
  downloadTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const globalAssetsState = globalThis as typeof globalThis & {
  __plutoDuckAssetsState?: AssetsRuntimeState;
};

export const runtimeState: AssetsRuntimeState = globalAssetsState.__plutoDuckAssetsState ?? {
  schemaReady: false,
  loadedModelId: null,
  downloadTimers: new Map<string, ReturnType<typeof setTimeout>>(),
};

if (!globalAssetsState.__plutoDuckAssetsState) {
  globalAssetsState.__plutoDuckAssetsState = runtimeState;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

export function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StoreHttpError(400, `${fieldName} is required`);
  }
  return normalized;
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseJsonArray<T>(raw: string | null, fallback: T[]): T[] {
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch (_error) {
    return fallback;
  }
  return fallback;
}

export function parseJsonObject<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as T;
    }
  } catch (_error) {
    return fallback;
  }
  return fallback;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function normalizeTableName(value: string): string {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized.length === 0) {
    normalized = `table_${randomUUID().slice(0, 8)}`;
  }
  if (/^[0-9]/.test(normalized)) {
    normalized = `_${normalized}`;
  }
  return normalized;
}

export function assertMaxLength(value: string, maxLength: number, fieldName: string): void {
  if (value.length > maxLength) {
    throw new StoreHttpError(413, `${fieldName} exceeds ${maxLength} characters`);
  }
}

export function assertMaxArrayLength(length: number, maxLength: number, fieldName: string): void {
  if (length > maxLength) {
    throw new StoreHttpError(413, `${fieldName} exceeds maximum size (${maxLength})`);
  }
}

export function normalizeAnalysisId(value: string | null | undefined): string {
  if (!value) {
    return randomUUID();
  }
  return normalizeRequiredText(value, 'analysis_id');
}

export function normalizeMaterialization(value: string | null | undefined): Materialization {
  const normalized = (value ?? 'view').trim().toLowerCase() as Materialization;
  if (!MATERIALIZATIONS.has(normalized)) {
    throw new StoreHttpError(400, 'materialization must be view|table|append|parquet');
  }
  return normalized;
}

export function normalizeFileType(value: string): FileType {
  const normalized = value.trim().toLowerCase() as FileType;
  if (!FILE_TYPES.has(normalized)) {
    throw new StoreHttpError(400, 'file_type must be csv|parquet');
  }
  return normalized;
}

export function normalizeIssueStatus(value: string): IssueStatus {
  const normalized = value.trim().toLowerCase() as IssueStatus;
  if (!ISSUE_STATUSES.has(normalized)) {
    throw new StoreHttpError(400, 'status must be open|confirmed|dismissed|resolved');
  }
  return normalized;
}

export function normalizeLocalModelId(value: string | null | undefined, filename?: string): string {
  const fallback = filename ? filename.replace(/\.[^.]+$/, '') : randomUUID().slice(0, 8);
  const source = value?.trim() || fallback;
  const normalized = source.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new StoreHttpError(400, 'model_id is required');
  }
  return normalized;
}

export function fileSourceExpression(filePath: string, fileType: FileType): string {
  if (fileType === 'csv') {
    return `read_csv_auto(${sqlString(filePath)}, HEADER=TRUE)`;
  }
  return `read_parquet(${sqlString(filePath)})`;
}

export function assertAbsolutePath(filePath: string, fieldName: string): string {
  const normalized = filePath.trim();
  if (!normalized) {
    throw new StoreHttpError(400, `${fieldName} is required`);
  }
  assertMaxLength(normalized, MAX_PATH_LENGTH, fieldName);
  if (!isAbsolute(normalized)) {
    throw new StoreHttpError(400, `${fieldName} must be absolute`);
  }
  return normalized;
}

export function parseDependencyTokens(sqlText: string): string[] {
  const regex = /\b(?:from|join)\s+([a-zA-Z0-9_."`]+)/gi;
  const dependencies = new Set<string>();

  for (const match of sqlText.matchAll(regex)) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    const cleaned = raw
      .replaceAll('"', '')
      .replaceAll('`', '')
      .replace(/^\.+|\.+$/g, '')
      .trim();
    if (!cleaned || cleaned.includes('(')) {
      continue;
    }
    dependencies.add(cleaned);
  }

  return Array.from(dependencies);
}

export async function ensureAssetsSchema(): Promise<void> {
  if (runtimeState.schemaReady) {
    return;
  }

  await dbExec(
    `
CREATE TABLE IF NOT EXISTS asset_analyses (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  sql_text VARCHAR NOT NULL,
  description VARCHAR,
  materialization VARCHAR NOT NULL,
  parameters_json VARCHAR,
  tags_json VARCHAR,
  result_table VARCHAR NOT NULL,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_analysis_runs (
  run_id VARCHAR PRIMARY KEY,
  analysis_id VARCHAR NOT NULL,
  project_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  started_at VARCHAR NOT NULL,
  finished_at VARCHAR,
  duration_ms INTEGER,
  rows_affected INTEGER,
  error_message VARCHAR
);

CREATE TABLE IF NOT EXISTS asset_files (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  file_type VARCHAR NOT NULL,
  table_name VARCHAR NOT NULL,
  description VARCHAR,
  row_count INTEGER,
  column_count INTEGER,
  file_size_bytes BIGINT,
  diagnosis_id VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL,
  UNIQUE(project_id, table_name)
);

CREATE TABLE IF NOT EXISTS asset_file_sources (
  id VARCHAR PRIMARY KEY,
  file_asset_id VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  original_name VARCHAR,
  row_count INTEGER,
  file_size_bytes BIGINT,
  added_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_file_diagnoses (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  file_type VARCHAR NOT NULL,
  language VARCHAR NOT NULL,
  diagnosis_json VARCHAR NOT NULL,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL,
  UNIQUE(project_id, file_path, language)
);

CREATE TABLE IF NOT EXISTS asset_file_issues (
  id VARCHAR PRIMARY KEY,
  diagnosis_id VARCHAR NOT NULL,
  file_asset_id VARCHAR NOT NULL,
  issue VARCHAR NOT NULL,
  issue_type VARCHAR NOT NULL,
  suggestion VARCHAR,
  example VARCHAR,
  status VARCHAR NOT NULL,
  user_response VARCHAR,
  confirmed_at VARCHAR,
  resolved_at VARCHAR,
  resolved_by VARCHAR,
  deleted_at VARCHAR,
  deleted_by VARCHAR,
  delete_reason VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_file_events (
  id VARCHAR PRIMARY KEY,
  file_asset_id VARCHAR NOT NULL,
  event_type VARCHAR NOT NULL,
  message VARCHAR,
  actor VARCHAR,
  created_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS local_models (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  path VARCHAR NOT NULL,
  size_bytes BIGINT,
  quantization VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS local_model_download_states (
  model_id VARCHAR PRIMARY KEY,
  status VARCHAR NOT NULL,
  detail VARCHAR,
  updated_at VARCHAR NOT NULL
);
`
  );

  runtimeState.schemaReady = true;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const rows = await dbQuery<{ id: string }>(`SELECT id FROM projects WHERE id = ${sqlString(projectId)} LIMIT 1;`);
  if (!rows[0]) {
    throw new StoreHttpError(404, 'Project not found');
  }
}

export async function resolveProjectId(projectId: string | null): Promise<string> {
  await ensureAssetsSchema();

  if (projectId) {
    const normalized = normalizeRequiredText(projectId, 'project_id');
    await assertProjectExists(normalized);
    return normalized;
  }

  const rows = await dbQuery<{ default_project_id: string | null }>(
    'SELECT default_project_id FROM settings WHERE id = 1 LIMIT 1;'
  );
  const defaultProjectId = rows[0]?.default_project_id ?? null;
  if (!defaultProjectId) {
    throw new StoreHttpError(400, 'project_id is required');
  }
  await assertProjectExists(defaultProjectId);
  return defaultProjectId;
}

export function resetDuckpipeRuntimeForTests(): void {
  runtimeState.schemaReady = false;
  runtimeState.loadedModelId = null;
  for (const timer of runtimeState.downloadTimers.values()) {
    clearTimeout(timer);
  }
  runtimeState.downloadTimers.clear();
}

export function normalizeDownloadStatus(value: string): DownloadStatus | 'error' {
  return ['queued', 'downloading', 'completed', 'error'].includes(value)
    ? (value as DownloadStatus)
    : 'error';
}
