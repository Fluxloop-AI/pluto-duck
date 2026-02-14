import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { dbExec, dbQuery, sqlString } from './db.ts';
import { StoreHttpError } from './store.ts';

type JsonMap = Record<string, unknown>;
type BoardItemType = 'markdown' | 'chart' | 'table' | 'metric' | 'image';
const MAX_BOARD_ASSET_BYTES = 64 * 1024 * 1024;
const DEFAULT_BOARD_ASSET_MIME = 'application/octet-stream';

const BOARD_ITEM_TYPES: Set<BoardItemType> = new Set([
  'markdown',
  'chart',
  'table',
  'metric',
  'image',
]);

interface RuntimeState {
  queue: Promise<void>;
  schemaReady: boolean;
}

const globalBoardsState = globalThis as typeof globalThis & {
  __plutoDuckBoardsState?: RuntimeState;
};

const runtimeState: RuntimeState = globalBoardsState.__plutoDuckBoardsState ?? {
  queue: Promise.resolve(),
  schemaReady: false,
};

if (!globalBoardsState.__plutoDuckBoardsState) {
  globalBoardsState.__plutoDuckBoardsState = runtimeState;
}

function withBoardsLock<T>(operation: () => Promise<T>): Promise<T> {
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

function sanitizeName(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StoreHttpError(400, `${fieldName} is required`);
  }
  return normalized;
}

function assertJsonObject(
  value: unknown,
  fieldName: string,
  options?: { nullable?: boolean; optional?: boolean }
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

function parseOptionalJsonMap(raw: string | null): JsonMap | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonMap;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function parseRequiredJsonMap(raw: string): JsonMap {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonMap;
    }
  } catch (_error) {
    return {};
  }
  return {};
}

function toInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new StoreHttpError(400, `${fieldName} must be an array of strings`);
  }
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new StoreHttpError(400, `${fieldName} must be an array of strings`);
    }
    normalized.push(item);
  }
  return normalized;
}

function assertScopeMatch(scopeProjectId: string | null, actualProjectId: string, message: string): void {
  if (scopeProjectId && scopeProjectId !== actualProjectId) {
    throw new StoreHttpError(400, message);
  }
}

function resolveBoardAssetsRootDir(): string {
  const explicitDataRoot = process.env.PLUTODUCK_DATA_DIR__ROOT?.trim();
  if (explicitDataRoot) {
    return resolve(explicitDataRoot, 'board-assets');
  }

  const explicitDbPath = process.env.PLUTODUCK_DB_PATH?.trim();
  if (explicitDbPath) {
    return resolve(dirname(explicitDbPath), 'board-assets');
  }

  return resolve(process.cwd(), '.pluto-duck-data', 'board-assets');
}

function normalizeAssetFileName(fileName: string): string {
  const normalizedBase = basename(fileName).trim();
  const fallback = 'upload.bin';
  if (normalizedBase.length === 0) {
    return fallback;
  }
  return normalizedBase.replace(/[\r\n]/g, '_');
}

function normalizeAssetMimeType(mimeType: string | null | undefined): string {
  const normalized = mimeType?.trim();
  if (!normalized) {
    return DEFAULT_BOARD_ASSET_MIME;
  }
  return normalized.toLowerCase();
}

interface BoardRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  settings_json: string | null;
}

interface BoardListRow extends BoardRow {
  effective_updated_at: string | null;
}

