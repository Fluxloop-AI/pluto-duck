import { randomUUID } from 'node:crypto';

import { databaseReadiness, dbExec, dbQuery, resetDatabaseForTests, sqlString } from './db.ts';

type JsonMap = Record<string, unknown>;
type ConfirmationOperation = 'reset' | 'delete';

export class StoreHttpError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.name = 'StoreHttpError';
  }
}

interface StoreRuntimeState {
  queue: Promise<void>;
}

const globalStoreState = globalThis as typeof globalThis & {
  __plutoDuckStoreState?: StoreRuntimeState;
};

const runtimeState: StoreRuntimeState = globalStoreState.__plutoDuckStoreState ?? {
  queue: Promise.resolve(),
};

if (!globalStoreState.__plutoDuckStoreState) {
  globalStoreState.__plutoDuckStoreState = runtimeState;
}

function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = runtimeState.queue.then(operation, operation);
  runtimeState.queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  settings: JsonMap;
  is_default: boolean;
  board_count: number;
  conversation_count: number;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  settings_json: string;
  is_default: boolean;
  board_count: number;
  conversation_count: number;
}

interface StoredSettingsRow {
  llm_provider: string;
  llm_api_key: string | null;
  llm_model: string | null;
  data_sources_json: string | null;
  dbt_project_json: string | null;
  ui_preferences_json: string;
  default_project_id: string | null;
  user_name: string | null;
  language: string;
}

export interface SettingsRecord {
  llm_provider: string;
  llm_api_key: string | null;
  llm_model: string | null;
  data_sources: unknown;
  dbt_project: unknown;
  ui_preferences: {
    theme: string;
  };
  default_project_id: string | null;
  user_name: string | null;
  language: string;
}

export interface UpdateSettingsPayload {
  llm_api_key?: string | null;
  llm_model?: string | null;
  llm_provider?: string | null;
  user_name?: string | null;
  language?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeProjectName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new StoreHttpError(400, 'Project name is required');
  }
  return normalized;
}

function assertJsonMap(value: unknown, fieldName: string): asserts value is JsonMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoreHttpError(400, `${fieldName} must be an object`);
  }
}

function parseJsonValue(raw: string | null, fallback: unknown): unknown {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function parseJsonMap(raw: string | null): JsonMap {
  const parsed = parseJsonValue(raw, {});
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as JsonMap;
  }
  return {};
}

function toProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    settings: parseJsonMap(row.settings_json),
    is_default: row.is_default,
    board_count: Number(row.board_count),
    conversation_count: Number(row.conversation_count),
  };
}

async function loadProjectRow(projectId: string): Promise<ProjectRow> {
  const rows = await dbQuery<ProjectRow>(
    `
SELECT
  id,
  name,
  description,
  created_at,
  updated_at,
  settings_json,
  is_default,
  board_count,
  conversation_count
FROM projects
WHERE id = ${sqlString(projectId)}
LIMIT 1;
`
  );

  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(404, 'Project not found');
  }
  return row;
}

async function loadSettingsRow(): Promise<StoredSettingsRow> {
  const rows = await dbQuery<StoredSettingsRow>(
    `
SELECT
  llm_provider,
  llm_api_key,
  llm_model,
  data_sources_json,
  dbt_project_json,
  ui_preferences_json,
  default_project_id,
  user_name,
  language
FROM settings
WHERE id = 1
LIMIT 1;
`
  );
  const row = rows[0];
  if (!row) {
    throw new StoreHttpError(500, 'Settings row not initialized');
  }
  return row;
}

function toProjectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

function expectedConfirmationPhrase(projectName: string, operation: ConfirmationOperation): string {
  const slug = toProjectSlug(projectName);
  if (operation === 'reset') {
    return `reset-${slug}`;
  }
  return `delete-${slug}-permanently`;
}

function assertConfirmation(project: ProjectRecord, operation: ConfirmationOperation, confirmation: string): void {
  const expected = expectedConfirmationPhrase(project.name, operation);
  if (confirmation !== expected) {
    throw new StoreHttpError(400, `Confirmation phrase mismatch. Expected '${expected}'.`);
  }
}

