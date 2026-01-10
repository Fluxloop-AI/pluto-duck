'use client';

import { useState, useEffect } from 'react';
import { FileSpreadsheet, FileArchive, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { previewFileData, type FileAsset } from '@/lib/fileAssetApi';

interface FilePreviewModalProps {
  open: boolean;
  fileAsset: FileAsset;
  projectId: string;
  onClose: () => void;
}

interface PreviewData {
  columns: string[];
  rows: any[][];
  total_rows: number;
}

export function FilePreviewModal({
  open,
  fileAsset,
  projectId,
  onClose,
}: FilePreviewModalProps) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  const FileIcon = fileAsset.file_type === 'csv' ? FileSpreadsheet : FileArchive;

  // Load preview data
  useEffect(() => {
    if (open) {
      loadPreview();
    }
  }, [open, limit]);

  const loadPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const preview = await previewFileData(projectId, fileAsset.id, limit);
      setData(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
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
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fileAsset.name}</h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono">{fileAsset.table_name}</span>
                {data && (
                  <span className="ml-2">
                    • Showing {Math.min(limit, data.total_rows)} of {data.total_rows.toLocaleString()} rows
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Row limit selector */}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              disabled={isLoading}
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
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading preview...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md">
                <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                </div>
                <p className="text-sm font-medium mb-2">Failed to load preview</p>
                <p className="text-xs text-muted-foreground mb-4">{error}</p>
                <Button onClick={loadPreview} variant="outline" size="sm">
                  <RefreshCw className="h-3 w-3 mr-2" />
                  Try Again
                </Button>
              </div>
            </div>
          ) : data ? (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-auto max-h-[calc(85vh-180px)]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground border-b border-border w-12">
                        #
                      </th>
                      {data.columns.map((col, i) => (
                        <th
                          key={i}
                          className="px-4 py-3 text-left font-medium text-foreground border-b border-border whitespace-nowrap"
                        >
                          <div className="flex items-center gap-2">
                            <span>{col}</span>
                            <span className="text-xs text-muted-foreground font-normal">
                              ({typeof data.rows[0]?.[i]})
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={data.columns.length + 1}
                          className="px-4 py-8 text-center text-muted-foreground"
                        >
                          No data available
                        </td>
                      </tr>
                    ) : (
                      data.rows.map((row, rowIndex) => (
                        <tr
                          key={rowIndex}
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-2 text-muted-foreground text-xs font-mono">
                            {rowIndex + 1}
                          </td>
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className="px-4 py-2 font-mono text-xs max-w-md truncate"
                              title={formatCellValue(cell)}
                            >
                              {formatCellValue(cell)}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex items-center justify-between bg-muted/20">
          <div className="text-sm text-muted-foreground">
            {data && (
              <>
                <span className="font-medium text-foreground">
                  {data.columns.length}
                </span>{' '}
                columns •{' '}
                <span className="font-medium text-foreground">
                  {data.total_rows.toLocaleString()}
                </span>{' '}
                total rows
              </>
            )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

