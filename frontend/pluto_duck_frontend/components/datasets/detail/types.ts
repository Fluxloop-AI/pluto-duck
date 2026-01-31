import type { ReactNode } from 'react';
import type { DiagnosisIssue, FileAsset } from '../../../lib/fileAssetApi';
import type { CachedTable } from '../../../lib/sourceApi';

export type Dataset = FileAsset | CachedTable;

export type DatasetTab = 'summary' | 'diagnosis' | 'table';

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
  subtitle: ReactNode;
}

export type DatasetIssue = DiagnosisIssue;

export type IssueResponseType = 'yes' | 'no' | 'custom' | 'unsure' | 'resolved';

export interface IssueResponseInfo {
  type: IssueResponseType;
  text: string;
  color: string;
}
