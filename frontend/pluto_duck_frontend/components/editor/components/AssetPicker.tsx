'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Database, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { listAnalyses, type Analysis } from '@/lib/assetsApi';

interface AssetPickerProps {
  open: boolean;
  projectId: string;
  onSelect: (analysisId: string) => void;
  onCancel: () => void;
}

const MATERIALIZATION_ICONS: Record<string, string> = {
  view: '👁️',
  table: '📊',
  append: '📝',
  parquet: '📦',
};

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
      <DialogContent className="max-w-lg h-[500px] flex flex-col p-0 gap-0">
        {/* Screen reader accessible title */}
        <DialogTitle className="sr-only">Select Asset</DialogTitle>
        <DialogDescription className="sr-only">
          Choose an analysis to embed in your board
        </DialogDescription>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Select Asset</h2>
            <p className="text-sm text-muted-foreground">
              Choose an analysis to embed in your board
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border">
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
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading analyses...</p>
              </div>
            </div>
          ) : filteredAnalyses.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileSpreadsheet className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">
                {searchQuery ? 'No matching analyses' : 'No analyses found'}
              </p>
              <p className="text-xs mt-1">
                {searchQuery ? 'Try a different search term' : 'Create an analysis first'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAnalyses.map((analysis) => (
                <button
                  key={analysis.id}
                  onClick={() => setSelectedId(analysis.id)}
                  onDoubleClick={() => handleDoubleClick(analysis.id)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all duration-150 ${
                    selectedId === analysis.id
                      ? 'bg-primary/10 ring-2 ring-primary ring-offset-1 ring-offset-background'
                      : 'hover:bg-muted/60 border border-transparent hover:border-border'
                  }`}
                >
                  {/* Icon */}
                  <div className="flex-shrink-0 mt-0.5 text-lg">
                    {MATERIALIZATION_ICONS[analysis.materialization] || '📊'}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{analysis.name}</span>
                      {selectedId === analysis.id && (
                        <span className="flex-shrink-0 h-2 w-2 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                      {analysis.id}
                    </p>
                    {analysis.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {analysis.description}
                      </p>
                    )}
                    {analysis.tags.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {analysis.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 bg-muted rounded font-medium"
                          >
                            {tag}
                          </span>
                        ))}
                        {analysis.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{analysis.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20">
          <p className="text-xs text-muted-foreground">
            {filteredAnalyses.length} analysis{filteredAnalyses.length !== 1 ? 'es' : ''} available
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSelect}
              disabled={!selectedId}
            >
              Insert
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
