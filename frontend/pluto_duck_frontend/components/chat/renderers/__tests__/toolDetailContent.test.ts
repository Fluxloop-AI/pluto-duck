import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildToolDetailEntriesForChildren,
  buildToolDetailRowsForChild,
  serializeToolDetailContent,
} from '../toolDetailContent.ts';

test('serialize returns raw string unchanged', () => {
  assert.equal(serializeToolDetailContent('hello'), 'hello');
});

test('serialize pretty-prints object', () => {
  assert.equal(
    serializeToolDetailContent({ a: 1 }),
    '{\n  "a": 1\n}'
  );
});

test('serialize returns null for nullish input', () => {
  assert.equal(serializeToolDetailContent(null), null);
  assert.equal(serializeToolDetailContent(undefined), null);
});

test('build rows with input only', () => {
  const rows = buildToolDetailRowsForChild({
    id: 'child-1',
    input: { file_path: 'data.csv' },
    output: undefined,
    error: undefined,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, 'input');
});

test('build rows with output only', () => {
  const rows = buildToolDetailRowsForChild({
    id: 'child-2',
    input: undefined,
    output: { type: 'tool', content: { ok: true } },
    error: undefined,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, 'output');
  assert.equal(rows[0]?.content, '{\n  "ok": true\n}');
});

test('build rows with error only', () => {
  const rows = buildToolDetailRowsForChild({
    id: 'child-3',
    input: undefined,
    output: { ignored: true },
    error: 'boom',
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, 'error');
  assert.equal(rows[0]?.content, 'boom');
});

test('build rows prioritizes error over output', () => {
  const rows = buildToolDetailRowsForChild({
    id: 'child-4',
    input: undefined,
    output: { type: 'tool', content: { ok: true } },
    error: 'failed',
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, 'error');
});

test('build rows skips empty child', () => {
  const rows = buildToolDetailRowsForChild({
    id: 'child-5',
    input: undefined,
    output: undefined,
    error: undefined,
  });

  assert.deepEqual(rows, []);
});

test('group entries keep row order and divider count', () => {
  const entries = buildToolDetailEntriesForChildren([
    {
      id: 'a',
      input: { path: '/tmp/a.csv' },
      output: { type: 'tool', content: 'done-a' },
      error: undefined,
    },
    {
      id: 'b',
      input: undefined,
      output: undefined,
      error: undefined,
    },
    {
      id: 'c',
      input: undefined,
      output: undefined,
      error: 'err-c',
    },
  ]);

  assert.equal(entries.length, 5);
  assert.equal('kind' in (entries[0] ?? {}), true);
  assert.equal('type' in (entries[1] ?? {}), true);
  assert.equal('kind' in (entries[2] ?? {}), true);
  assert.equal('type' in (entries[3] ?? {}), true);
  assert.equal('kind' in (entries[4] ?? {}), true);

  if (entries[0] && 'kind' in entries[0]) {
    assert.equal(entries[0].kind, 'input');
  }
  if (entries[1] && 'type' in entries[1]) {
    assert.equal(entries[1].type, 'divider');
  }
  if (entries[2] && 'kind' in entries[2]) {
    assert.equal(entries[2].kind, 'output');
  }
  if (entries[3] && 'type' in entries[3]) {
    assert.equal(entries[3].type, 'divider');
  }
  if (entries[4] && 'kind' in entries[4]) {
    assert.equal(entries[4].kind, 'error');
  }
});
