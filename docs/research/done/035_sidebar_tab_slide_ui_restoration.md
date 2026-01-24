---
date: 2026-01-23T00:00:00+09:00
researcher: Claude
topic: "Sidebar Tab Slide UI Restoration with Dataset Functionality"
tags: [research, codebase, sidebar, ui, tab-slide, dataset]
status: complete
---

# Research: Sidebar Tab Slide UI Restoration

## Research Question
현재 사이드바와 Dataset 관련 기능 변경사항 중 신규 Dataset 기능과 Assets 위치는 유지하면서, 사이드바 UI를 예전 탭 슬라이드 방식으로 복구하는 방법 조사.

요구사항:
1. 신규 Dataset 기능 유지 (데이터셋 추가 등)
2. Assets는 Settings 위 메뉴로 유지
3. 사이드바 UI 스타일을 예전 방식으로 재구성:
   - Workspace 옆쪽에 pencil icon으로 보드 추가 버튼
   - 바로 아래에 슬라이드 탭: Board / Dataset
   - 슬라이드 탭 바로 아래에 보드 리스트 유지

## Summary

### 복구해야 할 UI 요소 (이전 버전)
1. **Project Selector 옆 보드 추가 버튼**: SquarePen 아이콘으로 "New Board" 버튼
2. **슬라이드 탭 UI**: Board / Assets → Board / Dataset으로 변경
3. **탭 아래 컨텐츠**: 선택된 탭에 따라 BoardList 또는 DatasetView

### 유지해야 할 기능 (현재 버전)
1. **Dataset 기능 전체**: AddDatasetModal, DatasetView, fileAssetApi, sourceApi
2. **Assets 위치**: 사이드바 하단 Settings 위
3. **MainView 타입**: 'boards' | 'assets' | 'datasets' 유지

## Detailed Findings

### 1. 이전 탭 슬라이드 UI 코드 (merge-base: 82453b39)

**위치:** `frontend/pluto_duck_frontend/app/page.tsx` (lines ~558-610)

