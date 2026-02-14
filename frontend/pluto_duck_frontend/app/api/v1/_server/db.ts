import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DUCKDB_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const SCHEMA_VERSION = 1;

interface DbRuntimeState {
  queue: Promise<void>;
  initialized: boolean;
}

const globalDbState = globalThis as typeof globalThis & {
  __plutoDuckDbState?: DbRuntimeState;
};

const dbState: DbRuntimeState = globalDbState.__plutoDuckDbState ?? {
  queue: Promise.resolve(),
  initialized: false,
};

if (!globalDbState.__plutoDuckDbState) {
  globalDbState.__plutoDuckDbState = dbState;
}

export class DbError extends Error {
  detail: string;

  constructor(detail: string, cause?: unknown) {
    super(detail);
    this.name = 'DbError';
    this.detail = detail;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function resolveDatabasePath(): string {
  const explicitDbPath = process.env.PLUTODUCK_DB_PATH?.trim();
  if (explicitDbPath) {
    return resolve(explicitDbPath);
  }

  const dataRoot = process.env.PLUTODUCK_DATA_DIR__ROOT?.trim();
  if (dataRoot) {
    return resolve(dataRoot, 'warehouse', 'pluto_duck.duckdb');
  }

  return resolve(process.cwd(), '.pluto-duck-data', 'pluto_duck.duckdb');
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = dbState.queue.then(operation, operation);
  dbState.queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function normalizeDuckDbError(error: unknown): string {
  if (error instanceof Error) {
    const withStderr = error as Error & { stderr?: string | Buffer };
    const stderr = withStderr.stderr?.toString().trim();
    if (stderr) {
      return stderr;
    }
    return error.message;
  }
  return 'Unknown DuckDB error';
}

function isLockConflict(detail: string): boolean {
  return detail.includes('Could not set lock on file') || detail.includes('Conflicting lock is held');
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

async function runDuckDb(sql: string, jsonOutput: boolean): Promise<string> {
  const dbPath = resolveDatabasePath();
  const args = jsonOutput ? ['-json', dbPath, '-c', sql] : [dbPath, '-c', sql];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { stdout } = await execFileAsync('duckdb', args, {
        maxBuffer: DUCKDB_MAX_BUFFER_BYTES,
      });
      return stdout.trim();
    } catch (error) {
      const detail = normalizeDuckDbError(error);
      if (attempt < 4 && isLockConflict(detail)) {
        await sleep(50 * (attempt + 1));
        continue;
      }
      throw new DbError(detail, error);
    }
  }

  throw new DbError('DuckDB command failed after retries');
}

async function ensureInitializedLocked(): Promise<void> {
  if (dbState.initialized) {
    return;
  }

  const dbPath = resolveDatabasePath();
  await mkdir(dirname(dbPath), { recursive: true });

  await runDuckDb(
    `
CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at VARCHAR NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  description VARCHAR,
  created_at VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL,
  settings_json VARCHAR NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  board_count INTEGER NOT NULL DEFAULT 0,
  conversation_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  llm_provider VARCHAR NOT NULL,
  llm_api_key VARCHAR,
  llm_model VARCHAR,
  data_sources_json VARCHAR,
  dbt_project_json VARCHAR,
  ui_preferences_json VARCHAR NOT NULL,
  default_project_id VARCHAR,
  user_name VARCHAR,
  language VARCHAR NOT NULL,
  updated_at VARCHAR NOT NULL
);
`,
    false
  );

  const now = new Date().toISOString();
  await runDuckDb(
    `
INSERT INTO schema_meta (id, version, updated_at)
SELECT 1, ${SCHEMA_VERSION}, '${now}'
WHERE NOT EXISTS (SELECT 1 FROM schema_meta WHERE id = 1);
`,
    false
  );

  const projectCountRows = await runDuckDb(
    'SELECT COUNT(*)::INTEGER AS count FROM projects;',
    true
  );
  const projectCount = parseRows<{ count: number }>(projectCountRows)[0]?.count ?? 0;

  let defaultProjectId: string | null = null;
  if (projectCount === 0) {
    defaultProjectId = randomUUID();
    await runDuckDb(
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
  '${defaultProjectId}',
  'Default Project',
  'Default workspace',
  '${now}',
  '${now}',
  '{}',
  TRUE,
  0,
  0
);
`,
      false
    );
  } else {
    const firstProjectRows = await runDuckDb(
      'SELECT id FROM projects ORDER BY created_at ASC, id ASC LIMIT 1;',
      true
    );
    defaultProjectId = parseRows<{ id: string }>(firstProjectRows)[0]?.id ?? null;
  }

  const settingsCountRows = await runDuckDb(
    'SELECT COUNT(*)::INTEGER AS count FROM settings;',
    true
  );
  const settingsCount = parseRows<{ count: number }>(settingsCountRows)[0]?.count ?? 0;

  if (settingsCount === 0) {
    await runDuckDb(
      `
INSERT INTO settings (
  id,
  llm_provider,
  llm_api_key,
  llm_model,
  data_sources_json,
  dbt_project_json,
  ui_preferences_json,
  default_project_id,
  user_name,
  language,
  updated_at
) VALUES (
  1,
  'openai',
  NULL,
  'gpt-5-mini',
  NULL,
  NULL,
  '{"theme":"dark"}',
  ${sqlString(defaultProjectId)},
  NULL,
  'en',
  '${now}'
);
`,
      false
    );
  }

  dbState.initialized = true;
}

function parseRows<T>(rawOutput: string): T[] {
  if (rawOutput.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawOutput);
    if (!Array.isArray(parsed)) {
      throw new Error('DuckDB did not return a JSON array');
    }
    return parsed as T[];
  } catch (error) {
    throw new DbError('Failed to parse DuckDB JSON output', error);
  }
}

export function sqlString(value: string | null): string {
  if (value === null) {
    return 'NULL';
  }
  return `'${value.replaceAll("'", "''")}'`;
}

export async function dbExec(sql: string): Promise<void> {
  await enqueue(async () => {
    await ensureInitializedLocked();
    await runDuckDb(sql, false);
  });
}

export async function dbQuery<T>(sql: string): Promise<T[]> {
  return enqueue(async () => {
    await ensureInitializedLocked();
    const output = await runDuckDb(sql, true);
    return parseRows<T>(output);
  });
}

export async function databaseReadiness(): Promise<{
  ready: true;
  db_path: string;
  schema_version: number;
}> {
  return enqueue(async () => {
    await ensureInitializedLocked();
    const versionOutput = await runDuckDb(
      'SELECT version::INTEGER AS version FROM schema_meta WHERE id = 1 LIMIT 1;',
      true
    );
    const versionRows = parseRows<{ version: number }>(versionOutput);
    return {
      ready: true as const,
      db_path: resolveDatabasePath(),
      schema_version: versionRows[0]?.version ?? SCHEMA_VERSION,
    };
  });
}

export async function resetDatabaseForTests(): Promise<void> {
  await enqueue(async () => {
    const dbPath = resolveDatabasePath();
    dbState.initialized = false;
    await rm(dbPath, { force: true });
  });
}