interface BoardItemRow {
  id: string;
  board_id: string;
  item_type: string;
  title: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  payload_json: string;
  render_config_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemScopeRow {
  id: string;
  board_id: string;
  project_id: string;
}

interface QueryRow {
  id: string;
  item_id: string;
  query_text: string;
  data_source_tables_json: string | null;
  refresh_mode: string;
  refresh_interval_seconds: number | null;
  last_result_json: string | null;
}

interface BoardAssetRow {
  id: string;
  item_id: string;
  board_id: string;
  project_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string | null;
  file_size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface BoardRecord {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  settings: JsonMap | null;
}

export interface BoardItemRecord {
  id: string;
  board_id: string;
  item_type: BoardItemType;
  title: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  payload: JsonMap;
  render_config: JsonMap | null;
  created_at: string;
  updated_at: string;
}

export interface QueryResultRecord {
  columns: string[];
  data: Array<Record<string, unknown>>;
  row_count: number;
  executed_at: string;
}

export interface BoardAssetUploadRecord {
  asset_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  url: string;
}

export interface BoardAssetDownloadRecord {
  filename: string;
  mime_type: string;
  content: Uint8Array;
}

async function ensureBoardsSchema(): Promise<void> {
  if (runtimeState.schemaReady) {
    return;
  }

  await dbExec(
    `
CREATE TABLE IF NOT EXISTS boards (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  description VARCHAR,
  position INTEGER NOT NULL DEFAULT 0,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL,
  settings_json VARCHAR
);

CREATE TABLE IF NOT EXISTS board_items (
  id VARCHAR PRIMARY KEY,
  board_id VARCHAR NOT NULL,
  item_type VARCHAR NOT NULL,
  title VARCHAR,
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 1,
  height INTEGER NOT NULL DEFAULT 1,
  payload_json VARCHAR NOT NULL,
  render_config_json VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS board_queries (
  id VARCHAR PRIMARY KEY,
  item_id VARCHAR NOT NULL UNIQUE,
  query_text VARCHAR NOT NULL,
  data_source_tables_json VARCHAR,
  refresh_mode VARCHAR NOT NULL DEFAULT 'manual',
  refresh_interval_seconds INTEGER,
  last_result_json VARCHAR,
  last_executed_at VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'idle',
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS board_assets (
  id VARCHAR PRIMARY KEY,
  item_id VARCHAR NOT NULL,
  board_id VARCHAR NOT NULL,
  project_id VARCHAR NOT NULL,
  storage_path VARCHAR NOT NULL,
  original_name VARCHAR NOT NULL,
  mime_type VARCHAR,
  file_size_bytes BIGINT NOT NULL,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
`
  );

  runtimeState.schemaReady = true;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const rows = await dbQuery<{ id: string }>(
    `SELECT id FROM projects WHERE id = ${sqlString(projectId)} LIMIT 1;`
  );
  if (!rows[0]) {
    throw new StoreHttpError(404, 'Project not found');
  }
}

function toBoardRecord(row: BoardRow, effectiveUpdatedAt?: string | null): BoardRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    description: row.description,
    position: toInteger(row.position, 0),
    created_at: row.created_at,
    updated_at: effectiveUpdatedAt ?? row.updated_at,
    settings: parseOptionalJsonMap(row.settings_json),
  };
}

