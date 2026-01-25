'use client';

import { useMemo } from 'react';
import {
  FileSpreadsheet,
  Pencil,
  MoreHorizontal,
  Download,
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
  onRename?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

interface SourceFile {
  name: string;
  rows: number | null;
  columns: number | null;
  size: number | null;
}

export function DatasetHeader({
  dataset,
  onRename,
  onExport,
  onDelete,
}: DatasetHeaderProps) {
  // Build metadata
  const rowCount = isFileAsset(dataset) ? dataset.row_count : dataset.row_count;
  const columnCount = isFileAsset(dataset) ? dataset.column_count : null;
  const fileSize = isFileAsset(dataset) ? dataset.file_size_bytes : null;
  const createdAt = isFileAsset(dataset) ? dataset.created_at : dataset.cached_at;
  const originalFileName = isFileAsset(dataset) ? dataset.name : dataset.source_table;

  // Source files (currently just the main file)
  const sourceFiles = useMemo((): SourceFile[] => {
    return [{
      name: originalFileName || 'Unknown',
      rows: rowCount,
      columns: columnCount,
      size: fileSize,
    }];
  }, [originalFileName, rowCount, columnCount, fileSize]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{getDatasetName(dataset)}</h2>
        <button
          type="button"
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Rename dataset"
          onClick={onRename}
        >
          <Pencil className="h-4 w-4" />
        </button>
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
            <DropdownMenuItem onClick={onExport}>
              <Download className="h-4 w-4" />
              <span>Export as CSV</span>
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
