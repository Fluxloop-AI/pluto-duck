import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAssistantActionsClassName,
  shouldShowAssistantActions,
} from '../assistantActionsPolicy.ts';

test('hides actions while assistant message is streaming', () => {
  const params = {
    id: 'timeline-assistant-1',
    messageId: 'assistant-1',
    isStreaming: true,
  };
  assert.equal(shouldShowAssistantActions(params), false);
  assert.equal(getAssistantActionsClassName(params), null);
});

test('shows actions with entry animation after streaming completes', () => {
  const params = {
    id: 'timeline-assistant-1',
    messageId: 'assistant-1',
    isStreaming: false,
  };
  assert.equal(shouldShowAssistantActions(params), true);
  assert.equal(getAssistantActionsClassName(params), 'mt-2 animate-step-in');
});

test('hides actions for transient stream-final placeholder rows', () => {
  const params = {
    id: 'timeline-streaming-run-1',
    messageId: 'stream-run-1',
    isStreaming: false,
  };
  assert.equal(shouldShowAssistantActions(params), false);
  assert.equal(getAssistantActionsClassName(params), null);
});

test('hides actions for legacy assistant-stream placeholder id', () => {
  const params = {
    id: 'assistant-stream-run-2',
    messageId: 'assistant-persisted-2',
    isStreaming: false,
  };
  assert.equal(shouldShowAssistantActions(params), false);
  assert.equal(getAssistantActionsClassName(params), null);
});

test('hides actions for transient stream messageId without timeline id', () => {
  const params = {
    id: 'timeline-assistant-3',
    messageId: 'stream-run-3',
    isStreaming: false,
  };
  assert.equal(shouldShowAssistantActions(params), false);
  assert.equal(getAssistantActionsClassName(params), null);
});
