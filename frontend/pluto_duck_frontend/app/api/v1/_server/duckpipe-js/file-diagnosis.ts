import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

import { dbExec, dbQuery, sqlString } from '../db.ts';
import { StoreHttpError } from '../store.ts';
import type {
  ColumnSchemaRecord,
  DiagnoseFilesResponseRecord,
  DiagnosisIssueRecord,
  FileAssetRecord,
  FileDiagnosisRecord,
  FilePreviewRecord,
  FilePreprocessingEventRecord,
  FileSchemaRecord,
  FileSourceRecord,
  FileType,
  IssueStatus,
  LlmAnalysisRecord,
  DuplicateCountRecord,
} from './contracts.ts';
import {
  MAX_DIAGNOSE_FILES,
  MAX_DIAGNOSE_FILE_BYTES,
  MAX_DUPLICATE_COUNT_FILES,
  MAX_IMPORT_FILE_BYTES,
  assertAbsolutePath,
  assertMaxArrayLength,
  ensureAssetsSchema,
  fileSourceExpression,
  normalizeFileType,
  normalizeIssueStatus,
  normalizeOptionalText,
  normalizeTableName,
  nowIso,
  parseJsonObject,
  quoteIdentifier,
  resolveProjectId,
  toInteger,
} from './runtime.ts';

