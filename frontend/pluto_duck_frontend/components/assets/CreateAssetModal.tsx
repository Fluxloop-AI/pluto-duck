'use client';

import { useState } from 'react';
import { X, Plus, Sparkles } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createAnalysis, type Analysis, getMaterializationIcon } from '@/lib/assetsApi';

interface CreateAssetModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (analysis: Analysis) => void;
  projectId: string;
  initialSql?: string;
}

export function CreateAssetModal({
  open,
  onClose,
  onCreated,
  projectId,
  initialSql = '',
}: CreateAssetModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sql, setSql] = useState(initialSql);
  const [materialization, setMaterialization] = useState<'view' | 'table' | 'append' | 'parquet'>(
    'view'
  );
  const [tags, setTags] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!sql.trim()) {
      setError('SQL is required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const analysis = await createAnalysis(
        {
          name: name.trim(),
          description: description.trim() || undefined,
          sql: sql.trim(),
          materialization,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
        projectId
      );

      onCreated(analysis);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create analysis');
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setSql(initialSql);
    setMaterialization('view');
    setTags('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 -mx-6 -mt-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Create New Analysis</h2>
          </div>
          <button
            onClick={handleClose}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 pt-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          {/* Name */}
          <div>
            <label className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Monthly Sales Report"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              A human-readable name for this analysis
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this analysis do?"
              className="mt-1"
              rows={2}
            />
          </div>

          {/* SQL */}
          <div>
            <label className="text-sm font-medium">
              SQL Query <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="SELECT ..."
              className="mt-1 font-mono text-sm"
              rows={8}
            />
          </div>

          {/* Materialization */}
          <div>
            <label className="text-sm font-medium">Materialization</label>
            <Select
              value={materialization}
              onValueChange={(v) => setMaterialization(v as typeof materialization)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">
                  <span className="flex items-center gap-2">
                    {getMaterializationIcon('view')} View — computed on-demand
                  </span>
                </SelectItem>
                <SelectItem value="table">
                  <span className="flex items-center gap-2">
                    {getMaterializationIcon('table')} Table — stored for fast queries
                  </span>
                </SelectItem>
                <SelectItem value="append">
                  <span className="flex items-center gap-2">
                    {getMaterializationIcon('append')} Append — incremental inserts
                  </span>
                </SelectItem>
                <SelectItem value="parquet">
                  <span className="flex items-center gap-2">
                    {getMaterializationIcon('parquet')} Parquet — export to file
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              How the results should be stored
            </p>
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium">Tags</label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="sales, monthly, reporting"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">Comma-separated tags for organization</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border pt-4 mt-6 -mx-6 px-6">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            <Plus className="mr-2 h-4 w-4" />
            {isCreating ? 'Creating...' : 'Create Analysis'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

