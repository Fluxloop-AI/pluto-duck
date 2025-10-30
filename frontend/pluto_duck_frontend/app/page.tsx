'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCcwIcon, PlusIcon, SettingsIcon, DatabaseIcon, ChevronLeft, ChevronRight } from 'lucide-react';

import { SettingsModal, MultiTabChatPanel } from '../components/chat';
import {
  DataSourcesView,
  ImportCSVModal,
  ImportParquetModal,
  ImportPostgresModal,
  ImportSQLiteModal,
} from '../components/data-sources';
import { BoardsView, BoardList, CreateBoardModal } from '../components/boards';
import { ProjectSelector, CreateProjectModal } from '../components/projects';
import { useBoards } from '../hooks/useBoards';
import { useProjects } from '../hooks/useProjects';
import { useProjectState } from '../hooks/useProjectState';
import type { Board } from '../lib/boardsApi';
import type { ChatTab } from '../hooks/useMultiTabChat';
import { Loader } from '../components/ai-elements';
import { fetchSettings } from '../lib/settingsApi';
import { fetchDataSources, fetchDataSourceDetail, type DataSource, type DataSourceTable } from '../lib/dataSourcesApi';
import { fetchProject, type Project, type ProjectListItem } from '../lib/projectsApi';
import { useBackendStatus } from '../hooks/useBackendStatus';

type ViewMode = 'boards' | 'data-sources';