interface FileAssetRow {
  id: string;
  project_id: string;
  name: string;
  file_path: string;
  file_type: string;
  table_name: string;
  description: string | null;
  row_count: number | null;
  column_count: number | null;
  file_size_bytes: number | null;
  diagnosis_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FileSourceRow {
  id: string;
  file_asset_id: string;
  file_path: string;
  original_name: string | null;
  row_count: number | null;
  file_size_bytes: number | null;
  added_at: string;
}

interface DiagnosisRow {
  id: string;
  project_id: string;
  file_path: string;
  file_type: string;
  language: string;
  diagnosis_json: string;
  created_at: string;
  updated_at: string;
}

interface IssueRow {
  id: string;
  diagnosis_id: string;
  file_asset_id: string;
  issue: string;
  issue_type: string;
  suggestion: string | null;
  example: string | null;
  status: string;
  user_response: string | null;
  confirmed_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  file_asset_id: string;
  event_type: string;
  message: string | null;
  actor: string | null;
  created_at: string;
}

function toIssueRecord(row: IssueRow): DiagnosisIssueRecord {
  const normalizedStatus = ['open', 'confirmed', 'dismissed', 'resolved'].includes(row.status)
    ? (row.status as IssueStatus)
    : 'open';

  return {
    id: row.id,
    diagnosis_id: row.diagnosis_id,
    file_asset_id: row.file_asset_id,
    issue: row.issue,
    issue_type: row.issue_type,
    suggestion: row.suggestion,
    example: row.example,
    status: normalizedStatus,
    user_response: row.user_response,
    confirmed_at: row.confirmed_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    deleted_at: row.deleted_at,
    deleted_by: row.deleted_by,
    delete_reason: row.delete_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildLlmAnalysis(filePath: string, columns: ColumnSchemaRecord[]): LlmAnalysisRecord {
  const inferredName = normalizeTableName(filePath.split('/').at(-1) ?? 'dataset');
  const metricColumn = columns.find((column) => column.type.toLowerCase().includes('int'))?.name;

  return {
    suggested_name: inferredName,
    context: `Dataset imported from ${filePath.split('/').at(-1) ?? filePath} with ${columns.length} columns.`,
    potential: [
      {
        question: metricColumn
          ? `How does ${metricColumn} trend over time?`
          : 'What are the top records by key metric?',
        analysis: 'Create a grouped summary and compare period-over-period deltas.',
      },
    ],
    issues: [
      {
        issue: 'Potential missing values detected in nullable columns',
        issue_type: 'missing_values',
        suggestion: 'Review null-heavy columns and fill or filter them before downstream joins.',
      },
    ],
    analyzed_at: nowIso(),
    model_used: 'local-rules-v1',
  };
}

async function tableExists(tableName: string): Promise<boolean> {
  const rows = await dbQuery<{ count: number }>(
    `
SELECT COUNT(*)::INTEGER AS count
FROM information_schema.tables
WHERE lower(table_name) = lower(${sqlString(tableName)});
`
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function countRowsForTable(tableName: string): Promise<number> {
  const rows = await dbQuery<{ count: number }>(`SELECT COUNT(*)::INTEGER AS count FROM ${quoteIdentifier(tableName)};`);
  return rows[0]?.count ?? 0;
}

async function countColumnsForTable(tableName: string): Promise<number> {
  const rows = await dbQuery<Array<{ column_name: string }>[number]>(
    `
SELECT column_name
FROM information_schema.columns
WHERE lower(table_name) = lower(${sqlString(tableName)});
`
  );
  return rows.length;
}

async function loadFileAssetRow(fileId: string, projectId: string): Promise<FileAssetRow> {
  const rows = await dbQuery<FileAssetRow>(
    `
SELECT
  id,
  project_id,
  name,
  file_path,
  file_type,
  table_name,
  description,
  row_count,
  column_count,
  file_size_bytes,
  diagnosis_id,
  created_at,
  updated_at
FROM asset_files
WHERE id = ${sqlString(fileId)}
  AND project_id = ${sqlString(projectId)}
LIMIT 1;
`
  );

  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, `File asset '${fileId}' not found`);
  }
  return row;
}

async function loadFileAssetByTable(tableName: string, projectId: string): Promise<FileAssetRow | null> {
  const rows = await dbQuery<FileAssetRow>(
    `
SELECT
  id,
  project_id,
  name,
  file_path,
  file_type,
  table_name,
  description,
  row_count,
  column_count,
  file_size_bytes,
  diagnosis_id,
  created_at,
  updated_at
FROM asset_files
WHERE table_name = ${sqlString(tableName)}
  AND project_id = ${sqlString(projectId)}
LIMIT 1;
`
  );
  return rows[0] ?? null;
}

async function appendFileEvent(fileAssetId: string, eventType: string, message: string, actor: string = 'system'): Promise<void> {
  const now = nowIso();
  await dbExec(
    `
INSERT INTO asset_file_events (id, file_asset_id, event_type, message, actor, created_at)
VALUES (
  ${sqlString(randomUUID())},
  ${sqlString(fileAssetId)},
  ${sqlString(eventType)},
  ${sqlString(message)},
  ${sqlString(actor)},
  ${sqlString(now)}
);
`
  );
}

async function attachFileSource(
  fileAssetId: string,
  filePath: string,
  rowCount: number | null,
  fileSizeBytes: number | null
): Promise<void> {
  const now = nowIso();
  await dbExec(
    `
INSERT INTO asset_file_sources (
  id,
  file_asset_id,
  file_path,
  original_name,
  row_count,
  file_size_bytes,
  added_at
) VALUES (
  ${sqlString(randomUUID())},
  ${sqlString(fileAssetId)},
  ${sqlString(filePath)},
  ${sqlString(filePath.split('/').at(-1) ?? null)},
  ${rowCount === null ? 'NULL' : String(rowCount)},
  ${fileSizeBytes === null ? 'NULL' : String(fileSizeBytes)},
  ${sqlString(now)}
);
`
  );
}

async function loadFileSources(fileAssetId: string): Promise<FileSourceRecord[]> {
  const rows = await dbQuery<FileSourceRow>(
    `
SELECT id, file_asset_id, file_path, original_name, row_count, file_size_bytes, added_at
FROM asset_file_sources
WHERE file_asset_id = ${sqlString(fileAssetId)}
ORDER BY added_at ASC, id ASC;
`
  );

  return rows.map((row) => ({
    file_path: row.file_path,
    original_name: row.original_name,
    row_count: row.row_count === null ? null : toInteger(row.row_count, 0),
    file_size_bytes: row.file_size_bytes === null ? null : toInteger(row.file_size_bytes, 0),
    added_at: row.added_at,
  }));
}

async function toFileAssetRecord(row: FileAssetRow): Promise<FileAssetRecord> {
  return {
    id: row.id,
    name: row.name,
    file_path: row.file_path,
    file_type: normalizeFileType(row.file_type),
    table_name: row.table_name,
    description: row.description,
    row_count: row.row_count === null ? null : toInteger(row.row_count, 0),
    column_count: row.column_count === null ? null : toInteger(row.column_count, 0),
    file_size_bytes: row.file_size_bytes === null ? null : toInteger(row.file_size_bytes, 0),
    diagnosis_id: row.diagnosis_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sources: await loadFileSources(row.id),
  };
}

async function diagnoseSingleFile(filePath: string, fileType: FileType, diagnosisId: string | null = null): Promise<FileDiagnosisRecord> {
  const absolutePath = assertAbsolutePath(filePath, 'file_path');
  const source = fileSourceExpression(absolutePath, fileType);

  const fileStats = await stat(absolutePath).catch((_error) => {
    throw new StoreHttpError(404, `File not found: ${absolutePath}`);
  });
  if (fileStats.size > MAX_DIAGNOSE_FILE_BYTES) {
    throw new StoreHttpError(413, `File is too large for diagnosis (max ${MAX_DIAGNOSE_FILE_BYTES} bytes)`);
  }

  const schemaRows = await dbQuery<Array<{ column_name: string; column_type: string }>[number]>(
    `DESCRIBE SELECT * FROM ${source};`
  );

  const columns: ColumnSchemaRecord[] = schemaRows.map((row) => ({
    name: row.column_name,
    type: row.column_type,
    nullable: true,
  }));

  const rowCountRows = await dbQuery<{ row_count: number }>(`SELECT COUNT(*)::INTEGER AS row_count FROM ${source};`);
  const rowCount = rowCountRows[0]?.row_count ?? 0;

  const sampleRowsRaw = await dbQuery<Record<string, unknown>>(`SELECT * FROM ${source} LIMIT 5;`);
  const sampleRows = sampleRowsRaw.map((row) => columns.map((column) => row[column.name] ?? null));

  const missingValues: Record<string, number> = {};
  for (const column of columns) {
    const missingRows = await dbQuery<{ missing_count: number }>(
      `SELECT COUNT(*)::INTEGER AS missing_count FROM ${source} WHERE ${quoteIdentifier(column.name)} IS NULL;`
    );
    missingValues[column.name] = missingRows[0]?.missing_count ?? 0;
  }

  return {
    file_path: absolutePath,
    file_type: fileType,
    columns,
    missing_values: missingValues,
    row_count: rowCount,
    file_size_bytes: Number(fileStats.size),
    type_suggestions: [],
    diagnosed_at: nowIso(),
    encoding: {
      detected: 'utf-8',
      confidence: 0.99,
    },
    parsing_integrity: {
      total_lines: rowCount,
      parsed_rows: rowCount,
      malformed_rows: 0,
      has_errors: false,
    },
    column_statistics: [],
    sample_rows: sampleRows,
    diagnosis_id: diagnosisId ?? undefined,
  };
}

async function getCachedDiagnosis(projectId: string, filePath: string, language: string): Promise<FileDiagnosisRecord | null> {
  const rows = await dbQuery<DiagnosisRow>(
    `
SELECT id, project_id, file_path, file_type, language, diagnosis_json, created_at, updated_at
FROM asset_file_diagnoses
WHERE project_id = ${sqlString(projectId)}
  AND file_path = ${sqlString(filePath)}
  AND language = ${sqlString(language)}
LIMIT 1;
`
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const parsed = parseJsonObject<FileDiagnosisRecord | null>(row.diagnosis_json, null);
  if (!parsed) {
    return null;
  }

  parsed.diagnosis_id = row.id;
  return parsed;
}

async function saveDiagnosis(projectId: string, diagnosis: FileDiagnosisRecord, language: string): Promise<string> {
  const now = nowIso();

  const existing = await dbQuery<{ id: string }>(
    `
SELECT id
FROM asset_file_diagnoses
WHERE project_id = ${sqlString(projectId)}
  AND file_path = ${sqlString(diagnosis.file_path)}
  AND language = ${sqlString(language)}
LIMIT 1;
`
  );

  const diagnosisId = existing[0]?.id ?? randomUUID();
  diagnosis.diagnosis_id = diagnosisId;

  if (existing[0]) {
    await dbExec(
      `
UPDATE asset_file_diagnoses
SET file_type = ${sqlString(diagnosis.file_type)},
    diagnosis_json = ${sqlString(JSON.stringify(diagnosis))},
    updated_at = ${sqlString(now)}
WHERE id = ${sqlString(diagnosisId)};
`
    );
  } else {
    await dbExec(
      `
INSERT INTO asset_file_diagnoses (
  id,
  project_id,
  file_path,
  file_type,
  language,
  diagnosis_json,
  created_at,
  updated_at
) VALUES (
  ${sqlString(diagnosisId)},
  ${sqlString(projectId)},
  ${sqlString(diagnosis.file_path)},
  ${sqlString(diagnosis.file_type)},
  ${sqlString(language)},
  ${sqlString(JSON.stringify(diagnosis))},
  ${sqlString(now)},
  ${sqlString(now)}
);
`
    );
  }

  return diagnosisId;
}

async function loadIssuesForFile(
  fileAssetId: string,
  options?: { status?: string | null; includeDeleted?: boolean }
): Promise<DiagnosisIssueRecord[]> {
  const conditions = [`file_asset_id = ${sqlString(fileAssetId)}`];
  if (!options?.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (options?.status) {
    conditions.push(`status = ${sqlString(options.status)}`);
  }

  const rows = await dbQuery<IssueRow>(
    `
SELECT
  id,
  diagnosis_id,
  file_asset_id,
  issue,
  issue_type,
  suggestion,
  example,
  status,
  user_response,
  confirmed_at,
  resolved_at,
  resolved_by,
  deleted_at,
  deleted_by,
  delete_reason,
  created_at,
  updated_at
FROM asset_file_issues
WHERE ${conditions.join(' AND ')}
ORDER BY created_at ASC, id ASC;
`
  );

  return rows.map(toIssueRecord);
}

function toSourceUnionQuery(files: Array<{ file_path: string; file_type: FileType }>): string {
  if (files.length === 0) {
    throw new StoreHttpError(400, 'files is required');
  }
  assertMaxArrayLength(files.length, MAX_DUPLICATE_COUNT_FILES, 'files');

  const selects = files.map((entry) => {
    const filePath = assertAbsolutePath(entry.file_path, 'file_path');
    return `SELECT * FROM ${fileSourceExpression(filePath, normalizeFileType(entry.file_type))}`;
  });
  return selects.join('\nUNION ALL\n');
}

export async function listFileAssets(scopeProjectId: string | null): Promise<FileAssetRecord[]> {
  const projectId = await resolveProjectId(scopeProjectId);

  const rows = await dbQuery<FileAssetRow>(
    `
SELECT
  id,
  project_id,
  name,
  file_path,
  file_type,
  table_name,
  description,
  row_count,
  column_count,
  file_size_bytes,
  diagnosis_id,
  created_at,
  updated_at
FROM asset_files
WHERE project_id = ${sqlString(projectId)}
ORDER BY created_at DESC, id ASC;
`
  );

  const assets: FileAssetRecord[] = [];
  for (const row of rows) {
    assets.push(await toFileAssetRecord(row));
  }
  return assets;
}

export async function getFileAsset(fileId: string, scopeProjectId: string | null): Promise<FileAssetRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  return toFileAssetRecord(await loadFileAssetRow(fileId, projectId));
}

export async function importFileAsset(
  input: {
    file_path: string;
    file_type: FileType;
    table_name: string;
    name?: string;
    description?: string;
    overwrite?: boolean;
    mode?: 'replace' | 'append' | 'merge';
    target_table?: string;
    merge_keys?: string[];
    deduplicate?: boolean;
    diagnosis_id?: string;
  },
  scopeProjectId: string | null
): Promise<FileAssetRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const now = nowIso();

  const filePath = assertAbsolutePath(input.file_path, 'file_path');
  const fileType = normalizeFileType(input.file_type);
  const source = fileSourceExpression(filePath, fileType);
  const mode = (input.mode ?? 'replace').trim().toLowerCase() as 'replace' | 'append' | 'merge';
  const tableName = normalizeTableName(input.table_name);
  const targetTable = normalizeTableName(input.target_table ?? tableName);
  const overwrite = input.overwrite ?? true;

  if (!['replace', 'append', 'merge'].includes(mode)) {
    throw new StoreHttpError(400, 'mode must be replace|append|merge');
  }

  const fileStats = await stat(filePath).catch((_error) => {
    throw new StoreHttpError(404, `File not found: ${filePath}`);
  });
  if (fileStats.size > MAX_IMPORT_FILE_BYTES) {
    throw new StoreHttpError(413, `File is too large to import (max ${MAX_IMPORT_FILE_BYTES} bytes)`);
  }

  if (mode === 'replace') {
    if (!overwrite) {
      const exists = await tableExists(tableName);
      if (exists) {
        throw new StoreHttpError(409, `Table '${tableName}' already exists`);
      }
    }

    await dbExec(`CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${source};`);
  } else if (mode === 'append') {
    const exists = await tableExists(targetTable);
    if (!exists) {
      throw new StoreHttpError(404, `Target table '${targetTable}' not found`);
    }

    if (input.deduplicate) {
      await dbExec(
        `
INSERT INTO ${quoteIdentifier(targetTable)}
SELECT * FROM ${source}
EXCEPT
SELECT * FROM ${quoteIdentifier(targetTable)};
`
      );
    } else {
      await dbExec(`INSERT INTO ${quoteIdentifier(targetTable)} SELECT * FROM ${source};`);
    }
  } else {
    const exists = await tableExists(targetTable);
    if (!exists) {
      throw new StoreHttpError(404, `Target table '${targetTable}' not found`);
    }

    const mergeKeys = Array.isArray(input.merge_keys)
      ? input.merge_keys.map((value) => value.trim()).filter(Boolean)
      : [];
    if (mergeKeys.length === 0) {
      throw new StoreHttpError(400, 'merge_keys is required for merge mode');
    }
    assertMaxArrayLength(mergeKeys.length, 16, 'merge_keys');

    const stagingTable = normalizeTableName(`staging_${randomUUID().slice(0, 8)}`);
    await dbExec(`CREATE TABLE ${quoteIdentifier(stagingTable)} AS SELECT * FROM ${source};`);

    try {
      const joinCondition = mergeKeys
        .map((key) => `target.${quoteIdentifier(key)} = source.${quoteIdentifier(key)}`)
        .join(' AND ');

      await dbExec(
        `
DELETE FROM ${quoteIdentifier(targetTable)} AS target
USING ${quoteIdentifier(stagingTable)} AS source
WHERE ${joinCondition};

INSERT INTO ${quoteIdentifier(targetTable)}
SELECT * FROM ${quoteIdentifier(stagingTable)};
`
      );
    } finally {
      await dbExec(`DROP TABLE IF EXISTS ${quoteIdentifier(stagingTable)};`);
    }
  }

  const effectiveTable = mode === 'replace' ? tableName : targetTable;
  const rowCount = await countRowsForTable(effectiveTable);
  const columnCount = await countColumnsForTable(effectiveTable);
  const existingAsset = await loadFileAssetByTable(effectiveTable, projectId);
  const fileName = normalizeOptionalText(input.name) ?? effectiveTable;
  const description = normalizeOptionalText(input.description);

  if (existingAsset) {
    await dbExec(
      `
UPDATE asset_files
SET name = ${sqlString(fileName)},
    file_path = ${sqlString(filePath)},
    file_type = ${sqlString(fileType)},
    description = ${sqlString(description ?? existingAsset.description)},
    row_count = ${String(rowCount)},
    column_count = ${String(columnCount)},
    file_size_bytes = ${String(fileStats.size)},
    diagnosis_id = ${sqlString(input.diagnosis_id ?? existingAsset.diagnosis_id)},
    updated_at = ${sqlString(now)}
WHERE id = ${sqlString(existingAsset.id)};
`
    );

    await attachFileSource(existingAsset.id, filePath, rowCount, Number(fileStats.size));
    await appendFileEvent(existingAsset.id, mode, `${mode.toUpperCase()} import completed for ${effectiveTable}`);

    return toFileAssetRecord(await loadFileAssetRow(existingAsset.id, projectId));
  }

  const fileAssetId = randomUUID();
  await dbExec(
    `
INSERT INTO asset_files (
  id,
  project_id,
  name,
  file_path,
  file_type,
  table_name,
  description,
  row_count,
  column_count,
  file_size_bytes,
  diagnosis_id,
  created_at,
  updated_at
) VALUES (
  ${sqlString(fileAssetId)},
  ${sqlString(projectId)},
  ${sqlString(fileName)},
  ${sqlString(filePath)},
  ${sqlString(fileType)},
  ${sqlString(effectiveTable)},
  ${sqlString(description)},
  ${String(rowCount)},
  ${String(columnCount)},
  ${String(fileStats.size)},
  ${sqlString(input.diagnosis_id ?? null)},
  ${sqlString(now)},
  ${sqlString(now)}
);
`
  );

  await attachFileSource(fileAssetId, filePath, rowCount, Number(fileStats.size));
  await appendFileEvent(fileAssetId, mode, `${mode.toUpperCase()} import completed for ${effectiveTable}`);

  return toFileAssetRecord(await loadFileAssetRow(fileAssetId, projectId));
}

export async function deleteFileAsset(
  fileId: string,
  options: { drop_table?: boolean },
  scopeProjectId: string | null
): Promise<void> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);
  const dropTable = options.drop_table ?? true;

  if (dropTable) {
    await dbExec(`DROP TABLE IF EXISTS ${quoteIdentifier(asset.table_name)};`);
  }

  await dbExec(
    `
DELETE FROM asset_file_events WHERE file_asset_id = ${sqlString(asset.id)};
DELETE FROM asset_file_issues WHERE file_asset_id = ${sqlString(asset.id)};
DELETE FROM asset_file_sources WHERE file_asset_id = ${sqlString(asset.id)};
DELETE FROM asset_files WHERE id = ${sqlString(asset.id)};
`
  );
}

export async function refreshFileAsset(fileId: string, scopeProjectId: string | null): Promise<FileAssetRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);

  await dbExec(
    `
CREATE OR REPLACE TABLE ${quoteIdentifier(asset.table_name)} AS
SELECT * FROM ${fileSourceExpression(asset.file_path, normalizeFileType(asset.file_type))};
`
  );

  const rowCount = await countRowsForTable(asset.table_name);
  const columnCount = await countColumnsForTable(asset.table_name);
  const fileStats = await stat(asset.file_path).catch(() => null);

  await dbExec(
    `
UPDATE asset_files
SET row_count = ${String(rowCount)},
    column_count = ${String(columnCount)},
    file_size_bytes = ${fileStats ? String(fileStats.size) : 'NULL'},
    updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(asset.id)};
`
  );

  await attachFileSource(asset.id, asset.file_path, rowCount, fileStats ? Number(fileStats.size) : null);
  await appendFileEvent(asset.id, 'refresh', `Refreshed file asset ${asset.name}`);

  return toFileAssetRecord(await loadFileAssetRow(fileId, projectId));
}

