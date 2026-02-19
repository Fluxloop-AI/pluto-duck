import assert from 'node:assert/strict';
import test from 'node:test';

import { formatBoardUpdatedAt, getDisplayTabTitle } from '../boardTitle.ts';

test('getDisplayTabTitle returns original value when not blank', () => {
  assert.equal(getDisplayTabTitle('Hello'), 'Hello');
});

test('getDisplayTabTitle returns Untitled for blank values', () => {
  assert.equal(getDisplayTabTitle('   '), 'Untitled');
});

test('formatBoardUpdatedAt returns formatted text for valid ISO', () => {
  const iso = '2025-10-25T20:20:00.000Z';
  const expected = new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  assert.equal(formatBoardUpdatedAt(iso), expected);
});

test('formatBoardUpdatedAt returns null for undefined/null/invalid values', () => {
  assert.equal(formatBoardUpdatedAt(undefined), null);
  assert.equal(formatBoardUpdatedAt(null), null);
  assert.equal(formatBoardUpdatedAt('invalid-date'), null);
});
