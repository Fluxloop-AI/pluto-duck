'use client';

import {
  FileSpreadsheet,
  FileArchive,
  MoreVertical,
  Eye,
  Trash2,
  RefreshCw,
  HardDrive,
  Rows,
  Columns,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FileAsset } from '@/lib/fileAssetApi';

interface FileAssetCardProps {
  fileAsset: FileAsset;
  onView: (fileAsset: FileAsset) => void;
  onRefresh: (fileAsset: FileAsset) => void;
  onDelete: (fileAsset: FileAsset) => void;
}

export function FileAssetCard({
  fileAsset,
  onView,
  onRefresh,
  onDelete,
}: FileAssetCardProps) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatNumber = (num: number | null) => {
    if (num === null) return '-';
    return num.toLocaleString();
  };

  const FileIcon = fileAsset.file_type === 'csv' ? FileSpreadsheet : FileArchive;

  return (
    <div className="group relative flex flex-col rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md min-w-[280px] w-full h-[180px] overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 flex-shrink-0">
            <FileIcon className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-foreground truncate" title={fileAsset.name}>{fileAsset.name}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate" title={fileAsset.table_name}>{fileAsset.table_name}</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRefresh(fileAsset)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Re-import
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(fileAsset)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      {fileAsset.description && (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {fileAsset.description}
        </p>
      )}

      {/* File Type Badge */}
      <div className="mt-2 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground uppercase">
          {fileAsset.file_type}
        </span>
      </div>

      {/* Stats Row */}
      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground py-2 border-t border-border/50">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1" title="Rows">
            <Rows className="h-3 w-3" />
            {formatNumber(fileAsset.row_count)}
          </span>
          <span className="flex items-center gap-1" title="Columns">
            <Columns className="h-3 w-3" />
            {formatNumber(fileAsset.column_count)}
          </span>
          <span className="flex items-center gap-1" title="File size">
            <HardDrive className="h-3 w-3" />
            {formatFileSize(fileAsset.file_size_bytes)}
          </span>
        </div>
        <span>{formatDate(fileAsset.created_at)}</span>
      </div>

      {/* Action Buttons - Always visible at bottom */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onView(fileAsset)}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Eye className="h-3 w-3" />
          Preview
        </button>
        <button
          onClick={() => onRefresh(fileAsset)}
          className="flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
