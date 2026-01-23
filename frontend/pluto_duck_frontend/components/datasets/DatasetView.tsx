'use client';

import { useEffect, useState } from 'react';
import { Plus, Table2, Database, RefreshCw, FileText, HardDrive } from 'lucide-react';
import { listFileAssets, type FileAsset } from '../../lib/fileAssetApi';
import { fetchCachedTables, type CachedTable } from '../../lib/sourceApi';

type Dataset = FileAsset | CachedTable;

interface DatasetViewProps {
  projectId: string;
  onOpenAddModal?: () => void;
  refreshTrigger?: number;
}

function isFileAsset(dataset: Dataset): dataset is FileAsset {
  return 'file_type' in dataset;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(num: number | null): string {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function DatasetView({
  projectId,
  onOpenAddModal,
  refreshTrigger = 0,
}: DatasetViewProps) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const loadDatasets = async () => {
      setLoading(true);
      setError(null);
      try {
        const [fileAssets, cachedTables] = await Promise.all([
          listFileAssets(projectId),
          fetchCachedTables(projectId),
        ]);
        setDatasets([...fileAssets, ...cachedTables]);
      } catch (err) {
        console.error('Failed to load datasets:', err);
        setError(err instanceof Error ? err.message : 'Failed to load datasets');
      } finally {
        setLoading(false);
      }
    };

    void loadDatasets();
  }, [projectId, refreshTrigger]);

  const getDatasetName = (dataset: Dataset): string => {
    if (isFileAsset(dataset)) {
      return dataset.name || dataset.table_name;
    }
    return dataset.local_table;
  };

  const getDatasetType = (dataset: Dataset): string => {
    if (isFileAsset(dataset)) {
      return dataset.file_type.toUpperCase();
    }
    return 'Cached';
  };

  const getDatasetIcon = (dataset: Dataset) => {
    if (isFileAsset(dataset)) {
      return <FileText className="h-4 w-4" />;
    }
    return <Database className="h-4 w-4" />;
  };

  const getRowCount = (dataset: Dataset): number | null => {
    if (isFileAsset(dataset)) {
      return dataset.row_count;
    }
    return dataset.row_count;
  };

  const getCreatedDate = (dataset: Dataset): string | null => {
    if (isFileAsset(dataset)) {
      return dataset.created_at;
    }
    return dataset.cached_at;
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={() => setError(null)}
          className="text-sm text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Datasets</h1>
        {onOpenAddModal && (
          <button
            type="button"
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Dataset
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {datasets.length === 0 ? (
          /* Empty State */
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <HardDrive className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-medium">No datasets yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Import CSV or Parquet files, or cache tables from connected databases.
              </p>
            </div>
            {onOpenAddModal && (
              <button
                type="button"
                onClick={onOpenAddModal}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Add Dataset
              </button>
            )}
          </div>
        ) : (
          /* Dataset List */
          <div className="grid gap-3">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
              >
                {/* Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  {getDatasetIcon(dataset)}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{getDatasetName(dataset)}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {getDatasetType(dataset)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatNumber(getRowCount(dataset))} rows</span>
                    {isFileAsset(dataset) && dataset.file_size_bytes && (
                      <span>{formatBytes(dataset.file_size_bytes)}</span>
                    )}
                    <span>{formatDate(getCreatedDate(dataset))}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