async function ensureDefaultProjectId(): Promise<string | null> {
  const settings = await loadSettingsRow();
  if (settings.default_project_id) {
    const existing = await dbQuery<{ id: string }>(
      `SELECT id FROM projects WHERE id = ${sqlString(settings.default_project_id)} LIMIT 1;`
    );
    if (existing[0]) {
      return settings.default_project_id;
    }
  }

  const defaultProjectRows = await dbQuery<{ id: string }>(
    'SELECT id FROM projects WHERE is_default = TRUE ORDER BY created_at ASC, id ASC LIMIT 1;'
  );
  const defaultProjectId = defaultProjectRows[0]?.id ?? null;
  if (defaultProjectId) {
    await dbExec(
      `
UPDATE settings
SET default_project_id = ${sqlString(defaultProjectId)}, updated_at = ${sqlString(nowIso())}
WHERE id = 1;
`
    );
    return defaultProjectId;
  }

  const firstProjectRows = await dbQuery<{ id: string }>(
    'SELECT id FROM projects ORDER BY created_at ASC, id ASC LIMIT 1;'
  );
  const firstProjectId = firstProjectRows[0]?.id ?? null;
  if (!firstProjectId) {
    await dbExec(
      `
UPDATE settings
SET default_project_id = NULL, updated_at = ${sqlString(nowIso())}
WHERE id = 1;
`
    );
    return null;
  }

  await dbExec(
    `
UPDATE projects
SET is_default = (id = ${sqlString(firstProjectId)}),
    updated_at = ${sqlString(nowIso())};

UPDATE settings
SET default_project_id = ${sqlString(firstProjectId)}, updated_at = ${sqlString(nowIso())}
WHERE id = 1;
`
  );
  return firstProjectId;
}

function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) {
    return null;
  }
  if (apiKey.length <= 10) {
    return 'sk-***';
  }
  return `${apiKey.slice(0, 7)}***${apiKey.slice(-4)}`;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return withStoreLock(async () => {
    const rows = await dbQuery<ProjectRow>(
      `
SELECT
  id,
  name,
  description,
  created_at,
  updated_at,
  settings_json,
  is_default,
  board_count,
  conversation_count
FROM projects
ORDER BY created_at ASC, id ASC;
`
    );
    return rows.map(toProjectRecord);
  });
}

export async function getProject(projectId: string): Promise<ProjectRecord> {
  return withStoreLock(async () => {
    return toProjectRecord(await loadProjectRow(projectId));
  });
}

export async function createProject(input: {
  name: string;
  description?: string | null;
}): Promise<ProjectRecord> {
  return withStoreLock(async () => {
    const now = nowIso();
    const id = randomUUID();
    const name = sanitizeProjectName(input.name);
    const description = input.description?.trim() || null;

    await dbExec(
      `
INSERT INTO projects (
  id,
  name,
  description,
  created_at,
  updated_at,
  settings_json,
  is_default,
  board_count,
  conversation_count
) VALUES (
  ${sqlString(id)},
  ${sqlString(name)},
  ${sqlString(description)},
  ${sqlString(now)},
  ${sqlString(now)},
  '{}',
  FALSE,
  0,
  0
);
`
    );

    return toProjectRecord(await loadProjectRow(id));
  });
}

export async function updateProjectSettings(
  projectId: string,
  patch: { ui_state?: JsonMap; preferences?: JsonMap }
): Promise<void> {
  return withStoreLock(async () => {
    if (patch.ui_state !== undefined) {
      assertJsonMap(patch.ui_state, 'ui_state');
    }
    if (patch.preferences !== undefined) {
      assertJsonMap(patch.preferences, 'preferences');
    }

    const project = toProjectRecord(await loadProjectRow(projectId));
    const nextSettings = { ...project.settings };

    if (patch.ui_state !== undefined) {
      nextSettings.ui_state = patch.ui_state;
    }
    if (patch.preferences !== undefined) {
      nextSettings.preferences = patch.preferences;
    }

    await dbExec(
      `
UPDATE projects
SET settings_json = ${sqlString(JSON.stringify(nextSettings))},
    updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(projectId)};
`
    );
  });
}

