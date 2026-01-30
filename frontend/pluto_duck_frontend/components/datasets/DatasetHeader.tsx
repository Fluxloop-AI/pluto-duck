'use client';

import { useMemo } from 'react';
import {
  FileSpreadsheet,
  Pencil,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type Dataset,
  isFileAsset,
  getDatasetName,
  formatFileSize,
  formatDate,
} from './DatasetDetailView';

interface DatasetHeaderProps {
  dataset: Dataset;
  onDelete?: () => void;
}

interface SourceFile {
  name: string;
  rows: number | null;
  columns: number | null;
  size: number | null;
}

function getBaseName(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const parts = filePath.split(/[/\\\\]/);
  return parts[parts.length - 1] || null;
}

export function DatasetHeader({
  dataset,
  onDelete,
}: DatasetHeaderProps) {
  // Build metadata
  const rowCount = isFileAsset(dataset) ? dataset.row_count : dataset.row_count;
  const columnCount = isFileAsset(dataset) ? dataset.column_count : null;
  const createdAt = isFileAsset(dataset) ? dataset.created_at : dataset.cached_at;

  // Source files (multi-source aware with fallback)
  const sourceFiles = useMemo((): SourceFile[] => {
    if (!isFileAsset(dataset)) {
      return [
        {
          name: dataset.source_table || dataset.local_table || 'Unknown',
          rows: dataset.row_count,
          columns: null,
          size: null,
        },
      ];
    }

    const sources = dataset.sources && dataset.sources.length > 0 ? dataset.sources : null;
    if (!sources) {
      const fallbackName = getBaseName(dataset.file_path) || dataset.name || 'Unknown';
      return [
        {
          name: fallbackName,
          rows: dataset.row_count,
          columns: dataset.column_count,
          size: dataset.file_size_bytes,
        },
      ];
    }

    return sources.map((source) => ({
      name: source.original_name || getBaseName(source.file_path) || dataset.name || 'Unknown',
      rows: source.row_count ?? null,
      columns: null,
      size: source.file_size_bytes ?? null,
    }));
  }, [dataset]);

  const fileSize = useMemo(() => {
    if (sourceFiles.length === 0) return null;
    const sizes = sourceFiles.map((file) => file.size).filter((size) => size !== null);
    if (sizes.length === 0) return null;
    return sizes.reduce((sum, size) => sum + (size ?? 0), 0);
  }, [sourceFiles]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{getDatasetName(dataset)}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled className="opacity-50 cursor-not-allowed">
              <Pencil className="h-4 w-4" />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              <span>Delete dataset</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Metadata Line */}
      <p className="mt-2 text-sm text-muted-foreground">
        {sourceFiles.length} {sourceFiles.length === 1 ? 'Source' : 'Sources'}
        {columnCount !== null && <> · {columnCount} Columns</>}
        {rowCount !== null && <> · {rowCount.toLocaleString()} Rows</>}
        {createdAt && <> · Created at {formatDate(createdAt)}</>}
        {fileSize !== null && <> · {formatFileSize(fileSize)}</>}
      </p>
    </div>
  );
}