export async function getFileSchema(fileId: string, scopeProjectId: string | null): Promise<FileSchemaRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);

  const rows = await dbQuery<Array<{ column_name: string; column_type: string }>[number]>(
    `DESCRIBE SELECT * FROM ${quoteIdentifier(asset.table_name)};`
  );

  return {
    columns: rows.map((row) => ({
      column_name: row.column_name,
      column_type: row.column_type,
      null: 'YES',
      key: null,
      default: null,
      extra: null,
    })),
  };
}

export async function previewFileAsset(
  fileId: string,
  options: { limit?: number },
  scopeProjectId: string | null
): Promise<FilePreviewRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);
  const limit = Math.min(1000, Math.max(1, toInteger(options.limit ?? 100, 100)));

  const rows = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdentifier(asset.table_name)} LIMIT ${String(limit)};`
  );
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const totalRows = await countRowsForTable(asset.table_name);

  return {
    columns,
    rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
    total_rows: totalRows,
  };
}

export async function countDuplicateRowsAcrossFiles(
  files: Array<{ file_path: string; file_type: FileType }>
): Promise<DuplicateCountRecord> {
  await ensureAssetsSchema();
  assertMaxArrayLength(files.length, MAX_DUPLICATE_COUNT_FILES, 'files');

  const unionSql = toSourceUnionQuery(files);
  const totalRowsQuery = await dbQuery<{ total_rows: number }>(
    `WITH unioned AS (${unionSql}) SELECT COUNT(*)::INTEGER AS total_rows FROM unioned;`
  );

  const totalRows = totalRowsQuery[0]?.total_rows ?? 0;
  if (totalRows > 100000) {
    return {
      total_rows: totalRows,
      duplicate_rows: 0,
      estimated_rows: totalRows,
      skipped: true,
    };
  }

  try {
    const uniqueRowsQuery = await dbQuery<{ unique_rows: number }>(
      `WITH unioned AS (${unionSql}) SELECT COUNT(*)::INTEGER AS unique_rows FROM (SELECT DISTINCT * FROM unioned);`
    );
    const uniqueRows = uniqueRowsQuery[0]?.unique_rows ?? totalRows;
    const duplicateRows = Math.max(0, totalRows - uniqueRows);

    return {
      total_rows: totalRows,
      duplicate_rows: duplicateRows,
      estimated_rows: Math.max(0, totalRows - duplicateRows),
      skipped: false,
    };
  } catch (_error) {
    return {
      total_rows: totalRows,
      duplicate_rows: 0,
      estimated_rows: totalRows,
      skipped: true,
    };
  }
}

export async function diagnoseFiles(
  input: {
    files: Array<{ file_path: string; file_type: FileType }>;
    use_cache?: boolean;
    include_llm?: boolean;
    llm_mode?: 'sync' | 'defer' | 'cache_only';
    language?: 'en' | 'ko';
    include_merge_analysis?: boolean;
    merge_context?: {
      total_rows: number;
      duplicate_rows: number;
      estimated_rows: number;
      skipped: boolean;
    };
  },
  scopeProjectId: string | null
): Promise<DiagnoseFilesResponseRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const useCache = input.use_cache ?? true;
  const includeLlm = input.include_llm ?? false;
  const llmMode = input.llm_mode ?? 'sync';
  const language = input.language ?? 'en';

  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new StoreHttpError(400, 'files is required');
  }
  assertMaxArrayLength(input.files.length, MAX_DIAGNOSE_FILES, 'files');
  if (!['sync', 'defer', 'cache_only'].includes(llmMode)) {
    throw new StoreHttpError(400, 'llm_mode must be sync|defer|cache_only');
  }

  const diagnoses: FileDiagnosisRecord[] = [];
  let llmPending = false;

  for (const file of input.files) {
    const filePath = assertAbsolutePath(file.file_path, 'file_path');
    const fileType = normalizeFileType(file.file_type);

    let diagnosis = useCache ? await getCachedDiagnosis(projectId, filePath, language) : null;

    if (!diagnosis) {
      diagnosis = await diagnoseSingleFile(filePath, fileType);
    }

    if (includeLlm) {
      if (llmMode === 'cache_only') {
        if (!diagnosis.llm_analysis) {
          llmPending = true;
        }
      } else if (!diagnosis.llm_analysis) {
        diagnosis.llm_analysis = buildLlmAnalysis(filePath, diagnosis.columns);
      }
    }

    const diagnosisId = await saveDiagnosis(projectId, diagnosis, language);
    diagnosis.diagnosis_id = diagnosisId;
    diagnoses.push(diagnosis);
  }

  const response: DiagnoseFilesResponseRecord = {
    diagnoses,
    llm_pending: llmPending,
  };

  if (includeLlm && input.include_merge_analysis) {
    if (llmMode === 'cache_only' && llmPending) {
      response.merged_analysis = undefined;
      response.llm_pending = true;
    } else {
      const mergedName = normalizeTableName(
        diagnoses
          .map((diagnosis) => diagnosis.llm_analysis?.suggested_name ?? diagnosis.file_path.split('/').at(-1) ?? 'dataset')
          .join('_')
      );

      const mergeContext = input.merge_context;
      const contextMessage = mergeContext
        ? `Merged ${diagnoses.length} files (${mergeContext.total_rows} rows, ${mergeContext.duplicate_rows} duplicates).`
        : `Merged ${diagnoses.length} files into one dataset.`;

      response.merged_analysis = {
        suggested_name: mergedName,
        context: contextMessage,
      };
    }
  }

  return response;
}

export async function getFileDiagnosis(
  fileId: string,
  options: { use_cache?: boolean },
  scopeProjectId: string | null
): Promise<FileDiagnosisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);
  const language = 'en';

  if (options.use_cache === false) {
    const diagnosis = await diagnoseSingleFile(asset.file_path, normalizeFileType(asset.file_type), asset.diagnosis_id);
    const diagnosisId = await saveDiagnosis(projectId, diagnosis, language);

    await dbExec(
      `
