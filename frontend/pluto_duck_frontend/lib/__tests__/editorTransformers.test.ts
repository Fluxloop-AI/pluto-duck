import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALLOUT_BLOCK_START_REGEXP,
  CALLOUT_INLINE_REGEXP,
  HORIZONTAL_RULE_REGEXP,
  resolveCalloutType,
  stripCalloutQuotePrefix,
} from '../../components/editor/transformerUtils.ts';

test('callout marker is mapped to lexical callout types', () => {
  assert.equal(resolveCalloutType('NOTE'), 'info');
  assert.equal(resolveCalloutType('IMPORTANT'), 'info');
  assert.equal(resolveCalloutType('warning'), 'warning');
  assert.equal(resolveCalloutType('Tip'), 'success');
  assert.equal(resolveCalloutType('CAUTION'), 'error');
  assert.equal(resolveCalloutType('UNKNOWN'), undefined);
});

test('inline callout regexp captures marker and trailing text', () => {
  const match = '> [!WARNING] keep this'.match(CALLOUT_INLINE_REGEXP);

  assert.ok(match);
  assert.equal(match?.[1], 'WARNING');
  assert.equal(match?.[2], 'keep this');
});

test('block callout start regexp accepts marker-only line', () => {
  assert.ok(CALLOUT_BLOCK_START_REGEXP.test('> [!NOTE]'));
  assert.equal(CALLOUT_BLOCK_START_REGEXP.test('> [!NOTE] title'), false);
});

test('callout quote prefix stripper keeps inner text as plain text', () => {
  assert.equal(stripCalloutQuotePrefix('> hello world'), 'hello world');
  assert.equal(stripCalloutQuotePrefix('>   trailing   '), '  trailing');
  assert.equal(stripCalloutQuotePrefix('plain line'), 'plain line');
});

test('horizontal rule regexp keeps markdown hr variants only', () => {
  assert.ok(HORIZONTAL_RULE_REGEXP.test('---'));
  assert.ok(HORIZONTAL_RULE_REGEXP.test('***'));
  assert.ok(HORIZONTAL_RULE_REGEXP.test('___'));
  assert.equal(HORIZONTAL_RULE_REGEXP.test('--'), false);
  assert.equal(HORIZONTAL_RULE_REGEXP.test('----'), false);
});
