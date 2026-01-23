---
date: 2026-01-23T12:00:00+09:00
researcher: Claude
topic: "Sidebar DatasetList Style Unification with BoardList"
tags: [research, codebase, sidebar, DatasetList, BoardList, style-unification]
status: complete
---

# Research: Sidebar DatasetList Style Unification with BoardList

## Research Question
사이드바 Datasets 탭 아래 표시되는 DatasetList 컴포넌트를 BoardList와 동일한 스타일로 통일하려면 어떤 변경이 필요한가?

## Summary

**사이드바 DatasetList**는 현재 1줄 레이아웃(아이콘 + 이름)으로, 시간 표시, 삭제, 이름 변경 기능이 없음. **BoardList**는 2줄 레이아웃(이름 + 상대 시간), hover 삭제 버튼, 더블클릭 이름 변경, 자동 시간 갱신 기능을 갖추고 있음.

주요 차이점:
1. **레이아웃**: 1줄 vs 2줄
2. **시간 표시**: 없음 vs 상대 시간 ("8h ago")
3. **Active 스타일**: `bg-black/5` vs `bg-primary/10 text-primary`
4. **Hover 스타일**: `hover:bg-black/5` vs `hover:bg-accent`
5. **삭제 기능**: 없음 vs hover 시 trash 아이콘 + 인라인 확인
6. **이름 변경**: 없음 vs 더블클릭 인라인 편집

## Detailed Findings

### BoardList (Target Style Reference)
**File**: [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx)

#### 레이아웃 및 스타일
- Container: `space-y-1 pl-0.5` (line 102)
- Item: `group relative flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm cursor-pointer transition-colors` (lines 133-134)
- Active state: `bg-primary/10 text-primary` (lines 136-137)
- Hover state: `hover:bg-accent` (line 138)
- 2줄 레이아웃: name `<p>` + relative time `<p>` (lines 157, 166-167)

#### 기능
- **자동 시간 갱신**: 60초 interval로 tick state 업데이트 (lines 25-31)
- **삭제 확인**: `confirmingDeleteId` state로 인라인 확인 UI (lines 104-128)
- **인라인 이름 변경**: 더블클릭으로 편집 모드, Enter/Escape/blur 핸들링 (lines 41-61, 144-165)

#### Props
```typescript
interface BoardListProps {
  boards: Board[];
  activeId?: string;
  onSelect: (board: Board) => void;
  onDelete?: (board: Board) => void;
  onUpdate?: (boardId: string, data: { name?: string }) => void;
  onCreate?: () => void;
}
```

### DatasetList (Current State)
**File**: [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx)

#### 레이아웃 및 스타일
- Container: `<div>` (line 59)
- Item: `flex w-full items-center gap-2 pl-1.5 pr-2.5 py-2.5 rounded-lg cursor-pointer transition-colors` (line 70)
- Active state: `bg-black/5` (lines 70-71)
- Hover state: `hover:bg-black/5` (line 71)
- 1줄 레이아웃: icon + name only (lines 74-75)

#### 현재 기능
- maxItems prop으로 표시 개수 제한 (default 3)
- "Browse all datasets..." 버튼
- 시간 표시, 삭제, 이름 변경 없음

#### Props
```typescript
interface DatasetListProps {
  datasets: Dataset[];
  maxItems?: number;
  activeId?: string;
  onSelect: (dataset: Dataset) => void;
  onBrowseAll: () => void;
}
```

### Dataset Types
**FileAsset** ([fileAssetApi.ts:16-28](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L16-L28)):
- `updated_at: string | null` - 상대 시간 표시에 사용 가능
- `created_at: string | null`
- 삭제 API: `deleteFileAsset(projectId, fileId)` (line 133-142)
- 이름 변경 API: **없음** (추후 백엔드 추가 필요)