function toBoardItemRecord(row: BoardItemRow): BoardItemRecord {
  const itemType = BOARD_ITEM_TYPES.has(row.item_type as BoardItemType)
    ? (row.item_type as BoardItemType)
    : 'table';

  return {
    id: row.id,
    board_id: row.board_id,
    item_type: itemType,
    title: row.title,
    position_x: toInteger(row.position_x, 0),
    position_y: toInteger(row.position_y, 0),
    width: Math.max(1, toInteger(row.width, 1)),
    height: Math.max(1, toInteger(row.height, 1)),
    payload: parseRequiredJsonMap(row.payload_json),
    render_config: parseOptionalJsonMap(row.render_config_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadBoardRow(boardId: string): Promise<BoardRow> {
  const rows = await dbQuery<BoardRow>(
    `
SELECT id, project_id, name, description, position, created_at, updated_at, settings_json
FROM boards
WHERE id = ${sqlString(boardId)}
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Board not found');
  }
  return row;
}

async function loadItemScope(itemId: string): Promise<ItemScopeRow> {
  const rows = await dbQuery<ItemScopeRow>(
    `
SELECT bi.id, bi.board_id, b.project_id
FROM board_items bi
JOIN boards b ON b.id = bi.board_id
WHERE bi.id = ${sqlString(itemId)}
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Item not found');
  }
  return row;
}

async function loadItemRow(itemId: string): Promise<BoardItemRow> {
  const rows = await dbQuery<BoardItemRow>(
    `
SELECT
  id,
  board_id,
  item_type,
  title,
  position_x,
  position_y,
  width,
  height,
  payload_json,
  render_config_json,
  created_at,
  updated_at
FROM board_items
WHERE id = ${sqlString(itemId)}
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Item not found');
  }
  return row;
}

async function loadBoardAssetRow(assetId: string): Promise<BoardAssetRow> {
  const rows = await dbQuery<BoardAssetRow>(
    `
SELECT
  id,
  item_id,
  board_id,
  project_id,
  storage_path,
  original_name,
  mime_type,
  file_size_bytes,
  created_at,
  updated_at
FROM board_assets
WHERE id = ${sqlString(assetId)}
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Asset not found');
  }
  return row;
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function listBoardAssetsByItem(itemId: string): Promise<BoardAssetRow[]> {
  return dbQuery<BoardAssetRow>(
    `
SELECT
  id,
  item_id,
  board_id,
  project_id,
  storage_path,
  original_name,
  mime_type,
  file_size_bytes,
  created_at,
  updated_at
FROM board_assets
WHERE item_id = ${sqlString(itemId)}
ORDER BY created_at ASC, id ASC;
`
  );
}

async function touchBoard(boardId: string): Promise<void> {
  await dbExec(
    `
UPDATE boards
SET updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(boardId)};
`
  );
}

async function syncProjectBoardCount(projectId: string): Promise<void> {
  await dbExec(
    `
UPDATE projects
SET board_count = (
      SELECT COUNT(*)::INTEGER
      FROM boards
      WHERE project_id = ${sqlString(projectId)}
    ),
    updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(projectId)};
`
  );
}

export async function listBoards(projectIdInput: string): Promise<BoardRecord[]> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();
    const projectId = normalizeId(projectIdInput, 'Project id');
    await assertProjectExists(projectId);

    const rows = await dbQuery<BoardListRow>(
      `
SELECT
  b.id,
  b.project_id,
  b.name,
  b.description,
  b.position,
  b.created_at,
  b.updated_at,
  b.settings_json,
  COALESCE(MAX(bi.updated_at), b.updated_at) AS effective_updated_at
FROM boards b
LEFT JOIN board_items bi ON bi.board_id = b.id
WHERE b.project_id = ${sqlString(projectId)}
GROUP BY
  b.id,
  b.project_id,
  b.name,
  b.description,
  b.position,
  b.created_at,
  b.updated_at,
  b.settings_json
ORDER BY effective_updated_at DESC, b.created_at DESC, b.id DESC;
`
    );

    return rows.map((row) => toBoardRecord(row, row.effective_updated_at));
  });
}

export async function createBoard(
  projectIdInput: string,
  payload: {
    name: string;
    description?: string | null;
    settings?: JsonMap | null;
  }
): Promise<BoardRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();
    const projectId = normalizeId(projectIdInput, 'Project id');
    await assertProjectExists(projectId);

    const name = sanitizeName(payload.name, 'Board name');
    const description = payload.description?.trim() || null;

    if (payload.settings !== undefined) {
      assertJsonObject(payload.settings, 'settings', { optional: true, nullable: true });
    }
    const settings = payload.settings ?? null;

    const now = nowIso();
    const boardId = randomUUID();
    const positionRows = await dbQuery<{ position: number }>(
      `
SELECT COALESCE(MAX(position), -1)::INTEGER + 1 AS position
FROM boards
WHERE project_id = ${sqlString(projectId)};
`
    );
    const position = positionRows[0]?.position ?? 0;

    await dbExec(
      `
INSERT INTO boards (
  id,
  project_id,
  name,
  description,
  position,
  created_at,
  updated_at,
  settings_json
) VALUES (
  ${sqlString(boardId)},
  ${sqlString(projectId)},
  ${sqlString(name)},
  ${sqlString(description)},
  ${position},
  ${sqlString(now)},
  ${sqlString(now)},
  ${sqlString(settings ? JSON.stringify(settings) : null)}
);
`
    );

    await syncProjectBoardCount(projectId);
    return toBoardRecord(await loadBoardRow(boardId));
  });
}

export async function getBoardDetail(
  boardIdInput: string,
  scopeProjectId: string | null
): Promise<BoardRecord & { items: BoardItemRecord[] }> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const boardId = normalizeId(boardIdInput, 'Board id');
    const board = await loadBoardRow(boardId);
    assertScopeMatch(scopeProjectId, board.project_id, 'Project scope does not match board project id');

    const items = await dbQuery<BoardItemRow>(
      `
SELECT
  id,
  board_id,
  item_type,
  title,
  position_x,
  position_y,
  width,
  height,
  payload_json,
  render_config_json,
  created_at,
  updated_at
FROM board_items
WHERE board_id = ${sqlString(board.id)}
ORDER BY position_y ASC, position_x ASC, created_at ASC, id ASC;
`
    );

    return {
      ...toBoardRecord(board),
      items: items.map(toBoardItemRecord),
    };
  });
}

