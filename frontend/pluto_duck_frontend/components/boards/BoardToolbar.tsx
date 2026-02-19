'use client';

import { useState, useRef, useEffect } from 'react';
import { PlusIcon, XIcon, MoreHorizontal, Pencil, Save, Play, Download, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getDisplayTabTitle } from '@/lib/boardTitle';
import type { Board, BoardTab, SaveStatus } from '../../lib/boardsApi';

interface BoardToolbarProps {
  board: Board | null;
  tabs: BoardTab[];
  activeTabId: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  onSave: () => void;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onRenameTab: (tabId: string, newName: string) => void;
  onDeleteTab: (tabId: string) => void;
}

export function BoardToolbar({
  board,
  tabs,
  activeTabId,
  saveStatus,
  lastSavedAt,
  onSave,
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
    if (editingTabId) {
      onRenameTab(editingTabId, editingName);
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

  const handleMenuAction = () => undefined;
  const formattedLastSavedAt = lastSavedAt?.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (!board) return null;

  return (
    <div
      className="flex items-center bg-background py-2"
      data-save-status={saveStatus}
      data-last-saved-at={lastSavedAt?.toISOString() ?? ''}
    >
      <div className="flex w-full items-center pl-4 pr-3">
        <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
          <div className="flex min-w-max items-center gap-1">
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
                      {getDisplayTabTitle(tab.name)}
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

            <button
              onClick={onAddTab}
              className="sticky right-0 z-10 ml-1 mr-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              title="Add new tab"
              aria-label="Add new tab"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mx-1.5 h-5 w-px flex-shrink-0 bg-border" />

        <TooltipProvider>
          <div className="flex flex-shrink-0 items-center gap-1 pl-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onSave}
                  className={cn(
                    'relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
                    saveStatus === 'saving' && 'pointer-events-none opacity-50'
                  )}
                  aria-label="Save"
                >
                  <Save className="h-4 w-4" />
                  {saveStatus === 'unsaved' && (
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-orange-400" />
                  )}
                  {saveStatus === 'saving' && (
                    <span className="absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center rounded-full bg-background">
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                    </span>
                  )}
                  {(saveStatus === 'saved' || saveStatus === 'auto-saved') && (
                    <span className="absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center rounded-full bg-green-500">
                      <Check className="h-2 w-2 text-white" />
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {(saveStatus === 'idle' || saveStatus === 'unsaved') && <p>Save (⌘S)</p>}
                {saveStatus === 'saving' && <p>Saving...</p>}
                {saveStatus === 'saved' && (
                  <p>{formattedLastSavedAt ? `Saved · ${formattedLastSavedAt}` : 'Saved'}</p>
                )}
                {saveStatus === 'auto-saved' && (
                  <p>{formattedLastSavedAt ? `Auto-saved · ${formattedLastSavedAt}` : 'Auto-saved'}</p>
                )}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleMenuAction}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  aria-label="Run"
                >
                  <Play className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Run</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleMenuAction}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  aria-label="Export"
                >
                  <Download className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Export</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
