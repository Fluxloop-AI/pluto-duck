import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTimelineEvent, resolveApprovalDecision } from '../eventIntentRegistry.ts';

test('tool event with approval_required is classified as approval-control lane', () => {
  const classification = classifyTimelineEvent({
    type: 'tool',
    subtype: 'start',
    content: {
      tool: 'write_file',
      approval_required: true,
    },
  });

  assert.equal(classification.intent, 'approval-control');
  assert.equal(classification.lane, 'control');
  assert.equal(classification.hasApprovalSignal, true);
});

test('tool event with approval decision maps to approval-control metadata', () => {
  const classification = classifyTimelineEvent({
    type: 'tool',
    subtype: 'end',
    content: {
      tool: 'write_file',
      approval_id: 'approval-123',
      decision: 'approve',
    },
  });

  assert.equal(classification.intent, 'approval-control');
  assert.equal(classification.lane, 'control');
  assert.equal(classification.approvalId, 'approval-123');
  assert.equal(classification.approvalDecision, 'approved');
});

test('tool event without approval signal is classified as execution lane', () => {
  const classification = classifyTimelineEvent({
    type: 'tool',
    subtype: 'start',
    content: {
      tool: 'search',
    },
  });

  assert.equal(classification.intent, 'execution');
  assert.equal(classification.lane, 'tool');
  assert.equal(classification.hasApprovalSignal, false);
});

test('message and reasoning events map to stable intent/lane pairs', () => {
  const messageClassification = classifyTimelineEvent({
    type: 'message',
    subtype: 'final',
    content: {
      text: 'hello',
    },
  });
  const reasoningClassification = classifyTimelineEvent({
    type: 'reasoning',
    subtype: 'chunk',
    content: {
      reason: 'thinking',
    },
  });

  assert.equal(messageClassification.intent, 'message');
  assert.equal(messageClassification.lane, 'assistant');
  assert.equal(reasoningClassification.intent, 'reasoning');
  assert.equal(reasoningClassification.lane, 'reasoning');
});

test('resolveApprovalDecision keeps canonical decision mapping', () => {
  assert.equal(resolveApprovalDecision('approve'), 'approved');
  assert.equal(resolveApprovalDecision('edited'), 'approved');
  assert.equal(resolveApprovalDecision('reject'), 'rejected');
  assert.equal(resolveApprovalDecision('pending'), 'pending');
  assert.equal(resolveApprovalDecision('unknown'), undefined);
});
