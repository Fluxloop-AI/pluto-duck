'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { DatasetIssue } from '../types';

interface IssueCardProps {
  issue: DatasetIssue;
  onRespond: (id: string, response: string, note?: string) => void;
  onReset: (id: string) => void;
}

export function IssueCard({ issue, onRespond, onReset }: IssueCardProps) {
  const [showInput, setShowInput] = useState(false);
  const [userInput, setUserInput] = useState('');

  const handleCustomInput = () => {
    if (userInput.trim()) {
      onRespond(issue.id, 'custom', userInput.trim());
      setShowInput(false);
      setUserInput('');
    }
  };

  const getStatusText = () => {
    if (issue.status === 'dismissed') {
      return issue.dismissedReason || 'Not an issue';
    }
    if (issue.status === 'acknowledged') {
      if (issue.userNote) {
        return issue.userNote;
      }
      return 'Issue confirmed';
    }
    return '';
  };

  const getStatusColor = () => {
    if (issue.status === 'acknowledged') {
      if (issue.userNote === 'Needs review') {
        return 'text-[#d97706]'; // warning color
      }
      if (issue.userNote) {
        return 'text-muted-foreground';
      }
      return 'text-red-500'; // Issue confirmed
    }
    return 'text-muted-foreground';
  };

  return (
    <div className="rounded-xl bg-muted/50 p-5 space-y-4">
      {/* Header */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{issue.discoveredAt} detected</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 text-xs bg-background border border-border rounded-md font-medium text-muted-foreground">{issue.issueType}</span>
          <h4 className="text-base font-medium">{issue.title}</h4>
          {issue.isNew && (
            <span className="text-[10px] font-semibold text-red-500">NEW</span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">{issue.description}</p>

      {/* Example */}
      {issue.example && (
        <div className="rounded-lg bg-background px-4 py-3">
          <code className="text-sm text-muted-foreground">Example: {issue.example}</code>
        </div>
      )}

      {/* Actions or Status */}
      {issue.status === 'pending' && !showInput && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onRespond(issue.id, 'correct')}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onRespond(issue.id, 'incorrect')}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            No
          </button>
          <button
            type="button"
            onClick={() => onRespond(issue.id, 'unknown')}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            Not sure
          </button>
          <button
            type="button"
            onClick={() => setShowInput(true)}
            className="px-4 py-2 text-sm bg-background border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            Add note
          </button>
        </div>
      )}

      {/* Custom Input Mode */}
      {issue.status === 'pending' && showInput && (
        <div className="space-y-3 pt-1">
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Tell us about this data..."
            className="w-full min-h-[80px] rounded-lg border border-border bg-background p-3 text-sm resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowInput(false);
                setUserInput('');
              }}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCustomInput}
              className="px-4 py-2 text-sm bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Resolved Status */}
      {issue.status !== 'pending' && (
        <div className="flex items-center justify-between pt-1">
          <span className={cn('text-sm', getStatusColor())}>
            {getStatusText()}
          </span>
          <button
            type="button"
            onClick={() => onReset(issue.id)}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            Review again
          </button>
        </div>
      )}
    </div>
  );
}
