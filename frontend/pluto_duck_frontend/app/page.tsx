'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlusIcon, SettingsIcon, DatabaseIcon, PanelLeftClose, PanelLeftOpen, SquarePen, Layers, PanelRightClose, PanelRightOpen, Package } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from '../lib/tauriRuntime';

import { SettingsModal, MultiTabChatPanel } from '../components/chat';
import { UpdateBanner } from '../components/UpdateBanner';
import {
  DataSourcesModal,
  ImportCSVModal,
  ImportParquetModal,
  ImportPostgresModal,
  ImportSQLiteModal,
  ConnectFolderModal,
} from '../components/data-sources';
import { BoardsView, BoardList, CreateBoardModal } from '../components/boards';
import { AssetListView } from '../components/assets';
import { ProjectSelector, CreateProjectModal } from '../components/projects';
import { useBoards } from '../hooks/useBoards';
import { useProjects } from '../hooks/useProjects';
import { useProjectState } from '../hooks/useProjectState';
import type { Board } from '../lib/boardsApi';
import type { ChatTab } from '../hooks/useMultiTabChat';
import { Loader } from '../components/ai-elements/loader';
import { fetchSettings } from '../lib/settingsApi';
import { loadLocalModel, unloadLocalModel } from '../lib/modelsApi';
import { fetchDataSources, fetchDataSourceDetail, type DataSource, type DataSourceTable } from '../lib/dataSourcesApi';
import { fetchProject, type Project, type ProjectListItem } from '../lib/projectsApi';
import { useBackendStatus } from '../hooks/useBackendStatus';

type MainView = 'boards' | 'assets';

