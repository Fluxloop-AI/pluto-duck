import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchApprovalDecision,
  resolveApprovalSummary,
} from '../approvalRenderModel.ts';

test('approval summary prefers structured description/reason fields', () => {
  const described = resolveApprovalSummary(JSON.stringify({ description: 'Need write access approval' }));
  assert.equal(described, 'Need write access approval');

  const reasoned = resolveApprovalSummary(JSON.stringify({ reason: 'User confirmation required' }));
  assert.equal(reasoned, 'User confirmation required');
});

test('approval summary falls back to raw content text', () => {
  const plain = resolveApprovalSummary('Manual approval step');
  assert.equal(plain, 'Manual approval step');

  const empty = resolveApprovalSummary('   ');
  assert.equal(empty, 'Approval required before continuing.');
});

test('approval action dispatcher calls callback with expected decision payload', () => {
  const calls: Array<{ id: string; runId: string | null; decision: 'approved' | 'rejected' }> = [];
  dispatchApprovalDecision((id, runId, decision) => calls.push({ id, runId, decision }), 'evt-approval-1', 'run-1', 'approved');
  dispatchApprovalDecision((id, runId, decision) => calls.push({ id, runId, decision }), 'evt-approval-1', 'run-1', 'rejected');

  assert.deepEqual(calls, [
    { id: 'evt-approval-1', runId: 'run-1', decision: 'approved' },
    { id: 'evt-approval-1', runId: 'run-1', decision: 'rejected' },
  ]);
});
