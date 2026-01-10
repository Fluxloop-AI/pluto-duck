'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Database, FileSpreadsheet, CheckCircle, XCircle } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { listAnalyses, type Analysis } from '@/lib/assetsApi';

interface AssetPickerProps {
  open: boolean;
  projectId: string;
  onSelect: (analysisId: string) => void;
  onCancel: () => void;
}

export function AssetPicker({ open, projectId, onSelect, onCancel }: AssetPickerProps) {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Fetch analyses when modal opens
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      setSearchQuery('');
      setSelectedId(null);
      listAnalyses({ projectId })
        .then(setAnalyses)
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [open, projectId]);

  // Filter analyses by search query
  const filteredAnalyses = analyses.filter((a) => {
    const query = searchQuery.toLowerCase();
    return (
      a.name.toLowerCase().includes(query) ||
      a.id.toLowerCase().includes(query) ||
      a.description?.toLowerCase().includes(query) ||
      a.tags.some((t) => t.toLowerCase().includes(query))
    );
  });

  const handleSelect = useCallback(() => {
    if (selectedId) {
      onSelect(selectedId);
    }
  }, [selectedId, onSelect]);

  const handleDoubleClick = useCallback((id: string) => {
    onSelect(id);
  }, [onSelect]);

  return (
    <Dialog open={open} onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-lg">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border pb-4 -mx-6 px-6 -mt-2">
          <Database className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Select Asset</h2>
            <p className="text-sm text-muted-foreground">
              Choose an analysis to embed in your board
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search analyses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {/* List */}
        <div className="max-h-[300px] overflow-y-auto space-y-1 -mx-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : filteredAnalyses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">
                {searchQuery ? 'No matching analyses' : 'No analyses found'}
              </p>
              <p className="text-xs mt-1">
                {searchQuery ? 'Try a different search' : 'Create an analysis first'}
              </p>
            </div>
          ) : (
            filteredAnalyses.map((analysis) => (
              <button
                key={analysis.id}
                onClick={() => setSelectedId(analysis.id)}
                onDoubleClick={() => handleDoubleClick(analysis.id)}
                className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors ${
                  selectedId === analysis.id
                    ? 'bg-primary/10 border border-primary'
                    : 'hover:bg-muted border border-transparent'
                }`}
              >
                {/* Icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {analysis.materialization === 'view' && (
                    <span className="text-lg">👁️</span>
                  )}
                  {analysis.materialization === 'table' && (
                    <span className="text-lg">📊</span>
                  )}
                  {analysis.materialization === 'append' && (
                    <span className="text-lg">📝</span>
                  )}
                  {analysis.materialization === 'parquet' && (
                    <span className="text-lg">📦</span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{analysis.name}</span>
                    {selectedId === analysis.id && (
                      <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {analysis.id}
                  </p>
                  {analysis.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {analysis.description}
                    </p>
                  )}
                  {analysis.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {analysis.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 bg-muted rounded"
                        >
                          {tag}
                        </span>
                      ))}
                      {analysis.tags.length > 3 && (
                        <span className="text-xs text-muted-foreground">
                          +{analysis.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-4 -mx-6 px-6">
          <p className="text-xs text-muted-foreground">
            {filteredAnalyses.length} analysis{filteredAnalyses.length !== 1 ? 'es' : ''} available
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-md hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              disabled={!selectedId}
              className={`px-4 py-2 text-sm rounded-md font-medium ${
                selectedId
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              Insert
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

