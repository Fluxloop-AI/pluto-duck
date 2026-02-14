import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-phase-c-source-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_phase_c_source.duckdb');

const storeModule = await import(new URL('../store.ts', import.meta.url).href);
const { getSettings, resetDatabaseForTests } = storeModule;

const sourceModule = await import(new URL('../source.ts', import.meta.url).href);
const {
  cacheSourceTable,
  createFolderSourceRecord,
  createSourceConnection,
  deleteFolderSourceRecord,
  deleteSourceConnection,
  getSourceDetail,
  listCachedTables,
  listFolderFilesForSource,
  listFolderSources,
  listSourceTables,
  listSources,
  previewCachedTable,
  refreshCachedTable,
  resetSourceSchemaForTests,
  scanFolderSourceFiles,
} = sourceModule;

test.beforeEach(async () => {
  await resetDatabaseForTests();
  resetSourceSchemaForTests();
});

test.after(async () => {
  await resetDatabaseForTests();
  await rm(tempRoot, { recursive: true, force: true });
});

test('Source connection lifecycle supports table listing/cache/preview refresh', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const created = await createSourceConnection(
    {
      name: 'analytics_pg',
      source_type: 'postgres',
      source_config: {
        dsn: 'postgresql://example',
      },
      description: 'analytics source',
    },
    projectId
  );
  assert.equal(created.name, 'analytics_pg');
  assert.equal(created.status, 'attached');

  const listedSources = await listSources(projectId);
  assert.equal(listedSources.length, 1);
  assert.equal(listedSources[0]?.name, 'analytics_pg');

  const tables = await listSourceTables('analytics_pg', projectId);
  assert.ok(tables.length > 0);
  assert.equal(tables[0]?.mode, 'live');

  const targetTable = tables[0]?.table_name as string;
  const cached = await cacheSourceTable(
    {
      source_name: 'analytics_pg',
      table_name: targetTable,
      local_name: 'analytics_snapshot',
      expires_hours: 24,
    },
    projectId
  );
  assert.equal(cached.local_table, 'analytics_snapshot');
  assert.ok((cached.row_count ?? 0) > 0);

  const cachedList = await listCachedTables(projectId);
  assert.equal(cachedList.length, 1);
  assert.equal(cachedList[0]?.source_name, 'analytics_pg');

  const preview = await previewCachedTable('analytics_snapshot', projectId, 10);
  assert.ok(preview.columns.length > 0);
  assert.ok(preview.rows.length > 0);
  assert.ok((preview.total_rows ?? 0) >= preview.rows.length);

  const detail = await getSourceDetail('analytics_pg', projectId);
  assert.equal(detail.cached_tables.length, 1);

  const refreshed = await refreshCachedTable('analytics_snapshot', projectId);
  assert.ok((refreshed.row_count ?? 0) > 0);

  await deleteSourceConnection('analytics_pg', projectId);
  const afterDeleteSources = await listSources(projectId);
  const afterDeleteCache = await listCachedTables(projectId);
  assert.equal(afterDeleteSources.length, 0);
  assert.equal(afterDeleteCache.length, 0);
});

test('Folder source listing and scan detect new/changed/deleted files', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const folderPath = join(tempRoot, 'folder-source-fixtures');
  await mkdir(join(folderPath, 'nested'), { recursive: true });
  await writeFile(join(folderPath, 'customers.csv'), 'id,name\n1,Alice\n');
  await writeFile(join(folderPath, 'nested', 'events.parquet'), 'PARQUET_PLACEHOLDER');

  const folder = await createFolderSourceRecord(
    {
      name: 'local_data',
      path: folderPath,
      allowed_types: 'both',
    },
    projectId
  );

  const listedFolders = await listFolderSources(projectId);
  assert.equal(listedFolders.length, 1);
  assert.equal(listedFolders[0]?.id, folder.id);

  const filesBeforeScan = await listFolderFilesForSource(folder.id, projectId, 100);
  assert.equal(filesBeforeScan.length, 2);

  const scan1 = await scanFolderSourceFiles(folder.id, projectId);
  assert.equal(scan1.new_files, 2);
  assert.equal(scan1.changed_files, 0);
  assert.equal(scan1.deleted_files, 0);

  await writeFile(join(folderPath, 'customers.csv'), 'id,name\n1,Alice\n2,Bob\n');
  await unlink(join(folderPath, 'nested', 'events.parquet'));
  await writeFile(join(folderPath, 'sales.csv'), 'id,amount\n1,120\n');

  const scan2 = await scanFolderSourceFiles(folder.id, projectId);
  assert.equal(scan2.new_files, 1);
  assert.equal(scan2.changed_files, 1);
  assert.equal(scan2.deleted_files, 1);

  await deleteFolderSourceRecord(folder.id, projectId);
  const afterDelete = await listFolderSources(projectId);
  assert.equal(afterDelete.length, 0);
});
