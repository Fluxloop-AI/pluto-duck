'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { BoardToolbar } from './BoardToolbar';
import { BoardEditor } from '../editor/BoardEditor';
import { Board, BoardTab, updateBoard } from '../../lib/boardsApi';
import { nanoid } from 'nanoid';

interface BoardsViewProps {
  projectId: string;
  activeBoard: Board | null;
  onBoardUpdate?: (board: Board) => void;
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

export function BoardsView({ projectId, activeBoard, onBoardUpdate }: BoardsViewProps) {
  // Initialize tabs from board settings - use useMemo to ensure consistent IDs
  const initialData = useMemo(() => {
    if (!activeBoard) {
      return { tabs: [], activeTabId: null };
    }
    const tabs = migrateToTabs(activeBoard);
    const settings = activeBoard.settings || {};
    const activeTabId = settings.activeTabId && tabs.find(t => t.id === settings.activeTabId)
      ? settings.activeTabId
      : tabs[0]?.id || null;
    return { tabs, activeTabId };
  }, [activeBoard?.id, projectId]); // Include projectId to reset on project change

  const [tabs, setTabs] = useState<BoardTab[]>(initialData.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialData.activeTabId);

  // Save tabs to backend - use ref to avoid stale closures
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);

  // Update tabs when board/project changes and cleanup pending saves
  useEffect(() => {
    // Clear any pending save timeout when board/project changes
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    isSavingRef.current = false;
    
    setTabs(initialData.tabs);
    setActiveTabId(initialData.activeTabId);
    
    // Cleanup on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [initialData]);

  // Get active tab
  const activeTab = useMemo(() => 
    tabs.find(t => t.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  );
  
  const saveTabs = useCallback(async (newTabs: BoardTab[], newActiveTabId?: string) => {
    if (!activeBoard || isSavingRef.current) return;
    
    // Debounce saves to prevent too many API calls
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      isSavingRef.current = true;
      try {
        await updateBoard(activeBoard.id, {
          settings: {
            tabs: newTabs,
            activeTabId: newActiveTabId || activeTabId,
          },
        });
      } catch (error) {
        console.error('Failed to save tabs:', error);
      } finally {
        isSavingRef.current = false;
      }
    }, 500); // 500ms debounce for tab operations
  }, [activeBoard?.id, activeTabId]); // Use activeBoard.id instead of activeBoard object

  // Tab operations
  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    // Save active tab preference
    if (activeBoard) {
      updateBoard(activeBoard.id, {
        settings: {
          ...activeBoard.settings,
          tabs,
          activeTabId: tabId,
        },
      }).catch(console.error);
    }
  }, [activeBoard, tabs]);

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
            key={`${activeBoard.id}-${activeTab.id}`}
            board={activeBoard}
            projectId={projectId}
            tabId={activeTab.id}
            initialContent={activeTab.content}
            onContentChange={handleTabContentChange}
          />
        )}
      </div>
    </div>
  );
}
