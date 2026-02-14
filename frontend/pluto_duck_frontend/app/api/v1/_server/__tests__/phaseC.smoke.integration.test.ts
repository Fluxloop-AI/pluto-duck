import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-phase-c-smoke-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_phase_c_smoke.duckdb');

const storeModule = await import(new URL('../store.ts', import.meta.url).href);
const { getSettings, resetDatabaseForTests } = storeModule;

const boardsModule = await import(new URL('../boards.ts', import.meta.url).href);
const {
  createBoard,
  createBoardItem,
  createBoardQuery,
  executeBoardQueryByItem,
  getCachedBoardQueryResult,
  resetBoardsSchemaForTests,
} = boardsModule;

const sourceModule = await import(new URL('../source.ts', import.meta.url).href);
const { createSourceConnection, listSourceTables, resetSourceSchemaForTests } = sourceModule;

const assetsModule = await import(new URL('../assets.ts', import.meta.url).href);
const {
  createAnalysis,
  executeAnalysis,
  exportAnalysisCsv,
  getLocalDownloadStatuses,
  importFileAsset,
  requestLocalModelDownload,
  resetAssetsSchemaForTests,
} = assetsModule;

const chatModule = await import(new URL('../chat.ts', import.meta.url).href);
const { resetChatSchemaForTests } = chatModule;

const runtimeModule = await import(new URL('../agentRuntime.ts', import.meta.url).href);
const { createAgentEventStream, resetAgentRuntimeForTests, startAgentRun } = runtimeModule;

type AgentEventPayload = {
  type?: string;
  subtype?: string;
  run_id?: string | null;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectSseEvents(stream: ReadableStream<Uint8Array>): Promise<AgentEventPayload[]> {
  const events: AgentEventPayload[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const splitIndex = buffer.indexOf('\n\n');
      if (splitIndex < 0) {
        break;
      }
      const frame = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);

      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) {
          continue;
        }
        const jsonText = line.slice(6).trim();
        if (!jsonText) {
          continue;
        }
        events.push(JSON.parse(jsonText) as AgentEventPayload);
      }
    }
  }

  return events;
}

test.beforeEach(async () => {
  await resetDatabaseForTests();
  resetBoardsSchemaForTests();
  resetSourceSchemaForTests();
  resetAssetsSchemaForTests();
  resetChatSchemaForTests();
  resetAgentRuntimeForTests();
});

test.after(async () => {
  await resetDatabaseForTests();
  await rm(tempRoot, { recursive: true, force: true });
});

test('Phase C smoke: C1/C2/C3 critical flows run end-to-end', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const source = await createSourceConnection(
    {
      name: 'smoke_source',
      source_type: 'postgres',
      source_config: { dsn: 'postgresql://smoke' },
    },
    projectId
  );
  assert.equal(source.status, 'attached');

  const sourceTables = await listSourceTables(source.name, projectId);
  assert.ok(sourceTables.length > 0);

  const board = await createBoard(projectId, { name: 'Smoke Board' });
  const item = await createBoardItem(
    board.id,
    {
      item_type: 'table',
      title: 'Smoke Query',
      payload: { table: 'inline' },
    },
    projectId
  );

  await createBoardQuery(item.id, { query_text: 'SELECT 1 AS value' }, projectId);
  const firstResult = await executeBoardQueryByItem(item.id, projectId);
  assert.deepEqual(firstResult.columns, ['value']);
  assert.equal(firstResult.data[0]?.value, 1);

  const firstCached = await getCachedBoardQueryResult(item.id, projectId);
  assert.equal(firstCached.data[0]?.value, 1);

  await createBoardQuery(item.id, { query_text: 'SELECT 2 AS value' }, projectId);
  const secondResult = await executeBoardQueryByItem(item.id, projectId);
  assert.equal(secondResult.data[0]?.value, 2);

  const secondCached = await getCachedBoardQueryResult(item.id, projectId);
  assert.equal(secondCached.data[0]?.value, 2);

  const csvPath = join(tempRoot, 'smoke_dataset.csv');
  await writeFile(csvPath, 'id,amount\n1,10\n2,15\n3,20\n');

  const asset = await importFileAsset(
    {
      file_path: csvPath,
      file_type: 'csv',
      table_name: 'smoke_dataset',
      overwrite: true,
    },
    projectId
  );

  const analysis = await createAnalysis(
    {
      name: 'Smoke Analysis',
      sql: `SELECT COUNT(*) AS row_count, SUM(amount) AS total_amount FROM ${asset.table_name}`,
      materialization: 'table',
    },
    projectId
  );

  const analysisRun = await executeAnalysis(analysis.id, { force: true }, projectId);
  assert.equal(analysisRun.success, true);

  const exportPath = join(tempRoot, 'smoke_analysis.csv');
  const exported = await exportAnalysisCsv(analysis.id, { file_path: exportPath }, projectId);
  assert.equal(exported.status, 'saved');

  const exportedCsv = await readFile(exportPath, 'utf8');
  assert.ok(exportedCsv.includes('row_count,total_amount'));
  assert.ok(exportedCsv.includes('3,45'));

  const started = await startAgentRun({
    question: 'Phase C smoke agent stream',
    scope_project_id: projectId,
  });

  const agentEvents = await collectSseEvents(createAgentEventStream(started.run_id));
  assert.ok(agentEvents.some((event) => event.type === 'message' && event.subtype === 'chunk'));
  assert.ok(agentEvents.some((event) => event.type === 'message' && event.subtype === 'final'));
  assert.ok(agentEvents.some((event) => event.type === 'run' && event.subtype === 'end'));

  const requested = await requestLocalModelDownload({
    repo_id: 'Qwen/Qwen3-8B-GGUF',
    filename: 'qwen3-8b-q4_k_m.gguf',
    model_id: 'smoke-qwen',
  });
  assert.equal(requested.model_id, 'smoke-qwen');

  let completed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(25);
    const statuses = await getLocalDownloadStatuses();
    if (statuses['smoke-qwen']?.status === 'completed') {
      completed = true;
      break;
    }
  }

  assert.equal(completed, true);
});
