import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getInlineErrorText,
  getInlineTodosSummaryLabel,
  getInlineToolDisplayText,
  getInlineToolPhase,
} from '../toolInlineViewModel.ts';

test('prefers keyParam over preview and tool fallback', () => {
  const text = getInlineToolDisplayText({
    keyParam: 'ToolRenderer.tsx',
    preview: 'preview line',
    toolName: 'read_file',
  });

  assert.equal(text, 'ToolRenderer.tsx');
});

test('uses preview when keyParam is missing', () => {
  const text = getInlineToolDisplayText({
    keyParam: null,
    preview: 'first output line',
    toolName: 'read_file',
  });

  assert.equal(text, 'first output line');
});

test('falls back to formatted tool name when keyParam and preview are missing', () => {
  const text = getInlineToolDisplayText({
    keyParam: null,
    preview: null,
    toolName: 'executeCommand',
  });

  assert.equal(text, 'Execute Command');
});

test('maps inline state to phase', () => {
  assert.equal(getInlineToolPhase('pending'), 'running');
  assert.equal(getInlineToolPhase('completed'), 'complete');
  assert.equal(getInlineToolPhase('error'), 'error');
});

test('builds write_todos inline summary label', () => {
  assert.equal(getInlineTodosSummaryLabel(3), 'Update Todos — 3 items');
});

test('returns error text only when present', () => {
  assert.equal(getInlineErrorText('permission denied'), 'permission denied');
  assert.equal(getInlineErrorText(undefined), null);
});
