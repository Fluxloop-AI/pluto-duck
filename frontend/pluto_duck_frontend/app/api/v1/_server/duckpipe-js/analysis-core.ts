import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { dbExec, dbQuery, sqlString } from '../db.ts';
import { StoreHttpError } from '../store.ts';
import type {
  AnalysisDataRecord,
  AnalysisRecord,
  DownloadAnalysisRecord,
  ExecutionPlanRecord,
  ExecutionResultRecord,
  ExportAnalysisRecord,
  FileAssetRecord,
  FreshnessRecord,
  LineageGraphEdgeRecord,
  LineageGraphNodeRecord,
  LineageGraphRecord,
  LineageNodeRecord,
  LineageRecord,
  Materialization,
  RunHistoryRecord,
} from './contracts.ts';
import { listFileAssets } from './file-diagnosis.ts';
import {
  MAX_ANALYSIS_PARAMETER_COUNT,
  MAX_ANALYSIS_SQL_CHARS,
  MAX_ANALYSIS_TAG_COUNT,
  assertAbsolutePath,
  assertMaxArrayLength,
  assertMaxLength,
  normalizeAnalysisId,
  normalizeMaterialization,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTableName,
  nowIso,
  parseDependencyTokens,
  parseJsonArray,
  quoteIdentifier,
  resolveProjectId,
  toInteger,
} from './runtime.ts';

interface AnalysisRow {
  id: string;
  project_id: string;
  name: string;
  sql_text: string;
  description: string | null;
  materialization: string;
  parameters_json: string | null;
  tags_json: string | null;
  result_table: string;
  created_at: string;
  updated_at: string;
}

interface AnalysisRunRow {
  run_id: string;
  analysis_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_affected: number | null;
  error_message: string | null;
}

function toAnalysisRecord(row: AnalysisRow): AnalysisRecord {
  const parameters = parseJsonArray<Record<string, unknown>>(row.parameters_json, []);
  const tags = parseJsonArray<string>(row.tags_json, []).filter((tag) => typeof tag === 'string');
  const materialization = ['view', 'table', 'append', 'parquet'].includes(row.materialization)
    ? (row.materialization as Materialization)
    : 'view';

  return {
    id: row.id,
    name: row.name,
    sql: row.sql_text,
    description: row.description,
    materialization,
    parameters,
    tags,
    result_table: row.result_table,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadAnalysisRow(analysisId: string, projectId: string): Promise<AnalysisRow> {
  const rows = await dbQuery<AnalysisRow>(
    `
SELECT
  id,
  project_id,
  name,
  sql_text,
  description,
  materialization,
  parameters_json,
  tags_json,
  result_table,
  created_at,
  updated_at
FROM asset_analyses
WHERE id = ${sqlString(analysisId)}
  AND project_id = ${sqlString(projectId)}
LIMIT 1;
`
  );

  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, `Analysis '${analysisId}' not found`);
  }
  return row;
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

export async function listAnalyses(scopeProjectId: string | null, tags?: string[]): Promise<AnalysisRecord[]> {
  const projectId = await resolveProjectId(scopeProjectId);

  const rows = await dbQuery<AnalysisRow>(
    `
SELECT
  id,
  project_id,
  name,
  sql_text,
  description,
  materialization,
  parameters_json,
  tags_json,
  result_table,
  created_at,
  updated_at
FROM asset_analyses
WHERE project_id = ${sqlString(projectId)}
ORDER BY updated_at DESC, id ASC;
`
  );

  const analyses = rows.map(toAnalysisRecord);
  if (!tags || tags.length === 0) {
    return analyses;
  }

  return analyses.filter((analysis) => tags.some((tag) => analysis.tags.includes(tag)));
}

export async function createAnalysis(
  input: {
    sql: string;
    name: string;
    analysis_id?: string;
    description?: string | null;
    materialization?: Materialization;
    parameters?: Array<Record<string, unknown>>;
    tags?: string[];
  },
  scopeProjectId: string | null
): Promise<AnalysisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const now = nowIso();
  const analysisId = normalizeAnalysisId(input.analysis_id);
  const name = normalizeRequiredText(input.name, 'name');
  const sqlText = normalizeRequiredText(input.sql, 'sql');
  assertMaxLength(sqlText, MAX_ANALYSIS_SQL_CHARS, 'sql');
  const materialization = normalizeMaterialization(input.materialization);
  const description = normalizeOptionalText(input.description);
  const parameters = Array.isArray(input.parameters) ? input.parameters : [];
  assertMaxArrayLength(parameters.length, MAX_ANALYSIS_PARAMETER_COUNT, 'parameters');
  const tags = Array.isArray(input.tags)
    ? input.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
    : [];
  assertMaxArrayLength(tags.length, MAX_ANALYSIS_TAG_COUNT, 'tags');
  const resultTable = normalizeTableName(`analysis_${analysisId}`);

  try {
    await dbExec(
      `
INSERT INTO asset_analyses (
  id,
  project_id,
  name,
  sql_text,
  description,
  materialization,
  parameters_json,
  tags_json,
  result_table,
  created_at,
  updated_at
) VALUES (
  ${sqlString(analysisId)},
  ${sqlString(projectId)},
  ${sqlString(name)},
  ${sqlString(sqlText)},
  ${sqlString(description)},
  ${sqlString(materialization)},
  ${sqlString(JSON.stringify(parameters))},
  ${sqlString(JSON.stringify(tags))},
  ${sqlString(resultTable)},
  ${sqlString(now)},
  ${sqlString(now)}
);
`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.toLowerCase().includes('duplicate')) {
      throw new StoreHttpError(409, `Analysis '${analysisId}' already exists`);
    }
    throw error;
  }

  return toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));
}

