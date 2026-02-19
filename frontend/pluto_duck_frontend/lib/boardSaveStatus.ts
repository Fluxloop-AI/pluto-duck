import type { BoardTab, SaveStatus } from './boardsApi';

interface ManualSaveRequestParams {
  tabs: BoardTab[];
  activeTabId: string | null;
  editorSnapshot: string | null;
  saveStatus: SaveStatus;
}

interface ManualSaveRequest {
  shouldSave: boolean;
  tabs: BoardTab[];
  activeTabId: string | null;
}

interface SaveShortcutGuardInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  hasBoardFocus: boolean;
  isOutsideBoardEditable: boolean;
}

export function resolvePostSaveStatus(isManual: boolean): SaveStatus {
  return isManual ? 'saved' : 'auto-saved';
}

export function resolveSaveErrorStatus(): SaveStatus {
  return 'unsaved';
}

export function mergePendingSnapshot<T>(_: T | null, incoming: T): T {
  return incoming;
}

export function buildManualSaveRequest({
  tabs,
  activeTabId,
  editorSnapshot,
  saveStatus,
}: ManualSaveRequestParams): ManualSaveRequest {
  if (!activeTabId) {
    return { shouldSave: false, tabs, activeTabId };
  }

  if (editorSnapshot !== null) {
    return {
      shouldSave: true,
      tabs: tabs.map((tab) => (
        tab.id === activeTabId
          ? { ...tab, content: editorSnapshot }
          : tab
      )),
      activeTabId,
    };
  }

  if (saveStatus === 'idle') {
    return { shouldSave: false, tabs, activeTabId };
  }

  return { shouldSave: true, tabs, activeTabId };
}

export function shouldHandleBoardSaveShortcut({
  key,
  metaKey,
  ctrlKey,
  hasBoardFocus,
  isOutsideBoardEditable,
}: SaveShortcutGuardInput): boolean {
  if (key.toLowerCase() !== 's') {
    return false;
  }

  if (!metaKey && !ctrlKey) {
    return false;
  }

  if (!hasBoardFocus) {
    return false;
  }

  if (isOutsideBoardEditable) {
    return false;
  }

  return true;
}
