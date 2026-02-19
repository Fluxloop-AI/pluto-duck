import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarkdownTable, parseMarkdownTable } from '../../components/editor/markdownTableUtils.ts';

test('parseMarkdownTable parses header table with separator', () => {
  const result = parseMarkdownTable('| A | B |\n| --- | --- |\n| 1 | 2 |');

  assert.deepEqual(result, {
    hasHeader: true,
    columns: ['A', 'B'],
    rows: [['1', '2']],
  });
});

test('parseMarkdownTable parses headerless table when columns are consistent', () => {
  const result = parseMarkdownTable('| 1 | 2 |\n| 3 | 4 |');

  assert.deepEqual(result, {
    hasHeader: false,
    columns: [],
    rows: [
      ['1', '2'],
      ['3', '4'],
    ],
  });
});

test('parseMarkdownTable keeps empty cells', () => {
  const result = parseMarkdownTable('| A | B |\n| --- | --- |\n| 1 | |');

  assert.deepEqual(result, {
    hasHeader: true,
    columns: ['A', 'B'],
    rows: [['1', '']],
  });
});

test('parseMarkdownTable returns null when headerless table has inconsistent columns', () => {
  const result = parseMarkdownTable('| 1 | 2 |\n| 3 |');
  assert.equal(result, null);
});

test('parseMarkdownTable returns null when only one pipe row exists', () => {
  const result = parseMarkdownTable('| 1 | 2 |');
  assert.equal(result, null);
});

test('parseMarkdownTable returns null on empty input', () => {
  const result = parseMarkdownTable('');
  assert.equal(result, null);
});

test('buildMarkdownTable serializes header table', () => {
  const markdown = buildMarkdownTable(['A', 'B'], [['1', '2']], true);
  assert.equal(markdown, '| A | B |\n| --- | --- |\n| 1 | 2 |');
});

test('buildMarkdownTable serializes headerless table', () => {
  const markdown = buildMarkdownTable([], [['1', '2'], ['3', '4']], false);
  assert.equal(markdown, '| 1 | 2 |\n| 3 | 4 |');
});