export async function getAnalysis(analysisId: string, scopeProjectId: string | null): Promise<AnalysisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  return toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));
}

export async function updateAnalysis(
  analysisId: string,
  updates: {
    sql?: string;
    name?: string;
    description?: string | null;
    materialization?: Materialization;
    parameters?: Array<Record<string, unknown>>;
    tags?: string[];
  },
  scopeProjectId: string | null
): Promise<AnalysisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const existing = await loadAnalysisRow(analysisId, projectId);
  const now = nowIso();

  const nextName = updates.name ? normalizeRequiredText(updates.name, 'name') : existing.name;
  const nextSql = updates.sql ? normalizeRequiredText(updates.sql, 'sql') : existing.sql_text;
  assertMaxLength(nextSql, MAX_ANALYSIS_SQL_CHARS, 'sql');
  const nextDescription =
    updates.description === undefined ? existing.description : normalizeOptionalText(updates.description);
  const nextMaterialization = updates.materialization
    ? normalizeMaterialization(updates.materialization)
    : normalizeMaterialization(existing.materialization);
  const nextParameters = updates.parameters ?? parseJsonArray<Record<string, unknown>>(existing.parameters_json, []);
  assertMaxArrayLength(nextParameters.length, MAX_ANALYSIS_PARAMETER_COUNT, 'parameters');
  const nextTags = updates.tags
    ? updates.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
    : parseJsonArray<string>(existing.tags_json, []);
  assertMaxArrayLength(nextTags.length, MAX_ANALYSIS_TAG_COUNT, 'tags');

  await dbExec(
    `
UPDATE asset_analyses
SET name = ${sqlString(nextName)},
    sql_text = ${sqlString(nextSql)},
    description = ${sqlString(nextDescription)},
    materialization = ${sqlString(nextMaterialization)},
    parameters_json = ${sqlString(JSON.stringify(nextParameters))},
    tags_json = ${sqlString(JSON.stringify(nextTags))},
    updated_at = ${sqlString(now)}
WHERE id = ${sqlString(analysisId)}
  AND project_id = ${sqlString(projectId)};
`
  );

  return toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));
}