export async function updateBoard(
  boardIdInput: string,
  patch: {
    name?: string | null;
    description?: string | null;
    settings?: JsonMap | null;
  },
  scopeProjectId: string | null
): Promise<BoardRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const boardId = normalizeId(boardIdInput, 'Board id');
    const current = await loadBoardRow(boardId);
    assertScopeMatch(scopeProjectId, current.project_id, 'Project scope does not match board project id');

    if (patch.settings !== undefined) {
      assertJsonObject(patch.settings, 'settings', { optional: true, nullable: true });
    }

    const updates: string[] = [];
    if (patch.name !== undefined) {
      updates.push(`name = ${sqlString(sanitizeName(patch.name ?? '', 'Board name'))}`);
    }
    if (patch.description !== undefined) {
      updates.push(`description = ${sqlString(patch.description?.trim() || null)}`);
    }
    if (patch.settings !== undefined) {
      updates.push(
        `settings_json = ${sqlString(patch.settings ? JSON.stringify(patch.settings) : null)}`
      );
    }

    if (updates.length === 0) {
      return toBoardRecord(current);
    }

    updates.push(`updated_at = ${sqlString(nowIso())}`);

    await dbExec(
      `
UPDATE boards
SET ${updates.join(', ')}
WHERE id = ${sqlString(boardId)};
`
    );

    return toBoardRecord(await loadBoardRow(boardId));
  });
}

export async function deleteBoard(boardIdInput: string, scopeProjectId: string | null): Promise<void> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const boardId = normalizeId(boardIdInput, 'Board id');
    const board = await loadBoardRow(boardId);
    assertScopeMatch(scopeProjectId, board.project_id, 'Project scope does not match board project id');

    const assetRows = await dbQuery<BoardAssetRow>(
      `
SELECT
  id,
  item_id,
  board_id,
  project_id,
  storage_path,
  original_name,
  mime_type,
  file_size_bytes,
  created_at,
  updated_at
FROM board_assets
WHERE board_id = ${sqlString(boardId)};
`
    );

    await dbExec(
      `
DELETE FROM board_queries
WHERE item_id IN (
  SELECT id FROM board_items WHERE board_id = ${sqlString(boardId)}
);

DELETE FROM board_assets WHERE board_id = ${sqlString(boardId)};
DELETE FROM board_items WHERE board_id = ${sqlString(boardId)};
DELETE FROM boards WHERE id = ${sqlString(boardId)};
`
    );

    for (const asset of assetRows) {
      await unlinkIfPresent(asset.storage_path);
    }

    await syncProjectBoardCount(board.project_id);
  });
}

export async function listBoardItems(
  boardIdInput: string,
  scopeProjectId: string | null
): Promise<BoardItemRecord[]> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const boardId = normalizeId(boardIdInput, 'Board id');
    const board = await loadBoardRow(boardId);
    assertScopeMatch(scopeProjectId, board.project_id, 'Project scope does not match board project id');

    const rows = await dbQuery<BoardItemRow>(
      `
SELECT
  id,
  board_id,
  item_type,
  title,
  position_x,
  position_y,
  width,
  height,
  payload_json,
  render_config_json,
  created_at,
  updated_at
FROM board_items
WHERE board_id = ${sqlString(boardId)}
ORDER BY position_y ASC, position_x ASC, created_at ASC, id ASC;
`
    );
    return rows.map(toBoardItemRecord);
  });
}

export async function createBoardItem(
  boardIdInput: string,
  payload: {
    item_type: string;
    title?: string | null;
    payload: JsonMap;
    render_config?: JsonMap | null;
    position_x?: number;
    position_y?: number;
    width?: number;
    height?: number;
  },
  scopeProjectId: string | null
): Promise<BoardItemRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const boardId = normalizeId(boardIdInput, 'Board id');
    const board = await loadBoardRow(boardId);
    assertScopeMatch(scopeProjectId, board.project_id, 'Project scope does not match board project id');

    const itemType = payload.item_type as BoardItemType;
    if (!BOARD_ITEM_TYPES.has(itemType)) {
      throw new StoreHttpError(400, 'Invalid item_type');
    }

    assertJsonObject(payload.payload, 'payload');
    if (payload.render_config !== undefined) {
      assertJsonObject(payload.render_config, 'render_config', { optional: true, nullable: true });
    }

    const itemId = randomUUID();
    const now = nowIso();
    const positionX = toInteger(payload.position_x, 0);
    const positionY = toInteger(payload.position_y, 0);
    const width = Math.max(1, toInteger(payload.width, 1));
    const height = Math.max(1, toInteger(payload.height, 1));

    await dbExec(
      `
INSERT INTO board_items (
  id,
  board_id,
  item_type,
  title,
  position_x,
  position_y,
  width,
  height,
  payload_json,
  render_config_json,
  created_at,
  updated_at
) VALUES (
  ${sqlString(itemId)},
  ${sqlString(boardId)},
  ${sqlString(itemType)},
  ${sqlString(payload.title?.trim() || null)},
  ${positionX},
  ${positionY},
  ${width},
  ${height},
  ${sqlString(JSON.stringify(payload.payload))},
  ${sqlString(payload.render_config ? JSON.stringify(payload.render_config) : null)},
  ${sqlString(now)},
  ${sqlString(now)}
);
`
    );

    await touchBoard(boardId);
    return toBoardItemRecord(await loadItemRow(itemId));
  });
}

