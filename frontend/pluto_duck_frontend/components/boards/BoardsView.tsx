'use client';

import { useState, useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { BoardToolbar } from './BoardToolbar';
import { BoardEditor, type BoardEditorHandle } from '../editor/BoardEditor';
import { Board, BoardTab, updateBoard } from '../../lib/boardsApi';
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

  // Expose insertMarkdown and insertAssetEmbed methods to parent
  useImperativeHandle(ref, () => ({
    insertMarkdown: (content: string) => {
      boardEditorRef.current?.insertMarkdown(content);
    },
    insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => {
      boardEditorRef.current?.insertAssetEmbed(analysisId, projectId, config);
    },
  }));

  const [tabs, setTabs] = useState<BoardTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [boardUpdatedAt, setBoardUpdatedAt] = useState<string | null>(activeBoard?.updated_at ?? null);
  const activeTabIdRef = useRef<string | null>(null);
  const saveSequenceRef = useRef(0);
  const appliedSaveSequenceRef = useRef(0);

  // Save tabs to backend - use ref to avoid stale closures
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset local tab state only when board/project identity changes.
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveSequenceRef.current = 0;
    appliedSaveSequenceRef.current = 0;

    if (!activeBoard) {
      setTabs([]);
      setActiveTabId(null);
      setBoardUpdatedAt(null);
      return;
    }

    const nextTabs = migrateToTabs(activeBoard);
    const settings = activeBoard.settings || {};
    const nextActiveTabId = settings.activeTabId && nextTabs.find((tab) => tab.id === settings.activeTabId)
      ? settings.activeTabId
      : nextTabs[0]?.id || null;
    setTabs(nextTabs);
    setActiveTabId(nextActiveTabId);
    setBoardUpdatedAt(activeBoard.updated_at ?? null);
  }, [projectId, activeBoard?.id]);

  // Keep timestamp in sync when parent board updates.
  useEffect(() => {
    setBoardUpdatedAt(activeBoard?.updated_at ?? null);
  }, [activeBoard?.id, activeBoard?.updated_at]);

  // Track latest active tab id for debounced saves.
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Get active tab
  const activeTab = useMemo(() => 
    tabs.find(t => t.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  );
  
  const saveTabs = useCallback(async (newTabs: BoardTab[], newActiveTabId?: string) => {
    if (!activeBoard) return;
    
    // Debounce saves to prevent too many API calls
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      const saveSequence = ++saveSequenceRef.current;
      try {
        const updated = await updateBoard(activeBoard.id, {
          settings: {
            tabs: newTabs,
            activeTabId: newActiveTabId ?? activeTabIdRef.current,
          },
        });
        setBoardUpdatedAt(updated.updated_at);
        if (saveSequence >= appliedSaveSequenceRef.current) {
          appliedSaveSequenceRef.current = saveSequence;
          onBoardUpdate?.(updated);
        }
      } catch (error) {
        console.error('Failed to save tabs:', error);
      }
    }, 500); // 500ms debounce for tab operations
  }, [activeBoard?.id, onBoardUpdate]); // Use activeBoard.id instead of activeBoard object

  // Tab operations
  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    saveTabs(tabs, tabId);
  }, [tabs, saveTabs]);

  const handleAddTab = useCallback(() => {
    const newTab: BoardTab = {
      id: nanoid(),
      name: `Page ${tabs.length + 1}`,
      content: null,
    };
    const newTabs = [...tabs, newTab];
    setTabs(newTabs);
    setActiveTabId(newTab.id);
    saveTabs(newTabs, newTab.id);
  }, [tabs, saveTabs]);

  const handleRenameTab = useCallback((tabId: string, newName: string) => {
    const newTabs = tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName } : tab
    );
    setTabs(newTabs);
    saveTabs(newTabs);
  }, [tabs, saveTabs]);

  const handleDeleteTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) return; // Don't delete last tab
    
    const newTabs = tabs.filter(tab => tab.id !== tabId);
    setTabs(newTabs);
    
    // If deleted tab was active, switch to first tab
    if (activeTabId === tabId) {
      const newActiveId = newTabs[0]?.id || null;
      setActiveTabId(newActiveId);
      saveTabs(newTabs, newActiveId || undefined);
    } else {
      saveTabs(newTabs);
    }
  }, [tabs, activeTabId, saveTabs]);

  // Update tab content (called from BoardEditor)
  const handleTabContentChange = useCallback((content: string) => {
    if (!activeTabId) return;
    
    const newTabs = tabs.map(tab =>
      tab.id === activeTabId ? { ...tab, content } : tab
    );
    setTabs(newTabs);
    saveTabs(newTabs);
  }, [tabs, activeTabId, saveTabs]);

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
          />
        )}
      </div>
    </div>
  );
});
