'use client';

import { useEffect, useState, useRef } from 'react';
import { Plus, RefreshCw, HardDrive, TrashIcon } from 'lucide-react';
import { listFileAssets, type FileAsset } from '../../lib/fileAssetApi';
import { fetchCachedTables, type CachedTable } from '../../lib/sourceApi';
import { formatRelativeTime } from '../../lib/utils';

export type Dataset = FileAsset | CachedTable;

interface DatasetViewProps {
  projectId: string;
  onOpenAddModal?: () => void;
  refreshTrigger?: number;
  activeDatasetId?: string;
  onSelectDataset?: (dataset: Dataset) => void;
  onDeleteDataset?: (dataset: Dataset) => void;
  onRenameDataset?: (dataset: Dataset, newName: string) => void;
}

function isFileAsset(dataset: Dataset): dataset is FileAsset {
  return 'file_type' in dataset;
}

export function DatasetView({
  projectId,
  onOpenAddModal,
  refreshTrigger = 0,
  activeDatasetId,
  onSelectDataset,
  onDeleteDataset,
  onRenameDataset,
}: DatasetViewProps) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [editingDatasetId, setEditingDatasetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Update relative times every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingDatasetId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingDatasetId]);

  const getDatasetName = (dataset: Dataset): string => {
    if (isFileAsset(dataset)) {
      return dataset.name || dataset.table_name;
    }
    return dataset.local_table;
  };

  const getCreatedDate = (dataset: Dataset): string | null => {
    if (isFileAsset(dataset)) {
      return dataset.created_at;
    }
    return dataset.cached_at;
  };

  const handleStartRename = (dataset: Dataset) => {
    // Only allow rename for FileAsset type
    if (!isFileAsset(dataset)) return;
    setEditingDatasetId(dataset.id);
    setEditingName(getDatasetName(dataset));
  };

  const handleFinishRename = () => {
    if (editingDatasetId && editingName.trim() && onRenameDataset) {
      const dataset = datasets.find(d => d.id === editingDatasetId);
      if (dataset && editingName.trim() !== getDatasetName(dataset)) {
        onRenameDataset(dataset, editingName.trim());
      }
    }
    setEditingDatasetId(null);
    setEditingName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishRename();
    } else if (e.key === 'Escape') {
      setEditingDatasetId(null);
      setEditingName('');
    }
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
          <div className="space-y-1 pl-0.5">
            {datasets.map((dataset) => (
              confirmingDeleteId === dataset.id ? (
                // Inline delete confirmation UI
                <div
                  key={dataset.id}
                  className="flex h-[56px] items-center justify-between gap-2 rounded-lg bg-destructive/10 px-2.5 text-sm"
                >
                  <span className="text-destructive text-xs font-medium">Delete this dataset?</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setConfirmingDeleteId(null)}
                      className="px-2 py-1 text-xs rounded hover:bg-background transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        onDeleteDataset?.(dataset);
                        setConfirmingDeleteId(null);
                      }}
                      className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                // Normal dataset item
                <div
                  key={dataset.id}
                  className={`
                    group relative flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm cursor-pointer transition-colors
                    ${
                      activeDatasetId === dataset.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent'
                    }
                  `}
                  onClick={() => onSelectDataset?.(dataset)}
                >
                  <div className="flex-1 min-w-0">
                    {editingDatasetId === dataset.id ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={handleFinishRename}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className={`w-full bg-transparent outline-none truncate ${activeDatasetId === dataset.id ? 'font-medium' : 'font-normal'}`}
                      />
                    ) : (
                      <p
                        className={`truncate ${activeDatasetId === dataset.id ? 'font-medium' : 'font-normal'}`}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleStartRename(dataset);
                        }}
                      >
                        {getDatasetName(dataset)}
                      </p>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {formatRelativeTime(getCreatedDate(dataset))}
                    </p>
                  </div>

                  {onDeleteDataset && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDeleteId(dataset.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-opacity shrink-0"
                      title="Delete dataset"
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
