import assert from 'node:assert/strict';
import test from 'node:test';

import { canSubmitChatPrompt } from '../../chatSubmitEligibility.ts';

test('blocks submit when stream is active', () => {
  assert.equal(
    canSubmitChatPrompt({
      prompt: 'hello',
      isStreaming: true,
    }),
    false
  );
});

test('allows submit with valid prompt when stream is inactive', () => {
  assert.equal(
    canSubmitChatPrompt({
      prompt: 'hello',
      isStreaming: false,
    }),
    true
  );
});

test('blocks submit for empty or whitespace-only prompt', () => {
  assert.equal(
    canSubmitChatPrompt({
      prompt: '',
      isStreaming: false,
    }),
    false
  );
  assert.equal(
    canSubmitChatPrompt({
      prompt: '   ',
      isStreaming: false,
    }),
    false
  );
});