export default function WorkspacePage() {
  const { isReady: backendReady, isChecking: backendChecking } = useBackendStatus();
  const [currentView, setCurrentView] = useState<ViewMode>('boards');
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
  const [defaultProjectId, setDefaultProjectId] = useState<string | null>(null);
  const [currentProject, setCurrentProject] = useState<ProjectListItem | null>(null);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatTabs, setChatTabs] = useState<ChatTab[]>([]);
  const [activeChatTabId, setActiveChatTabId] = useState<string | null>(null);

  const {
    projects,
    loading: projectsLoading,
    createProject: apiCreateProject,
    reload: reloadProjects,
  } = useProjects({
    enabled: backendReady,
  });

  const {
    boards,
    activeBoard,
    createBoard,
    deleteBoard,
    selectBoard,
  } = useBoards({
    projectId: defaultProjectId || '',
    enabled: !!defaultProjectId && backendReady,
  });

  // Project state management for auto-save
  const { debouncedSaveState, saveState } = useProjectState({
    projectId: defaultProjectId,
    enabled: backendReady,
    autoSaveDelay: 2000,
  });

  // Load current project details whenever the active project changes
  useEffect(() => {
    if (!defaultProjectId) return;

    void (async () => {
      try {
        const detail = await fetchProject(defaultProjectId);
        const listItem = projects.find(p => p.id === defaultProjectId);

        const mergedProject: ProjectListItem = {
          ...detail,
          board_count: listItem?.board_count ?? 0,
          conversation_count: listItem?.conversation_count ?? 0,
        };

        setCurrentProject(mergedProject);
        console.log('[Page] Loaded current project detail:', mergedProject.settings?.ui_state);
      } catch (error) {
        console.error('Failed to load project detail', error);
      }
    })();
  }, [defaultProjectId, projects]);

  // Auto-save project state when it changes
  useEffect(() => {
    if (!defaultProjectId || !backendReady) return;
    
    const tabsToSave = chatTabs
      .filter(tab => tab.sessionId)
      .map((tab, index) => ({
        id: tab.sessionId!,
        order: index,
      }));
    
    // Find the active tab's sessionId
    const activeTab = chatTabs.find(tab => tab.id === activeChatTabId);
    const activeSessionId = activeTab?.sessionId || null;
    
    const state = {
      chatTabs: tabsToSave,
      activeChatTabId: activeSessionId,
      activeBoardId: activeBoard?.id || null,
      activeView: currentView,
    };
    
    debouncedSaveState(state);
  }, [defaultProjectId, activeBoard, currentView, chatTabs, activeChatTabId, backendReady, debouncedSaveState]);

  // Load default model from settings and data sources
  useEffect(() => {
    if (backendReady) {
      void (async () => {
        try {
          const settings = await fetchSettings();
          if (settings.llm_model) {
            setSelectedModel(settings.llm_model);
          }
          if (settings.default_project_id) {
            setDefaultProjectId(settings.default_project_id);
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

  const handleSelectProject = useCallback(async (project: ProjectListItem) => {
    console.log('[Page] Switching to project', project.name, project.id);
    console.log('[Page] Project saved state:', project.settings?.ui_state);
    
    // Save current project state before switching
    if (defaultProjectId) {
      // Convert chat tabs to saveable format (only sessionId)
      const tabsToSave = chatTabs
        .filter(tab => tab.sessionId) // Only save tabs with actual conversations
        .map((tab, index) => ({
          id: tab.sessionId!,
          order: index,
        }));
      
      // Find the active tab's sessionId
      const activeTab = chatTabs.find(tab => tab.id === activeChatTabId);
      const activeSessionId = activeTab?.sessionId || null;
      
      console.log('[Page] Saving current project state:', {
        chatTabs: tabsToSave,
        activeChatTabId: activeSessionId,
      });
      
      await saveState({
        chatTabs: tabsToSave,
        activeChatTabId: activeSessionId,
        activeBoardId: activeBoard?.id || null,
        activeView: currentView,
      });
      await reloadProjects();
    }
    
    // Switch to new project
    setDefaultProjectId(project.id);
    
    // Switch to boards view and show empty state
    setCurrentView('boards');
    
    console.log('[Page] Project switched, will restore:', project.settings?.ui_state?.chat);
    
    // Reset board selection - show empty state in center area
    // The useBoards hook will reload boards for the new project and reset activeBoard
    // User needs to select a board manually
  }, [defaultProjectId, activeBoard, currentView, saveState, chatTabs, activeChatTabId, reloadProjects]);

  const handleCreateProject = useCallback(async (data: { name: string; description?: string }) => {
    const newProject = await apiCreateProject(data);
    await reloadProjects();
    
    // Switch to new project
    setDefaultProjectId(newProject.id);
    // Project will be set by the useEffect
  }, [apiCreateProject, reloadProjects]);

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

      {/* Left Sidebar - Board list */}
      <aside className={`hidden border-r border-border bg-muted/20 lg:flex lg:flex-col transition-all duration-300 ${
        sidebarCollapsed ? 'w-12' : 'w-64'
      }`}>
        {sidebarCollapsed ? (
          <>
            {/* Collapsed Toolbar */}
            <div className="flex items-center justify-center border-b border-border bg-background px-2 pt-3 pb-1">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card hover:bg-accent"
                title="Expand sidebar"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Collapsed board items */}
            <div className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
              {boards.map((board) => (
                <button
                  key={board.id}
                  onClick={() => {
                    setCurrentView('boards');
                    selectBoard(board);
                  }}
                  className={`w-full h-8 rounded border transition-colors flex items-center justify-center text-xs font-medium ${
                    activeBoard?.id === board.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card hover:bg-accent text-muted-foreground'
                  }`}
                  title={board.name}
                >
                  {board.name.charAt(0).toUpperCase()}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b border-border bg-background px-3 pt-3 pb-1">
              <div className="flex-1 min-w-0">
                <ProjectSelector
                  currentProject={currentProject}
                  projects={projects}
                  onSelectProject={handleSelectProject}
                  onNewProject={() => setShowCreateProjectModal(true)}
                />
              </div>
              
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card hover:bg-accent ml-2 shrink-0"
                title="Collapse sidebar"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* New board button */}
            <div className="px-3 pt-3">
              <button
                type="button"
                onClick={() => {
                  setCurrentView('boards');
                  setShowCreateBoardModal(true);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20"
                title="New board"
              >
                <PlusIcon className="h-4 w-4" />
                New Board
              </button>
            </div>

            {/* Board list */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <BoardList
                boards={boards}
                activeId={activeBoard?.id}
                onSelect={(board: Board) => {
                  setCurrentView('boards');
                  selectBoard(board);
                }}
                onDelete={(board: Board) => deleteBoard(board.id)}
              />
            </div>
          </>
        )}

        {/* Bottom buttons */}
        {!sidebarCollapsed && (
          <div className="space-y-2 px-3 pb-4">
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
        )}
      </aside>

      {/* Settings Modal */}
      <SettingsModal 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen}
        onSettingsSaved={(model) => setSelectedModel(model)}
      />

      {/* Create Board Modal */}
      <CreateBoardModal
        open={showCreateBoardModal}
        onOpenChange={setShowCreateBoardModal}
        onSubmit={async (name: string, description?: string) => {
          await createBoard(name, description);
        }}
      />

      {/* Create Project Modal */}
      <CreateProjectModal
        open={showCreateProjectModal}
        onOpenChange={setShowCreateProjectModal}
        onSubmit={handleCreateProject}
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

      {/* Center area - Boards or Data Sources */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-muted/5">
        {currentView === 'data-sources' ? (
          <DataSourcesView 
            onImportClick={handleImportClick}
            refreshTrigger={dataSourcesRefresh}
          />
        ) : defaultProjectId ? (
          <BoardsView projectId={defaultProjectId} activeBoard={activeBoard} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader />
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
          projectId={defaultProjectId}
          onTabsChange={(tabs, activeId) => {
            setChatTabs(tabs);
            setActiveChatTabId(activeId);
          }}
          savedTabs={currentProject?.settings?.ui_state?.chat?.open_tabs}
          savedActiveTabId={currentProject?.settings?.ui_state?.chat?.active_tab_id}
        />
      </div>
    </div>
  );
}
