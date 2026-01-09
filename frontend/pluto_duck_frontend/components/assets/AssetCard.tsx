'use client';

import { useState } from 'react';
import {
  Clock,
  Play,
  MoreVertical,
  Eye,
  Trash2,
  GitBranch,
  RefreshCw,
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
  const [isHovered, setIsHovered] = useState(false);

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
    <div
      className="group relative flex flex-col rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg" title={analysis.materialization}>
            {getMaterializationIcon(analysis.materialization)}
          </span>
          <div>
            <h3 className="font-medium text-foreground">{analysis.name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{analysis.id}</p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onView(analysis)}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRun(analysis)}>
              <Play className="mr-2 h-4 w-4" />
              Run
            </DropdownMenuItem>
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
        <div className="mt-3 flex flex-wrap gap-1">
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

      {/* Footer */}
      <div className="mt-auto pt-4 flex items-center justify-between border-t border-border/50 mt-4">
        <FreshnessIndicator />

        <div className="flex items-center gap-2">
          {freshness?.last_run_at && (
            <span className="text-xs text-muted-foreground">
              {formatDate(freshness.last_run_at)}
            </span>
          )}
        </div>
      </div>

      {/* Quick Run Button (on hover) */}
      {isHovered && (
        <button
          onClick={() => onRun(analysis)}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-all hover:bg-primary/90"
        >
          <Play className="h-3 w-3" />
          Run
        </button>
      )}
    </div>
  );
}

