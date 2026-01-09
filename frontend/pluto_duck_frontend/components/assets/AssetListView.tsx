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
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AssetCard } from './AssetCard';
import { AssetDetailModal } from './AssetDetailModal';
import { CreateAssetModal } from './CreateAssetModal';
import { ExecutionPlanView } from './ExecutionPlanView';
import { LineageGraphView } from './LineageGraphView';
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

interface AssetListViewProps {
  projectId: string;
}

type ViewMode = 'grid' | 'list' | 'graph';
type SortOption = 'name' | 'updated' | 'created';
type SortDirection = 'asc' | 'desc';
type FreshnessFilter = 'all' | 'fresh' | 'stale' | 'never';
type MaterializationFilter = 'all' | 'view' | 'table' | 'append' | 'parquet';

export function AssetListView({ projectId }: AssetListViewProps) {
  // State
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [freshnessMap, setFreshnessMap] = useState<Record<string, FreshnessStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Fetch analyses
  const fetchAnalyses = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listAnalyses({ projectId });
      setAnalyses(data);

      // Fetch freshness for all analyses
      const freshnessPromises = data.map(async (a) => {
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
      setError(err instanceof Error ? err.message : 'Failed to load analyses');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile analysis');
      setIsExecuting(false);
    }
  };

  const handleExecutePlan = async (options?: { continueOnFailure?: boolean }) => {
    if (!selectedAnalysis) return;

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

  // Empty state
  if (!isLoading && analyses.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
          <Package className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">No Saved Analyses</h2>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          Save your SQL analyses to reuse them later, track changes, and build data pipelines.
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
      {/* Toolbar */}
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, ID, SQL..."
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

            {/* Filter Toggle */}
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

            {/* Sort */}
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
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
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

            {/* Refresh */}
            <Button variant="outline" size="icon" onClick={fetchAnalyses} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>

            {/* Create */}
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Analysis
            </Button>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
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
        {viewMode === 'graph' ? (
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-lg border border-border bg-muted/50"
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}

