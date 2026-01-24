# Sidebar Datasets & Boards Sections Implementation Plan

## Overview
사이드바에 접기/펼치기 가능한 Datasets와 Boards 두 섹션을 추가하고, 기존 New Board 버튼을 Boards 섹션 헤더로 이동하는 UI 재배치 작업.

## Current State Analysis

**현재 사이드바 구조** (`page.tsx:529-589`):
- Header: ProjectSelector + New Board 버튼 (SquarePen 아이콘)
- Content: BoardList 컴포넌트 (섹션 구분 없음)
- Footer: Assets 버튼, Settings 버튼

**기존 컴포넌트**:
- `BoardList.tsx`: 보드 목록 렌더링
- `collapsible.tsx`: Radix UI Collapsible 래퍼

## Desired End State

```
┌─────────────────────────────┐
│ [ProjectSelector]           │  ← New Board 버튼 제거
├─────────────────────────────┤
│ Dataset ∨                 + │  ← 접기/펼치기 + 추가 버튼
│   ⊞ google_ad_20251208      │
│   ⊞ naver_ad_251208         │
│   ⊞ linkedin_ad_performance │  ← 선택시 bg-accent
│   🔍 Browse all datasets... │  ← 5개 초과시 표시
├─────────────────────────────┤
│ Board ∨                   + │  ← 접기/펼치기 + 추가 버튼
│   Untitled Board 4          │
│   8h ago                    │  ← 선택시 bg-accent
│   Untitled Board 2          │
│   3m ago                    │
├─────────────────────────────┤
│ Assets                      │
│ Settings                    │
└─────────────────────────────┘
```

## What We're NOT Doing
- Dataset 클릭 시 동작 구현 (향후)
- Dataset 추가 모달 구현 (향후)
- Dataset 삭제/편집 기능
- Boards 섹션 무한 스크롤 또는 페이지네이션

## Implementation Approach
1. 재사용 가능한 `SidebarSection` 컴포넌트 생성
2. `DatasetList` 컴포넌트 생성 (최대 5개 + Browse 버튼)
3. Datasets/Boards 섹션을 `SidebarSection`으로 감싸기
4. Header에서 New Board 버튼 제거

---

## - [x] Phase 1: SidebarSection 컴포넌트 생성

### Overview
접기/펼치기 가능한 섹션 컴포넌트를 생성하여 Datasets와 Boards 섹션에서 재사용

### Changes Required:

#### 1. SidebarSection 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/sidebar/SidebarSection.tsx` (신규)

**Props 인터페이스**:
- `label`: string - 섹션 레이블 ("Dataset", "Board")
- `defaultOpen`: boolean - 기본 펼침 상태 (기본값: true)
- `onAddClick`: () => void - "+" 버튼 클릭 핸들러 (optional)
- `children`: ReactNode - 섹션 내용

**스타일 사양** (이미지 기반):
- 헤더 컨테이너: `flex items-center justify-between px-3 py-2`
- 레이블 + Chevron 그룹:
  - 레이블: `text-sm text-muted-foreground font-medium`
  - ChevronDown 아이콘: `h-4 w-4 ml-1 text-muted-foreground`
  - 접힌 상태에서 chevron 90도 회전: `transition-transform rotate-[-90deg]`
- "+" 버튼:
  - 스타일: `h-6 w-6 flex items-center justify-center rounded hover:bg-accent`
  - Plus 아이콘: `h-4 w-4 text-muted-foreground`
- Content 영역: `px-3` (내부 아이템들은 자체 패딩)

**컴포넌트 구조**:
- Radix Collapsible 사용
- 헤더: CollapsibleTrigger (레이블 + chevron) + "+" 버튼 (trigger 외부)
- 내용: CollapsibleContent

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 타입 체크 통과: `npm run typecheck`
- [x] Lint 통과: `npm run lint`

