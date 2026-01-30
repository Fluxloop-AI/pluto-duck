'use client';

import { Search } from 'lucide-react';
import type { DatasetIssue } from '../types';
import { IssueCard } from './IssueCard';

interface IssuesSectionProps {
  issues: DatasetIssue[];
  onRespond: (id: string, response: string, note?: string) => void;
  onReset: (id: string) => void;
}

export function IssuesSection({ issues, onRespond, onReset }: IssuesSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Issues
        </h3>
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/50 transition-colors"
        >
          <Search className="h-4 w-4" />
          Find Issues
        </button>
      </div>

      <div className="space-y-4">
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            onRespond={onRespond}
            onReset={onReset}
          />
        ))}
      </div>
    </div>
  );
}
