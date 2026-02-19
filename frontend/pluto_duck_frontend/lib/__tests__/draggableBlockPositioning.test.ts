import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldInsertAfterBlock } from '../../components/editor/plugins/draggable-block/blockPositioning.ts';

test('clientY 기준 판정은 스크롤 오프셋과 무관하게 일관된다', () => {
  const targetTop = 620;
  const targetHeight = 120;
  const clientY = 610;
  const syntheticPageY = 1610;

  assert.equal(shouldInsertAfterBlock(clientY, targetTop, targetHeight), false);
  assert.equal(shouldInsertAfterBlock(syntheticPageY, targetTop, targetHeight), true);
});

test('경계값 mouseY === targetTop 에서는 위쪽 삽입(상단 라인)으로 판정한다', () => {
  const targetTop = 400;
  const targetHeight = 100;

  assert.equal(shouldInsertAfterBlock(targetTop, targetTop, targetHeight), false);
});

test('긴 블록 상단 근처에서는 뒤(아래)로 밀리지 않고 상단 삽입으로 판정한다', () => {
  const targetTop = 100;
  const targetHeight = 200;
  const pointerNearTop = 120;

  assert.equal(shouldInsertAfterBlock(pointerNearTop, targetTop, targetHeight), false);
});