export default function WorkspacePage() {
  const { isReady: backendReady, isChecking: backendChecking } = useBackendStatus();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gpt-5-mini');
  const [selectedDataSource, setSelectedDataSource] = useState('all');
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [allTables, setAllTables] = useState<DataSourceTable[]>([]);
  const [importCSVOpen, setImportCSVOpen] = useState(false);
  const [importParquetOpen, setImportParquetOpen] = useState(false);
  const [importPostgresOpen, setImportPostgresOpen] = useState(false);
  const [importSQLiteOpen, setImportSQLiteOpen] = useState(false);
  const [connectFolderOpen, setConnectFolderOpen] = useState(false);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [dataSourcesRefresh, setDataSourcesRefresh] = useState(0);
  const [selectedSourceForImport, setSelectedSourceForImport] = useState<DataSource | undefined>(undefined);
  const [defaultProjectId, setDefaultProjectId] = useState<string | null>(null);
  const [currentProject, setCurrentProject] = useState<ProjectListItem | null>(null);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false);
  const [mainView, setMainView] = useState<MainView>('boards');
  const [assetInitialTab, setAssetInitialTab] = useState<'analyses' | 'datasources'>('analyses');
  const [chatPanelWidth, setChatPanelWidth] = useState(380);
  const [chatTabs, setChatTabs] = useState<ChatTab[]>([]);
  const [activeChatTabId, setActiveChatTabId] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);

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
    };
    
    debouncedSaveState(state);
  }, [defaultProjectId, chatTabs, activeChatTabId, backendReady, debouncedSaveState]);

  // Load default model and project from settings
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
      })();
    }
  }, [backendReady]);
        
  // Load data sources when project is selected
  useEffect(() => {
    if (backendReady && defaultProjectId) {
      void (async () => {
        try {
          const sources = await fetchDataSources(defaultProjectId);
          setDataSources(sources);
          const details = await Promise.all(
            sources.map(async source => {
              try {
                const detail = await fetchDataSourceDetail(defaultProjectId, source.name);
                return detail;
              } catch (error) {
                console.error('Failed to load source detail', source.name, error);
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
  }, [backendReady, defaultProjectId]);

  useEffect(() => {
    if (!backendReady) return;
    if (!selectedModel) return;

    if (selectedModel.startsWith('local:')) {
      const modelId = selectedModel.slice('local:'.length);
      void loadLocalModel(modelId).catch(error => {
        console.error('Failed to load local model', error);
      });
    } else {
      void unloadLocalModel().catch(error => {
        console.error('Failed to unload local model', error);
      });
    }
  }, [backendReady, selectedModel]);

  const handleImportClick = useCallback((connectorType: string, source?: DataSource) => {
    setSelectedSourceForImport(source);
    
    switch (connectorType) {
      case 'file': {
        void (async () => {
          try {
            let filePath: string | null = null;
            if (isTauriRuntime()) {
              const selected = await openDialog({
                multiple: false,
                filters: [
                  {
                    name: 'Data Files',
                    extensions: ['csv', 'parquet'],
                  },
                ],
              });
              if (!selected) return;
              filePath = selected as string;
            } else {
              filePath = window.prompt('Paste the absolute file path (.csv or .parquet):') || null;
              if (!filePath) return;
            }
            const ext = filePath.split('.').pop()?.toLowerCase();
            setImportFilePath(filePath);
            if (ext === 'csv') {
        setImportCSVOpen(true);
              return;
            }
            if (ext === 'parquet') {
              setImportParquetOpen(true);
              return;
            }
            console.error('Unsupported file extension:', ext);
          } catch (e) {
            console.error('Failed to open file dialog:', e);
          }
        })();
        break;
      }
      case 'folder':
        setConnectFolderOpen(true);
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
      });
      await reloadProjects();
    }
    
    // Switch to new project
    setDefaultProjectId(project.id);
    
    console.log('[Page] Project switched, will restore:', project.settings?.ui_state?.chat);
    
    // The useBoards hook will reload boards for the new project and auto-select the first board
  }, [defaultProjectId, saveState, chatTabs, activeChatTabId, reloadProjects]);

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
      if (!defaultProjectId) return;
      try {
        const sources = await fetchDataSources(defaultProjectId);
        setDataSources(sources);
        const details = await Promise.all(
          sources.map(async source => {
            try {
              const detail = await fetchDataSourceDetail(source.id, defaultProjectId);
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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 300;
      const maxWidth = 800;
      
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setChatPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return (
    <div className="relative flex h-screen w-full flex-col bg-white">
      <header className="z-10 flex h-10 shrink-0 items-center bg-muted px-3 pl-[76px] pr-3">
        <button
          onClick={() => setSidebarCollapsed(prev => !prev)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>

        <button
          onClick={() => setDataSourcesOpen(true)}
          className="ml-2 flex h-7 items-center gap-1.5 rounded-md border border-muted-foreground/40 bg-white px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground hover:border-muted-foreground/60"
          title="Connect data sources"
        >
          <DatabaseIcon className="h-3.5 w-3.5" />
          <span>Connect Data</span>
        </button>

        <div
          data-tauri-drag-region
          className="flex h-full flex-1 select-none items-center justify-center gap-2"
        />

        <button
          onClick={() => setChatPanelCollapsed(prev => !prev)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent"
          title={chatPanelCollapsed ? 'Expand chat panel' : 'Collapse chat panel'}
        >
          {chatPanelCollapsed ? (
            <PanelRightOpen className="h-4 w-4" />
          ) : (
            <PanelRightClose className="h-4 w-4" />
          )}
        </button>
      </header>

      <UpdateBanner />

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

      <div className="flex flex-1 overflow-hidden bg-muted">
        {!sidebarCollapsed && (
          <aside className="hidden w-64 border-r border-muted bg-muted transition-all duration-300 lg:flex lg:flex-col">
            <div className="px-3 pt-3 pb-3">
              <div className="flex items-center justify-between">
                <ProjectSelector
                  currentProject={currentProject}
                  projects={projects}
                  onSelectProject={handleSelectProject}
                  onNewProject={() => setShowCreateProjectModal(true)}
                />
                <button
                  type="button"
                  onClick={() => {
                    const existingCount = boards.filter(b => b.name.startsWith('Untitled Board')).length;
                    const newName = existingCount === 0 ? 'Untitled Board' : `Untitled Board ${existingCount + 1}`;
                    void createBoard(newName);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10 transition"
                  title="New board"
                >
                  <SquarePen className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              {/* View Tabs */}
              <div className="relative mb-3 flex rounded-lg bg-card p-1">
                {/* Sliding indicator */}
                <div
                  className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md bg-primary transition-all duration-200 ease-out ${
                    mainView === 'boards' ? 'left-1' : 'left-[50%]'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setMainView('boards')}
                  className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-200 ${
                    mainView === 'boards'
                      ? 'text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  Boards
                </button>
                <button
                  type="button"
                  onClick={() => setMainView('assets')}
                  className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-200 ${
                    mainView === 'assets'
                      ? 'text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Package className="h-3.5 w-3.5" />
                  Assets
                </button>
              </div>

              {mainView === 'boards' && (
              <BoardList
                boards={boards}
                activeId={activeBoard?.id}
                onSelect={(board: Board) => selectBoard(board)}
                onDelete={(board: Board) => deleteBoard(board.id)}
              />
              )}

              {mainView === 'assets' && (
                <div className="text-xs text-muted-foreground">
                  View saved analyses in the main panel
                </div>
              )}
            </div>

            <div className="space-y-2 px-3 pb-4">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon className="h-4 w-4" />
                <span>Settings</span>
              </button>
            </div>
          </aside>
        )}

        {/* Main Content Wrapper - Board + Chat with rounded corners */}
        <div className={`flex flex-1 overflow-hidden rounded-[10px] bg-background m-2 border border-black/10 ${sidebarCollapsed ? '' : 'ml-0'}`}>
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {defaultProjectId ? (
              mainView === 'boards' ? (
                <BoardsView projectId={defaultProjectId} activeBoard={activeBoard} />
              ) : (
                <AssetListView projectId={defaultProjectId} initialTab={assetInitialTab} refreshTrigger={dataSourcesRefresh} />
              )
            ) : (
              <div className="flex h-full items-center justify-center">
                <Loader />
              </div>
            )}
          </div>

          {!chatPanelCollapsed && (
            <div
              className="hidden lg:flex relative"
              style={{ width: `${chatPanelWidth}px` }}
            >
              {/* Resize Handle */}
              <div
                onMouseDown={handleMouseDown}
                className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/50 transition-colors z-10 group"
                style={{
                  left: '-1px',
                }}
              >
                <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
              </div>

              <MultiTabChatPanel
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                selectedDataSource={selectedDataSource}
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
          )}
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSettingsSaved={(model) => setSelectedModel(model)}
      />
      <DataSourcesModal
        projectId={defaultProjectId || ''}
        open={dataSourcesOpen}
        onOpenChange={setDataSourcesOpen}
        onImportClick={handleImportClick}
        refreshTrigger={dataSourcesRefresh}
        onNavigateToAssets={() => {
          setAssetInitialTab('datasources');
          setMainView('assets');
        }}
      />
      <CreateBoardModal
        open={showCreateBoardModal}
        onOpenChange={setShowCreateBoardModal}
        onSubmit={async (name: string, description?: string) => {
          await createBoard(name, description);
        }}
      />
      <CreateProjectModal
        open={showCreateProjectModal}
        onOpenChange={setShowCreateProjectModal}
        onSubmit={handleCreateProject}
      />
      <ImportCSVModal
        projectId={defaultProjectId || ''}
        open={importCSVOpen}
        onOpenChange={(open) => {
          setImportCSVOpen(open);
          if (!open) setImportFilePath(null);
        }}
        onImportSuccess={handleImportSuccess}
        initialFilePath={importFilePath || undefined}
      />
      <ImportParquetModal
        projectId={defaultProjectId || ''}
        open={importParquetOpen}
        onOpenChange={(open) => {
          setImportParquetOpen(open);
          if (!open) setImportFilePath(null);
        }}
        onImportSuccess={handleImportSuccess}
        initialFilePath={importFilePath || undefined}
      />
      <ConnectFolderModal
        projectId={defaultProjectId || ''}
        open={connectFolderOpen}
        onOpenChange={setConnectFolderOpen}
        onSuccess={() => {
          setDataSourcesRefresh(prev => prev + 1);
          setAssetInitialTab('datasources');
          setMainView('assets');
        }}
      />
      <ImportPostgresModal
        projectId={defaultProjectId || ''}
        open={importPostgresOpen}
        onOpenChange={(open) => {
          setImportPostgresOpen(open);
          if (!open) setSelectedSourceForImport(undefined);
        }}
        onImportSuccess={handleImportSuccess}
        existingSource={selectedSourceForImport}
      />
      <ImportSQLiteModal
        projectId={defaultProjectId || ''}
        open={importSQLiteOpen}
        onOpenChange={(open) => {
          setImportSQLiteOpen(open);
          if (!open) setSelectedSourceForImport(undefined);
        }}
        onImportSuccess={handleImportSuccess}
        existingSource={selectedSourceForImport}
      />
    </div>
  );
}
