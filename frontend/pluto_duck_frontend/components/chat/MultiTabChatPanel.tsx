'use client';

import { useEffect, useRef } from 'react';
import { PlusIcon } from 'lucide-react';
import { TabBar } from './TabBar';
import { ChatPanel } from './ChatPanel';
import { useMultiTabChat, type ChatTab } from '../../hooks/useMultiTabChat';
import type { AssetEmbedConfig } from '../editor/nodes/AssetEmbedNode';

interface MultiTabChatPanelProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedDataSource: string;
  backendReady: boolean;
  projectId?: string | null;
  onSessionSelect?: (sessionId: string) => void;
  onTabsChange?: (tabs: ChatTab[], activeTabId: string | null) => void;
  savedTabs?: Array<{ id: string; order: number }>;
  savedActiveTabId?: string;
  onSendToBoard?: (messageId: string, content: string) => void;
  onEmbedAssetToBoard?: (analysisId: string, config: AssetEmbedConfig) => void;
}

export function MultiTabChatPanel({
  selectedModel,
  onModelChange,
  selectedDataSource,
  backendReady,
  projectId,
  onSessionSelect,
  onTabsChange,
  savedTabs,
  savedActiveTabId,
  onSendToBoard,
  onEmbedAssetToBoard,
}: MultiTabChatPanelProps) {
  const {
    tabs,
    activeTabId,
    activeTab,
    renderItems,
    loading,
    isStreaming,
    status,
    sessions,
    addTab,
    closeTab,
    switchTab,
    openSessionInTab,
    handleSubmit,
    handleFeedback,
    feedbackMap,
    restoreTabs,
  } = useMultiTabChat({
    selectedModel,
    selectedDataSource,
    backendReady,
    projectId,
  });

  const lastRestoreKeyRef = useRef<string | null>(null);

  // Notify parent when tabs change
  useEffect(() => {
    if (onTabsChange) {
      onTabsChange(tabs, activeTabId);
    }
  }, [tabs, activeTabId, onTabsChange]);

  // Restore tabs when project changes and sessions are loaded
  useEffect(() => {
    const savedTabsKey = savedTabs ? JSON.stringify(savedTabs) : '[]';
    const restoreKey = `${projectId ?? ''}|${savedTabsKey}|${savedActiveTabId ?? ''}|${sessions.length}`;

    console.log('[MultiTabChatPanel] Restore useEffect triggered', {
      projectId,
      savedTabs,
      savedActiveTabId,
      sessionsCount: sessions.length,
      tabsCount: tabs.length,
      restoreKey,
      lastRestoreKey: lastRestoreKeyRef.current,
    });
    
    if (!projectId) {
      return;
    }
    
    if (!savedTabs || savedTabs.length === 0) {
      lastRestoreKeyRef.current = restoreKey;
      return;
    }
    
    if (sessions.length === 0) {
      return;
    }
    
    // Only restore if tabs are empty (after reset)
    if (tabs.length > 0) {
      lastRestoreKeyRef.current = restoreKey;
      return;
    }

    if (lastRestoreKeyRef.current === restoreKey) {
      return;
    }
    
    // Restore tabs after sessions are loaded
    console.log('[MultiTabChatPanel] Starting restore with', savedTabs.length, 'tabs');
    lastRestoreKeyRef.current = restoreKey;
    
    const timer = setTimeout(() => {
      console.log('[MultiTabChatPanel] Calling restoreTabs with', savedTabs, savedActiveTabId);
      void restoreTabs(savedTabs, savedActiveTabId);
    }, 300);
    
    return () => {
      clearTimeout(timer);
    };
  }, [projectId, sessions.length, tabs.length, savedTabs, savedActiveTabId]);

  return (
    <div className="flex flex-col h-full w-full border-l border-border bg-background">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={switchTab}
        onTabClose={closeTab}
        onNewTab={addTab}
        sessions={sessions}
        onLoadSession={openSessionInTab}
      />
      
      <div className="flex-1 relative overflow-hidden">
        {tabs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col">
            <ChatPanel
              activeSession={null}
              renderItems={[]}
              loading={false}
              isStreaming={false}
              status="ready"
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              onSubmit={handleSubmit}
              projectId={projectId || undefined}
              onSendToBoard={onSendToBoard}
              onEmbedAssetToBoard={onEmbedAssetToBoard}
            />
          </div>
        ) : (
          tabs.map(tab => (
            <div
              key={tab.id}
              style={{ 
                display: tab.id === activeTabId ? 'flex' : 'none',
                flexDirection: 'column',
                height: '100%',
              }}
              className="absolute inset-0"
            >
              <ChatPanel
                activeSession={tab.sessionId ? {
                  id: tab.sessionId,
                  title: tab.title,
                  status: 'active',
                  created_at: new Date(tab.createdAt).toISOString(),
                  updated_at: new Date(tab.createdAt).toISOString(),
                  last_message_preview: null,
                } : null}
                renderItems={renderItems}
                loading={loading}
                isStreaming={isStreaming}
                status={status}
                selectedModel={selectedModel}
                onModelChange={onModelChange}
                onSubmit={handleSubmit}
                onFeedback={handleFeedback}
                feedbackMap={feedbackMap}
                projectId={projectId || undefined}
                onSendToBoard={onSendToBoard}
                onEmbedAssetToBoard={onEmbedAssetToBoard}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

