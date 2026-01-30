import type { DatasetIssue, QuickScanItem } from './types';

export const mockQuickScanItems: QuickScanItem[] = [
  {
    id: '1',
    status: 'success',
    title: '결측치 2.4%',
    subtitle: '양호',
  },
  {
    id: '2',
    status: 'success',
    title: '컬럼 타입',
    subtitle: '8개 중 7개 정상',
  },
  {
    id: '3',
    status: 'warning',
    title: 'date 컬럼',
    subtitle: 'string으로 저장됨',
  },
];

export const initialMockIssues: DatasetIssue[] = [
  {
    id: '1',
    title: '날짜 형식이 섞여 있어요',
    columnName: 'date',
    discoveredAt: '2025.01.25',
    example: '"2025-01-22", "01/23/2025"',
    description: 'YYYY-MM-DD와 MM/DD/YYYY 형식이 섞여 있어요.',
    status: 'dismissed',
    dismissedReason: '문제 아님',
  },
  {
    id: '2',
    title: '금액 표기가 섞여 있어요',
    columnName: 'spend',
    discoveredAt: '2025.01.25',
    example: '"125000", "₩125,000"',
    description: '숫자만 있는 것과 통화 기호가 포함된 것이 섞여 있어요.',
    status: 'acknowledged',
    userNote: '"미국 지사 데이터라 원래 이래요"',
  },
  {
    id: '3',
    title: '전화번호 형식이 섞여 있어요',
    columnName: 'phone',
    discoveredAt: '2025.01.26',
    example: '"010-1234-5678", "01012345678"',
    description: '하이픈이 있는 것과 없는 것이 섞여 있어요.',
    isNew: true,
    status: 'pending',
  },
  {
    id: '4',
    title: '결측치에 패턴이 있어요',
    columnName: 'revenue',
    discoveredAt: '2025.01.26',
    example: 'conversions=0 일 때 revenue=null',
    description: '전환이 없을 때 매출이 비어있어요. 의도된 건지 확인이 필요해요.',
    isNew: true,
    status: 'pending',
  },
];