export async function updateBoardItem(
  itemIdInput: string,
  patch: {
    title?: string | null;
    payload?: JsonMap;
    render_config?: JsonMap | null;
  },
  scopeProjectId: string | null
): Promise<BoardItemRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const itemId = normalizeId(itemIdInput, 'Item id');
    const itemScope = await loadItemScope(itemId);
    assertScopeMatch(scopeProjectId, itemScope.project_id, 'Project scope does not match item project id');

    if (patch.payload !== undefined) {
      assertJsonObject(patch.payload, 'payload');
    }
    if (patch.render_config !== undefined) {
      assertJsonObject(patch.render_config, 'render_config', { optional: true, nullable: true });
    }

    const updates: string[] = [];
    if (patch.title !== undefined) {
      updates.push(`title = ${sqlString(patch.title?.trim() || null)}`);
    }
    if (patch.payload !== undefined) {
      updates.push(`payload_json = ${sqlString(JSON.stringify(patch.payload))}`);
    }
    if (patch.render_config !== undefined) {
      updates.push(
        `render_config_json = ${sqlString(patch.render_config ? JSON.stringify(patch.render_config) : null)}`
      );
    }

    if (updates.length > 0) {
      updates.push(`updated_at = ${sqlString(nowIso())}`);

      await dbExec(
        `
UPDATE board_items
SET ${updates.join(', ')}
WHERE id = ${sqlString(itemId)};
`
      );

      await touchBoard(itemScope.board_id);
    }

    return toBoardItemRecord(await loadItemRow(itemId));
  });
}

export async function deleteBoardItem(itemIdInput: string, scopeProjectId: string | null): Promise<void> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const itemId = normalizeId(itemIdInput, 'Item id');
    const itemScope = await loadItemScope(itemId);
    assertScopeMatch(scopeProjectId, itemScope.project_id, 'Project scope does not match item project id');
    const assetRows = await listBoardAssetsByItem(itemId);

    await dbExec(
      `
DELETE FROM board_queries WHERE item_id = ${sqlString(itemId)};
DELETE FROM board_assets WHERE item_id = ${sqlString(itemId)};
DELETE FROM board_items WHERE id = ${sqlString(itemId)};
`
    );
    for (const asset of assetRows) {
      await unlinkIfPresent(asset.storage_path);
    }
    await touchBoard(itemScope.board_id);
  });
}

export async function updateBoardItemPosition(
  itemIdInput: string,
  payload: {
    position_x: number;
    position_y: number;
    width: number;
    height: number;
  },
  scopeProjectId: string | null
): Promise<BoardItemRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const itemId = normalizeId(itemIdInput, 'Item id');
    const itemScope = await loadItemScope(itemId);
    assertScopeMatch(scopeProjectId, itemScope.project_id, 'Project scope does not match item project id');

    const positionX = toInteger(payload.position_x, 0);
    const positionY = toInteger(payload.position_y, 0);
    const width = Math.max(1, toInteger(payload.width, 1));
    const height = Math.max(1, toInteger(payload.height, 1));

    await dbExec(
      `
UPDATE board_items
SET
  position_x = ${positionX},
  position_y = ${positionY},
  width = ${width},
  height = ${height},
  updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(itemId)};
`
    );
    await touchBoard(itemScope.board_id);
    return toBoardItemRecord(await loadItemRow(itemId));
  });
}

