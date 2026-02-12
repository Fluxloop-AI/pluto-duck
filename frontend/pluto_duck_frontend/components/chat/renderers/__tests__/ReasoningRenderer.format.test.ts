import assert from 'node:assert/strict';
import test from 'node:test';

import { formatReasoningContent } from '../reasoningFormat.ts';

test('converts bold-only lines to h3 and removes extra blank line after heading', () => {
  const input = '**Overview**\n\nDetails';
  const expected = '### Overview\nDetails';
  assert.equal(formatReasoningContent(input), expected);
});

test('does not convert bold-only lines inside fenced code blocks', () => {
  const input = [
    '```md',
    '**Literal Bold**',
    '',
    '### Literal Heading',
    '```',
    '',
    '**Convert This**',
    '',
    'Done',
  ].join('\n');

  const expected = [
    '```md',
    '**Literal Bold**',
    '',
    '### Literal Heading',
    '```',
    '',
    '### Convert This',
    'Done',
  ].join('\n');

  assert.equal(formatReasoningContent(input), expected);
});
