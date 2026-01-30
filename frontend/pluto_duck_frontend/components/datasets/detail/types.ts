export interface AgentAnalysis {
  summary: string;
  bulletPoints: string[];
  generatedAt: string;
}

export interface SourceFile {
  name: string;
  rows: number | null;
  columns: number | null;
  size: number | null;
  addedAt?: string | null;
}

export interface HistoryItem {
  id: string;
  title: string;
  timestamp: string;
  isHighlighted: boolean;
  badge?: string;
}

export interface QuickScanItem {
  id: string;
  status: 'success' | 'warning';
  title: string;
  subtitle: string;
}

export interface DatasetIssue {
  id: string;
  title: string;
  columnName: string;
  discoveredAt: string;
  example: string;
  description: string;
  isNew?: boolean;
  status: 'pending' | 'dismissed' | 'acknowledged';
  dismissedReason?: string;
  userNote?: string;
}

export type IssueResponseType = 'yes' | 'no' | 'custom' | 'unsure';

export interface IssueResponseInfo {
  type: IssueResponseType;
  text: string;
  color: string;
}
