import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tempRoot = await mkdtemp(join(tmpdir(), 'pluto-duck-phase-c-asset-'));
process.env.PLUTODUCK_DB_PATH = join(tempRoot, 'pluto_duck_phase_c_asset.duckdb');

const storeModule = await import(new URL('../store.ts', import.meta.url).href);
const { createProject, getSettings, resetDatabaseForTests } = storeModule;

const assetsModule = await import(new URL('../assets.ts', import.meta.url).href);
const {
  createAnalysis,
  deleteDiagnosisIssue,
  deleteLocalModel,
  diagnoseFiles,
  executeAnalysis,
  exportAnalysisCsv,
  findDiagnosisIssues,
  getAnalysisData,
  getFileAsset,
  getFileDiagnosis,
  getLocalDownloadStatuses,
  importFileAsset,
  listFileAssets,
  listLocalModels,
  loadLocalModel,
  requestLocalModelDownload,
  resetAssetsSchemaForTests,
  unloadLocalModel,
  updateDiagnosisIssue,
} = assetsModule;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test.beforeEach(async () => {
  await resetDatabaseForTests();
  resetAssetsSchemaForTests();
});

test.after(async () => {
  await resetDatabaseForTests();
  await rm(tempRoot, { recursive: true, force: true });
});

test('C3 file assets are project scoped and analysis export/download works', async () => {
  const settings = await getSettings();
  const projectA = settings.default_project_id as string;
  const projectB = (await createProject({ name: 'Phase C B Project' })).id;

  const csvPath = join(tempRoot, 'orders.csv');
  await writeFile(csvPath, 'id,amount\n1,100\n2,200\n3,200\n');

  const imported = await importFileAsset(
    {
      file_path: csvPath,
      file_type: 'csv',
      table_name: 'orders_asset',
      name: 'Orders Asset',
      overwrite: true,
    },
    projectA
  );

  assert.equal(imported.table_name, 'orders_asset');

  const assetsInA = await listFileAssets(projectA);
  const assetsInB = await listFileAssets(projectB);
  assert.equal(assetsInA.length, 1);
  assert.equal(assetsInB.length, 0);

  await assert.rejects(() => getFileAsset(imported.id, projectB), /File asset .* not found/);

  const analysis = await createAnalysis(
    {
      name: 'Orders Summary',
      sql: `SELECT COUNT(*) AS row_count, SUM(amount) AS total_amount FROM ${imported.table_name}`,
      materialization: 'table',
    },
    projectA
  );

  const executed = await executeAnalysis(
    analysis.id,
    {
      force: true,
    },
    projectA
  );
  assert.equal(executed.success, true);
  assert.equal(executed.step_results.length, 1);

  const data = await getAnalysisData(
    analysis.id,
    {
      limit: 10,
      offset: 0,
    },
    projectA
  );

  assert.deepEqual(data.columns, ['row_count', 'total_amount']);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0]?.[0], 3);
  assert.equal(data.rows[0]?.[1], 500);

  const exportPath = join(tempRoot, 'orders_summary.csv');
  const exported = await exportAnalysisCsv(
    analysis.id,
    {
      file_path: exportPath,
      force: false,
    },
    projectA
  );

  assert.equal(exported.status, 'saved');
  const exportedCsv = await readFile(exportPath, 'utf8');
  assert.ok(exportedCsv.includes('row_count,total_amount'));
  assert.ok(exportedCsv.includes('3,500'));
});

test('C3 diagnosis/issue workflow and local model status endpoints work for UI expectations', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const csvPath = join(tempRoot, 'diagnosis.csv');
  await writeFile(csvPath, 'id,name,score\n1,Alice,90\n2,,80\n3,Chris,70\n');

  const diagnoseResponse = await diagnoseFiles(
    {
      files: [
        {
          file_path: csvPath,
          file_type: 'csv',
        },
      ],
      include_llm: true,
      llm_mode: 'defer',
      use_cache: true,
      language: 'en',
    },
    projectId
  );

  assert.equal(diagnoseResponse.diagnoses.length, 1);
  assert.equal(typeof diagnoseResponse.diagnoses[0]?.diagnosis_id, 'string');
  assert.equal(Boolean(diagnoseResponse.diagnoses[0]?.llm_analysis), true);

  const imported = await importFileAsset(
    {
      file_path: csvPath,
      file_type: 'csv',
      table_name: 'diagnosis_asset',
      name: 'Diagnosis Asset',
      diagnosis_id: diagnoseResponse.diagnoses[0]?.diagnosis_id,
      overwrite: true,
    },
    projectId
  );

  const diagnosis = await getFileDiagnosis(imported.id, { use_cache: true }, projectId);
  assert.equal(diagnosis.file_path, csvPath);
  assert.ok(Array.isArray(diagnosis.columns));

  const foundIssues = await findDiagnosisIssues(imported.id, projectId);
  assert.ok(foundIssues.issues.length >= 1);

  const issue = foundIssues.issues[0] as { id: string };
  const updated = await updateDiagnosisIssue(issue.id, {
    status: 'confirmed',
    user_response: 'ack',
  });
  assert.equal(updated.status, 'confirmed');

  const deleted = await deleteDiagnosisIssue(issue.id, {
    delete_reason: 'not relevant',
  });
  assert.equal(typeof deleted.deleted_at, 'string');

  const requested = await requestLocalModelDownload({
    repo_id: 'Qwen/Qwen3-8B-GGUF',
    filename: 'qwen3-8b-q4_k_m.gguf',
    model_id: 'qwen3-8b-q4',
  });
  assert.equal(requested.model_id, 'qwen3-8b-q4');

  let completed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(25);
    const statuses = await getLocalDownloadStatuses();
    const status = statuses['qwen3-8b-q4']?.status;
    if (status === 'completed') {
      completed = true;
      break;
    }
  }

  assert.equal(completed, true);

  const models = await listLocalModels();
  assert.ok(models.some((model: { id: string }) => model.id === 'qwen3-8b-q4'));

  await loadLocalModel('qwen3-8b-q4');
  await unloadLocalModel();
  await deleteLocalModel('qwen3-8b-q4');

  const modelsAfterDelete = await listLocalModels();
  assert.equal(modelsAfterDelete.some((model: { id: string }) => model.id === 'qwen3-8b-q4'), false);
});

test('C4 guard: diagnosis file-count and analysis SQL length limits are enforced', async () => {
  const settings = await getSettings();
  const projectId = settings.default_project_id as string;

  const csvPath = join(tempRoot, 'guard.csv');
  await writeFile(csvPath, 'id,value\n1,10\n');

  const tooManyFiles = Array.from({ length: 21 }, () => ({
    file_path: csvPath,
    file_type: 'csv' as const,
  }));

  await assert.rejects(
    () =>
      diagnoseFiles(
        {
          files: tooManyFiles,
          include_llm: false,
        },
        projectId
      ),
    /files exceeds maximum size/
  );

  const veryLargeSql = `SELECT '${'x'.repeat(200_100)}' AS payload`;
  await assert.rejects(
    () =>
      createAnalysis(
        {
          name: 'Too Large SQL',
          sql: veryLargeSql,
        },
        projectId
      ),
    /sql exceeds/
  );
});
