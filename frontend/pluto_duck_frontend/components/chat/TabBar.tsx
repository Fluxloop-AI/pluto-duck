'use client';

import { useState, useRef, useEffect } from 'react';
import { PlusIcon, XIcon, History } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ChatTab } from '../../hooks/useMultiTabChat';
import type { ChatSessionSummary } from '../../lib/chatApi';

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
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current && 
        !popupRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowSessionPopup(false);
      }
    };

    if (showSessionPopup) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSessionPopup]);

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
              'max-w-[200px] group relative',
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
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => setShowSessionPopup(!showSessionPopup)}
              className="p-1 hover:bg-accent rounded-md transition-colors"
              title="Load conversation"
            >
              <History className="h-4 w-4" />
            </button>

            {showSessionPopup && (
            <div
              ref={popupRef}
              className="absolute top-full left-0 mt-1 w-80 max-h-96 overflow-y-auto bg-popover border border-border rounded-md shadow-lg z-50"
            >
              {sessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No conversations found
                </div>
              ) : (
                <div className="py-1">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => handleSessionSelect(session)}
                      className="w-full px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <div className="text-xs font-medium truncate">
                        {session.title || 'Untitled conversation'}
                      </div>
                      {session.last_message_preview && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {session.last_message_preview}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(session.updated_at).toLocaleDateString()}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
}

