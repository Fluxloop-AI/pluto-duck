---
date: 2026-01-23T15:30:00+09:00
researcher: Claude
topic: "데이터셋 리스트를 보드 리스트와 동일한 스타일로 변경"
tags: [research, sidebar, dataset, board, ui-consistency, list-style]
status: complete
---

# Research: 데이터셋 리스트 스타일 통일

## Research Question
현재 sidebar에서 데이터셋 리스트를 보드 리스트와 동일한 스타일로 변경하기 위해 필요한 작업.
- Title (제목)
- 생성 시간 (2줄 레이아웃)

## Summary

BoardList와 DatasetView의 리스트 스타일을 비교 분석한 결과, 다음 변경이 필요합니다:

1. **카드 스타일 제거**: border, icon container 제거
2. **2줄 레이아웃 적용**: 제목 + 상대 시간 (예: "8h ago")
3. **시간 포맷 변경**: 절대 날짜 → 상대 시간 (`formatRelativeTime`)
4. **스타일 클래스 통일**: padding, spacing, hover/active 상태

## Detailed Findings

### 1. 현재 BoardList 스타일 (목표 스타일)

**파일:** [BoardList.tsx:151-191](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L151-L191)

```
┌────────────────────────────────────┐
│ Untitled Board 3                   │  ← 제목 (truncate, font-medium/normal)
│ 8h ago                             │  ← 상대 시간 (text-xs, text-muted-foreground)
└────────────────────────────────────┘
```

**핵심 스타일:**
```tsx
// 컨테이너
<div className="space-y-1 pl-0.5">

// 각 아이템
<div className={`
  group relative flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm cursor-pointer transition-colors
  ${activeId === board.id
    ? 'bg-primary/10 text-primary'
    : 'text-foreground hover:bg-accent'
  }
`}>
  <div className="flex-1 min-w-0">
    <p className={`truncate ${activeId === board.id ? 'font-medium' : 'font-normal'}`}>
      {board.name}
    </p>
    <p className="truncate text-xs text-muted-foreground">
      {formatRelativeTime(board.updated_at)}
    </p>
  </div>
</div>
```

**상대 시간 포맷 함수:** [BoardList.tsx:71-90](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L71-L90)
```tsx
const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  const diffMs = Math.abs(Date.now() - date.getTime());
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
```

### 2. 현재 DatasetView 스타일 (변경 대상)

