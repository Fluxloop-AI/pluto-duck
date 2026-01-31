import type { DatasetIssue, QuickScanItem } from './types';

export const mockQuickScanItems: QuickScanItem[] = [
  {
    id: '1',
    status: 'success',
    title: 'Missing 2.4%',
    subtitle: 'OK',
  },
  {
    id: '2',
    status: 'success',
    title: 'Column types',
    subtitle: '7 of 8 OK',
  },
  {
    id: '3',
    status: 'warning',
    title: 'date column',
    subtitle: 'stored as string',
  },
];

export const initialMockIssues: DatasetIssue[] = [
  {
    id: '1',
    title: 'Date formats are mixed',
    issueType: 'date',
    discoveredAt: '2025.01.25',
    example: '"2025-01-22", "01/23/2025"',
    description: 'YYYY-MM-DD and MM/DD/YYYY formats are mixed.',
    status: 'dismissed',
    dismissedReason: 'Not an issue',
  },
  {
    id: '2',
    title: 'Currency formats are mixed',
    issueType: 'spend',
    discoveredAt: '2025.01.25',
    example: '"125000", "$125,000"',
    description: 'Values include both raw numbers and currency symbols.',
    status: 'acknowledged',
    userNote: 'This is expected for the US branch data.',
  },
  {
    id: '3',
    title: 'Phone number formats are mixed',
    issueType: 'phone',
    discoveredAt: '2025.01.26',
    example: '"010-1234-5678", "01012345678"',
    description: 'Values include both hyphenated and plain formats.',
    isNew: true,
    status: 'pending',
  },
  {
    id: '4',
    title: 'Missing values show a pattern',
    issueType: 'revenue',
    discoveredAt: '2025.01.26',
    example: 'revenue is null when conversions=0',
    description: 'Revenue is null when conversions are 0. Please confirm intent.',
    isNew: true,
    status: 'pending',
  },
];
