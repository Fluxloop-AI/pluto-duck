'use client';

import { Plus, RefreshCw } from 'lucide-react';
import { AssetTableView } from '../../../editor/components/AssetTableView';
import type { FilePreview } from '../../../../lib/fileAssetApi';
import type { CachedTablePreview } from '../../../../lib/sourceApi';

interface TableTabContentProps {
  preview: FilePreview | CachedTablePreview | null;
  loading: boolean;
  error: string | null;
}

export function TableTabContent({ preview, loading, error }: TableTabContentProps) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">No data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AssetTableView
        columns={preview.columns}
        rows={preview.rows}
        totalRows={preview.total_rows ?? preview.rows.length}
        alwaysShowSearch
      />

      {/* Add More Data Button */}
      <button
        type="button"
        className="flex items-center gap-2 w-fit rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        <Plus className="h-4 w-4" />
        <span>Add More Data</span>
      </button>
    </div>
  );
}
