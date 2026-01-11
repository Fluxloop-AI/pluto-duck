'use client';

import * as React from 'react';
import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import { Settings, RefreshCw, AlertCircle, Loader2, X, RotateCcw } from 'lucide-react';
import { 
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_DELETE_COMMAND,
  KEY_BACKSPACE_COMMAND,
} from 'lexical';
import { type AssetEmbedConfig, AssetEmbedNode } from '../nodes/AssetEmbedNode';
import { AssetTableView } from './AssetTableView';
import { AssetChartView } from './AssetChartView';
import { getAnalysis, getFreshness, executeAnalysis, getAnalysisData, type Analysis, type FreshnessStatus } from '@/lib/assetsApi';
import { retryAsync } from '@/hooks/useRetry';

// Context for opening config modal
export interface ConfigModalContextType {
  openConfigModal: (
    analysisId: string,
    currentConfig: AssetEmbedConfig,
    onSave: (config: AssetEmbedConfig) => void
  ) => void;
}

export const ConfigModalContext = React.createContext<ConfigModalContextType | null>(null);

interface AssetEmbedComponentProps {
  analysisId: string;
  projectId: string;
  config: AssetEmbedConfig;
  nodeKey: string;
}

interface QueryResult {
  columns: string[];
  rows: any[][];
  totalRows: number;
}

// ============================================
// Skeleton Components
// ============================================

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {/* Chart area */}
      <div className="h-[200px] bg-muted/50 rounded-md flex items-end justify-around px-4 pb-4 gap-2">
        {/* Fake bars */}
        <div className="w-8 bg-muted rounded-t" style={{ height: '60%' }} />
        <div className="w-8 bg-muted rounded-t" style={{ height: '80%' }} />
        <div className="w-8 bg-muted rounded-t" style={{ height: '45%' }} />
        <div className="w-8 bg-muted rounded-t" style={{ height: '90%' }} />
        <div className="w-8 bg-muted rounded-t" style={{ height: '55%' }} />
        <div className="w-8 bg-muted rounded-t" style={{ height: '70%' }} />
      </div>
      {/* X-axis labels */}
      <div className="flex justify-around px-4">
        <div className="h-3 w-8 bg-muted rounded" />
        <div className="h-3 w-8 bg-muted rounded" />
        <div className="h-3 w-8 bg-muted rounded" />
        <div className="h-3 w-8 bg-muted rounded" />
        <div className="h-3 w-8 bg-muted rounded" />
        <div className="h-3 w-8 bg-muted rounded" />
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      {/* Header */}
      <div className="flex gap-4 pb-2 border-b border-border/50">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-4 w-20 bg-muted rounded" />
        <div className="h-4 w-28 bg-muted rounded" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-2">
          <div className="h-3 w-24 bg-muted/70 rounded" />
          <div className="h-3 w-32 bg-muted/70 rounded" />
          <div className="h-3 w-20 bg-muted/70 rounded" />
          <div className="h-3 w-28 bg-muted/70 rounded" />
        </div>
      ))}
    </div>
  );
}

function MetadataSkeleton() {
  return (
    <div className="animate-pulse flex items-center gap-2">
      <div className="h-4 w-4 bg-muted rounded" />
      <div className="h-4 w-32 bg-muted rounded" />
    </div>
  );
}

// ============================================
// Error UI Component
// ============================================

interface ErrorDisplayProps {
  error: string;
  retryCount: number;
  maxRetries: number;
  isRetrying: boolean;
  onRetry: () => void;
}

function ErrorDisplay({ error, retryCount, maxRetries, isRetrying, onRetry }: ErrorDisplayProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-red-500" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">로드 실패</p>
        <p className="text-xs text-muted-foreground max-w-[250px]">{error}</p>
        {retryCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {retryCount}/{maxRetries}회 재시도 완료
          </p>
        )}
      </div>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {isRetrying ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            재시도 중...
          </>
        ) : (
          <>
            <RotateCcw className="h-4 w-4" />
            다시 시도
          </>
        )}
      </button>
    </div>
  );
}

// ============================================
// Loading State with Progress
// ============================================

interface LoadingDisplayProps {
  retryCount: number;
  isRetrying: boolean;
  displayType: 'table' | 'chart';
  rowsPerPage?: number;
}

