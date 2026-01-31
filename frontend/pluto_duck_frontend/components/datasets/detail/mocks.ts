import type { QuickScanItem } from './types';

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