export async function uploadBoardAsset(
  itemIdInput: string,
  payload: {
    file_name: string;
    mime_type?: string | null;
    content: Uint8Array;
  },
  scopeProjectId: string | null
): Promise<BoardAssetUploadRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const itemId = normalizeId(itemIdInput, 'Item id');
    const itemScope = await loadItemScope(itemId);
    assertScopeMatch(scopeProjectId, itemScope.project_id, 'Project scope does not match item project id');

    const contentBytes = payload.content.byteLength;
    if (contentBytes <= 0) {
      throw new StoreHttpError(400, 'Uploaded file is empty');
    }
    if (contentBytes > MAX_BOARD_ASSET_BYTES) {
      throw new StoreHttpError(413, `Uploaded file exceeds ${MAX_BOARD_ASSET_BYTES} bytes`);
    }

    const fileName = normalizeAssetFileName(payload.file_name);
    const mimeType = normalizeAssetMimeType(payload.mime_type);
    const assetId = randomUUID();
    const now = nowIso();
    const assetRoot = resolveBoardAssetsRootDir();
    const assetDir = join(assetRoot, itemScope.project_id, itemScope.board_id, itemId);
    await mkdir(assetDir, { recursive: true });
    const storagePath = join(assetDir, `${assetId}-${fileName}`);

    await writeFile(storagePath, payload.content);
    try {
      await dbExec(
        `
INSERT INTO board_assets (
  id,
  item_id,
  board_id,
  project_id,
  storage_path,
  original_name,
  mime_type,
  file_size_bytes,
  created_at,
  updated_at
) VALUES (
  ${sqlString(assetId)},
  ${sqlString(itemId)},
  ${sqlString(itemScope.board_id)},
  ${sqlString(itemScope.project_id)},
  ${sqlString(storagePath)},
  ${sqlString(fileName)},
  ${sqlString(mimeType)},
  ${contentBytes},
  ${sqlString(now)},
  ${sqlString(now)}
);
`
      );
    } catch (error) {
      await unlinkIfPresent(storagePath);
      throw error;
    }

    await touchBoard(itemScope.board_id);
    return {
      asset_id: assetId,
      file_name: fileName,
      file_size: contentBytes,
      mime_type: mimeType,
      url: `/api/v1/boards/assets/${assetId}/download`,
    };
  });
}

export async function downloadBoardAsset(
  assetIdInput: string,
  scopeProjectId: string | null
): Promise<BoardAssetDownloadRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();
    const assetId = normalizeId(assetIdInput, 'Asset id');
    const asset = await loadBoardAssetRow(assetId);
    assertScopeMatch(scopeProjectId, asset.project_id, 'Project scope does not match asset project id');

    let content: Uint8Array;
    try {
      content = await readFile(asset.storage_path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StoreHttpError(404, 'Asset file missing on disk');
      }
      throw error;
    }

    return {
      filename: asset.original_name,
      mime_type: normalizeAssetMimeType(asset.mime_type),
      content,
    };
  });
}

export async function deleteBoardAsset(
  assetIdInput: string,
  scopeProjectId: string | null
): Promise<void> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();
    const assetId = normalizeId(assetIdInput, 'Asset id');
    const asset = await loadBoardAssetRow(assetId);
    assertScopeMatch(scopeProjectId, asset.project_id, 'Project scope does not match asset project id');

    await dbExec(`DELETE FROM board_assets WHERE id = ${sqlString(asset.id)};`);
    await unlinkIfPresent(asset.storage_path);
    await touchBoard(asset.board_id);
  });
}

