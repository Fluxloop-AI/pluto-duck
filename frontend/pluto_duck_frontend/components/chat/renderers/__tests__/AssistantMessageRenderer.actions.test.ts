import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAssistantActionsClassName,
  shouldShowAssistantActions,
} from '../assistantActionsPolicy.ts';

test('hides actions while assistant message is streaming', () => {
  assert.equal(shouldShowAssistantActions(true), false);
  assert.equal(getAssistantActionsClassName(true), null);
});

test('shows actions with entry animation after streaming completes', () => {
  assert.equal(shouldShowAssistantActions(false), true);
  assert.equal(getAssistantActionsClassName(false), 'mt-2 animate-step-in');
});