#### Manual Verification:
- [ ] 접기/펼치기 애니메이션 동작
- [ ] Chevron 아이콘 회전 애니메이션
- [ ] "+" 버튼 hover 상태

---

## - [x] Phase 2: DatasetList 컴포넌트 생성

### Overview
사이드바에 표시할 Dataset 목록 컴포넌트 생성 (최대 5개 + Browse 버튼)

### Changes Required:

#### 1. DatasetList 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx` (신규)

**Props 인터페이스**:
- `datasets`: Array<FileAsset | CachedTable> - 데이터셋 목록
- `maxItems`: number - 최대 표시 개수 (기본값: 5)
- `activeId`: string | undefined - 선택된 데이터셋 ID
- `onSelect`: (dataset) => void - 선택 핸들러
- `onBrowseAll`: () => void - "Browse all datasets..." 클릭 핸들러

**스타일 사양** (이미지 기반):
- 아이템 컨테이너: `space-y-0.5`
- 각 아이템:
  - 컨테이너: `flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-accent transition-colors`
  - 선택 상태: `bg-accent`
  - Grid 아이콘 (LayoutGrid 또는 Table2): `h-4 w-4 text-muted-foreground shrink-0`
  - 텍스트: `text-sm text-foreground truncate`
- "Browse all datasets..." 버튼:
  - 컨테이너: `flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-accent`
  - 아이콘 (FolderSearch): `h-4 w-4 text-muted-foreground`
  - 텍스트: `text-sm text-muted-foreground`

**동작**:
- `datasets.slice(0, maxItems)` 만큼만 표시
- `datasets.length > maxItems`일 때 "Browse all datasets..." 버튼 표시
- 빈 상태: "No datasets yet" 메시지

#### 2. useDatasets 훅 생성 (선택적)
**File**: `frontend/pluto_duck_frontend/hooks/useDatasets.ts` (신규)

**기능**:
- projectId를 받아서 FileAssets + CachedTables 조합하여 반환
- 기존 `listFileAssets()`, `fetchCachedTables()` API 활용

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 타입 체크 통과
- [x] Lint 통과

#### Manual Verification:
- [ ] 데이터셋 5개 이하일 때 전체 표시
- [ ] 데이터셋 6개 이상일 때 5개 + Browse 버튼 표시
- [ ] 선택 상태 배경색 적용
- [ ] 호버 상태 동작

---

## - [x] Phase 3: 사이드바에 섹션 통합

### Overview
page.tsx의 사이드바에 Datasets 섹션과 Boards 섹션을 SidebarSection으로 감싸서 통합

### Changes Required:

#### 1. page.tsx 수정
**File**: `frontend/pluto_duck_frontend/app/page.tsx`

**Import 추가**:
- SidebarSection
- DatasetList
- useDatasets (또는 직접 API 호출)

**상태 추가**:
- `datasetsSectionOpen`: boolean (기본값: true)
- `boardsSectionOpen`: boolean (기본값: true)
- `datasets`: FileAsset[] + CachedTable[] (useDatasets 훅 또는 useEffect로 fetch)

**사이드바 Content 영역 변경** (lines 556-564):

기존:
```tsx
<div className="flex-1 overflow-y-auto px-3 py-3">
  <BoardList ... />
</div>
```

변경 후:
```tsx
<div className="flex-1 overflow-y-auto py-2">
  {/* Datasets Section */}
  <SidebarSection
    label="Dataset"
    defaultOpen={true}
    onAddClick={() => { /* 향후 모달 연결 */ }}
  >
    <DatasetList
      datasets={datasets}
      maxItems={5}
      activeId={undefined}
      onSelect={() => { /* 향후 구현 */ }}
      onBrowseAll={() => setMainView('assets')}
    />
  </SidebarSection>

  {/* Boards Section */}
  <SidebarSection
    label="Board"
    defaultOpen={true}
    onAddClick={handleCreateBoard}
  >
    <BoardList ... />
  </SidebarSection>
</div>
```

