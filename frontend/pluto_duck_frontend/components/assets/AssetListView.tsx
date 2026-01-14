'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Search,
  Filter,
  LayoutGrid,
  List,
  RefreshCw,
  Package,
  GitBranch,
  ChevronDown,
  X,
  SortAsc,
  SortDesc,
  FileSpreadsheet,
  Database,
  Plug,
  HardDrive,
  Folder,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AssetCard } from './AssetCard';
import { FileAssetCard } from './FileAssetCard';
import { TableCard, type TableItem } from './TableCard';
import { AssetDetailModal } from './AssetDetailModal';
import { CreateAssetModal } from './CreateAssetModal';
import { ExecutionPlanView } from './ExecutionPlanView';
import { LineageGraphView } from './LineageGraphView';
import { FilePreviewModal } from './FilePreviewModal';
import { SourceTableBrowserModal } from './SourceTableBrowserModal';
import { CachedTablePreviewModal } from './CachedTablePreviewModal';
import { FolderSourceBrowserModal } from './FolderSourceBrowserModal';
import { ImportCSVModal } from '../data-sources/ImportCSVModal';
import { ImportParquetModal } from '../data-sources/ImportParquetModal';
import {
  listAnalyses,
  deleteAnalysis,
  executeAnalysis,
  compileAnalysis,
  getFreshness,
  type Analysis,
  type FreshnessStatus,
  type ExecutionPlan,
  type ExecutionResult,
} from '@/lib/assetsApi';
import {
  listFileAssets,
  deleteFileAsset,
  refreshFileAsset,
  type FileAsset,
} from '@/lib/fileAssetApi';
import {
  fetchSources,
  fetchCachedTables,
  listFolderSources,
  scanFolderSource,
  deleteSource,
  deleteFolderSource,
  dropCache,
  type Source,
  type CachedTable,
  type FolderSource,
  type FolderFile,
} from '@/lib/sourceApi';

interface AssetListViewProps {
  projectId: string;
  initialTab?: AssetTab;
  refreshTrigger?: number;
}

type ViewMode = 'grid' | 'list' | 'graph';
type SortOption = 'name' | 'updated' | 'created';
type SortDirection = 'asc' | 'desc';
type FreshnessFilter = 'all' | 'fresh' | 'stale' | 'never';
type MaterializationFilter = 'all' | 'view' | 'table' | 'append' | 'parquet';
type AssetTab = 'analyses' | 'datasources';
type AnalysesSubTab = 'queries'; // Future: 'reports' | 'notebooks' etc.
type DataSourceSubTab = 'sources' | 'datasets';

