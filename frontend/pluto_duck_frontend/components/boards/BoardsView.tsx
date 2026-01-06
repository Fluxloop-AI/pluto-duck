'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
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
  // Initialize tabs from board settings
  const [tabs, setTabs] = useState<BoardTab[]>(() => 
    activeBoard ? migrateToTabs(activeBoard) : []
  );
  
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    if (!activeBoard) return null;
    const settings = activeBoard.settings || {};
    const initialTabs = migrateToTabs(activeBoard);
    return settings.activeTabId || initialTabs[0]?.id || null;
  });

  // Update tabs when board changes
  useEffect(() => {
    if (activeBoard) {
      const newTabs = migrateToTabs(activeBoard);
      setTabs(newTabs);
      
      const settings = activeBoard.settings || {};
      // Keep activeTabId if it exists in new tabs, otherwise use first tab
      const validTabId = newTabs.find(t => t.id === settings.activeTabId)?.id 
        || newTabs[0]?.id 
        || null;
      setActiveTabId(validTabId);
    } else {
      setTabs([]);
      setActiveTabId(null);
    }
  }, [activeBoard?.id]); // Only when board changes

  // Get active tab
  const activeTab = useMemo(() => 
    tabs.find(t => t.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  );

  // Save tabs to backend
  const saveTabs = useCallback(async (newTabs: BoardTab[], newActiveTabId?: string) => {
    if (!activeBoard) return;
    
    try {
      await updateBoard(activeBoard.id, {
        settings: {
          ...activeBoard.settings,
          tabs: newTabs,
          activeTabId: newActiveTabId || activeTabId,
          // Clear legacy content field after migration
          content: undefined,
        },
      });
    } catch (error) {
      console.error('Failed to save tabs:', error);
    }
  }, [activeBoard, activeTabId]);

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