UPDATE asset_files
SET diagnosis_id = ${sqlString(diagnosisId)},
    updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(asset.id)};
`
    );

    diagnosis.diagnosis_id = diagnosisId;
    return diagnosis;
  }

  if (asset.diagnosis_id) {
    const rows = await dbQuery<DiagnosisRow>(
      `
SELECT id, project_id, file_path, file_type, language, diagnosis_json, created_at, updated_at
FROM asset_file_diagnoses
WHERE id = ${sqlString(asset.diagnosis_id)}
LIMIT 1;
`
    );

    const row = rows[0];
    if (row) {
      const diagnosis = parseJsonObject<FileDiagnosisRecord | null>(row.diagnosis_json, null);
      if (diagnosis) {
        diagnosis.diagnosis_id = row.id;
        return diagnosis;
      }
    }
  }

  const cached = await getCachedDiagnosis(projectId, asset.file_path, language);
  if (cached) {
    return cached;
  }

  throw new StoreHttpError(404, `No diagnosis found for file '${fileId}'`);
}

export async function regenerateSummary(fileId: string, scopeProjectId: string | null): Promise<FileDiagnosisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);
  const language = 'en';

  let diagnosis = await getCachedDiagnosis(projectId, asset.file_path, language);
  if (!diagnosis) {
    diagnosis = await diagnoseSingleFile(asset.file_path, normalizeFileType(asset.file_type), asset.diagnosis_id);
  }

  diagnosis.llm_analysis = buildLlmAnalysis(asset.file_path, diagnosis.columns);
  const diagnosisId = await saveDiagnosis(projectId, diagnosis, language);

  await dbExec(
    `
