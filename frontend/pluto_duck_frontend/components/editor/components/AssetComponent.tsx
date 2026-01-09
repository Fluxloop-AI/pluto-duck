'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import {
  Database,
  RefreshCw,
  ExternalLink,
  Table2,
  Eye,
  Plus,
  Package,
  AlertCircle,
  CheckCircle,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getAnalysis,
  getFreshness,
  executeAnalysis,
  type Analysis,
  type FreshnessStatus,
  getMaterializationIcon,
} from '@/lib/assetsApi';
import { $isAssetNode } from '../nodes/AssetNode';

interface AssetComponentProps {
  analysisId: string;
  projectId: string;
  nodeKey: string;
}

export function AssetComponent({ analysisId, projectId, nodeKey }: AssetComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [freshness, setFreshness] = useState<FreshnessStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, unknown>[] | null>(null);

  const [showRefreshPrompt, setShowRefreshPrompt] = useState(false);

  // Load analysis data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [analysisData, freshnessData] = await Promise.all([
        getAnalysis(analysisId, projectId),
        getFreshness(analysisId, projectId).catch(() => null),
      ]);
      setAnalysis(analysisData);
      setFreshness(freshnessData);

      // On-Access Refresh: Check if stale and prompt user
      if (freshnessData?.is_stale) {
        setShowRefreshPrompt(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analysis');
    } finally {
      setIsLoading(false);
    }
  }, [analysisId, projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh if stale (user can dismiss the prompt)
  const handleAutoRefresh = async () => {
    setShowRefreshPrompt(false);
    await handleRun();
  };

  const dismissRefreshPrompt = () => {
    setShowRefreshPrompt(false);
  };

  // Run analysis
  const handleRun = async () => {
    setIsRunning(true);
    try {
      await executeAnalysis(analysisId, { projectId });
      // Refresh freshness after run
      const freshnessData = await getFreshness(analysisId, projectId).catch(() => null);
      setFreshness(freshnessData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run analysis');
    } finally {
      setIsRunning(false);
    }
  };

  // Delete node
  const handleDelete = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isAssetNode(node)) {
        node.remove();
      }
    });
  };

  // Get icon for materialization
  const getIcon = (materialization: string) => {
    switch (materialization) {
      case 'view':
        return <Eye className="h-4 w-4" />;
      case 'table':
        return <Table2 className="h-4 w-4" />;
      case 'append':
        return <Plus className="h-4 w-4" />;
      case 'parquet':
        return <Package className="h-4 w-4" />;
      default:
        return <Database className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="border border-border rounded-lg p-4 bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-sm text-muted-foreground">Loading analysis...</span>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm text-red-500">
              {error || `Analysis "${analysisId}" not found`}
            </span>
          </div>
          <button
            onClick={handleDelete}
            className="p-1 hover:bg-red-500/20 rounded"
          >
            <X className="h-4 w-4 text-red-500" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-background shadow-sm">
      {/* On-Access Refresh Prompt */}
      {showRefreshPrompt && (
        <div className="flex items-center justify-between px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30">
          <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
            <AlertCircle className="h-4 w-4" />
            <span>This analysis is stale. Would you like to refresh it?</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={dismissRefreshPrompt}
              className="h-6 px-2 text-xs"
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              onClick={handleAutoRefresh}
              className="h-6 px-2 text-xs bg-yellow-500 hover:bg-yellow-600 text-white"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh Now
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10 text-primary">
            {getIcon(analysis.materialization)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{analysis.name}</span>
              {freshness && (
                <span
                  className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                    freshness.is_stale
                      ? 'bg-yellow-500/20 text-yellow-500'
                      : 'bg-green-500/20 text-green-500'
                  }`}
                >
                  {freshness.is_stale ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : (
                    <CheckCircle className="h-3 w-3" />
                  )}
                  {freshness.is_stale ? 'Stale' : 'Fresh'}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono">{analysis.result_table}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRun}
            disabled={isRunning}
            className="h-7 px-2"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isRunning ? 'animate-spin' : ''}`} />
            {isRunning ? 'Running...' : 'Run'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-7 px-2"
          >
            {isExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </Button>
          <button
            onClick={handleDelete}
            className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 space-y-3">
          {/* Description */}
          {analysis.description && (
            <p className="text-sm text-muted-foreground">{analysis.description}</p>
          )}

          {/* SQL Preview */}
          <div>
            <span className="text-xs text-muted-foreground uppercase font-medium">SQL</span>
            <pre className="mt-1 p-2 rounded-md bg-muted text-xs font-mono overflow-auto max-h-32">
              {analysis.sql}
            </pre>
          </div>

          {/* Tags */}
          {analysis.tags.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Tags:</span>
              <div className="flex gap-1">
                {analysis.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Last Run */}
          {freshness?.last_run_at && (
            <div className="text-xs text-muted-foreground">
              Last run:{' '}
              {new Date(freshness.last_run_at).toLocaleString('ko-KR')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