**파일:** [DatasetView.tsx:176-205](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx#L176-L205)

```
┌────────────────────────────────────────────────┐
│ ┌────┐                                         │
│ │ 📄 │  dataset_name.csv   [CSV]               │  ← 아이콘 + 제목 + 타입 배지
│ └────┘  1,234 rows · 2.5 MB · Jan 23, 2025     │  ← 메타데이터 행
└────────────────────────────────────────────────┘
```

**현재 스타일:**
```tsx
// 컨테이너
<div className="grid gap-3">

// 각 아이템 (카드 스타일)
<div className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50">
  {/* 아이콘 컨테이너 (10x10) */}
  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
    {getDatasetIcon(dataset)}
  </div>

  {/* 정보 */}
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-2">
      <span className="truncate font-medium">{getDatasetName(dataset)}</span>
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        {getDatasetType(dataset)}
      </span>
    </div>
    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
      <span>{formatNumber(getRowCount(dataset))} rows</span>
      {isFileAsset(dataset) && dataset.file_size_bytes && (
        <span>{formatBytes(dataset.file_size_bytes)}</span>
      )}
      <span>{formatDate(getCreatedDate(dataset))}</span>  {/* 절대 날짜 */}
    </div>
  </div>
</div>
```

### 3. 스타일 차이점 비교

| 속성 | BoardList | DatasetView | 변경 필요 |
|------|-----------|-------------|-----------|
| **레이아웃** | 2줄 (제목 + 시간) | 카드 (아이콘 + 제목/배지 + 메타데이터) | O |
| **컨테이너** | `space-y-1 pl-0.5` | `grid gap-3` | O |
| **아이템 패딩** | `px-2.5 py-2.5` | `p-4 gap-4` | O |
| **Border** | 없음 | `border bg-card` | O (제거) |
| **아이콘** | 없음 | 10x10 컨테이너 | O (제거 또는 축소) |
| **시간 포맷** | 상대 시간 (`8h ago`) | 절대 날짜 (`Jan 23, 2025`) | O |
| **Active 상태** | `bg-primary/10 text-primary` | 없음 | O (추가) |
| **Hover 상태** | `hover:bg-accent` | `hover:bg-accent/50` | O |
| **타입 배지** | 없음 | 있음 (CSV, PARQUET, Cached) | 선택적 |

### 4. 필요한 변경 사항

#### 4.1 DatasetView에 상대 시간 함수 추가
```tsx
// DatasetView.tsx에 추가
const formatRelativeTime = (dateString: string | null) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const diffMs = Math.abs(Date.now() - date.getTime());
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
```

#### 4.2 리스트 아이템 스타일 변경

**Before (현재):**
```tsx
<div className="grid gap-3">
  {datasets.map((dataset) => (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4 ...">
      <div className="flex h-10 w-10 ...">...</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">...</span>
          <span className="...badge...">{type}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{rows} rows</span>
          <span>{size}</span>
          <span>{formatDate(date)}</span>
        </div>
      </div>
    </div>
  ))}
</div>
```

**After (목표):**
```tsx
<div className="space-y-1 pl-0.5">
  {datasets.map((dataset) => (
    <div
      className={`
        group relative flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm cursor-pointer transition-colors
        ${activeDatasetId === dataset.id
          ? 'bg-primary/10 text-primary'
          : 'text-foreground hover:bg-accent'
        }
      `}
      onClick={() => onSelectDataset?.(dataset)}
    >
      <div className="flex-1 min-w-0">
        <p className={`truncate ${activeDatasetId === dataset.id ? 'font-medium' : 'font-normal'}`}>
          {getDatasetName(dataset)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatRelativeTime(getCreatedDate(dataset))}
        </p>
      </div>
    </div>
  ))}
</div>
```

#### 4.3 Props 확장 필요

```tsx
interface DatasetViewProps {
  projectId: string;
  onOpenAddModal?: () => void;
  refreshTrigger?: number;
  // 추가 필요:
  activeDatasetId?: string;           // 선택된 데이터셋 ID
  onSelectDataset?: (dataset: Dataset) => void;  // 선택 핸들러
}
```

### 5. 시간 자동 업데이트

BoardList는 1분마다 상대 시간을 업데이트합니다:

```tsx
// BoardList.tsx:23-30
const [tick, setTick] = useState(0);

useEffect(() => {
  const interval = setInterval(() => {
    setTick(t => t + 1);
  }, 60000); // 60 seconds

  return () => clearInterval(interval);
}, []);
```

DatasetView에도 동일한 로직 추가 필요.

### 6. 공통 유틸리티로 추출 고려

`formatRelativeTime` 함수가 BoardList와 DatasetView에서 동일하게 사용되므로, 공통 유틸리티로 추출하는 것이 좋습니다:

```
frontend/pluto_duck_frontend/lib/dateUtils.ts
```

```tsx
export function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return '-';
  // ... 구현
}
```

## Code References

- `frontend/pluto_duck_frontend/components/boards/BoardList.tsx:71-90` - formatRelativeTime 함수
- `frontend/pluto_duck_frontend/components/boards/BoardList.tsx:121-209` - BoardList 렌더링
- `frontend/pluto_duck_frontend/components/boards/BoardList.tsx:151-191` - 보드 아이템 스타일
- `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx:32-40` - formatDate 함수 (변경 대상)
- `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx:176-205` - 데이터셋 리스트 렌더링

## Implementation Checklist

- [ ] 1. `formatRelativeTime` 함수를 DatasetView에 추가 (또는 공통 유틸로 추출)
- [ ] 2. 1분마다 시간 업데이트하는 `tick` state 및 useEffect 추가
- [ ] 3. 리스트 컨테이너 클래스 변경: `grid gap-3` → `space-y-1 pl-0.5`
- [ ] 4. 아이템 클래스 변경:
  - border, bg-card, p-4 제거
  - `px-2.5 py-2.5 rounded-lg` 적용
  - hover 상태: `hover:bg-accent`
- [ ] 5. 아이콘 컨테이너 제거 (10x10 → 없음)
- [ ] 6. 2줄 레이아웃 적용: 제목 + 상대 시간
- [ ] 7. 타입 배지 제거 (선택적)
- [ ] 8. active 상태 스타일 추가 (`activeDatasetId` prop 필요)
- [ ] 9. `onSelectDataset` 핸들러 prop 추가

## Architecture Insights

- BoardList와 DatasetView의 리스트 아이템 스타일을 통일하면 UI 일관성이 향상됩니다
- 공통 유틸리티 함수 추출로 코드 중복을 줄일 수 있습니다
- active 상태 관리를 위해 상위 컴포넌트에서 상태를 전달받아야 합니다

## Open Questions

1. **타입 배지 유지 여부**: CSV/PARQUET/Cached 구분이 필요한가?
2. **삭제 버튼 추가 여부**: BoardList처럼 hover 시 삭제 버튼 표시?
3. **인라인 수정 기능**: BoardList처럼 더블클릭으로 이름 수정?
