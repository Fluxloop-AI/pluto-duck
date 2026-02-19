'use client';

import { useState, useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { BoardToolbar } from './BoardToolbar';
import { BoardEditor, type BoardEditorHandle } from '../editor/BoardEditor';
import { Board, BoardTab, SaveStatus, updateBoard } from '../../lib/boardsApi';
import type { AssetEmbedConfig } from '../editor/nodes/AssetEmbedNode';
import { nanoid } from 'nanoid';

interface BoardsViewProps {
  projectId: string;
  activeBoard: Board | null;
  onBoardUpdate?: (board: Board) => void;
}

export interface BoardsViewHandle {
  insertMarkdown: (content: string) => void;
  insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => void;
}

interface SaveTabsOptions {
  immediate?: boolean;
  isManual?: boolean;
}

interface SaveSnapshot {
  boardId: string;
  tabs: BoardTab[];
  activeTabId: string | null;
  isManual: boolean;
}

// Default tab when a board has no tabs yet
function createDefaultTab(): BoardTab {
  return {
    id: nanoid(),
    name: 'Page 1',
    content: null,
  };
}

// Migrate legacy content to tabs format
function migrateToTabs(board: Board): BoardTab[] {
  const settings = board.settings || {};
  
  // Already has tabs
  if (settings.tabs && settings.tabs.length > 0) {
    return settings.tabs;
  }
  
  // Has legacy content - migrate to first tab
  if (settings.content) {
    return [{
      id: nanoid(),
      name: 'Page 1',
      content: settings.content,
    }];
  }
  
  // No content at all - create default tab
  return [createDefaultTab()];
}

export const BoardsView = forwardRef<BoardsViewHandle, BoardsViewProps>(
  function BoardsView({ projectId, activeBoard, onBoardUpdate }, ref) {
  const boardEditorRef = useRef<BoardEditorHandle>(null);

  const [tabs, setTabs] = useState<BoardTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [boardUpdatedAt, setBoardUpdatedAt] = useState<string | null>(activeBoard?.updated_at ?? null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const activeBoardIdRef = useRef<string | null>(activeBoard?.id ?? null);
  const activeBoardRef = useRef<Board | null>(activeBoard);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savedDisplayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSnapshotRef = useRef<SaveSnapshot | null>(null);
  const isSavingRef = useRef(false);

  const clearSavedDisplayTimeout = useCallback(() => {
    if (!savedDisplayTimeoutRef.current) {
      return;
    }
    clearTimeout(savedDisplayTimeoutRef.current);
    savedDisplayTimeoutRef.current = null;
  }, []);

  const setSaveStatusLogged = useCallback((nextStatus: SaveStatus) => {
    setSaveStatus((currentStatus) => {
      if (currentStatus === nextStatus) {
        return currentStatus;
      }
      console.log(`[BoardsView] Save status: ${currentStatus} -> ${nextStatus}`);
      return nextStatus;
    });
  }, []);

  const markUnsaved = useCallback(() => {
    if (saveStatus === 'saving' || isSavingRef.current) {
      return;
    }
    clearSavedDisplayTimeout();
    setSaveStatusLogged('unsaved');
  }, [clearSavedDisplayTimeout, saveStatus, setSaveStatusLogged]);

  useEffect(() => {
    activeBoardIdRef.current = activeBoard?.id ?? null;
  }, [activeBoard?.id]);

  useEffect(() => {
    activeBoardRef.current = activeBoard;
  }, [activeBoard]);

  const runSaveQueue = useCallback(async (initialSnapshot: SaveSnapshot) => {
    let currentSnapshot: SaveSnapshot | null = initialSnapshot;

    while (currentSnapshot) {
      isSavingRef.current = true;
      clearSavedDisplayTimeout();
      setSaveStatusLogged('saving');

      try {
        const updatedBoard = await updateBoard(currentSnapshot.boardId, {
          settings: {
            tabs: currentSnapshot.tabs,
            activeTabId: currentSnapshot.activeTabId,
          },
        });

        if (activeBoardIdRef.current !== currentSnapshot.boardId) {
          pendingSnapshotRef.current = null;
          return;
        }

        setBoardUpdatedAt(updatedBoard.updated_at);
        onBoardUpdate?.(updatedBoard);

        setLastSavedAt(new Date());
        setSaveStatusLogged(currentSnapshot.isManual ? 'saved' : 'auto-saved');
        clearSavedDisplayTimeout();
        savedDisplayTimeoutRef.current = setTimeout(() => {
          setSaveStatusLogged('idle');
        }, 2000);
      } catch (error) {
        if (activeBoardIdRef.current !== currentSnapshot.boardId) {
          pendingSnapshotRef.current = null;
          return;
        }
        console.error('Failed to save tabs:', error);
        clearSavedDisplayTimeout();
        setSaveStatusLogged('unsaved');
      } finally {
        isSavingRef.current = false;
      }

      if (activeBoardIdRef.current !== currentSnapshot.boardId) {
        pendingSnapshotRef.current = null;
        return;
      }

      currentSnapshot = pendingSnapshotRef.current;
      pendingSnapshotRef.current = null;
    }
  }, [clearSavedDisplayTimeout, onBoardUpdate, setSaveStatusLogged]);

  const enqueueSnapshot = useCallback((snapshot: SaveSnapshot) => {
    if (isSavingRef.current) {
      pendingSnapshotRef.current = snapshot;
      return;
    }

    void runSaveQueue(snapshot);
  }, [runSaveQueue]);

  // Reset local tab state only when board/project identity changes.
  useEffect(() => {
    const currentBoard = activeBoardRef.current;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    clearSavedDisplayTimeout();
    pendingSnapshotRef.current = null;
    isSavingRef.current = false;
    setSaveStatusLogged('idle');
    setLastSavedAt(null);

    if (!currentBoard) {
      setTabs([]);
      setActiveTabId(null);
      setBoardUpdatedAt(null);
      return;
    }

    const nextTabs = migrateToTabs(currentBoard);
    const settings = currentBoard.settings || {};
    const nextActiveTabId = settings.activeTabId && nextTabs.find((tab) => tab.id === settings.activeTabId)
      ? settings.activeTabId
      : nextTabs[0]?.id || null;
    setTabs(nextTabs);
    setActiveTabId(nextActiveTabId);
    setBoardUpdatedAt(currentBoard.updated_at ?? null);
  }, [projectId, activeBoard?.id, clearSavedDisplayTimeout, setSaveStatusLogged]);

  // Keep timestamp in sync when parent board updates.
  useEffect(() => {
    setBoardUpdatedAt(activeBoard?.updated_at ?? null);
  }, [activeBoard?.id, activeBoard?.updated_at]);

  // Track latest active tab id for debounced saves.
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    if ((saveStatus === 'saved' || saveStatus === 'auto-saved') && lastSavedAt) {
      console.log(`[BoardsView] Last saved at: ${lastSavedAt.toISOString()}`);
    }
  }, [lastSavedAt, saveStatus]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      clearSavedDisplayTimeout();
    };
  }, [clearSavedDisplayTimeout]);

  // Get active tab
  const activeTab = useMemo(() => 
    tabs.find(t => t.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  );
  
  const saveTabs = useCallback((snapshotTabs: BoardTab[], snapshotActiveTabId: string | null, options?: SaveTabsOptions) => {
    const boardId = activeBoardIdRef.current;
    if (!boardId) {
      return;
    }

    const snapshot: SaveSnapshot = {
      boardId,
      tabs: snapshotTabs,
      activeTabId: snapshotActiveTabId,
      isManual: options?.isManual ?? false,
    };

    if (options?.immediate) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      enqueueSnapshot(snapshot);
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      enqueueSnapshot(snapshot);
    }, 500); // 500ms debounce for tab operations
  }, [enqueueSnapshot]);

  // Tab operations
  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    markUnsaved();
    saveTabs(tabs, tabId);
  }, [markUnsaved, saveTabs, tabs]);

  const handleAddTab = useCallback(() => {
    const newTab: BoardTab = {
      id: nanoid(),
      name: `Page ${tabs.length + 1}`,
      content: null,
    };
    const newTabs = [...tabs, newTab];
    setTabs(newTabs);
    setActiveTabId(newTab.id);
    markUnsaved();
    saveTabs(newTabs, newTab.id);
  }, [markUnsaved, saveTabs, tabs]);

  const handleRenameTab = useCallback((tabId: string, newName: string) => {
    const newTabs = tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName } : tab
    );
    setTabs(newTabs);
    markUnsaved();
    saveTabs(newTabs, activeTabIdRef.current);
  }, [markUnsaved, saveTabs, tabs]);

  const handleDeleteTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) return; // Don't delete last tab
    
    const newTabs = tabs.filter(tab => tab.id !== tabId);
    setTabs(newTabs);
    markUnsaved();
    
    // If deleted tab was active, switch to first tab
    if (activeTabId === tabId) {
      const newActiveId = newTabs[0]?.id || null;
      setActiveTabId(newActiveId);
      saveTabs(newTabs, newActiveId);
    } else {
      saveTabs(newTabs, activeTabId);
    }
  }, [activeTabId, markUnsaved, saveTabs, tabs]);

  // Update tab content (called from BoardEditor)
  const handleTabContentChange = useCallback((content: string) => {
    if (!activeTabId) return;
    
    const newTabs = tabs.map(tab =>
      tab.id === activeTabId ? { ...tab, content } : tab
    );
    setTabs(newTabs);
    markUnsaved();
    saveTabs(newTabs, activeTabId);
  }, [activeTabId, markUnsaved, saveTabs, tabs]);

  const handleManualSave = useCallback(() => {
    if (!activeTabIdRef.current) {
      return;
    }
    saveTabs(tabs, activeTabIdRef.current, { immediate: true, isManual: true });
  }, [saveTabs, tabs]);

  // Expose editor insertion methods to parent.
  useImperativeHandle(ref, () => ({
    insertMarkdown: (content: string) => {
      boardEditorRef.current?.insertMarkdown(content);
    },
    insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => {
      boardEditorRef.current?.insertAssetEmbed(analysisId, projectId, config);
    },
  }));

  if (!activeBoard) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-muted">
            <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">Select a board from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <BoardToolbar
        board={activeBoard}
        tabs={tabs}
        activeTabId={activeTabId}
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        onSave={handleManualSave}
        onSelectTab={handleSelectTab}
        onAddTab={handleAddTab}
        onRenameTab={handleRenameTab}
        onDeleteTab={handleDeleteTab}
      />
      <div className="flex-1 overflow-hidden relative">
        {activeTab && (
          <BoardEditor
            ref={boardEditorRef}
            key={`${activeBoard.id}-${activeTab.id}`}
            board={activeBoard}
            projectId={projectId}
            tabId={activeTab.id}
            tabName={activeTab.name}
            onRenameTab={(newName) => handleRenameTab(activeTab.id, newName)}
            boardUpdatedAt={boardUpdatedAt}
            initialContent={activeTab.content}
            onContentChange={handleTabContentChange}
            onContentDirty={markUnsaved}
          />
        )}
      </div>
    </div>
  );
});
