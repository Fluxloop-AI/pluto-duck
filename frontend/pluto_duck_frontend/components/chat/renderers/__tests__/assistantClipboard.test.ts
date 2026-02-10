import assert from 'node:assert/strict';
import test from 'node:test';
import { writeAssistantMessageToClipboard } from '../assistantClipboard.ts';

test('returns true when clipboard write succeeds', async () => {
  let writtenText = '';
  const isCopied = await writeAssistantMessageToClipboard('hello', {
    writeText: async text => {
      writtenText = text;
    },
  });

  assert.equal(isCopied, true);
  assert.equal(writtenText, 'hello');
});

test('returns false when clipboard write fails', async () => {
  const isCopied = await writeAssistantMessageToClipboard('hello', {
    writeText: async () => {
      throw new Error('denied');
    },
  });

  assert.equal(isCopied, false);
});

test('returns false when clipboard is unavailable', async () => {
  const isCopied = await writeAssistantMessageToClipboard('hello', undefined);
  assert.equal(isCopied, false);
});
