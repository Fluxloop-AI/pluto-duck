'use client';

import { useState, useEffect } from 'react';
import { HardDrive, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { type CachedTable, type CachedTablePreview, fetchCachedTablePreview } from '@/lib/sourceApi';

interface CachedTablePreviewModalProps {
  open: boolean;
  cachedTable: CachedTable;
  projectId: string;
  onClose: () => void;
}

type PreviewData = Omit<CachedTablePreview, 'total_rows'> & { total_rows: number };

export function CachedTablePreviewModal({
  open,
  cachedTable,
  projectId,
  onClose,
}: CachedTablePreviewModalProps) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  const resolveErrorMessage = (err: unknown): string => {
    if (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'ApiError') {
      const apiError = err as { status?: number; detail?: unknown; message?: string };
      if (typeof apiError.detail === 'string' && apiError.detail.trim().length > 0) {
        return apiError.detail;
      }
      if (typeof apiError.status === 'number') {
        return `Preview failed: ${apiError.status}`;
      }
      if (typeof apiError.message === 'string' && apiError.message.trim().length > 0) {
        return apiError.message;
      }
    }
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return 'Failed to load preview';
  };

  // Load preview data using query API
  useEffect(() => {
    if (open) {
      loadPreview();
    }
  }, [open, limit]);

  const loadPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchCachedTablePreview(projectId, cachedTable.local_table, limit);
      setData({
        columns: result.columns || [],
        rows: result.rows || [],
        total_rows: result.total_rows ?? cachedTable.row_count ?? 0,
      });
    } catch (err) {
      setError(resolveErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const formatCellValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0 gap-0">
        {/* Screen reader accessible title */}
        <DialogTitle className="sr-only">{cachedTable.local_table} Preview</DialogTitle>
        <DialogDescription className="sr-only">
          Preview data from cached table {cachedTable.local_table}
        </DialogDescription>
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <HardDrive className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{cachedTable.local_table}</h2>
              <p className="text-sm text-muted-foreground">
                From: <span className="font-mono">{cachedTable.source_name}.{cachedTable.source_table}</span>
                {data && (
                  <span className="ml-2">
                    • Showing {Math.min(limit, data.total_rows)} of {data.total_rows.toLocaleString()} rows
                  </span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
              <option value={500}>500 rows</option>
              <option value={1000}>1000 rows</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={loadPreview}
              disabled={isLoading}
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center p-8">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <p className="text-destructive font-medium mb-2">Failed to load preview</p>
              <p className="text-sm text-muted-foreground text-center max-w-md">{error}</p>
              <Button variant="outline" className="mt-4" onClick={loadPreview}>
                Try Again
              </Button>
            </div>
          ) : data && data.columns.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                  {data.columns.map((col, i) => (
                    <th key={i} className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-muted/50">
                    <td className="px-4 py-2 text-muted-foreground">{rowIdx + 1}</td>
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className="px-4 py-2 font-mono text-xs whitespace-nowrap max-w-[300px] overflow-hidden text-ellipsis">
                        {formatCellValue(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted-foreground">No data available</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <p className="text-xs text-muted-foreground">
            Cached: {new Date(cachedTable.cached_at).toLocaleString()}
            {cachedTable.expires_at && ` • Expires: ${new Date(cachedTable.expires_at).toLocaleString()}`}
          </p>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
