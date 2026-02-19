import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManualSaveRequest,
  mergePendingSnapshot,
  resolveSaveErrorStatus,
  shouldHandleBoardSaveShortcut,
} from '../boardSaveStatus.ts';
import type { BoardTab } from '../boardsApi.ts';

test('resolveSaveErrorStatus keeps unsaved on failure', () => {
  assert.equal(resolveSaveErrorStatus(), 'unsaved');
});

test('mergePendingSnapshot keeps latest snapshot while saving', () => {
  const first = { version: 1, content: 'a' };
  const second = { version: 2, content: 'b' };

  const pending = mergePendingSnapshot(first, second);
  assert.deepEqual(pending, second);
});

test('buildManualSaveRequest uses flush snapshot for same tab save', () => {
  const tabs: BoardTab[] = [
    { id: 'tab-1', name: 'Page 1', content: '{"v":1}' },
    { id: 'tab-2', name: 'Page 2', content: null },
  ];

  const request = buildManualSaveRequest({
    tabs,
    activeTabId: 'tab-1',
    editorSnapshot: '{"v":2}',
    saveStatus: 'unsaved',
  });

  assert.equal(request.shouldSave, true);
  assert.equal(request.activeTabId, 'tab-1');
  assert.equal(request.tabs[0]?.content, '{"v":2}');
});

test('buildManualSaveRequest skips save when snapshot is null and no pending change', () => {
  const tabs: BoardTab[] = [{ id: 'tab-1', name: 'Page 1', content: '{"v":1}' }];

  for (const status of ['idle', 'saving', 'saved', 'auto-saved'] as const) {
    const request = buildManualSaveRequest({
      tabs,
      activeTabId: 'tab-1',
      editorSnapshot: null,
      saveStatus: status,
    });

    assert.equal(request.shouldSave, false, `expected skip for status=${status}`);
    assert.equal(request.tabs, tabs);
  }
});

test('buildManualSaveRequest keeps manual save when snapshot is null but unsaved', () => {
  const tabs: BoardTab[] = [{ id: 'tab-1', name: 'Page 1', content: '{"v":1}' }];

  const request = buildManualSaveRequest({
    tabs,
    activeTabId: 'tab-1',
    editorSnapshot: null,
    saveStatus: 'unsaved',
  });

  assert.equal(request.shouldSave, true);
  assert.equal(request.tabs, tabs);
});

test('Cmd+S guard returns false outside board editable context', () => {
  const shouldHandle = shouldHandleBoardSaveShortcut({
    key: 's',
    metaKey: true,
    ctrlKey: false,
    hasBoardFocus: false,
    isOutsideBoardEditable: true,
  });

  assert.equal(shouldHandle, false);
});