export async function deleteAnalysis(analysisId: string, scopeProjectId: string | null): Promise<void> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = await loadAnalysisRow(analysisId, projectId);

  await dbExec(
    `
DROP VIEW IF EXISTS ${quoteIdentifier(analysis.result_table)};
DROP TABLE IF EXISTS ${quoteIdentifier(analysis.result_table)};

DELETE FROM asset_analysis_runs
WHERE analysis_id = ${sqlString(analysis.id)}
  AND project_id = ${sqlString(projectId)};

DELETE FROM asset_analyses
WHERE id = ${sqlString(analysis.id)}
  AND project_id = ${sqlString(projectId)};
`
  );
}

export async function compileAnalysis(
  analysisId: string,
  input: {
    params?: Record<string, unknown>;
    force?: boolean;
  },
  scopeProjectId: string | null
): Promise<ExecutionPlanRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));
  const freshness = await getFreshness(analysisId, projectId);

  const shouldSkip = !input.force && !freshness.is_stale;
  return {
    target_id: analysis.id,
    steps: [
      {
        analysis_id: analysis.id,
        action: shouldSkip ? 'skip' : 'run',
        reason: shouldSkip ? 'Result is fresh' : freshness.stale_reason,
        operation: shouldSkip ? null : analysis.materialization,
        target_table: analysis.result_table,
      },
    ],
    params: input.params ?? {},
  };
}

export async function executeAnalysis(
  analysisId: string,
  input: {
    params?: Record<string, unknown>;
    force?: boolean;
    continue_on_failure?: boolean;
  },
  scopeProjectId: string | null
): Promise<ExecutionResultRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));
  const plan = await compileAnalysis(analysisId, input, projectId);

  const runId = randomUUID();
  const startedAt = nowIso();
  const nowMs = Date.now();

  if (plan.steps[0]?.action === 'skip') {
    await dbExec(
      `
INSERT INTO asset_analysis_runs (
  run_id,
  analysis_id,
  project_id,
  status,
  started_at,
  finished_at,
  duration_ms,
  rows_affected,
  error_message
) VALUES (
  ${sqlString(runId)},
  ${sqlString(analysis.id)},
  ${sqlString(projectId)},
  'skipped',
  ${sqlString(startedAt)},
  ${sqlString(startedAt)},
  0,
  NULL,
  NULL
);
`
    );

    return {
      success: true,
      target_id: analysis.id,
      step_results: [
        {
          run_id: runId,
          analysis_id: analysis.id,
          status: 'skipped',
          started_at: startedAt,
          finished_at: startedAt,
          duration_ms: 0,
          rows_affected: null,
          error: null,
        },
      ],
    };
  }

  try {
    const resultTable = quoteIdentifier(analysis.result_table);
    const sqlText = analysis.sql;

    if (analysis.materialization === 'view') {
      await dbExec(`CREATE OR REPLACE VIEW ${resultTable} AS ${sqlText};`);
    } else if (analysis.materialization === 'append') {
      const exists = await tableExists(analysis.result_table);
      if (exists) {
        await dbExec(`INSERT INTO ${resultTable} SELECT * FROM (${sqlText}) AS append_source;`);
      } else {
        await dbExec(`CREATE TABLE ${resultTable} AS ${sqlText};`);
      }
    } else {
      await dbExec(`CREATE OR REPLACE TABLE ${resultTable} AS ${sqlText};`);
    }

    let rowsAffected: number | null = null;
    if (analysis.materialization !== 'view') {
      rowsAffected = await countRowsForTable(analysis.result_table);
    }

    const finishedAt = nowIso();
    const duration = Date.now() - nowMs;

    await dbExec(
      `
INSERT INTO asset_analysis_runs (
  run_id,
  analysis_id,
  project_id,
  status,
  started_at,
  finished_at,
  duration_ms,
  rows_affected,
  error_message
) VALUES (
  ${sqlString(runId)},
  ${sqlString(analysis.id)},
  ${sqlString(projectId)},
  'success',
  ${sqlString(startedAt)},
  ${sqlString(finishedAt)},
  ${String(duration)},
  ${rowsAffected === null ? 'NULL' : String(rowsAffected)},
  NULL
);
`
    );

    return {
      success: true,
      target_id: analysis.id,
      step_results: [
        {
          run_id: runId,
          analysis_id: analysis.id,
          status: 'success',
          started_at: startedAt,
          finished_at: finishedAt,
          duration_ms: duration,
          rows_affected: rowsAffected,
          error: null,
        },
      ],
    };
  } catch (error) {
    const finishedAt = nowIso();
    const duration = Date.now() - nowMs;
    const detail = error instanceof Error ? error.message : String(error);

    await dbExec(
      `
INSERT INTO asset_analysis_runs (
  run_id,
  analysis_id,
  project_id,
  status,
  started_at,
  finished_at,
  duration_ms,
  rows_affected,
  error_message
) VALUES (
  ${sqlString(runId)},
  ${sqlString(analysis.id)},
  ${sqlString(projectId)},
  'failed',
  ${sqlString(startedAt)},
  ${sqlString(finishedAt)},
  ${String(duration)},
  NULL,
  ${sqlString(detail)}
);
`
    );

    throw new StoreHttpError(500, detail);
  }
}

