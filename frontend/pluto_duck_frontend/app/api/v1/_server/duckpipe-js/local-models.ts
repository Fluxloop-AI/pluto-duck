import { join } from 'node:path';

import { dbExec, dbQuery, sqlString } from '../db.ts';
import { StoreHttpError } from '../store.ts';
import type { DownloadStatus, LocalDownloadStatusRecord, LocalModelInfoRecord } from './contracts.ts';
import {
  MAX_MODEL_FIELD_LENGTH,
  assertMaxLength,
  ensureAssetsSchema,
  normalizeDownloadStatus,
  normalizeLocalModelId,
  normalizeRequiredText,
  nowIso,
  runtimeState,
  toInteger,
} from './runtime.ts';

interface LocalModelRow {
  id: string;
  name: string;
  path: string;
  size_bytes: number | null;
  quantization: string | null;
  created_at: string;
  updated_at: string;
}

interface LocalDownloadStatusRow {
  model_id: string;
  status: string;
  detail: string | null;
  updated_at: string;
}

async function setDownloadStatus(modelId: string, status: DownloadStatus, detail?: string | null): Promise<void> {
  const now = nowIso();
  await dbExec(
    `
INSERT INTO local_model_download_states (model_id, status, detail, updated_at)
VALUES (
  ${sqlString(modelId)},
  ${sqlString(status)},
  ${sqlString(detail ?? null)},
  ${sqlString(now)}
)
ON CONFLICT(model_id) DO UPDATE SET
  status = excluded.status,
  detail = excluded.detail,
  updated_at = excluded.updated_at;
`
  );
}

async function scheduleModelDownload(modelId: string, repoId: string, filename: string): Promise<void> {
  const existing = runtimeState.downloadTimers.get(modelId);
  if (existing) {
    clearTimeout(existing);
    runtimeState.downloadTimers.delete(modelId);
  }

  await setDownloadStatus(modelId, 'queued', `Preparing download from ${repoId}`);

  const queuedTimer = setTimeout(() => {
    void (async () => {
      await setDownloadStatus(modelId, 'downloading', `Downloading ${filename}`);

      const completeTimer = setTimeout(() => {
        void (async () => {
          const now = nowIso();
          const modelPath = join(process.cwd(), '.pluto-duck-data', 'models', modelId, filename);
          await dbExec(
            `
INSERT INTO local_models (id, name, path, size_bytes, quantization, created_at, updated_at)
VALUES (
  ${sqlString(modelId)},
  ${sqlString(modelId)},
  ${sqlString(modelPath)},
  NULL,
  NULL,
  ${sqlString(now)},
  ${sqlString(now)}
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  path = excluded.path,
  updated_at = excluded.updated_at;
`
          );
          await setDownloadStatus(modelId, 'completed', null);
          runtimeState.downloadTimers.delete(modelId);
        })().catch((error: unknown) => {
          void setDownloadStatus(
            modelId,
            'error',
            error instanceof Error ? error.message : 'Local model download failed'
          );
          runtimeState.downloadTimers.delete(modelId);
        });
      }, 60);

      runtimeState.downloadTimers.set(modelId, completeTimer);
    })().catch((error: unknown) => {
      void setDownloadStatus(
        modelId,
        'error',
        error instanceof Error ? error.message : 'Local model download failed'
      );
      runtimeState.downloadTimers.delete(modelId);
    });
  }, 20);

  runtimeState.downloadTimers.set(modelId, queuedTimer);
}

export async function listLocalModels(): Promise<LocalModelInfoRecord[]> {
  await ensureAssetsSchema();

  const rows = await dbQuery<LocalModelRow>(
    `
SELECT id, name, path, size_bytes, quantization, created_at, updated_at
FROM local_models
ORDER BY created_at ASC, id ASC;
`
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    size_bytes: row.size_bytes === null ? null : toInteger(row.size_bytes, 0),
    quantization: row.quantization,
  }));
}

