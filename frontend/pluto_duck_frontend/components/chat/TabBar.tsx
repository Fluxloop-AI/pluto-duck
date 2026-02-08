'use client';

import { useState } from 'react';
import { PlusIcon, XIcon, History } from 'lucide-react';
import { cn, formatRelativeTime } from '../../lib/utils';
import type { ChatTab } from '../../hooks/useMultiTabChat';
import type { ChatSessionSummary } from '../../lib/chatApi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  sessions?: ChatSessionSummary[];
  onLoadSession?: (session: ChatSessionSummary) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  sessions = [],
  onLoadSession,
}: TabBarProps) {
  const [showSessionPopup, setShowSessionPopup] = useState(false);

  const handleSessionSelect = (session: ChatSessionSummary) => {
    onLoadSession?.(session);
    setShowSessionPopup(false);
  };

  return (
    <div className="flex items-center gap-1 px-3 pt-3 pb-1 bg-background shrink-0 relative">
      {/* Scrollable tab area */}
      <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 scrollbar-thin">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={cn(
              'flex items-center justify-center gap-0.5 pl-1.5 pr-1 py-1 rounded-md text-xs transition-colors cursor-pointer shrink-0',
              'max-w-[120px] group relative',
              activeTabId === tab.id
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50 text-muted-foreground'
            )}
            onClick={() => onTabClick(tab.id)}
          >
            <span className="truncate">{tab.title}</span>
            <div
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              className={cn(
                'opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity cursor-pointer',
                'flex items-center justify-center'
              )}
              title="Close tab"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onTabClose(tab.id);
                }
              }}
            >
              <XIcon className="h-3 w-3" />
            </div>
          </div>
        ))}
      </div>

      {/* Fixed button area */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onNewTab}
          className="p-1 hover:bg-accent rounded-md transition-colors"
          title="New tab"
        >
          <PlusIcon className="h-4 w-4" />
        </button>

        {onLoadSession && (
          <DropdownMenu open={showSessionPopup} onOpenChange={setShowSessionPopup}>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 hover:bg-accent rounded-md transition-colors"
                title="Load conversation"
              >
                <History className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={8}
              className="w-64 max-h-96 p-0 overflow-y-auto"
            >
              {sessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No conversations found
                </div>
              ) : (
                <div className="py-1">
                  {sessions.map((session) => (
                    <DropdownMenuItem
                      key={session.id}
                      onSelect={() => handleSessionSelect(session)}
                      className="w-full px-3 py-2 cursor-pointer transition-colors"
                    >
                      <div className="w-full flex items-center gap-2 min-w-0">
                        <div className="text-xs font-medium truncate min-w-0 flex-1">
                          {session.title || 'Untitled conversation'}
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">
                          {formatRelativeTime(session.updated_at)}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