export async function getAnalysisData(
  analysisId: string,
  options: {
    limit?: number;
    offset?: number;
  },
  scopeProjectId: string | null
): Promise<AnalysisDataRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));

  const exists = await tableExists(analysis.result_table);
  if (!exists) {
    throw new StoreHttpError(400, 'Analysis result is not available. Execute analysis first');
  }

  const limit = Math.min(10000, Math.max(1, toInteger(options.limit ?? 1000, 1000)));
  const offset = Math.max(0, toInteger(options.offset ?? 0, 0));

  const totalRowsRaw = await dbQuery<{ total_rows: number }>(
    `SELECT COUNT(*)::INTEGER AS total_rows FROM ${quoteIdentifier(analysis.result_table)};`
  );
  const totalRows = totalRowsRaw[0]?.total_rows ?? 0;

  const dataRows = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdentifier(analysis.result_table)} LIMIT ${String(limit)} OFFSET ${String(offset)};`
  );
  const columns = dataRows[0] ? Object.keys(dataRows[0]) : [];

  return {
    columns,
    rows: dataRows.map((row) => columns.map((column) => row[column] ?? null)),
    total_rows: totalRows,
  };
}

export async function exportAnalysisCsv(
  analysisId: string,
  input: {
    file_path: string;
    force?: boolean;
  },
  scopeProjectId: string | null
): Promise<ExportAnalysisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));

  const executeResult = await executeAnalysis(
    analysisId,
    {
      force: input.force ?? false,
      continue_on_failure: false,
    },
    projectId
  );

  if (!executeResult.success) {
    throw new StoreHttpError(500, 'Execution failed');
  }

  let destination = assertAbsolutePath(input.file_path, 'file_path');
  if (!destination.toLowerCase().endsWith('.csv')) {
    destination = `${destination}.csv`;
  }
  await mkdir(dirname(destination), { recursive: true });

  await dbExec(
    `COPY (SELECT * FROM ${quoteIdentifier(analysis.result_table)}) TO ${sqlString(destination)} (HEADER, DELIMITER ',');`
  );

  return {
    status: 'saved',
    file_path: destination,
  };
}

export async function downloadAnalysisCsv(
  analysisId: string,
  options: {
    force?: boolean;
  },
  scopeProjectId: string | null
): Promise<DownloadAnalysisRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));

  const executeResult = await executeAnalysis(
    analysisId,
    {
      force: options.force ?? false,
      continue_on_failure: false,
    },
    projectId
  );
  if (!executeResult.success) {
    throw new StoreHttpError(500, 'Execution failed');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'pluto-duck-analysis-'));
  const tempPath = join(tempDir, `${analysis.id}.csv`);

  try {
    await dbExec(
      `COPY (SELECT * FROM ${quoteIdentifier(analysis.result_table)}) TO ${sqlString(tempPath)} (HEADER, DELIMITER ',');`
    );
    const content = await readFile(tempPath);
    return {
      filename: `${analysis.id}.csv`,
      content,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function getFreshness(analysisId: string, scopeProjectId: string | null): Promise<FreshnessRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));

  const rows = await dbQuery<{ finished_at: string | null; status: string }>(
    `
