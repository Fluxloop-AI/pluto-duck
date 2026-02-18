'use client';

import { useState, useRef, useEffect } from 'react';
import { PlusIcon, XIcon, MoreHorizontal, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Board, BoardTab } from '../../lib/boardsApi';

interface BoardToolbarProps {
  board: Board | null;
  tabs: BoardTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onRenameTab: (tabId: string, newName: string) => void;
  onDeleteTab: (tabId: string) => void;
}

export function BoardToolbar({
  board,
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onDeleteTab,
}: BoardToolbarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const handleStartRename = (tab: BoardTab) => {
    setEditingTabId(tab.id);
    setEditingName(tab.name);
  };

  const handleFinishRename = () => {
    if (editingTabId && editingName.trim()) {
      onRenameTab(editingTabId, editingName.trim());
    }
    setEditingTabId(null);
    setEditingName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishRename();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
      setEditingName('');
    }
  };

  if (!board) return null;

  return (
    <div className="flex items-center bg-background pt-2">
      {/* Tab List - aligned with editor content */}
      <div className="w-full max-w-4xl pl-6">
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={cn(
                    'group relative flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors',
                    activeTabId === tab.id
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  {editingTabId === tab.id ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={handleFinishRename}
                      onKeyDown={handleKeyDown}
                      className="w-20 bg-transparent text-sm outline-none"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => onSelectTab(tab.id)}
                        onDoubleClick={() => handleStartRename(tab)}
                        className="truncate max-w-[120px]"
                      >
                        {tab.name}
                      </button>

                      {/* Tab Actions (visible on hover or when active) */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              'h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-100',
                              activeTabId === tab.id && 'opacity-50'
                            )}
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-32">
                          <DropdownMenuItem onClick={() => handleStartRename(tab)}>
                            <Pencil className="mr-2 h-3 w-3" />
                            Rename
                          </DropdownMenuItem>
                          {tabs.length > 1 && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => onDeleteTab(tab.id)}
                            >
                              <XIcon className="mr-2 h-3 w-3" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Add Tab Button */}
          <button
            onClick={onAddTab}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="Add new tab"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
