'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCcwIcon, PlusIcon, SettingsIcon, DatabaseIcon } from 'lucide-react';

import { ConversationList, SettingsModal, MultiTabChatPanel } from '../components/chat';
import {
  DataSourcesView,
  ImportCSVModal,
  ImportParquetModal,
  ImportPostgresModal,
  ImportSQLiteModal,
} from '../components/data-sources';
import { Loader } from '../components/ai-elements';
import { fetchSettings } from '../lib/settingsApi';
import { fetchDataSources, fetchDataSourceDetail, type DataSource, type DataSourceTable } from '../lib/dataSourcesApi';
import { useMultiTabChat } from '../hooks/useMultiTabChat';
import { useBackendStatus } from '../hooks/useBackendStatus';

type ViewMode = 'placeholder' | 'data-sources';

export default function WorkspacePage() {
  const { isReady: backendReady, isChecking: backendChecking } = useBackendStatus();
  const [currentView, setCurrentView] = useState<ViewMode>('placeholder');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gpt-5-mini');
  const [selectedDataSource, setSelectedDataSource] = useState('all');
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [allTables, setAllTables] = useState<DataSourceTable[]>([]);
  const [importCSVOpen, setImportCSVOpen] = useState(false);
  const [importParquetOpen, setImportParquetOpen] = useState(false);
  const [importPostgresOpen, setImportPostgresOpen] = useState(false);
  const [importSQLiteOpen, setImportSQLiteOpen] = useState(false);
  const [dataSourcesRefresh, setDataSourcesRefresh] = useState(0);
  const [selectedSourceForImport, setSelectedSourceForImport] = useState<DataSource | undefined>(undefined);

  const {
    sessions,
    openSessionInTab,
    handleDeleteSession,
    handleNewConversation,
    loadSessions,
  } = useMultiTabChat({
    selectedModel,
    selectedDataSource,
    backendReady,
  });

  // Load default model from settings and data sources
  useEffect(() => {
    if (backendReady) {
      void (async () => {
        try {
          const settings = await fetchSettings();
          if (settings.llm_model) {
            setSelectedModel(settings.llm_model);
          }
        } catch (error) {
          console.error('Failed to load default model from settings', error);
        }
        
        try {
          const sources = await fetchDataSources();
          setDataSources(sources);
          const details = await Promise.all(
            sources.map(async source => {
              try {
                const detail = await fetchDataSourceDetail(source.id);
                return detail;
              } catch (error) {
                console.error('Failed to load source detail', source.id, error);
                return null;
              }
            })
          );
          const tables: DataSourceTable[] = [];
          for (const detail of details) {
            if (detail) {
              tables.push(...detail.tables);
            }
          }
          setAllTables(tables);
        } catch (error) {
          console.error('Failed to load data sources', error);
        }
      })();
    }
  }, [backendReady]);

  const handleImportClick = useCallback((connectorType: string, source?: DataSource) => {
    setSelectedSourceForImport(source);
    
    switch (connectorType) {
      case 'csv':
        setImportCSVOpen(true);
        break;
      case 'parquet':
        setImportParquetOpen(true);
        break;
      case 'postgres':
        setImportPostgresOpen(true);
        break;
      case 'sqlite':
        setImportSQLiteOpen(true);
        break;
      default:
        console.error('Unknown connector type:', connectorType);
    }
  }, []);

  const handleImportSuccess = useCallback(() => {
    // Trigger refresh of data sources list
    setDataSourcesRefresh(prev => prev + 1);
    // Reload data sources for dropdown
    void (async () => {
      try {
        const sources = await fetchDataSources();
        setDataSources(sources);
        const details = await Promise.all(
          sources.map(async source => {
            try {
              const detail = await fetchDataSourceDetail(source.id);
              return detail;
            } catch (error) {
              console.error('Failed to load source detail', source.id, error);
              return null;
            }
          })
        );
        const tables: DataSourceTable[] = [];
        for (const detail of details) {
          if (detail) {
            tables.push(...detail.tables);
          }
        }
        setAllTables(tables);
      } catch (error) {
        console.error('Failed to reload data sources', error);
      }
    })();
  }, []);

  return (
    <div className="flex h-screen w-full flex-1 relative">
      {/* Backend status overlay */}
      {!backendReady && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-lg border bg-card p-8 text-center shadow-lg">
            <Loader />
            <p className="mt-4 text-sm font-medium text-muted-foreground">
              {backendChecking ? 'Connecting to backend...' : 'Backend is starting...'}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Please wait while the backend initializes
            </p>
          </div>
        </div>
      )}

      {/* Left Sidebar - Conversation list */}
      <aside className="hidden w-80 border-r border-border bg-muted/20 px-4 py-6 lg:flex lg:flex-col">
        {/* Top action buttons */}
        <div className="mb-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card hover:bg-accent"
            onClick={() => void loadSessions()}
            title="Refresh"
          >
            <RefreshCcwIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            onClick={handleNewConversation}
            title="New conversation"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          <ConversationList 
            sessions={sessions} 
            activeId={undefined}
            onSelect={openSessionInTab} 
            onDelete={handleDeleteSession} 
          />
        </div>

        {/* Bottom buttons */}
        <div className="mt-4 space-y-2">
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
              currentView === 'data-sources'
                ? 'border-primary/60 bg-primary/10 text-primary'
                : 'border-border bg-card hover:bg-accent'
            }`}
            onClick={() => setCurrentView('data-sources')}
          >
            <DatabaseIcon className="h-4 w-4" />
            <span>Data Sources</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon className="h-4 w-4" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Settings Modal */}
      <SettingsModal 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen}
        onSettingsSaved={(model) => setSelectedModel(model)}
      />

      {/* Import Modals */}
      <ImportCSVModal
        open={importCSVOpen}
        onOpenChange={setImportCSVOpen}
        onImportSuccess={handleImportSuccess}
      />
      <ImportParquetModal
        open={importParquetOpen}
        onOpenChange={setImportParquetOpen}
        onImportSuccess={handleImportSuccess}
      />
      <ImportPostgresModal
        open={importPostgresOpen}
        onOpenChange={(open) => {
          setImportPostgresOpen(open);
          if (!open) setSelectedSourceForImport(undefined);
        }}
        onImportSuccess={handleImportSuccess}
        existingSource={selectedSourceForImport}
      />
      <ImportSQLiteModal
        open={importSQLiteOpen}
        onOpenChange={(open) => {
          setImportSQLiteOpen(open);
          if (!open) setSelectedSourceForImport(undefined);
        }}
        onImportSuccess={handleImportSuccess}
        existingSource={selectedSourceForImport}
      />

      {/* Center area - Main content (boards will go here) */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-muted/5">
        {currentView === 'data-sources' ? (
          <DataSourcesView 
            onImportClick={handleImportClick}
            refreshTrigger={dataSourcesRefresh}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-4">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted">
                <svg
                  className="h-8 w-8 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Board Area</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Boards will be displayed here
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Start a conversation to create visualizations and dashboards
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar - Multi-Tab Chat Panel */}
      <div className="hidden lg:flex">
        <MultiTabChatPanel
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          selectedDataSource={selectedDataSource}
          dataSources={dataSources}
          allTables={allTables}
          backendReady={backendReady}
        />
      </div>
    </div>
  );
}
