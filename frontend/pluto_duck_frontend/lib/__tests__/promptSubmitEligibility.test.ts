import assert from 'node:assert/strict';
import test from 'node:test';

import { canSubmitPromptOnEnter } from '../promptSubmitEligibility.ts';

test('Enter submits when not composing, not shifted, and submit is enabled', () => {
  assert.equal(
    canSubmitPromptOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      nativeIsComposing: false,
      submitDisabled: false,
    }),
    true
  );
});

test('Enter does not submit when submit button is disabled', () => {
  assert.equal(
    canSubmitPromptOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      nativeIsComposing: false,
      submitDisabled: true,
    }),
    false
  );
});

test('Enter does not submit while IME composition is active', () => {
  assert.equal(
    canSubmitPromptOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      nativeIsComposing: false,
      submitDisabled: false,
    }),
    false
  );
  assert.equal(
    canSubmitPromptOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      nativeIsComposing: true,
      submitDisabled: false,
    }),
    false
  );
});

test('Shift+Enter does not submit', () => {
  assert.equal(
    canSubmitPromptOnEnter({
      key: 'Enter',
      shiftKey: true,
      isComposing: false,
      nativeIsComposing: false,
      submitDisabled: false,
    }),
    false
  );
});

test('Non-Enter key does not submit', () => {
  assert.equal(
    canSubmitPromptOnEnter({
      key: 'a',
      shiftKey: false,
      isComposing: false,
      nativeIsComposing: false,
      submitDisabled: false,
    }),
    false
  );
});