```tsx
{/* View Tabs */}
<div className="relative mb-3 flex rounded-lg bg-card p-1">
  {/* Sliding indicator */}
  <div
    className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md bg-primary transition-all duration-200 ease-out ${
      mainView === 'boards' ? 'left-1' : 'left-[50%]'
    }`}
  />
  <button
    type="button"
    onClick={() => setMainView('boards')}
    className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-200 ${
      mainView === 'boards'
        ? 'text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    <Layers className="h-3.5 w-3.5" />
    Boards
  </button>
  <button
    type="button"
    onClick={() => setMainView('assets')}
    className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-200 ${
      mainView === 'assets'
        ? 'text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`}
  >
    <Package className="h-3.5 w-3.5" />
    Assets
  </button>
</div>
```

**슬라이드 인디케이터 작동 방식:**
- Container: `relative` 포지션, `rounded-lg bg-card p-1`
- Sliding div: `absolute` 포지션, `w-[calc(50%-4px)]`, `bg-primary`
- 애니메이션: `transition-all duration-200 ease-out`
- 위치 전환: `left-1` (boards) ↔ `left-[50%]` (assets)

### 2. 이전 Project Selector 옆 New Board 버튼

**이전 구조:**
```tsx
<div className="flex items-center justify-between pl-[18px] pr-[14px] pt-3 pb-3">
  <ProjectSelector ... />
  <Button
    variant="ghost"
    size="icon"
    className="h-8 w-8 rounded-lg hover:bg-black/10"
    onClick={handleCreateBoard}
  >
    <SquarePen className="h-4 w-4" />
  </Button>
</div>
```

### 3. 현재 사이드바 구조 (변경됨)

**현재 구조 (page.tsx lines 540-608):**
```
Sidebar (w-64)
├── ProjectSelector (단독, 보드 추가 버튼 없음)
├── SidebarMenuItem "Dataset"
│   └── Database icon + label
│   └── mainView 'datasets'로 전환
├── SidebarSection "Board"
│   └── Layers icon + label + Plus 버튼
│   └── BoardList
└── Footer
    ├── Assets button
    └── Settings button
```

### 4. Dataset 기능 현황 (유지해야 함)

**핵심 컴포넌트:**
| 파일 | 경로 | 설명 |
|------|------|------|
| DatasetView.tsx | components/datasets/DatasetView.tsx | 데이터셋 메인 뷰 (lines 1-210) |
| AddDatasetModal.tsx | components/datasets/AddDatasetModal.tsx | 드래그앤드롭 업로드 모달 (lines 1-575) |
| fileAssetApi.ts | api/fileAssetApi.ts | CSV/Parquet 파일 API |
| sourceApi.ts | api/sourceApi.ts | 데이터베이스 테이블 캐시 API |

**API 엔드포인트:**
- `POST /api/v1/asset/files` - 파일 임포트
- `GET /api/v1/asset/files` - 파일 목록
- `GET /api/v1/source/cache/` - 캐시된 테이블 목록

**MainView 타입 (유지):**
```typescript
type MainView = 'boards' | 'assets' | 'datasets';
```

### 5. 필요한 변경사항 요약

#### 복구할 항목:
1. Project Selector 옆에 SquarePen 아이콘 버튼 추가
2. 슬라이드 탭 UI 복구 (Board / Dataset)
3. 탭 아래에 컨텐츠 영역 (BoardList 또는 Dataset 관련 UI)

#### 유지할 항목:
1. Dataset 관련 모든 기능 (AddDatasetModal, DatasetView 등)
2. Assets 버튼 위치 (사이드바 하단)
3. MainView 타입에 'datasets' 포함
4. SidebarMenuItem, SidebarSection 컴포넌트 (다른 곳에서 사용 가능)

#### 변경/제거할 항목:
1. 현재 SidebarMenuItem "Dataset" → 슬라이드 탭으로 통합
2. 현재 SidebarSection "Board" → 슬라이드 탭으로 통합

## Code References

### 현재 코드 (수정 대상)
- [page.tsx:540-608](frontend/pluto_duck_frontend/app/page.tsx#L540-L608) - 현재 사이드바 구조
- [page.tsx:555-563](frontend/pluto_duck_frontend/app/page.tsx#L555-L563) - SidebarMenuItem Dataset
- [page.tsx:566-581](frontend/pluto_duck_frontend/app/page.tsx#L566-L581) - SidebarSection Board

### Dataset 기능 (유지)
- [DatasetView.tsx:1-210](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx#L1-L210)
- [AddDatasetModal.tsx:1-575](frontend/pluto_duck_frontend/components/datasets/AddDatasetModal.tsx#L1-L575)
- [fileAssetApi.ts:86-119](frontend/pluto_duck_frontend/api/fileAssetApi.ts#L86-L119) - importFile, listFileAssets
- [sourceApi.ts:223-231](frontend/pluto_duck_frontend/api/sourceApi.ts#L223-L231) - fetchCachedTables

### 보드 관련 (유지)
- [BoardList.tsx:121-211](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L121-L211)
- [useBoards.ts:1-149](frontend/pluto_duck_frontend/hooks/useBoards.ts#L1-L149)

### Git History
- merge-base commit: `82453b39`
- 이전 탭 UI 제거 commit: `1432035` (feat: add collapsible Datasets and Boards sections)

## Architecture Insights

### 슬라이드 탭 구현 패턴
1. **Container**: `relative` 포지션으로 슬라이드 인디케이터 기준점
2. **Indicator**: `absolute` 포지션, `transition-all`로 애니메이션
3. **Buttons**: `relative z-10`으로 인디케이터 위에 표시
4. **State**: `mainView` 상태로 활성 탭 관리

### 최종 구조 (복구 후)
```
Sidebar
├── Header
│   ├── ProjectSelector
│   └── SquarePen Button (보드 추가)
├── Tab Slide UI
│   ├── Board Tab (Layers icon)
│   └── Dataset Tab (Database icon)
├── Content Area
│   ├── (boards 탭) BoardList
│   └── (datasets 탭) DatasetList (최대 3개 + "Browse all datasets...")
└── Footer
    ├── Assets Button
    └── Settings Button

메인 영역 동작:
- Board 탭 선택 → 기존처럼 선택된 보드 표시 유지
- "Browse all datasets..." 클릭 → mainView를 'datasets'로 변경하여 DatasetView 표시
```

## Implementation Recommendations

### Phase 1: DatasetList 컴포넌트 복구
1. 삭제된 DatasetList.tsx 파일 복구
2. import 경로 수정 (lib → api)
3. "Browse all datasets..." 클릭 시 mainView 변경 로직 추가

### Phase 2: Project Selector 헤더 수정
1. SquarePen 아이콘 버튼 추가
2. handleCreateBoard 연결

### Phase 3: Tab Slide UI 복구
1. 이전 코드에서 슬라이드 탭 UI 코드 가져오기
2. 'assets' → 'datasets'로 변경
3. Package 아이콘 → Database 아이콘으로 변경

### Phase 4: 컨텐츠 영역 조정
1. Board 탭: BoardList 표시
2. Dataset 탭: DatasetList 표시 (최대 3개 + "Browse all datasets...")
3. "Browse all datasets..." 클릭 시 mainView를 'datasets'로 변경

### Phase 5: 기존 컴포넌트 정리
1. SidebarMenuItem "Dataset" 제거
2. SidebarSection "Board" 제거 (탭으로 대체)

## User Decisions (Clarified)

1. **Dataset 탭 내용**: ✅ **(A) 간단한 Dataset 목록 표시**
   - 탭 아래에 DatasetList 컴포넌트로 목록 표시
   - 삭제된 DatasetList 컴포넌트 복구 필요

2. **탭 선택 시 메인 영역 동작**: ✅ **기존처럼 선택된 보드 표시 유지**
   - Board 탭 선택 시 오른쪽 메인 영역에 선택된 보드 유지
   - Dataset 탭 선택해도 메인 영역은 독립적으로 동작

## Deleted DatasetList Component (복구 대상)

Git에서 삭제된 DatasetList 컴포넌트 코드 (commit `723be3c6`에서 삭제됨):

**파일:** `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx`

```tsx
'use client';

import { Table2, FolderSearch } from 'lucide-react';
import type { FileAsset } from '../../lib/fileAssetApi';
import type { CachedTable } from '../../lib/sourceApi';

type Dataset = FileAsset | CachedTable;

interface DatasetListProps {
  datasets: Dataset[];
  maxItems?: number;
  activeId?: string;
  onSelect: (dataset: Dataset) => void;
}

export function DatasetList({
  datasets,
  maxItems = 3,
  activeId,
  onSelect,
}: DatasetListProps) {
  if (datasets.length === 0) {
    return (
      <div className="py-2 px-2.5 text-sm text-muted-foreground">
        No datasets yet
      </div>
    );
  }

  const displayedDatasets = datasets.slice(0, maxItems);

  const getDatasetName = (dataset: Dataset): string => {
    if ('name' in dataset && dataset.name) {
      return dataset.name;
    }
    if ('local_table' in dataset) {
      return dataset.local_table;
    }
    return 'Unknown';
  };

  const getDatasetId = (dataset: Dataset): string => {
    return dataset.id;
  };

  return (
    <div>
      {displayedDatasets.map((dataset) => {
        const id = getDatasetId(dataset);
        const name = getDatasetName(dataset);
        const isActive = activeId === id;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(dataset)}
            className={`flex w-full items-center gap-2 pl-1.5 pr-2.5 py-2.5 rounded-lg cursor-pointer transition-colors ${
              isActive ? 'bg-black/5' : 'hover:bg-black/5'
            }`}
          >
            <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[0.8rem] leading-[1rem] text-foreground truncate">{name}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="flex w-full items-center gap-2 pl-1.5 pr-2.5 py-2.5 rounded-lg cursor-pointer hover:bg-black/5 transition-colors"
      >
        <FolderSearch className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[0.8rem] leading-[1rem] text-muted-foreground">Browse all datasets...</span>
      </button>
    </div>
  );
}
```

**특징:**
- 최대 3개 항목 표시 (maxItems prop)
- Table2 아이콘으로 각 데이터셋 표시
- "Browse all datasets..." 버튼 (FolderSearch 아이콘)
- 빈 상태 메시지: "No datasets yet"