export async function resetProjectData(
  projectId: string,
  confirmation: string
): Promise<{ success: true; message: string }> {
  return withStoreLock(async () => {
    const project = toProjectRecord(await loadProjectRow(projectId));
    assertConfirmation(project, 'reset', confirmation);

    await dbExec(
      `
UPDATE projects
SET settings_json = '{}',
    board_count = 0,
    conversation_count = 0,
    updated_at = ${sqlString(nowIso())}
WHERE id = ${sqlString(projectId)};
`
    );

    return {
      success: true,
      message: 'Project data reset completed.',
    };
  });
}

export async function deleteProjectPermanently(
  projectId: string,
  confirmation: string
): Promise<{ success: true; message: string }> {
  return withStoreLock(async () => {
    const project = toProjectRecord(await loadProjectRow(projectId));
    assertConfirmation(project, 'delete', confirmation);

    if (project.is_default) {
      throw new StoreHttpError(409, 'Cannot delete the default project');
    }

    await dbExec(`DELETE FROM projects WHERE id = ${sqlString(projectId)};`);
    await ensureDefaultProjectId();

    return {
      success: true,
      message: 'Project deleted permanently.',
    };
  });
}

export function legacyDeleteProject(): never {
  throw new StoreHttpError(
    410,
    'DELETE /api/v1/projects/{project_id} is deprecated. Use POST /api/v1/projects/{project_id}/delete-permanently with confirmation.'
  );
}

export async function getSettings(): Promise<SettingsRecord> {
  return withStoreLock(async () => {
    const settings = await loadSettingsRow();
    const defaultProjectId = await ensureDefaultProjectId();

    const parsedUiPreferences = parseJsonValue(settings.ui_preferences_json, {
      theme: 'dark',
    });
    const uiPreferences =
      typeof parsedUiPreferences === 'object' &&
      parsedUiPreferences !== null &&
      !Array.isArray(parsedUiPreferences)
        ? (parsedUiPreferences as { theme?: string })
        : { theme: 'dark' };

    return {
      llm_provider: settings.llm_provider,
      llm_api_key: maskApiKey(settings.llm_api_key),
      llm_model: settings.llm_model,
      data_sources: parseJsonValue(settings.data_sources_json, null),
      dbt_project: parseJsonValue(settings.dbt_project_json, null),
      ui_preferences: {
        theme: uiPreferences.theme ?? 'dark',
      },
      default_project_id: defaultProjectId,
      user_name: settings.user_name,
      language: settings.language,
    };
  });
}

export async function updateSettings(payload: UpdateSettingsPayload): Promise<{
  success: true;
  message: string;
}> {
  return withStoreLock(async () => {
    const current = await loadSettingsRow();

    let llmProvider = current.llm_provider;
    if (payload.llm_provider !== undefined) {
      if (payload.llm_provider !== 'openai') {
        throw new StoreHttpError(400, "Currently only 'openai' provider is supported");
      }
      llmProvider = payload.llm_provider;
    }

    let llmApiKey = current.llm_api_key;
    if (payload.llm_api_key !== undefined) {
      if (payload.llm_api_key && !payload.llm_api_key.startsWith('sk-')) {
        throw new StoreHttpError(400, "Invalid API key format. Must start with 'sk-'");
      }
      llmApiKey = payload.llm_api_key || null;
    }

    const llmModel =
      payload.llm_model !== undefined ? payload.llm_model || null : current.llm_model;
    const userName =
      payload.user_name !== undefined ? payload.user_name?.trim() || null : current.user_name;

    let language = current.language;
    if (payload.language !== undefined) {
      if (payload.language !== 'en' && payload.language !== 'ko') {
        throw new StoreHttpError(400, "Invalid language. Must be 'en' or 'ko'");
      }
      language = payload.language;
    }

    await dbExec(
      `
UPDATE settings
SET llm_provider = ${sqlString(llmProvider)},
    llm_api_key = ${sqlString(llmApiKey)},
    llm_model = ${sqlString(llmModel)},
    user_name = ${sqlString(userName)},
    language = ${sqlString(language)},
    updated_at = ${sqlString(nowIso())}
WHERE id = 1;
`
    );

    return {
      success: true,
      message: 'Settings saved successfully',
    };
  });
}

export async function getStoreHealth(): Promise<{
  ready: true;
  db_path: string;
  schema_version: number;
}> {
  return databaseReadiness();
}

export { resetDatabaseForTests };