export async function createBoardQuery(
  itemIdInput: string,
  payload: {
    query_text: string;
    data_source_tables?: string[];
    refresh_mode?: string;
    refresh_interval_seconds?: number | null;
  },
  scopeProjectId: string | null
): Promise<{ query_id: string }> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const itemId = normalizeId(itemIdInput, 'Item id');
    const itemScope = await loadItemScope(itemId);
    assertScopeMatch(scopeProjectId, itemScope.project_id, 'Project scope does not match item project id');

    const queryText = sanitizeName(payload.query_text, 'query_text');
    const dataSourceTables = parseStringArray(payload.data_source_tables, 'data_source_tables');
    const refreshMode = payload.refresh_mode?.trim() || 'manual';
    const refreshInterval =
      payload.refresh_interval_seconds === undefined || payload.refresh_interval_seconds === null
        ? null
        : toInteger(payload.refresh_interval_seconds, 0);

    const existingRows = await dbQuery<{ id: string }>(
      `SELECT id FROM board_queries WHERE item_id = ${sqlString(itemId)} LIMIT 1;`
    );
    const now = nowIso();
    const queryId = existingRows[0]?.id ?? randomUUID();

    if (existingRows[0]) {
      await dbExec(
        `
UPDATE board_queries
SET
  query_text = ${sqlString(queryText)},
  data_source_tables_json = ${sqlString(JSON.stringify(dataSourceTables))},
  refresh_mode = ${sqlString(refreshMode)},
  refresh_interval_seconds = ${refreshInterval === null ? 'NULL' : refreshInterval},
  updated_at = ${sqlString(now)}
WHERE id = ${sqlString(queryId)};
`
      );
    } else {
      await dbExec(
        `
INSERT INTO board_queries (
  id,
  item_id,
  query_text,
  data_source_tables_json,
  refresh_mode,
  refresh_interval_seconds,
  last_result_json,
  last_executed_at,
  status,
  created_at,
  updated_at
) VALUES (
  ${sqlString(queryId)},
  ${sqlString(itemId)},
  ${sqlString(queryText)},
  ${sqlString(JSON.stringify(dataSourceTables))},
  ${sqlString(refreshMode)},
  ${refreshInterval === null ? 'NULL' : refreshInterval},
  NULL,
  NULL,
  'idle',
  ${sqlString(now)},
  ${sqlString(now)}
);
`
      );
    }

    await touchBoard(itemScope.board_id);
    return { query_id: queryId };
  });
}

async function loadQueryByItem(itemId: string): Promise<QueryRow> {
  const rows = await dbQuery<QueryRow>(
    `
SELECT
  id,
  item_id,
  query_text,
  data_source_tables_json,
  refresh_mode,
  refresh_interval_seconds,
  last_result_json
FROM board_queries
WHERE item_id = ${sqlString(itemId)}
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Query not found for this item');
  }
  return row;
}

function normalizeQueryRows(rows: Array<Record<string, unknown>>): QueryResultRecord {
  const columns = rows.length === 0 ? [] : Object.keys(rows[0] ?? {});
  return {
    columns,
    data: rows,
    row_count: rows.length,
    executed_at: nowIso(),
  };
}

export async function executeBoardQueryByItem(
  itemIdInput: string,
  scopeProjectId: string | null
): Promise<QueryResultRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const itemId = normalizeId(itemIdInput, 'Item id');
    const itemScope = await loadItemScope(itemId);
    assertScopeMatch(scopeProjectId, itemScope.project_id, 'Project scope does not match item project id');

    const query = await loadQueryByItem(itemId);
    const resultRows = await dbQuery<Record<string, unknown>>(query.query_text);
    const result = normalizeQueryRows(resultRows);

    await dbExec(
      `
UPDATE board_queries
SET
  last_result_json = ${sqlString(JSON.stringify(result))},
  last_executed_at = ${sqlString(result.executed_at)},
  status = 'success',
  updated_at = ${sqlString(result.executed_at)}
WHERE id = ${sqlString(query.id)};
`
    );

    await touchBoard(itemScope.board_id);
    return result;
  });
}

export async function getCachedBoardQueryResult(
  itemIdInput: string,
  scopeProjectId: string | null
): Promise<QueryResultRecord> {
  return withBoardsLock(async () => {
    await ensureBoardsSchema();

    const itemId = normalizeId(itemIdInput, 'Item id');
    const itemScope = await loadItemScope(itemId);
    assertScopeMatch(scopeProjectId, itemScope.project_id, 'Project scope does not match item project id');

    const query = await loadQueryByItem(itemId);
    if (!query.last_result_json) {
      throw new StoreHttpError(404, 'No cached result available');
    }

    try {
      const parsed = JSON.parse(query.last_result_json) as Partial<QueryResultRecord>;
      return {
        columns: Array.isArray(parsed.columns) ? parsed.columns.map(String) : [],
        data: Array.isArray(parsed.data) ? (parsed.data as Array<Record<string, unknown>>) : [],
        row_count: typeof parsed.row_count === 'number' ? parsed.row_count : 0,
        executed_at: typeof parsed.executed_at === 'string' ? parsed.executed_at : '',
      };
    } catch (_error) {
      throw new StoreHttpError(500, 'Cached query result is corrupted');
    }
  });
}

export function resetBoardsSchemaForTests(): void {
  runtimeState.schemaReady = false;
}