function LoadingDisplay({ retryCount, isRetrying, displayType, rowsPerPage = 5 }: LoadingDisplayProps) {
  return (
    <div className="space-y-3">
      {/* Retry indicator */}
      {isRetrying && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded py-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>재시도 중... ({retryCount}회)</span>
        </div>
      )}
      
      {/* Skeleton based on display type */}
      {displayType === 'chart' ? (
        <ChartSkeleton />
      ) : (
        <TableSkeleton rows={rowsPerPage} />
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function AssetEmbedComponent({
  analysisId,
  projectId,
  config,
  nodeKey,
}: AssetEmbedComponentProps) {
  const [editor] = useLexicalComposerContext();
  const configModalContext = useContext(ConfigModalContext);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Selection handling
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);

  // Hover state for showing/hiding UI
  const [isHovered, setIsHovered] = useState(false);

  // Metadata state
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [freshness, setFreshness] = useState<FreshnessStatus | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Data state
  const [data, setData] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);

  const MAX_RETRIES = 3;

  // Delete handler
  const handleDelete = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) {
        node.remove();
      }
    });
  }, [editor, nodeKey]);

  // Keyboard delete handling
  const onDelete = useCallback(
    (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        event.preventDefault();
        handleDelete();
        return true;
      }
      return false;
    },
    [isSelected, handleDelete]
  );

  // Click and keyboard event registration
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          if (containerRef.current?.contains(event.target as Node)) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(true);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW)
    );
  }, [editor, clearSelection, setSelected, onDelete]);

  // Load analysis metadata with retry
  useEffect(() => {
    let cancelled = false;
    
    const loadMetadata = async () => {
    setIsLoadingMeta(true);
      setMetaError(null);
      
      try {
        const [analysisData, freshnessData] = await retryAsync(
          async () => Promise.all([
      getAnalysis(analysisId, projectId),
      getFreshness(analysisId, projectId),
          ]),
          { maxRetries: 2, initialDelay: 500 }
        );
        
        if (!cancelled) {
        setAnalysis(analysisData);
        setFreshness(freshnessData);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load analysis metadata:', err);
          setMetaError(err instanceof Error ? err.message : 'Failed to load metadata');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMeta(false);
        }
      }
    };

    loadMetadata();
    
    return () => {
      cancelled = true;
    };
  }, [analysisId, projectId]);

  // Load data function with retry
  const loadData = useCallback(async (isManualRetry = false) => {
    setIsLoading(true);
    setError(null);

    if (isManualRetry) {
      setRetryCount(0);
    }

    let currentRetry = 0;
    const delays = [1000, 2000, 4000]; // Exponential backoff

    while (currentRetry <= MAX_RETRIES) {
      try {
        if (currentRetry > 0) {
          setIsRetrying(true);
          setRetryCount(currentRetry);
        }

      // Execute the analysis to ensure fresh data
      const result = await executeAnalysis(analysisId, { projectId });

      if (!result.success) {
        const failedStep = result.step_results.find((s) => s.status === 'failed');
        throw new Error(failedStep?.error || 'Execution failed');
      }

        // Fetch the result data
      const dataResult = await getAnalysisData(analysisId, {
        projectId,
        limit: 1000,
      });

      setData({
        columns: dataResult.columns || [],
        rows: dataResult.rows || [],
        totalRows: dataResult.total_rows || dataResult.rows?.length || 0,
      });

      // Refresh freshness
        try {
      const newFreshness = await getFreshness(analysisId, projectId);
      setFreshness(newFreshness);
        } catch {
          // Ignore freshness error
        }

        setError(null);
        setIsRetrying(false);
        setIsLoading(false);
        return; // Success!
        
    } catch (err) {
        currentRetry++;
        
        if (currentRetry <= MAX_RETRIES) {
          console.log(`[AssetEmbed] Load failed, retry ${currentRetry}/${MAX_RETRIES} in ${delays[currentRetry - 1]}ms`);
          await new Promise(resolve => setTimeout(resolve, delays[currentRetry - 1]));
        } else {
          // All retries exhausted
      setError(err instanceof Error ? err.message : 'Failed to load data');
          setIsRetrying(false);
      setIsLoading(false);
        }
      }
    }
  }, [analysisId, projectId]);

  // Auto-load data when metadata is loaded
  useEffect(() => {
    if (!isLoadingMeta && !hasAutoLoaded && !data && !error && !metaError) {
      setHasAutoLoaded(true);
      loadData();
    }
  }, [isLoadingMeta, hasAutoLoaded, data, error, metaError, loadData]);

  // Handle config update
  const handleConfigUpdate = useCallback(
    (newConfig: AssetEmbedConfig) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof AssetEmbedNode) {
          node.setConfig(newConfig);
        }
      });
    },
    [editor, nodeKey]
  );

  // Open config modal
  const handleOpenConfig = useCallback(() => {
    if (configModalContext) {
      configModalContext.openConfigModal(analysisId, config, handleConfigUpdate);
    }
  }, [configModalContext, analysisId, config, handleConfigUpdate]);

  // Determine if UI should be visible
  const showUI = isHovered || isSelected || isLoading || !!error;

  // Render content based on state
  const renderContent = () => {
    // Error state
    if (error) {
      return (
        <ErrorDisplay
          error={error}
          retryCount={retryCount}
          maxRetries={MAX_RETRIES}
          isRetrying={isRetrying}
          onRetry={() => loadData(true)}
        />
      );
    }

    // Loading state with skeleton
    if (isLoading || !data) {
      return (
        <LoadingDisplay
          retryCount={retryCount}
          isRetrying={isRetrying}
          displayType={config.displayType}
          rowsPerPage={config.tableConfig?.rowsPerPage}
        />
      );
    }

    // Data loaded - render chart or table
    if (config.displayType === 'table') {
      return (
        <AssetTableView
          columns={data.columns}
          rows={data.rows}
          totalRows={data.totalRows}
          rowsPerPage={config.tableConfig?.rowsPerPage || 5}
        />
      );
    }

    // Chart with Group By
    if (config.chartConfig?.groupByColumn) {
      return (
        <AssetChartView
          columns={data.columns}
          rows={data.rows}
          chartType={config.chartConfig?.type === 'composed' ? 'line' : (config.chartConfig?.type || 'line')}
          xColumn={config.chartConfig?.xColumn || data.columns[0]}
          yColumn={config.chartConfig?.yColumn || data.columns[1]}
          groupByColumn={config.chartConfig.groupByColumn}
          stacked={config.chartConfig?.stacked}
        />
      );
    }

    // Chart with Multiple Y columns
    if (config.chartConfig?.yColumns && config.chartConfig.yColumns.length > 0) {
      return (
        <AssetChartView
          columns={data.columns}
          rows={data.rows}
          chartType={config.chartConfig?.type || 'bar'}
          xColumn={config.chartConfig?.xColumn || data.columns[0]}
          yColumns={config.chartConfig.yColumns}
          stacked={config.chartConfig?.stacked}
          showDualAxis={config.chartConfig?.showDualAxis}
        />
      );
    }

    // Single series chart (default)
    return (
      <AssetChartView
        columns={data.columns}
        rows={data.rows}
        chartType={config.chartConfig?.type === 'composed' ? 'bar' : (config.chartConfig?.type || 'bar')}
        xColumn={config.chartConfig?.xColumn || data.columns[0]}
        yColumn={config.chartConfig?.yColumn || data.columns[1]}
      />
    );
  };

  // Loading metadata state
  if (isLoadingMeta) {
    return (
      <div 
        ref={containerRef}
        className="asset-embed-container rounded-md p-4 bg-card border border-border/30"
        style={{ font: 'inherit' }}
      >
        <div className="space-y-3">
          <MetadataSkeleton />
          {config.displayType === 'chart' ? <ChartSkeleton /> : <TableSkeleton />}
        </div>
      </div>
    );
  }

  // Metadata load error
  if (metaError) {
    return (
      <div 
        ref={containerRef}
        className="asset-embed-container rounded-md p-4 bg-card border border-red-500/30"
        style={{ font: 'inherit' }}
      >
        <ErrorDisplay
          error={metaError}
          retryCount={0}
          maxRetries={MAX_RETRIES}
          isRetrying={false}
          onRetry={() => window.location.reload()} // Simple reload for meta error
        />
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`asset-embed-container rounded-md overflow-hidden bg-card transition-all duration-200 ${
        showUI 
          ? isSelected 
            ? 'border border-blue-500 ring-2 ring-blue-500/30' 
            : 'border border-border/60'
          : 'border border-transparent'
      }`}
      style={{ font: 'inherit' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header - Only visible on hover/select */}
      <div 
        className={`flex items-center justify-between px-3 py-1.5 border-b bg-muted/20 transition-all duration-200 ${
          showUI ? 'opacity-100 border-border/40' : 'opacity-0 h-0 py-0 border-transparent overflow-hidden'
        }`}
      >
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="text-xs">
            {config.displayType === 'table' ? '📋' : '📊'}
          </span>
          <span className="text-xs font-medium text-foreground/80">{analysis?.name || analysisId}</span>
          {freshness?.is_stale && (
            <span className="flex items-center gap-0.5 text-[10px] bg-yellow-500/15 text-yellow-600 px-1.5 py-0.5 rounded">
              <AlertCircle className="h-2.5 w-2.5" />
              Stale
            </span>
          )}
          {isRetrying && (
            <span className="flex items-center gap-0.5 text-[10px] bg-blue-500/15 text-blue-600 px-1.5 py-0.5 rounded">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Retry {retryCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground rounded hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh
          </button>
          <button
            onClick={handleOpenConfig}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Settings"
          >
            <Settings className="h-3 w-3" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
            title="Delete"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 not-prose">
        {renderContent()}
      </div>
    </div>
  );
}
