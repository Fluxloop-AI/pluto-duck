'use client';

import { Table2, FolderSearch } from 'lucide-react';
import type { FileAsset } from '../../lib/fileAssetApi';
import type { CachedTable } from '../../lib/sourceApi';

type Dataset = FileAsset | CachedTable;

interface DatasetListProps {
  datasets: Dataset[];
  maxItems?: number;
  activeId?: string;
  onSelect: (dataset: Dataset) => void;
}

export function DatasetList({
  datasets,
  maxItems = 3,
  activeId,
  onSelect,
}: DatasetListProps) {
  if (datasets.length === 0) {
    return (
      <div className="py-2 px-2.5 text-sm text-muted-foreground">
        No datasets yet
      </div>
    );
  }

  const displayedDatasets = datasets.slice(0, maxItems);

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

  return (
    <div>
      {displayedDatasets.map((dataset) => {
        const id = getDatasetId(dataset);
        const name = getDatasetName(dataset);
        const isActive = activeId === id;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(dataset)}
            className={`flex w-full items-center gap-2 pl-1.5 pr-2.5 py-2.5 rounded-lg cursor-pointer transition-colors ${
              isActive ? 'bg-black/5' : 'hover:bg-black/5'
            }`}
          >
            <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[0.8rem] leading-[1rem] text-foreground truncate">{name}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="flex w-full items-center gap-2 pl-1.5 pr-2.5 py-2.5 rounded-lg cursor-pointer hover:bg-black/5 transition-colors"
      >
        <FolderSearch className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[0.8rem] leading-[1rem] text-muted-foreground">Browse all datasets...</span>
      </button>
    </div>
  );
}
