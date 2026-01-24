'use client';

import { useState, useEffect } from 'react';
import { TrashIcon } from 'lucide-react';
import type { FileAsset } from '../../lib/fileAssetApi';
import type { CachedTable } from '../../lib/sourceApi';
import { formatRelativeTime } from '../../lib/utils';

type Dataset = FileAsset | CachedTable;

interface DatasetListProps {
  datasets: Dataset[];
  activeId?: string;
  onSelect: (dataset: Dataset) => void;
  onDelete?: (dataset: Dataset) => void;
}

export function DatasetList({
  datasets,
  activeId,
  onSelect,
  onDelete,
}: DatasetListProps) {
  const [tick, setTick] = useState(0);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Update relative times every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, []);

  const getDatasetName = (dataset: Dataset): string => {
    if ('name' in dataset && dataset.name) {
      return dataset.name;
    }
    if ('local_table' in dataset) {
      return dataset.local_table;
    }
    return 'Unknown';
  };

  const getDatasetId = (dataset: Dataset): string => {
    return dataset.id;
  };

  const getDatasetTime = (dataset: Dataset): string | null => {
    // FileAsset has updated_at, CachedTable has cached_at
    if ('updated_at' in dataset) {
      return dataset.updated_at;
    }
    if ('cached_at' in dataset) {
      return dataset.cached_at;
    }
    return null;
  };

  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <p className="text-sm">No datasets yet</p>
        <p className="text-xs mt-1">Add one to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-1 pl-0.5">
      {datasets.map((dataset) => {
        const id = getDatasetId(dataset);
        const name = getDatasetName(dataset);
        const time = getDatasetTime(dataset);
        const isActive = activeId === id;

        if (confirmingDeleteId === id) {
          // Inline delete confirmation UI
          return (
            <div
              key={id}
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
                    onDelete?.(dataset);
                    setConfirmingDeleteId(null);
                  }}
                  className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        }

        // Normal dataset item
        return (
          <div
            key={id}
            className={`
              group relative flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm cursor-pointer transition-colors
              ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-accent'
              }
            `}
            onClick={() => onSelect(dataset)}
          >
            <div className="flex-1 min-w-0">
              <p className={`truncate ${isActive ? 'font-medium' : 'font-normal'}`}>
                {name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatRelativeTime(time)}
              </p>
            </div>

            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDeleteId(id);
                }}
                className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-opacity shrink-0"
                title="Delete dataset"
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
