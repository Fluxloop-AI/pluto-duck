import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-phase-b-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_phase_b.duckdb');

const storeModuleUrl = new URL('../store.ts', import.meta.url);
const storeModule = await import(storeModuleUrl.href);
const {
  createProject,
  deleteProjectPermanently,
  getProject,
  getSettings,
  getStoreHealth,
  resetDatabaseForTests,
  resetProjectData,
  updateProjectSettings,
  updateSettings,
} = storeModule;

const boardsModuleUrl = new URL('../boards.ts', import.meta.url);
const boardsModule = await import(boardsModuleUrl.href);
const {
  createBoard,
  createBoardItem,
  createBoardQuery,
  deleteBoardAsset,
  downloadBoardAsset,
  executeBoardQueryByItem,
  getBoardDetail,
  getCachedBoardQueryResult,
  listBoards,
  resetBoardsSchemaForTests,
  uploadBoardAsset,
} = boardsModule;

const scopeModuleUrl = new URL('../scope.ts', import.meta.url);
const scopeModule = await import(scopeModuleUrl.href);
const { resolveProjectScope, resolveRouteProjectId } = scopeModule;

test.beforeEach(async () => {
  await resetDatabaseForTests();
  resetBoardsSchemaForTests();
});

test.after(async () => {
  await resetDatabaseForTests();
  await rm(tempRoot, { recursive: true, force: true });
});

test('Scope helper rules are consistent for query/header/path project IDs', async () => {
  assert.throws(
    () =>
      resolveProjectScope(
        new Request('http://localhost/api/v1/settings?project_id=project-a', {
          headers: {
            'X-Project-ID': 'project-b',
          },
        })
      ),
    /project_id query and X-Project-ID header do not match/
  );

  const resolved = resolveProjectScope(
    new Request('http://localhost/api/v1/settings?project_id=project-a')
  );
  assert.equal(resolved.project_id, 'project-a');
  assert.equal(resolved.source, 'query');

  assert.throws(
    () =>
      resolveRouteProjectId(
        new Request('http://localhost/api/v1/boards/projects/project-a/boards', {
          headers: {
            'X-Project-ID': 'project-b',
          },
        }),
        'project-a'
      ),
    /Project scope does not match route project id/
  );
});

test('Phase B store persists settings/projects in DuckDB and masks API key', async () => {
  const defaultSettings = await getSettings();
  assert.equal(defaultSettings.llm_provider, 'openai');
  assert.ok(defaultSettings.default_project_id);

  const created = await createProject({
    name: 'Phase B Project',
    description: 'integration',
  });
  assert.equal(created.name, 'Phase B Project');

  await updateSettings({
    language: 'ko',
    llm_api_key: 'sk-1234567890',
  });

  const refreshedSettings = await getSettings();
  assert.equal(refreshedSettings.language, 'ko');
  assert.equal(refreshedSettings.llm_api_key, 'sk-1234***7890');
});

test('Project settings patch and dangerous operations are persisted in DuckDB', async () => {
  const created = await createProject({
    name: 'Operations Project',
  });

  await updateProjectSettings(created.id, {
    ui_state: {
      active_tab_id: 'chat-1',
    },
    preferences: {
      font_size: 14,
    },
  });

  const updated = await getProject(created.id);
  assert.deepEqual(updated.settings.ui_state, { active_tab_id: 'chat-1' });
  assert.deepEqual(updated.settings.preferences, { font_size: 14 });

  const resetResult = await resetProjectData(created.id, 'reset-operations-project');
  assert.equal(resetResult.success, true);
  const resetProject = await getProject(created.id);
  assert.deepEqual(resetProject.settings, {});
});

test('Delete-permanently confirmation and DB readiness are enforced', async () => {
  const projectA = await createProject({ name: 'Delete Me' });
  const projectB = await createProject({ name: 'Keep Me' });

  await assert.rejects(
    () => deleteProjectPermanently(projectA.id, 'delete-wrong-permanently'),
    /Confirmation phrase mismatch/
  );

  const result = await deleteProjectPermanently(projectA.id, 'delete-delete-me-permanently');
  assert.equal(result.success, true);

  const remaining = await getProject(projectB.id);
  assert.equal(remaining.name, 'Keep Me');

  const health = await getStoreHealth();
  assert.equal(health.ready, true);
  assert.equal(health.schema_version, 1);
  assert.ok(health.db_path.endsWith('.duckdb'));
});

test('Boards store supports create-item-query flow with scoped access', async () => {
  const settings = await getSettings();
  assert.ok(settings.default_project_id);
  const projectId = settings.default_project_id as string;

  const board = await createBoard(projectId, {
    name: 'KPI Board',
  });
  assert.equal(board.project_id, projectId);

  const listedBoards = await listBoards(projectId);
  assert.equal(listedBoards.length, 1);
  assert.equal(listedBoards[0]?.id, board.id);

  await assert.rejects(
    () => getBoardDetail(board.id, 'mismatch-project'),
    /Project scope does not match board project id/
  );

  const item = await createBoardItem(
    board.id,
    {
      item_type: 'table',
      title: 'Daily KPI',
      payload: {
        table: 'metrics',
      },
    },
    projectId
  );
  assert.equal(item.board_id, board.id);

  const createdQuery = await createBoardQuery(
    item.id,
    {
      query_text: 'SELECT 1 AS n',
    },
    projectId
  );
  assert.ok(createdQuery.query_id);

  const executed = await executeBoardQueryByItem(item.id, projectId);
  assert.equal(executed.row_count, 1);
  assert.deepEqual(executed.columns, ['n']);

  const cachedResult = await getCachedBoardQueryResult(item.id, projectId);
  assert.equal(cachedResult.row_count, 1);

  const detail = await getBoardDetail(board.id, projectId);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0]?.id, item.id);
});

test('Boards asset upload/download/delete flow works with project scope', async () => {
  const settings = await getSettings();
  assert.ok(settings.default_project_id);
  const projectId = settings.default_project_id as string;

  const board = await createBoard(projectId, {
    name: 'Asset Board',
  });
  const item = await createBoardItem(
    board.id,
    {
      item_type: 'image',
      title: 'Asset Item',
      payload: {},
    },
    projectId
  );

  const uploaded = await uploadBoardAsset(
    item.id,
    {
      file_name: 'sample.csv',
      mime_type: 'text/csv',
      content: new Uint8Array(Buffer.from('a,b\n1,2\n', 'utf8')),
    },
    projectId
  );
  assert.ok(uploaded.asset_id.length > 0);
  assert.equal(uploaded.file_name, 'sample.csv');
  assert.equal(uploaded.mime_type, 'text/csv');
  assert.equal(uploaded.url, `/api/v1/boards/assets/${uploaded.asset_id}/download`);

  const downloaded = await downloadBoardAsset(uploaded.asset_id, projectId);
  assert.equal(downloaded.filename, 'sample.csv');
  assert.equal(downloaded.mime_type, 'text/csv');
  assert.equal(Buffer.from(downloaded.content).toString('utf8'), 'a,b\n1,2\n');

  await assert.rejects(
    () => downloadBoardAsset(uploaded.asset_id, 'mismatch-project'),
    /Project scope does not match asset project id/
  );

  await deleteBoardAsset(uploaded.asset_id, projectId);
  await assert.rejects(() => downloadBoardAsset(uploaded.asset_id, projectId), /Asset not found/);
});