**CachedTable** ([sourceApi.ts:33-42](frontend/pluto_duck_frontend/lib/sourceApi.ts#L33-L42)):
- `cached_at: string` - 상대 시간 표시에 사용 가능
- 삭제 API: `dropCache(projectId, localTable)` (line 245-252)
- 이름 변경: **불가** (source에서 파생된 고정 이름)

### Usage Context
**File**: [page.tsx](frontend/pluto_duck_frontend/app/page.tsx)

현재 사용 (lines 628-635):
```tsx
<DatasetList
  datasets={sidebarDatasets}
  maxItems={3}
  onSelect={() => {}}  // 현재 아무 동작 안 함
  onBrowseAll={() => {
    setMainView('datasets');
  }}
/>
```

BoardList 사용 비교 (lines 620-626):
```tsx
<BoardList
  boards={boards}
  activeId={activeBoard?.id}
  onSelect={(board: Board) => selectBoard(board)}
  onDelete={(board: Board) => deleteBoard(board.id)}
  onUpdate={(boardId: string, data: { name?: string }) => updateBoard(boardId, data)}
/>
```

### Shared Utility
**File**: [utils.ts](frontend/pluto_duck_frontend/lib/utils.ts)

`formatRelativeTime` 함수가 이미 존재 (lines 8-28):
- null 입력 처리: `'-'` 반환
- "Just now", "Xm ago", "Xh ago", "Xd ago" 형식
- 7일 이후: 날짜/시간 형식

## Code References
- [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) - 목표 스타일 레퍼런스
- [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) - 수정 대상 컴포넌트
- [page.tsx:628-635](frontend/pluto_duck_frontend/app/page.tsx#L628-L635) - DatasetList 사용처
- [fileAssetApi.ts:133-142](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L133-L142) - deleteFileAsset API
- [sourceApi.ts:245-252](frontend/pluto_duck_frontend/lib/sourceApi.ts#L245-L252) - dropCache API
- [utils.ts:8-28](frontend/pluto_duck_frontend/lib/utils.ts#L8-L28) - formatRelativeTime 유틸리티

## Architecture Insights

1. **Dataset 타입 분기**: FileAsset과 CachedTable은 서로 다른 필드명 사용
   - FileAsset: `updated_at`, `name`
   - CachedTable: `cached_at`, `local_table`

2. **시간 필드 통일 필요**:
   - FileAsset → `updated_at` 또는 `created_at`
   - CachedTable → `cached_at`

3. **이름 변경 제한**:
   - FileAsset: 백엔드 API 없음 (추후 추가 가능)
   - CachedTable: 이름 변경 불가 (source에서 파생)

4. **"Browse all datasets..." 버튼**: BoardList에는 없는 DatasetList 고유 기능 - 유지 필요

## Implementation Considerations

### 변경 필요 사항
1. Container 스타일: `<div>` → `<div className="space-y-1 pl-0.5">`
2. Item 스타일: BoardList와 동일하게 변경
3. 2줄 레이아웃: 이름 + 상대 시간 추가
4. Active/Hover 스타일: `bg-primary/10 text-primary`, `hover:bg-accent`
5. 삭제 기능: hover trash 아이콘 + 인라인 확인
6. tick state: 60초 자동 갱신

### 이름 변경 기능 범위
- **이번 구현에서 제외 권장**: 백엔드 API가 없고, CachedTable은 이름 변경 불가
- 추후 FileAsset용 rename API 추가 시 별도 구현

### Props 확장 필요
```typescript
interface DatasetListProps {
  datasets: Dataset[];
  maxItems?: number;
  activeId?: string;
  onSelect: (dataset: Dataset) => void;
  onBrowseAll: () => void;
  onDelete?: (dataset: Dataset) => void;  // 새로 추가
}
```

### page.tsx 변경 필요
- onDelete 콜백 추가하여 FileAsset은 `deleteFileAsset`, CachedTable은 `dropCache` 호출

## Decisions Made

1. **이름 변경 기능**: 제외 (백엔드 API 없음, CachedTable 변경 불가)
2. **삭제 기능**: BoardList와 동일하게 구현 (hover trash + 인라인 확인)
3. **"Browse all datasets..." 버튼**: 유지
4. **아이콘**: 제거 (BoardList와 완전히 동일한 스타일)
5. **onSelect 동작**: 현재 상태 유지 (추후 데이터 미리보기 기능 추가 예정)
