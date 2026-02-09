import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearReasoningDismissTimers,
  scheduleReasoningDismissTimers,
} from '../../reasoningDismissTimers.ts';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('scheduled dismissal runs even when no new entries are discovered later', async () => {
  const timersById = new Map<string, ReturnType<typeof setTimeout>>();
  const dismissed: string[] = [];

  scheduleReasoningDismissTimers({
    ids: ['reasoning-1'],
    delayMs: 20,
    timersById,
    onDismiss: id => dismissed.push(id),
  });

  // Simulate an effect pass with discoveredEntries = [] (no new scheduling).
  await wait(40);

  assert.deepEqual(dismissed, ['reasoning-1']);
  assert.equal(timersById.size, 0);
});

test('duplicate scheduling does not create multiple timers for the same id', async () => {
  const timersById = new Map<string, ReturnType<typeof setTimeout>>();
  const dismissed: string[] = [];

  scheduleReasoningDismissTimers({
    ids: ['reasoning-dup'],
    delayMs: 20,
    timersById,
    onDismiss: id => dismissed.push(id),
  });
  scheduleReasoningDismissTimers({
    ids: ['reasoning-dup'],
    delayMs: 20,
    timersById,
    onDismiss: id => dismissed.push(id),
  });

  await wait(40);

  assert.deepEqual(dismissed, ['reasoning-dup']);
  assert.equal(timersById.size, 0);
});

test('clearing timers cancels pending dismiss callbacks', async () => {
  const timersById = new Map<string, ReturnType<typeof setTimeout>>();
  const dismissed: string[] = [];

  scheduleReasoningDismissTimers({
    ids: ['reasoning-a', 'reasoning-b'],
    delayMs: 30,
    timersById,
    onDismiss: id => dismissed.push(id),
  });

  clearReasoningDismissTimers(timersById);
  await wait(50);

  assert.deepEqual(dismissed, []);
  assert.equal(timersById.size, 0);
});
