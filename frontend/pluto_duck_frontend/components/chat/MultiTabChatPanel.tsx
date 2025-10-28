'use client';

import { PlusIcon } from 'lucide-react';
import { TabBar } from './TabBar';
import { ChatPanel } from './ChatPanel';
import { useMultiTabChat, type ChatTab } from '../../hooks/useMultiTabChat';
import type { DataSource, DataSourceTable } from '../../lib/dataSourcesApi';

interface MultiTabChatPanelProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedDataSource: string;
  dataSources: DataSource[];
  allTables: DataSourceTable[];
  backendReady: boolean;
  onSessionSelect?: (sessionId: string) => void;
}

export function MultiTabChatPanel({
  selectedModel,
  onModelChange,
  selectedDataSource,
  dataSources,
  allTables,
  backendReady,
  onSessionSelect,
}: MultiTabChatPanelProps) {
  const {
    tabs,
    activeTabId,
    activeTab,
    detail,
    loading,
    isStreaming,
    status,
    reasoningEvents,
    sessions,
    addTab,
    closeTab,
    switchTab,
    openSessionInTab,
    handleSubmit,
  } = useMultiTabChat({
    selectedModel,
    selectedDataSource,
    backendReady,
  });

  return (
    <div className="flex flex-col h-full w-[500px] border-l border-border bg-background">
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
              detail={null}
              loading={false}
              isStreaming={false}
              status="ready"
              reasoningEvents={[]}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              dataSources={dataSources}
              allTables={allTables}
              onSubmit={handleSubmit}
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
                detail={detail}
                loading={loading}
                isStreaming={isStreaming}
                status={status}
                reasoningEvents={reasoningEvents}
                selectedModel={selectedModel}
                onModelChange={onModelChange}
                dataSources={dataSources}
                allTables={allTables}
                onSubmit={handleSubmit}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

