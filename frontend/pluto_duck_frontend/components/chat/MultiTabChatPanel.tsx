'use client';

import { useEffect, useRef } from 'react';
import { TabBar } from './TabBar';
import { ChatPanel } from './ChatPanel';
import { useMultiTabChat, type ChatTab } from '../../hooks/useMultiTabChat';
import { buildRestoreFingerprint } from '../../hooks/useMultiTabChat.restore';
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
    chatLoadingMode,
    status,
    sessions,
    addTab,
    closeTab,
    switchTab,
    openSessionInTab,
    handleSubmit,
    handleFeedback,
    handleApprovalDecision,
    feedbackMap,
    restoreTabs,
  } = useMultiTabChat({
    selectedModel,
    selectedDataSource,
    backendReady,
    projectId,
  });

  const lastRestoreKeyRef = useRef<string | null>(null);
  const activeSessionSummary = activeTab?.sessionId
    ? {
        id: activeTab.sessionId,
        title: activeTab.title,
        status: 'active',
        created_at: new Date(activeTab.createdAt).toISOString(),
        updated_at: new Date(activeTab.createdAt).toISOString(),
        last_message_preview: null,
      }
    : null;

  // Notify parent when tabs change
  useEffect(() => {
    if (onTabsChange) {
      onTabsChange(tabs, activeTabId);
    }
  }, [tabs, activeTabId, onTabsChange]);

  // Restore tabs when project changes and sessions are loaded
  useEffect(() => {
    const restoreKey = buildRestoreFingerprint({
      projectId,
      savedTabs,
      savedActiveTabId,
      sessions,
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
    
    lastRestoreKeyRef.current = restoreKey;
    restoreTabs(savedTabs, savedActiveTabId);
  }, [projectId, sessions, tabs.length, savedTabs, savedActiveTabId, restoreTabs]);

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
              chatLoadingMode="idle"
              status="ready"
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              onSubmit={handleSubmit}
              projectId={projectId || undefined}
              onSendToBoard={onSendToBoard}
              onApprovalDecision={handleApprovalDecision}
              onEmbedAssetToBoard={onEmbedAssetToBoard}
            />
          </div>
        ) : (
          <div
            key={activeTabId ?? 'active-tab'}
            className="absolute inset-0 flex flex-col"
          >
            <ChatPanel
              activeSession={activeSessionSummary}
              renderItems={renderItems}
              loading={loading}
              isStreaming={isStreaming}
              chatLoadingMode={chatLoadingMode}
              status={status}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              onSubmit={handleSubmit}
              onFeedback={handleFeedback}
              feedbackMap={feedbackMap}
              projectId={projectId || undefined}
              onSendToBoard={onSendToBoard}
              onApprovalDecision={handleApprovalDecision}
              onEmbedAssetToBoard={onEmbedAssetToBoard}
            />
          </div>
        )}
      </div>
    </div>
  );
}