export async function requestLocalModelDownload(input: {
  repo_id: string;
  filename: string;
  model_id?: string;
}): Promise<{ model_id: string; status: DownloadStatus | 'in_progress'; detail?: string }> {
  await ensureAssetsSchema();

  const repoId = normalizeRequiredText(input.repo_id, 'repo_id');
  const filename = normalizeRequiredText(input.filename, 'filename');
  assertMaxLength(repoId, MAX_MODEL_FIELD_LENGTH, 'repo_id');
  assertMaxLength(filename, MAX_MODEL_FIELD_LENGTH, 'filename');
  const modelId = normalizeLocalModelId(input.model_id, filename);
  assertMaxLength(modelId, MAX_MODEL_FIELD_LENGTH, 'model_id');

  const existingRows = await dbQuery<LocalModelRow>(
    `
SELECT id, name, path, size_bytes, quantization, created_at, updated_at
FROM local_models
WHERE id = ${sqlString(modelId)}
LIMIT 1;
`
  );

  if (existingRows[0]) {
    await setDownloadStatus(modelId, 'completed', 'Model already downloaded');
    return {
      model_id: modelId,
      status: 'completed',
      detail: 'Model already downloaded',
    };
  }

  const statusRows = await dbQuery<LocalDownloadStatusRow>(
    `
SELECT model_id, status, detail, updated_at
FROM local_model_download_states
WHERE model_id = ${sqlString(modelId)}
LIMIT 1;
`
  );

  const existingStatus = statusRows[0]?.status;
  if (existingStatus === 'queued' || existingStatus === 'downloading') {
    return {
      model_id: modelId,
      status: existingStatus as DownloadStatus,
      detail: statusRows[0]?.detail ?? undefined,
    };
  }

  await scheduleModelDownload(modelId, repoId, filename);
  return {
    model_id: modelId,
    status: 'queued',
  };
}

export async function getLocalDownloadStatuses(): Promise<Record<string, LocalDownloadStatusRecord>> {
  await ensureAssetsSchema();

  const rows = await dbQuery<LocalDownloadStatusRow>(
    `
SELECT model_id, status, detail, updated_at
FROM local_model_download_states
ORDER BY updated_at DESC, model_id ASC;
`
  );

  const result: Record<string, LocalDownloadStatusRecord> = {};
  for (const row of rows) {
    result[row.model_id] = {
      status: normalizeDownloadStatus(row.status),
      detail: row.detail,
      updated_at: row.updated_at,
    };
  }

  return result;
}

export async function loadLocalModel(modelId: string): Promise<void> {
  await ensureAssetsSchema();

  const normalizedId = normalizeRequiredText(modelId, 'model_id');
  const rows = await dbQuery<{ id: string }>(`SELECT id FROM local_models WHERE id = ${sqlString(normalizedId)} LIMIT 1;`);
  if (!rows[0]) {
    throw new StoreHttpError(404, 'Model not installed');
  }

  runtimeState.loadedModelId = normalizedId;
}

export async function unloadLocalModel(): Promise<void> {
  await ensureAssetsSchema();
  runtimeState.loadedModelId = null;
}

export async function deleteLocalModel(modelId: string): Promise<void> {
  await ensureAssetsSchema();
  const normalizedId = normalizeRequiredText(modelId, 'model_id');

  const rows = await dbQuery<{ id: string }>(`SELECT id FROM local_models WHERE id = ${sqlString(normalizedId)} LIMIT 1;`);
  if (!rows[0]) {
    throw new StoreHttpError(404, 'Model not found');
  }

  await dbExec(
    `
DELETE FROM local_models WHERE id = ${sqlString(normalizedId)};
DELETE FROM local_model_download_states WHERE model_id = ${sqlString(normalizedId)};
`
  );

  if (runtimeState.loadedModelId === normalizedId) {
    runtimeState.loadedModelId = null;
  }

  const timer = runtimeState.downloadTimers.get(normalizedId);
  if (timer) {
    clearTimeout(timer);
    runtimeState.downloadTimers.delete(normalizedId);
  }
}