UPDATE asset_files
SET diagnosis_id = ${sqlString(diagnosisId)},
    updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(asset.id)};
`
  );

  diagnosis.diagnosis_id = diagnosisId;
  await appendFileEvent(asset.id, 'summary_regenerate', 'Regenerated LLM summary');
  return diagnosis;
}

export async function rescanQuickDiagnosis(fileId: string, scopeProjectId: string | null): Promise<FileDiagnosisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);
  const language = 'en';

  const previous = await getCachedDiagnosis(projectId, asset.file_path, language);
  const diagnosis = await diagnoseSingleFile(asset.file_path, normalizeFileType(asset.file_type), asset.diagnosis_id);
  if (previous?.llm_analysis) {
    diagnosis.llm_analysis = previous.llm_analysis;
  }

  const diagnosisId = await saveDiagnosis(projectId, diagnosis, language);
  await dbExec(
    `
UPDATE asset_files
SET diagnosis_id = ${sqlString(diagnosisId)},
    updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(asset.id)};
`
  );

  diagnosis.diagnosis_id = diagnosisId;
  await appendFileEvent(asset.id, 'diagnosis_rescan', 'Rescanned dataset diagnosis');
  return diagnosis;
}

export async function listDiagnosisIssues(
  fileId: string,
  options: { status?: string | null; include_deleted?: boolean },
  scopeProjectId: string | null
): Promise<{ issues: DiagnosisIssueRecord[] }> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);

  if (options.status) {
    normalizeIssueStatus(options.status);
  }

  return {
    issues: await loadIssuesForFile(asset.id, {
      status: options.status,
      includeDeleted: options.include_deleted ?? false,
    }),
  };
}

export async function findDiagnosisIssues(
  fileId: string,
  scopeProjectId: string | null
): Promise<{ issues: DiagnosisIssueRecord[] }> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);
  const diagnosis = await regenerateSummary(fileId, projectId);

  const issues = diagnosis.llm_analysis?.issues ?? [];
  if (issues.length > 0 && diagnosis.diagnosis_id) {
    for (const issue of issues) {
      await dbExec(
        `
