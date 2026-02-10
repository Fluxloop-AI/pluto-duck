import assert from 'node:assert/strict';
import test from 'node:test';
import { getAssistantMessageProseClassName } from '../assistantMessageProseClassName.ts';

const ASSISTANT_PROSE_BASE_CLASS = 'prose prose-sm dark:prose-invert max-w-none';

test('returns base prose classes plus prose-streaming while assistant message is streaming', () => {
  const className = getAssistantMessageProseClassName(true);
  assert.equal(className, `${ASSISTANT_PROSE_BASE_CLASS} prose-streaming`);
});

test('returns base prose classes after streaming completes', () => {
  const className = getAssistantMessageProseClassName(false);
  assert.equal(className, ASSISTANT_PROSE_BASE_CLASS);
});