SELECT finished_at, status
FROM asset_analysis_runs
WHERE analysis_id = ${sqlString(analysis.id)}
  AND project_id = ${sqlString(projectId)}
ORDER BY started_at DESC, run_id DESC
LIMIT 1;
`
  );

  const latest = rows[0];
  const lastRunAt = latest?.finished_at ?? null;

  if (!latest || latest.status !== 'success' || !lastRunAt) {
    return {
      analysis_id: analysis.id,
      is_stale: true,
      last_run_at: lastRunAt,
      stale_reason: 'Never executed',
    };
  }

  const updatedAt = new Date(analysis.updated_at).getTime();
  const finishedAt = new Date(lastRunAt).getTime();
  const staleBecauseUpdated = Number.isFinite(updatedAt) && Number.isFinite(finishedAt) && updatedAt > finishedAt;

  return {
    analysis_id: analysis.id,
    is_stale: staleBecauseUpdated,
    last_run_at: lastRunAt,
    stale_reason: staleBecauseUpdated ? 'Analysis updated after last run' : null,
  };
}

export async function getLineage(analysisId: string, scopeProjectId: string | null): Promise<LineageRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analysis = toAnalysisRecord(await loadAnalysisRow(analysisId, projectId));
  const allAnalyses = await listAnalyses(projectId);
  const files = await listFileAssets(projectId);

  const analysisByResult = new Map<string, AnalysisRecord>();
  for (const candidate of allAnalyses) {
    analysisByResult.set(candidate.result_table.toLowerCase(), candidate);
  }

  const fileByTable = new Map<string, FileAssetRecord>();
  for (const file of files) {
    fileByTable.set(file.table_name.toLowerCase(), file);
  }

  const upstream: LineageNodeRecord[] = [];
  const dependencies = parseDependencyTokens(analysis.sql);

  for (const dependency of dependencies) {
    const lookup = dependency.toLowerCase();
    const analysisDependency = analysisByResult.get(lookup);
    if (analysisDependency && analysisDependency.id !== analysis.id) {
      upstream.push({
        type: 'analysis',
        id: analysisDependency.id,
        name: analysisDependency.name,
      });
      continue;
    }

    const fileDependency = fileByTable.get(lookup);
    if (fileDependency) {
      upstream.push({
        type: 'file',
        id: fileDependency.id,
        name: fileDependency.name,
        full: dependency,
      });
      continue;
    }

    upstream.push({
      type: 'source',
      id: dependency,
      full: dependency,
    });
  }

  const downstream: LineageNodeRecord[] = [];
  const resultLookup = analysis.result_table.toLowerCase();

  for (const candidate of allAnalyses) {
    if (candidate.id === analysis.id) {
      continue;
    }
    const refs = parseDependencyTokens(candidate.sql).map((token) => token.toLowerCase());
    if (refs.includes(resultLookup)) {
      downstream.push({
        type: 'analysis',
        id: candidate.id,
        name: candidate.name,
      });
    }
  }

  return {
    analysis_id: analysis.id,
    upstream,
    downstream,
  };
}

export async function getRunHistory(
  analysisId: string,
  options: { limit?: number },
  scopeProjectId: string | null
): Promise<RunHistoryRecord[]> {
  const projectId = await resolveProjectId(scopeProjectId);
  await loadAnalysisRow(analysisId, projectId);

  const limit = Math.min(100, Math.max(1, toInteger(options.limit ?? 10, 10)));
  const rows = await dbQuery<AnalysisRunRow>(
    `