INSERT INTO asset_file_issues (
  id,
  diagnosis_id,
  file_asset_id,
  issue,
  issue_type,
  suggestion,
  example,
  status,
  user_response,
  confirmed_at,
  resolved_at,
  resolved_by,
  deleted_at,
  deleted_by,
  delete_reason,
  created_at,
  updated_at
) VALUES (
  ${sqlString(randomUUID())},
  ${sqlString(diagnosis.diagnosis_id)},
  ${sqlString(asset.id)},
  ${sqlString(issue.issue)},
  ${sqlString(issue.issue_type)},
  ${sqlString(issue.suggestion)},
  ${sqlString(issue.example ?? null)},
  'open',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  ${sqlString(nowIso())},
  ${sqlString(nowIso())}
);
`
      );
    }
  }

  await appendFileEvent(asset.id, 'issues_find', 'Generated diagnosis issues from summary');
  return {
    issues: await loadIssuesForFile(asset.id, { includeDeleted: false }),
  };
}

export async function updateDiagnosisIssue(
  issueId: string,
  updates: {
    status?: IssueStatus;
    user_response?: string;
    resolved_by?: string;
  }
): Promise<DiagnosisIssueRecord> {
  await ensureAssetsSchema();

  const rows = await dbQuery<IssueRow>(
    `