**handleCreateBoard 함수** (기존 인라인 로직 추출):
- 기존 line 543-546의 로직을 별도 함수로 추출

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 타입 체크 통과
- [x] Lint 통과
- [x] 빌드 성공: `npm run build`

#### Manual Verification:
- [ ] Datasets 섹션 접기/펼치기 동작
- [ ] Boards 섹션 접기/펼치기 동작
- [ ] Datasets "+" 버튼 클릭 가능 (향후 모달 연결용)
- [ ] Boards "+" 버튼 클릭 시 새 보드 생성
- [ ] "Browse all datasets..." 클릭 시 Assets 뷰로 전환

---

## - [x] Phase 4: Header에서 New Board 버튼 제거

### Overview
기존 ProjectSelector 옆의 New Board 버튼을 제거하여 UI 정리

### Changes Required:

#### 1. page.tsx 수정
**File**: `frontend/pluto_duck_frontend/app/page.tsx`

**삭제할 코드** (lines 541-552):
```tsx
<button
  type="button"
  onClick={() => {
    const existingCount = boards.filter(b => b.name.startsWith('Untitled Board')).length;
    const newName = existingCount === 0 ? 'Untitled Board' : `Untitled Board ${existingCount + 1}`;
    void createBoard(newName);
  }}
  className="flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10 transition"
  title="New board"
>
  <SquarePen className="h-4 w-4" />
</button>
```

**Header 레이아웃 조정**:
- `justify-between` 제거 (버튼이 없으므로 불필요)
- ProjectSelector만 남김

**Import 정리**:
- `SquarePen` 아이콘 import 제거 (더 이상 사용하지 않음)

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 타입 체크 통과
- [x] Lint 통과
- [x] 빌드 성공

#### Manual Verification:
- [ ] Header에 New Board 버튼이 없음
- [ ] ProjectSelector 정상 동작
- [ ] Boards 섹션의 "+" 버튼으로 새 보드 생성 가능

---

## Testing Strategy

### Unit Tests:
- SidebarSection 컴포넌트 렌더링 테스트
- DatasetList 컴포넌트의 maxItems 로직 테스트
- 빈 상태 렌더링 테스트

### Integration Tests:
- 사이드바 전체 렌더링
- 섹션 접기/펼치기 상태 유지

### Manual Testing Steps:
1. 앱 실행 후 사이드바에 Datasets, Boards 두 섹션 확인
2. 각 섹션의 접기/펼치기 버튼 클릭하여 동작 확인
3. Boards 섹션 "+" 버튼 클릭하여 새 보드 생성 확인
4. Datasets 섹션에 5개 초과 데이터셋 있을 때 "Browse all datasets..." 버튼 표시 확인
5. "Browse all datasets..." 클릭 시 Assets 뷰로 전환 확인
6. Header에 New Board 버튼이 없는지 확인

## Performance Considerations
- Datasets fetch는 사이드바 마운트 시 1회만 수행
- 섹션 접힌 상태에서도 내용물은 DOM에 유지 (Radix Collapsible 기본 동작)

## Migration Notes
- 기존 사용자의 사이드바 상태(collapsed)는 유지됨
- 섹션별 접힘 상태는 localStorage에 저장하지 않음 (향후 추가 가능)

## References
- `frontend/pluto_duck_frontend/app/page.tsx` (lines 529-589) - 현재 사이드바 구현
- `frontend/pluto_duck_frontend/components/boards/BoardList.tsx` - 기존 보드 목록 컴포넌트
- `frontend/pluto_duck_frontend/components/ui/collapsible.tsx` - Radix Collapsible 래퍼
- `frontend/pluto_duck_frontend/lib/fileAssetApi.ts` - FileAsset API
- `frontend/pluto_duck_frontend/lib/sourceApi.ts` - CachedTable API
- 사용자 제공 이미지 - 목표 UI 디자인