export function AssetListView({ projectId, initialTab, refreshTrigger }: AssetListViewProps) {
  // State
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [fileAssets, setFileAssets] = useState<FileAsset[]>([]);
  const [liveConnections, setLiveConnections] = useState<Source[]>([]);
  const [folderSources, setFolderSources] = useState<FolderSource[]>([]);
  const [folderNewCounts, setFolderNewCounts] = useState<Record<string, number>>({});
  const [cachedTables, setCachedTables] = useState<CachedTable[]>([]);
  const [freshnessMap, setFreshnessMap] = useState<Record<string, FreshnessStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AssetTab>(initialTab || 'analyses');
  const [analysesSubTab, setAnalysesSubTab] = useState<AnalysesSubTab>('queries');
  const [dataSourceSubTab, setDataSourceSubTab] = useState<DataSourceSubTab>('sources');

  // Update activeTab when initialTab changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // UI State
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [materializationFilter, setMaterializationFilter] = useState<MaterializationFilter>('all');
  const [freshnessFilter, setFreshnessFilter] = useState<FreshnessFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('updated');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(false);

  // Modal State
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [executionPlan, setExecutionPlan] = useState<ExecutionPlan | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // File Asset Modal State
  const [selectedFileAsset, setSelectedFileAsset] = useState<FileAsset | null>(null);
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false);

  // Source Table Browser State
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [showSourceBrowser, setShowSourceBrowser] = useState(false);
  
  // Cached Table Preview State
  const [selectedCachedTable, setSelectedCachedTable] = useState<CachedTable | null>(null);
  const [showCachedTablePreview, setShowCachedTablePreview] = useState(false);
  
  // Import (create dataset) modals (used from Folder Sources browser)
  const [showImportCSVModal, setShowImportCSVModal] = useState(false);
  const [showImportParquetModal, setShowImportParquetModal] = useState(false);
  const [importInitialFilePath, setImportInitialFilePath] = useState<string | null>(null);

  // Folder Source Browser
  const [selectedFolderSource, setSelectedFolderSource] = useState<FolderSource | null>(null);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // Fetch all data: analyses, file assets, live connections, cached tables
  const fetchAnalyses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch all data in parallel
      const [analysesData, fileAssetsData, sourcesData, folderSourcesData, cachedTablesData] = await Promise.all([
        listAnalyses({ projectId }),
        listFileAssets(projectId),
        fetchSources(projectId),
        listFolderSources(projectId),
        fetchCachedTables(projectId),
      ]);
      
      setAnalyses(analysesData);
      setFileAssets(fileAssetsData);
      setLiveConnections(sourcesData);
      setFolderSources(folderSourcesData);
      setCachedTables(cachedTablesData);
      console.log('[AssetListView] Loaded data:', {
        analyses: analysesData.length,
        fileAssets: fileAssetsData.length,
        sources: sourcesData.length,
        folderSources: folderSourcesData.length,
        cachedTables: cachedTablesData.length,
        sourcesData,
        activeTab,
        dataSourceSubTab,
      });

      // Fetch freshness for all analyses
      const freshnessPromises = analysesData.map(async (a) => {
        try {
          const freshness = await getFreshness(a.id, projectId);
          return [a.id, freshness] as const;
        } catch {
          return [a.id, null] as const;
        }
      });

      const freshnessResults = await Promise.all(freshnessPromises);
      const newFreshnessMap: Record<string, FreshnessStatus> = {};
      for (const [id, freshness] of freshnessResults) {
        if (freshness) {
          newFreshnessMap[id] = freshness;
        }
      }
      setFreshnessMap(newFreshnessMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assets');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses, refreshTrigger]);

  // P3-1: Scan folders when entering Assets → Data Sources → Sources subtab
  useEffect(() => {
    if (activeTab !== 'datasources') return;
    if (dataSourceSubTab !== 'sources') return;
    if (folderSources.length === 0) return;

    let cancelled = false;

    void (async () => {
      try {
        const results = await Promise.all(
          folderSources.map(async (f) => {
            try {
              const r = await scanFolderSource(projectId, f.id);
              return [f.id, r.new_files] as const;
            } catch (e) {
              console.warn('[AssetListView] Folder scan failed:', f.id, e);
              return [f.id, 0] as const;
            }
          })
        );
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const [id, cnt] of results) map[id] = cnt;
        setFolderNewCounts(map);
      } catch (e) {
        console.warn('[AssetListView] Folder scans failed:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, dataSourceSubTab, folderSources, projectId]);

  // Get all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    analyses.forEach((a) => a.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [analyses]);

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return (
      selectedTags.length > 0 ||
      materializationFilter !== 'all' ||
      freshnessFilter !== 'all'
    );
  }, [selectedTags, materializationFilter, freshnessFilter]);

  // Filter and sort analyses
  const filteredAnalyses = useMemo(() => {
    let result = analyses.filter((a) => {
      // Search filter (name, id, description, SQL)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = a.name.toLowerCase().includes(query);
        const matchesId = a.id.toLowerCase().includes(query);
        const matchesDesc = a.description?.toLowerCase().includes(query);
        const matchesSql = a.sql.toLowerCase().includes(query);
        if (!matchesName && !matchesId && !matchesDesc && !matchesSql) {
          return false;
        }
      }

      // Tag filter
      if (selectedTags.length > 0) {
        const hasTag = selectedTags.some((tag) => a.tags.includes(tag));
        if (!hasTag) {
          return false;
        }
      }

      // Materialization filter
      if (materializationFilter !== 'all') {
        if (a.materialization !== materializationFilter) {
          return false;
        }
      }

      // Freshness filter
      if (freshnessFilter !== 'all') {
        const freshness = freshnessMap[a.id];
        if (freshnessFilter === 'fresh' && (!freshness || freshness.is_stale)) {
          return false;
        }
        if (freshnessFilter === 'stale' && (!freshness || !freshness.is_stale)) {
          return false;
        }
        if (freshnessFilter === 'never' && freshness?.last_run_at) {
          return false;
        }
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortBy === 'updated') {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        cmp = aTime - bTime;
      } else if (sortBy === 'created') {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        cmp = aTime - bTime;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [analyses, searchQuery, selectedTags, materializationFilter, freshnessFilter, freshnessMap, sortBy, sortDir]);

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery('');
    setSelectedTags([]);
    setMaterializationFilter('all');
    setFreshnessFilter('all');
  };

  // Handlers
  const handleView = (analysis: Analysis) => {
    setSelectedAnalysis(analysis);
    setShowDetailModal(true);
  };

  const handleRun = async (analysis: Analysis) => {
    setSelectedAnalysis(analysis);
    setIsExecuting(true);
    setExecutionResult(null);

    try {
      // First compile to show the plan
      const plan = await compileAnalysis(analysis.id, { projectId });
      setExecutionPlan(plan);
      setIsExecuting(false); // Compile done, ready to execute
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile analysis');
      setIsExecuting(false);
    }
  };

  const handleExecutePlan = async (options?: { continueOnFailure?: boolean }) => {
    if (!selectedAnalysis) return;

    setIsExecuting(true); // Start execution
    try {
      const result = await executeAnalysis(selectedAnalysis.id, {
        projectId,
        continueOnFailure: options?.continueOnFailure,
      });
      setExecutionResult(result);

      // Refresh freshness for this analysis
      try {
        const freshness = await getFreshness(selectedAnalysis.id, projectId);
        setFreshnessMap((prev) => ({ ...prev, [selectedAnalysis.id]: freshness }));
      } catch {
        // Ignore freshness fetch error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute analysis');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCancelExecution = () => {
    setExecutionPlan(null);
    setExecutionResult(null);
    setSelectedAnalysis(null);
    setIsExecuting(false);
  };

  const handleDelete = async (analysis: Analysis) => {
    if (!confirm(`Delete "${analysis.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteAnalysis(analysis.id, projectId);
      setAnalyses((prev) => prev.filter((a) => a.id !== analysis.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete analysis');
    }
  };

  const handleViewLineage = (analysis: Analysis) => {
    setSelectedAnalysis(analysis);
    setShowDetailModal(true);
    // TODO: Switch to lineage tab in detail modal
  };

  const handleCreated = (analysis: Analysis) => {
    setAnalyses((prev) => [analysis, ...prev]);
    setShowCreateModal(false);
  };

  const handleUpdated = (analysis: Analysis) => {
    setAnalyses((prev) => prev.map((a) => (a.id === analysis.id ? analysis : a)));
    setShowDetailModal(false);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  // File Asset Handlers
  const handleViewFileAsset = (fileAsset: FileAsset) => {
    setSelectedFileAsset(fileAsset);
    setShowFilePreviewModal(true);
  };

  const handleRefreshFileAsset = async (fileAsset: FileAsset) => {
    if (!confirm(`Re-import "${fileAsset.name}" from ${fileAsset.file_path}?`)) {
      return;
    }
    try {
      const refreshed = await refreshFileAsset(projectId, fileAsset.id);
      setFileAssets((prev) => prev.map((f) => (f.id === fileAsset.id ? refreshed : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh file');
    }
  };

  const handleDeleteFileAsset = async (fileAsset: FileAsset) => {
    if (!confirm(`Delete "${fileAsset.name}"? This will also drop the table "${fileAsset.table_name}".`)) {
      return;
    }
    try {
      await deleteFileAsset(projectId, fileAsset.id);
      setFileAssets((prev) => prev.filter((f) => f.id !== fileAsset.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  // Unified Table Handlers (for both cached tables and file assets)
  const handleViewTable = (item: TableItem) => {
    if (item.type === 'database') {
      setSelectedCachedTable(item.data as CachedTable);
      setShowCachedTablePreview(true);
    } else {
      setSelectedFileAsset(item.data as FileAsset);
      setShowFilePreviewModal(true);
    }
  };

  const handleRefreshTable = async (item: TableItem) => {
    if (item.type === 'database') {
      // TODO: Implement refresh cache
      alert('Refresh snapshot coming soon!');
    } else {
      await handleRefreshFileAsset(item.data as FileAsset);
    }
  };

  const handleDeleteTable = async (item: TableItem) => {
    if (item.type === 'database') {
      const cache = item.data as CachedTable;
      if (!confirm(`Delete cached table "${cache.local_table}"?`)) {
        return;
      }
      try {
        await dropCache(projectId, cache.local_table);
        setCachedTables((prev) => prev.filter((c) => c.id !== cache.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete cached table');
      }
    } else {
      await handleDeleteFileAsset(item.data as FileAsset);
    }
  };

  // Empty state - only show if ALL data types are empty
  const hasAnyData =
    analyses.length > 0 ||
    fileAssets.length > 0 ||
    liveConnections.length > 0 ||
    folderSources.length > 0 ||
    cachedTables.length > 0;
  
  if (!isLoading && !hasAnyData) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
          <Package className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">No Assets Yet</h2>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          Save your SQL analyses or import CSV/Parquet files to build your data library.
        </p>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Your First Analysis
        </Button>

        <CreateAssetModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
          projectId={projectId}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="border-b border-border px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('analyses')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'analyses'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Package className="h-4 w-4" />
            Analyses
            {analyses.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {analyses.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('datasources')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'datasources'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Database className="h-4 w-4" />
            Data Sources
            {(liveConnections.length + folderSources.length + cachedTables.length + fileAssets.length) > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {liveConnections.length + folderSources.length + cachedTables.length + fileAssets.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={activeTab === 'analyses' ? "Search name, ID, SQL..." : "Search data sources..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-72 pl-9 pr-8"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Filter Toggle - only for analyses */}
            {activeTab === 'analyses' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={hasActiveFilters ? 'border-primary text-primary' : ''}
            >
              <Filter className="mr-2 h-4 w-4" />
              Filters
              {hasActiveFilters && (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                  {selectedTags.length + (materializationFilter !== 'all' ? 1 : 0) + (freshnessFilter !== 'all' ? 1 : 0)}
                </span>
              )}
              <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </Button>
            )}

            {/* Sort - only for analyses */}
            {activeTab === 'analyses' && (
            <div className="flex items-center gap-1 rounded-md border border-border">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="h-8 appearance-none bg-transparent px-2 text-sm outline-none"
              >
                <option value="updated">Updated</option>
                <option value="created">Created</option>
                <option value="name">Name</option>
              </select>
              <button
                onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                className="p-1.5 hover:bg-muted rounded-r-md"
              >
                {sortDir === 'asc' ? (
                  <SortAsc className="h-4 w-4" />
                ) : (
                  <SortDesc className="h-4 w-4" />
                )}
              </button>
            </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle - only for analyses */}
            {activeTab === 'analyses' && (
            <div className="flex rounded-md border border-border">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-muted' : 'hover:bg-muted/50'}`}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-muted' : 'hover:bg-muted/50'}`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('graph')}
                className={`p-2 ${viewMode === 'graph' ? 'bg-muted' : 'hover:bg-muted/50'}`}
                title="Lineage graph"
              >
                <GitBranch className="h-4 w-4" />
              </button>
            </div>
            )}

            {/* Refresh */}
            <Button variant="outline" size="icon" onClick={fetchAnalyses} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>

            {/* Create - only for analyses */}
            {activeTab === 'analyses' && (
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Analysis
            </Button>
            )}
          </div>
        </div>

        {/* Filter Panel - only for analyses */}
        {showFilters && activeTab === 'analyses' && (
          <div className="border-t border-border px-4 py-3 bg-muted/30">
            <div className="flex flex-wrap items-center gap-4">
              {/* Tags */}
              {allTags.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Tags:</span>
                  <div className="flex flex-wrap gap-1">
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                          selectedTags.includes(tag)
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Materialization */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Type:</span>
                <select
                  value={materializationFilter}
                  onChange={(e) => setMaterializationFilter(e.target.value as MaterializationFilter)}
                  className="h-7 rounded-md border border-border bg-background px-2 text-sm outline-none"
                >
                  <option value="all">All</option>
                  <option value="view">👁️ View</option>
                  <option value="table">📊 Table</option>
                  <option value="append">➕ Append</option>
                  <option value="parquet">📦 Parquet</option>
                </select>
              </div>

              {/* Freshness */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status:</span>
                <select
                  value={freshnessFilter}
                  onChange={(e) => setFreshnessFilter(e.target.value as FreshnessFilter)}
                  className="h-7 rounded-md border border-border bg-background px-2 text-sm outline-none"
                >
                  <option value="all">All</option>
                  <option value="fresh">🟢 Fresh</option>
                  <option value="stale">🟡 Stale</option>
                  <option value="never">⚫ Never run</option>
                </select>
              </div>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-primary hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-auto ${viewMode !== 'graph' ? 'p-4' : ''}`}>
        {activeTab === 'analyses' ? (
          // Analyses Tab Content
          <div className="space-y-4">
            {/* Sub-tabs: Queries | (future: Reports, Notebooks) */}
            {viewMode !== 'graph' && (
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <button
                  onClick={() => setAnalysesSubTab('queries')}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    analysesSubTab === 'queries'
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Queries
                  {analyses.length > 0 && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">
                      {analyses.length}
                    </span>
                  )}
                </button>
                {/* Future sub-tabs: Reports, Notebooks, etc. */}
              </div>
            )}
            
            {/* Queries content */}
            {analysesSubTab === 'queries' && (
              viewMode === 'graph' ? (
          <LineageGraphView
            projectId={projectId}
            onSelectAnalysis={(id) => {
              const analysis = analyses.find((a) => a.id === id);
              if (analysis) {
                handleView(analysis);
              }
            }}
          />
        ) : isLoading ? (
            <div 
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
            >
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                  className="h-[200px] animate-pulse rounded-lg border border-border bg-muted/50"
              />
            ))}
          </div>
        ) : filteredAnalyses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-1">No analyses match your filters</p>
            <p className="text-sm text-muted-foreground mb-3">
              {searchQuery
                ? `No results for "${searchQuery}"`
                : 'Try adjusting your filter settings'}
            </p>
            <button
              onClick={clearFilters}
              className="text-sm text-primary hover:underline"
            >
              Clear all filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
            <div 
              className="grid gap-4"
              style={{ 
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              }}
            >
            {filteredAnalyses.map((analysis) => (
              <AssetCard
                key={analysis.id}
                analysis={analysis}
                freshness={freshnessMap[analysis.id] || null}
                onView={handleView}
                onRun={handleRun}
                onDelete={handleDelete}
                onViewLineage={handleViewLineage}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAnalyses.map((analysis) => (
              <AssetCard
                key={analysis.id}
                analysis={analysis}
                freshness={freshnessMap[analysis.id] || null}
                onView={handleView}
                onRun={handleRun}
                onDelete={handleDelete}
                onViewLineage={handleViewLineage}
              />
            ))}
          </div>
              )
            )}
          </div>
        ) : (
          // Data Sources Tab Content
          <div className="space-y-4">
            {/* Sub-tabs: Sources | Datasets */}
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <button
                onClick={() => setDataSourceSubTab('sources')}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  dataSourceSubTab === 'sources'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <Plug className="h-4 w-4" />
                Sources
                {(liveConnections.length + folderSources.length) > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">
                    {liveConnections.length + folderSources.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setDataSourceSubTab('datasets')}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  dataSourceSubTab === 'datasets'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <HardDrive className="h-4 w-4" />
                Datasets
                {(cachedTables.length + fileAssets.length) > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">
                    {cachedTables.length + fileAssets.length}
                  </span>
                )}
              </button>
            </div>

            {/* Sub-tab Content */}
            {isLoading ? (
              <div 
                className="grid gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
              >
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-[180px] animate-pulse rounded-lg border border-border bg-muted/50"
                  />
                ))}
              </div>
            ) : dataSourceSubTab === 'sources' ? (
              // Sources (DB connections + Folder sources)
              (liveConnections.length + folderSources.length) === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Plug className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground mb-1">No sources connected</p>
                  <p className="text-sm text-muted-foreground">
                    Connect to databases or folders using Connect Data
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* DB Sources */}
                  {liveConnections.length > 0 && (
                    <div className="space-y-3">
                      {liveConnections.map((source) => (
                        <div
                          key={source.id}
                          className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                              source.status === 'attached' ? 'bg-green-500/10' : 'bg-red-500/10'
                            }`}>
                              <Database className={`h-5 w-5 ${
                                source.status === 'attached' ? 'text-green-500' : 'text-red-500'
                              }`} />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{source.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {source.source_type.toUpperCase()} • {source.table_count} tables • {
                                  source.status === 'attached' ? '🟢 Connected' : '🔴 Disconnected'
                                }
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedSource(source);
                                setShowSourceBrowser(true);
                              }}
                            >
                              Browse Tables
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={async () => {
                                if (confirm(`Disconnect ${source.name}?`)) {
                                  await deleteSource(projectId, source.name);
                                  fetchAnalyses();
                                }
                              }}
                            >
                              Disconnect
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Folder Sources */}
                  {folderSources.length > 0 && (
                    <div className="space-y-3">
                      {folderSources.map((folder) => (
                        <div
                          key={folder.id}
                          className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                              <Folder className="h-5 w-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="font-medium text-foreground truncate">{folder.name}</p>
                                {(folderNewCounts[folder.id] ?? 0) > 0 && (
                                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary whitespace-nowrap">
                                    New files: {folderNewCounts[folder.id]}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate" title={folder.path}>
                                {folder.path}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedFolderSource(folder);
                                setShowFolderBrowser(true);
                              }}
                            >
                              Browse Files
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={async () => {
                                if (confirm(`Remove folder source "${folder.name}"?`)) {
                                  await deleteFolderSource(projectId, folder.id);
                                  fetchAnalyses();
                                }
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            ) : (
              // Tables (Cached from DB + Imported from Files)
              (() => {
                // Combine cached tables and file assets into unified TableItem array
                const allTables: TableItem[] = [
                  ...cachedTables.map((cache): TableItem => ({ type: 'database', data: cache })),
                  ...fileAssets.map((file): TableItem => ({ type: 'file', data: file })),
                ];

                // Filter by search query
                const filteredTables = allTables.filter((item) => {
                  if (!searchQuery) return true;
                  const query = searchQuery.toLowerCase();
                  if (item.type === 'database') {
                    const cache = item.data as CachedTable;
                    return (
                      cache.local_table.toLowerCase().includes(query) ||
                      cache.source_name.toLowerCase().includes(query) ||
                      cache.source_table.toLowerCase().includes(query)
                    );
                  } else {
                    const file = item.data as FileAsset;
                    return (
                      file.name.toLowerCase().includes(query) ||
                      file.table_name.toLowerCase().includes(query) ||
                      file.file_path.toLowerCase().includes(query)
                    );
                  }
                });

                if (filteredTables.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12">
                      <HardDrive className="h-12 w-12 text-muted-foreground mb-3" />
                      <p className="text-muted-foreground mb-1">No tables yet</p>
                      <p className="text-sm text-muted-foreground">
                        Create snapshots from sources or import CSV/Parquet files
                      </p>
                    </div>
                  );
                }

                return (
                  <div 
                    className="grid gap-4"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
                  >
                    {filteredTables.map((item) => (
                      <TableCard
                        key={item.type === 'database' 
                          ? (item.data as CachedTable).id 
                          : (item.data as FileAsset).id}
                        item={item}
                        onView={handleViewTable}
                        onRefresh={handleRefreshTable}
                        onDelete={handleDeleteTable}
                      />
                    ))}
                  </div>
                );
              })()
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateAssetModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleCreated}
        projectId={projectId}
      />

      {selectedAnalysis && (
        <AssetDetailModal
          open={showDetailModal}
          analysis={selectedAnalysis}
          freshness={freshnessMap[selectedAnalysis.id] || null}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedAnalysis(null);
          }}
          onUpdated={handleUpdated}
          onRun={handleRun}
          projectId={projectId}
        />
      )}

      {executionPlan && (
        <ExecutionPlanView
          open={!!executionPlan}
          plan={executionPlan}
          result={executionResult}
          isExecuting={isExecuting}
          onExecute={handleExecutePlan}
          onCancel={handleCancelExecution}
        />
      )}

      {selectedFileAsset && (
        <FilePreviewModal
          open={showFilePreviewModal}
          fileAsset={selectedFileAsset}
          projectId={projectId}
          onClose={() => {
            setShowFilePreviewModal(false);
            setSelectedFileAsset(null);
          }}
        />
      )}

      {/* Source Table Browser Modal */}
      <SourceTableBrowserModal
        projectId={projectId}
        source={selectedSource}
        open={showSourceBrowser}
        onOpenChange={(open) => {
          setShowSourceBrowser(open);
          if (!open) setSelectedSource(null);
        }}
        onCacheCreated={() => {
          // Refresh data to show new cached table
          fetchAnalyses();
        }}
      />

      {/* Cached Table Preview Modal */}
      {selectedCachedTable && (
        <CachedTablePreviewModal
          open={showCachedTablePreview}
          cachedTable={selectedCachedTable}
          projectId={projectId}
          onClose={() => {
            setShowCachedTablePreview(false);
            setSelectedCachedTable(null);
          }}
        />
      )}

      {/* Folder Source Browser Modal */}
      <FolderSourceBrowserModal
        projectId={projectId}
        folderSource={selectedFolderSource}
        open={showFolderBrowser}
        onOpenChange={(open) => {
          setShowFolderBrowser(open);
          if (!open) setSelectedFolderSource(null);
        }}
        onDatasetsChanged={() => {
          fetchAnalyses();
        }}
        onCreateDatasetFromFile={(file: FolderFile) => {
          setImportInitialFilePath(file.path);
          if (file.file_type === 'csv') {
            setShowImportCSVModal(true);
          } else {
            setShowImportParquetModal(true);
          }
        }}
      />

      {/* Import (Create Dataset) - CSV */}
      <ImportCSVModal
        projectId={projectId}
        open={showImportCSVModal}
        onOpenChange={(open) => {
          setShowImportCSVModal(open);
          if (!open) setImportInitialFilePath(null);
        }}
        onImportSuccess={() => {
          fetchAnalyses();
        }}
        initialFilePath={importInitialFilePath || undefined}
      />

      {/* Import (Create Dataset) - Parquet */}
      <ImportParquetModal
        projectId={projectId}
        open={showImportParquetModal}
        onOpenChange={(open) => {
          setShowImportParquetModal(open);
          if (!open) setImportInitialFilePath(null);
        }}
        onImportSuccess={() => {
          fetchAnalyses();
        }}
        initialFilePath={importInitialFilePath || undefined}
      />
    </div>
  );
}