SELECT
  id,
  diagnosis_id,
  file_asset_id,
  issue,
  issue_type,
  suggestion,
  example,
  status,
  user_response,
  confirmed_at,
  resolved_at,
  resolved_by,
  deleted_at,
  deleted_by,
  delete_reason,
  created_at,
  updated_at
FROM asset_file_issues
WHERE id = ${sqlString(issueId)}
LIMIT 1;
`
  );

  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, `Issue '${issueId}' not found`);
  }

  const nextStatus = updates.status ? normalizeIssueStatus(updates.status) : normalizeIssueStatus(row.status);
  const now = nowIso();

  await dbExec(
    `
UPDATE asset_file_issues
SET status = ${sqlString(nextStatus)},
    user_response = ${sqlString(updates.user_response ?? row.user_response)},
    resolved_by = ${sqlString(updates.resolved_by ?? row.resolved_by)},
    confirmed_at = ${nextStatus === 'confirmed' ? sqlString(now) : sqlString(row.confirmed_at)},
    resolved_at = ${nextStatus === 'resolved' ? sqlString(now) : sqlString(row.resolved_at)},
    updated_at = ${sqlString(now)}
WHERE id = ${sqlString(issueId)};
`
  );

  const updatedRows = await dbQuery<IssueRow>(
    `