SELECT run_id, analysis_id, status, started_at, finished_at, duration_ms, rows_affected, error_message
FROM asset_analysis_runs
WHERE analysis_id = ${sqlString(analysisId)}
  AND project_id = ${sqlString(projectId)}
ORDER BY started_at DESC, run_id DESC
LIMIT ${String(limit)};
`
  );

  return rows.map((row) => ({
    run_id: row.run_id,
    analysis_id: row.analysis_id,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms === null ? null : toInteger(row.duration_ms, 0),
    rows_affected: row.rows_affected === null ? null : toInteger(row.rows_affected, 0),
    error_message: row.error_message,
  }));
}

export async function getLineageGraph(scopeProjectId: string | null): Promise<LineageGraphRecord> {
  const projectId = await resolveProjectId(scopeProjectId);
  const analyses = await listAnalyses(projectId);
  const files = await listFileAssets(projectId);

  const analysisByResult = new Map<string, AnalysisRecord>();
  for (const analysis of analyses) {
    analysisByResult.set(analysis.result_table.toLowerCase(), analysis);
  }

  const fileByTable = new Map<string, FileAssetRecord>();
  for (const file of files) {
    fileByTable.set(file.table_name.toLowerCase(), file);
  }

  const nodes: LineageGraphNodeRecord[] = [];
  const edges: LineageGraphEdgeRecord[] = [];
  const seenNodes = new Set<string>();

  for (const analysis of analyses) {
    const freshness = await getFreshness(analysis.id, projectId);
    const analysisNodeId = `analysis:${analysis.id}`;
    nodes.push({
      id: analysisNodeId,
      type: 'analysis',
      name: analysis.name,
      materialization: analysis.materialization,
      is_stale: freshness.is_stale,
      last_run_at: freshness.last_run_at,
    });
    seenNodes.add(analysisNodeId);

    for (const dependency of parseDependencyTokens(analysis.sql)) {
      const lookup = dependency.toLowerCase();
      const upstreamAnalysis = analysisByResult.get(lookup);
      if (upstreamAnalysis) {
        const sourceId = `analysis:${upstreamAnalysis.id}`;
        if (!seenNodes.has(sourceId)) {
          nodes.push({
            id: sourceId,
            type: 'analysis',
            name: upstreamAnalysis.name,
            materialization: upstreamAnalysis.materialization,
            is_stale: null,
            last_run_at: null,
          });
          seenNodes.add(sourceId);
        }
        edges.push({ source: sourceId, target: analysisNodeId });
        continue;
      }

      const upstreamFile = fileByTable.get(lookup);
      if (upstreamFile) {
        const sourceId = `file:${upstreamFile.id}`;
        if (!seenNodes.has(sourceId)) {
          nodes.push({
            id: sourceId,
            type: 'file',
            name: upstreamFile.name,
            materialization: null,
            is_stale: null,
            last_run_at: null,
          });
          seenNodes.add(sourceId);
        }
        edges.push({ source: sourceId, target: analysisNodeId });
        continue;
      }

      const sourceId = `source:${dependency}`;
      if (!seenNodes.has(sourceId)) {
        nodes.push({
          id: sourceId,
          type: 'source',
          name: dependency,
          materialization: null,
          is_stale: null,
          last_run_at: null,
        });
        seenNodes.add(sourceId);
      }
      edges.push({ source: sourceId, target: analysisNodeId });
    }
  }

  return {
    nodes,
    edges,
  };
}
