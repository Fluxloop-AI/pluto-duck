import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAbsolutePath,
  fileSourceExpression,
  normalizeDownloadStatus,
  normalizeLocalModelId,
  normalizeTableName,
  parseDependencyTokens,
} from '../duckpipe-js/runtime.ts';

test('duckpipe runtime normalizes table names deterministically', () => {
  assert.equal(normalizeTableName('  Sales Report 2026  '), 'sales_report_2026');
  assert.equal(normalizeTableName('123abc'), '_123abc');
  assert.match(normalizeTableName('!@#$%'), /^table_[a-f0-9]{8}$/);
});

test('duckpipe runtime extracts dependencies from sql text', () => {
  const dependencies = parseDependencyTokens(`
    SELECT *
    FROM analytics.orders o
    JOIN "asset_customers" c ON o.customer_id = c.id
    JOIN \`raw_events\` e ON e.user_id = c.id
  `);
  assert.deepEqual(
    dependencies.sort(),
    ['analytics.orders', 'asset_customers', 'raw_events'].sort()
  );
});

test('duckpipe runtime keeps known download states and coerces invalid state to error', () => {
  assert.equal(normalizeDownloadStatus('queued'), 'queued');
  assert.equal(normalizeDownloadStatus('downloading'), 'downloading');
  assert.equal(normalizeDownloadStatus('completed'), 'completed');
  assert.equal(normalizeDownloadStatus('error'), 'error');
  assert.equal(normalizeDownloadStatus('invalid-state'), 'error');
});

test('duckpipe runtime validates absolute path and source expression', () => {
  assert.equal(assertAbsolutePath('/tmp/input.csv', 'file_path'), '/tmp/input.csv');
  assert.throws(() => assertAbsolutePath('relative/path.csv', 'file_path'), /must be absolute/);

  assert.equal(
    fileSourceExpression('/tmp/input.csv', 'csv'),
    "read_csv_auto('/tmp/input.csv', HEADER=TRUE)"
  );
  assert.equal(fileSourceExpression('/tmp/input.parquet', 'parquet'), "read_parquet('/tmp/input.parquet')");
});

test('duckpipe runtime normalizes local model id with filename fallback', () => {
  assert.equal(normalizeLocalModelId('my:model', 'model.gguf'), 'my-model');
  assert.equal(normalizeLocalModelId(undefined, 'llama-3.1.gguf'), 'llama-3-1');
});
