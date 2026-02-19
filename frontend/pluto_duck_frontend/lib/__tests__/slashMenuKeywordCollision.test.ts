import assert from 'node:assert/strict';
import test from 'node:test';

import { filterSlashOptionsByQuery } from '../../components/editor/plugins/slashMenuFilter.ts';

const OPTIONS = [
  { title: 'Heading 1', keywords: ['h1', 'heading', 'large'] },
  { title: 'Divider', keywords: ['divider', 'hr', 'horizontal', 'line', '---'] },
  { title: 'Callout', keywords: ['callout', 'note', 'warning', 'tip', 'important', 'caution'] },
  // Phase 2(table) is intentionally skipped, so `table` stays as Asset keyword.
  { title: 'Asset', keywords: ['asset', 'analysis', 'data', 'query', 'table', 'chart'] },
] as const;

test('empty query keeps original slash option order', () => {
  const filtered = filterSlashOptionsByQuery([...OPTIONS], '');

  assert.deepEqual(
    filtered.map((item) => item.title),
    ['Heading 1', 'Divider', 'Callout', 'Asset']
  );
});

test('table query resolves to asset while table block is not enabled', () => {
  const filtered = filterSlashOptionsByQuery([...OPTIONS], 'table');

  assert.deepEqual(filtered.map((item) => item.title), ['Asset']);
});

test('prefix search wins over contains search', () => {
  const filtered = filterSlashOptionsByQuery([...OPTIONS], 'ca');

  assert.deepEqual(filtered.map((item) => item.title), ['Callout']);
});
