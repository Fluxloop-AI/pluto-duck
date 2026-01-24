---
date: 2026-01-23T15:00:00+09:00
researcher: Claude
topic: "Slide Tab 하단에 + New Board / + Add Dataset 버튼 배치 방법"
tags: [research, sidebar, ui, new-board-button, add-dataset-button, tab-slide]
status: complete
---

# Research: Slide Tab 하단에 액션 버튼 배치

## Research Question
slide tab 하단에 각 탭별 액션 버튼을 배치하기 위해 어떤 작업이 필요한지 파악:
- Boards 탭: "+ New Board" 버튼
- Datasets 탭: "+ Add Dataset" 버튼 (클릭 시 AddDatasetModal 표시)

## Summary

현재 "New Board" 버튼은 ProjectSelector 옆에 SquarePen 아이콘으로 배치되어 있습니다.

**변경 사항:**
- **헤더 버튼**: 현재 상태 유지 (추후 별도 처리)
- **Tab Slide UI 하단 (Boards 탭)**: "+ New Board" 버튼 추가
- **Tab Slide UI 하단 (Datasets 탭)**: "+ Add Dataset" 버튼 추가 → 클릭 시 AddDatasetModal 표시

변경 작업은 약 1개 파일에서 20줄 내외의 코드 수정이 필요합니다.

## Current vs Target Structure

### 현재 구조 (page.tsx:564-637)
```
Sidebar
├── Header
│   ├── ProjectSelector
│   └── SquarePen Button ← 여기서 보드 생성 (제거 또는 용도 변경)
├── Tab Slide UI (Boards / Datasets)
└── Content Area
    ├── BoardList (boards 탭)
    └── DatasetList (datasets 탭)
```

### 목표 구조 (이미지 기반)
```
Sidebar
├── Header
│   ├── ProjectSelector
│   └── SquarePen Button ← 현재 상태 유지 (추후 처리)
├── Tab Slide UI (Boards / Datasets)
├── + New Board Button ← 탭 하단, boards 탭 선택 시만 표시 (NEW)
└── Content Area
    ├── BoardList (boards 탭)
    └── DatasetList (datasets 탭)
```

## Code References

### 현재 구현 위치
- [page.tsx:564-579](frontend/pluto_duck_frontend/app/page.tsx#L564-L579) - 헤더 영역 (ProjectSelector + SquarePen 버튼)
- [page.tsx:581-616](frontend/pluto_duck_frontend/app/page.tsx#L581-L616) - Tab Slide UI
- [page.tsx:618-637](frontend/pluto_duck_frontend/app/page.tsx#L618-L637) - Content Area (BoardList/DatasetList)

### 관련 함수
- [page.tsx:573](frontend/pluto_duck_frontend/app/page.tsx#L573) - `handleCreateBoard` 함수 호출

## Implementation Plan

### 변경할 파일
`frontend/pluto_duck_frontend/app/page.tsx`

### Step 1: 헤더 영역 버튼 - 변경 없음
현재 SquarePen 버튼은 그대로 유지 (추후 별도 처리 예정)

### Step 2: Tab Slide UI 하단에 New Board 버튼 추가

**삽입 위치:** line 616 (Tab Slide UI 닫는 div) 이후, line 618 (Content Area) 이전

**추가할 코드:**
```tsx
{/* Tab Slide UI 끝 (line 616) */}
</div>

{/* New Board Button - boards 탭 선택 시만 표시 */}
{sidebarTab === 'boards' && (
  <button
    type="button"
    onClick={handleCreateBoard}
    className="flex w-full items-center gap-2 mx-3 mb-2 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
  >
    <Plus className="h-4 w-4" />
    <span>New Board</span>
  </button>
)}

{/* Content Area 시작 (line 618) */}
<div className="flex-1 overflow-y-auto px-3">
```

### Step 3: Plus 아이콘 import 확인
`lucide-react`에서 `Plus` 아이콘이 이미 import 되어 있는지 확인

**파일 상단 import에 추가 (필요시):**
```tsx
import { Plus } from 'lucide-react';
```

## Full Code Change Summary

### 변경 1: 헤더 버튼 - 변경 없음
헤더의 SquarePen 버튼은 현재 상태로 유지 (추후 별도 처리 예정)

### 변경 2: Tab 하단에 New Board 버튼 추가
**파일:** `frontend/pluto_duck_frontend/app/page.tsx`
**위치:** line 616 이후 삽입

```tsx
{sidebarTab === 'boards' && (
  <button
    type="button"
    onClick={handleCreateBoard}
    className="flex w-full items-center gap-2 mx-3 mb-2 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
  >
    <Plus className="h-4 w-4" />
    <span>New Board</span>
  </button>
)}
```

## Alternative Approaches

### 대안 1: BoardList 내부에 버튼 포함
BoardList 컴포넌트의 `onCreate` prop을 활용하여 컴포넌트 내부에서 버튼 렌더링

**장점:** 컴포넌트 캡슐화
**단점:** BoardList 컴포넌트 수정 필요

### 대안 2: 별도 컴포넌트로 분리
`SidebarNewBoardButton` 컴포넌트를 생성하여 재사용성 확보

**장점:** 재사용 가능, 테스트 용이
**단점:** 간단한 UI에 과도한 추상화

## Styling Considerations

이미지에서 확인된 스타일:
- `+` 아이콘 + "New Board" 텍스트
- 좌측 정렬
- 회색 컬러 (muted-foreground)
- hover 시 배경색 변경
- 적절한 패딩 (px-2.5 py-2)

## Decisions Made

1. **헤더의 SquarePen 버튼**: 현재 상태로 유지 (추후 별도 처리 예정)

## Open Questions

1. **Datasets 탭 선택 시**: 동일한 위치에 "+ Add Dataset" 버튼이 필요한가?

## Estimated Changes

| 파일 | 변경 내용 | 예상 라인 수 |
|------|----------|-------------|
| page.tsx | Tab 하단에 New Board 버튼 추가 | ~10줄 |

총 예상 변경: **1개 파일, ~10줄**
