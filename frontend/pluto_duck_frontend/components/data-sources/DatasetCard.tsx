'use client';

import { Pencil, Grid3X3 } from 'lucide-react';
import { StatusBadge, type DatasetStatus } from './StatusBadge';

export interface DatasetStats {
  rows: number;
  columns: number;
  issues: number;
}

export interface Dataset {
  id: number;
  name: string;
  status: DatasetStatus;
  description: string;
  files: string[];
  stats?: DatasetStats;
}

interface DatasetCardProps {
  dataset: Dataset;
  isEditing: boolean;
  editName: string;
  onStartEdit: (id: number, name: string) => void;
  onSaveEdit: (id: number) => void;
  onEditNameChange: (name: string) => void;
}

// Helper to format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function DatasetCard({
  dataset,
  isEditing,
  editName,
  onStartEdit,
  onSaveEdit,
  onEditNameChange,
}: DatasetCardProps) {
  return (
    <div className="border border-border rounded-xl overflow-hidden p-5 transition-all hover:shadow-sm hover:border-muted-foreground/30">
      <StatusBadge status={dataset.status} />

      <div className="mt-3 mb-1 flex items-center gap-2">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onBlur={() => onSaveEdit(dataset.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSaveEdit(dataset.id)}
            className="text-xl font-bold text-foreground bg-muted rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        ) : (
          <>
            <h3 className="text-xl font-bold text-foreground">{dataset.name}</h3>
            <button
              onClick={() => onStartEdit(dataset.id, dataset.name)}
              className="p-1.5 hover:bg-muted rounded-lg transition-colors"
            >
              <Pencil className="w-4 h-4 text-muted-foreground" />
            </button>
          </>
        )}
      </div>

      {dataset.description && (
        <p className="text-muted-foreground text-sm leading-relaxed mb-1">
          {dataset.description}
        </p>
      )}

      {dataset.stats && (
        <p className="text-muted-foreground text-sm mb-4">
          {formatNumber(dataset.stats.rows)} rows · {formatNumber(dataset.stats.columns)} columns · {dataset.stats.issues} issues
        </p>
      )}

      <div className="space-y-2">
        {dataset.files.map((file, idx) => (
          <div
            key={idx}
            className="inline-flex items-center gap-2 bg-muted/60 rounded-lg px-3 py-2 border border-border mr-2"
          >
            <Grid3X3 className="w-4 h-4 text-muted-foreground" />
            <span className="text-foreground text-sm">{file}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
