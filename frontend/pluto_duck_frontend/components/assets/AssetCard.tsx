'use client';

import {
  Clock,
  Play,
  MoreVertical,
  Eye,
  Trash2,
  GitBranch,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Analysis, FreshnessStatus } from '@/lib/assetsApi';
import { getMaterializationIcon } from '@/lib/assetsApi';

interface AssetCardProps {
  analysis: Analysis;
  freshness?: FreshnessStatus | null;
  onView: (analysis: Analysis) => void;
  onRun: (analysis: Analysis) => void;
  onDelete: (analysis: Analysis) => void;
  onViewLineage: (analysis: Analysis) => void;
}

export function AssetCard({
  analysis,
  freshness,
  onView,
  onRun,
  onDelete,
  onViewLineage,
}: AssetCardProps) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const FreshnessIndicator = () => {
    if (!freshness) {
      return (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Never run</span>
        </span>
      );
    }

    if (freshness.is_stale) {
      return (
        <span className="flex items-center gap-1 text-xs text-yellow-500">
          <AlertCircle className="h-3 w-3" />
          <span>Stale</span>
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1 text-xs text-green-500">
        <CheckCircle className="h-3 w-3" />
        <span>Fresh</span>
      </span>
    );
  };

  return (
    <div className="group relative flex flex-col rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md min-w-[280px] w-full h-[220px] overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-lg flex-shrink-0" title={analysis.materialization}>
            {getMaterializationIcon(analysis.materialization)}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-foreground truncate" title={analysis.name}>{analysis.name}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate" title={analysis.id}>{analysis.id}</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewLineage(analysis)}>
              <GitBranch className="mr-2 h-4 w-4" />
              View Lineage
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(analysis)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      {analysis.description && (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {analysis.description}
        </p>
      )}

      {/* Tags */}
      {analysis.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {analysis.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              {tag}
            </span>
          ))}
          {analysis.tags.length > 3 && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              +{analysis.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Spacer to push footer to bottom */}
      <div className="flex-1" />

      {/* Status Row */}
      <div className="flex items-center justify-between text-xs text-muted-foreground py-2 border-t border-border/50">
        <FreshnessIndicator />
        {freshness?.last_run_at && (
          <span>{formatDate(freshness.last_run_at)}</span>
        )}
      </div>

      {/* Action Buttons - Always visible at bottom */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onView(analysis)}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Eye className="h-3 w-3" />
          View
        </button>
        <button
          onClick={() => onRun(analysis)}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Play className="h-3 w-3" />
          Run
        </button>
      </div>
    </div>
  );
}