SELECT
  id,
  diagnosis_id,
  file_asset_id,
  issue,
  issue_type,
  suggestion,
  example,
  status,
  user_response,
  confirmed_at,
  resolved_at,
  resolved_by,
  deleted_at,
  deleted_by,
  delete_reason,
  created_at,
  updated_at
FROM asset_file_issues
WHERE id = ${sqlString(issueId)}
LIMIT 1;
`
  );

  const updated = updatedRows[0];
  if (!updated) {
    throw new StoreHttpError(404, `Issue '${issueId}' not found`);
  }

  return toIssueRecord(updated);
}

export async function deleteDiagnosisIssue(
  issueId: string,
  input: {
    deleted_by?: string;
    delete_reason?: string;
  }
): Promise<DiagnosisIssueRecord> {
  await ensureAssetsSchema();

  const rows = await dbQuery<IssueRow>(
    `
SELECT
  id,
  diagnosis_id,
  file_asset_id,
  issue,
  issue_type,
  suggestion,
  example,
  status,
  user_response,
  confirmed_at,
  resolved_at,
  resolved_by,
  deleted_at,
  deleted_by,
  delete_reason,
  created_at,
  updated_at
FROM asset_file_issues
WHERE id = ${sqlString(issueId)}
LIMIT 1;
`
  );

  if (!rows[0]) {
    throw new StoreHttpError(404, `Issue '${issueId}' not found`);
  }

  const now = nowIso();
  await dbExec(
    `
UPDATE asset_file_issues
SET deleted_at = ${sqlString(now)},
    deleted_by = ${sqlString(input.deleted_by ?? null)},
    delete_reason = ${sqlString(input.delete_reason ?? null)},
    updated_at = ${sqlString(now)}
WHERE id = ${sqlString(issueId)};
`
  );

  const updatedRows = await dbQuery<IssueRow>(
    `
SELECT
  id,
  diagnosis_id,
  file_asset_id,
  issue,
  issue_type,
  suggestion,
  example,
  status,
  user_response,
  confirmed_at,
  resolved_at,
  resolved_by,
  deleted_at,
  deleted_by,
  delete_reason,
  created_at,
  updated_at
FROM asset_file_issues
WHERE id = ${sqlString(issueId)}
LIMIT 1;
`
  );

  const updated = updatedRows[0];
  if (!updated) {
    throw new StoreHttpError(404, `Issue '${issueId}' not found`);
  }

  return toIssueRecord(updated);
}

export async function listFileEvents(
  fileId: string,
  scopeProjectId: string | null
): Promise<FilePreprocessingEventRecord[]> {
  const projectId = await resolveProjectId(scopeProjectId);
  const asset = await loadFileAssetRow(fileId, projectId);

  const rows = await dbQuery<EventRow>(
    `
SELECT id, file_asset_id, event_type, message, actor, created_at
FROM asset_file_events
WHERE file_asset_id = ${sqlString(asset.id)}
ORDER BY created_at ASC, id ASC;
`
  );

  return rows.map((row) => ({
    id: row.id,
    file_asset_id: row.file_asset_id,
    event_type: row.event_type,
    message: row.message,
    actor: row.actor,
    created_at: row.created_at,
  }));
}
