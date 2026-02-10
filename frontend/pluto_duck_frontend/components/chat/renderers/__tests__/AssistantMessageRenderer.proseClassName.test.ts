import assert from 'node:assert/strict';
import test from 'node:test';
import { getAssistantMessageProseClassName } from '../assistantMessageProseClassName.ts';

test('includes prose-streaming class while assistant message is streaming', () => {
  const className = getAssistantMessageProseClassName(true);
  assert.match(className, /\bprose-streaming\b/);
});

test('removes prose-streaming class after streaming completes', () => {
  const className = getAssistantMessageProseClassName(false);
  assert.doesNotMatch(className, /\bprose-streaming\b/);
});
