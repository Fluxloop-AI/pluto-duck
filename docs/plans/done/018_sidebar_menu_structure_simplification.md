# 사이드바 메뉴 구조 단순화 Implementation Plan

## Overview
사이드바의 Dataset/Board 섹션에서 접기/펴기(Collapsible) 기능을 제거하고, Dataset을 독립적인 메뉴 아이템으로 전환하여 클릭 시 메인 영역에 DatasetView를 표시하도록 변경합니다.

## Current State Analysis

**현재 구조:**
```
┌─────────────────────────────────────┐
│ ProjectSelector                      │
├─────────────────────────────────────┤
│ Dataset ▼              [+]          │ ← Collapsible
│   📊 Dataset 1                      │
│   📊 Dataset 2                      │
│   🔍 Browse all datasets...         │
├─────────────────────────────────────┤
│ Board ▼                [+]          │ ← Collapsible
│   Board items...                    │
├─────────────────────────────────────┤
│ Assets                               │
│ Settings                             │
└─────────────────────────────────────┘
```

**변경할 파일:**
- `frontend/pluto_duck_frontend/app/page.tsx` - MainView 타입, 사이드바 구조, 라우팅
- `frontend/pluto_duck_frontend/components/sidebar/SidebarSection.tsx` - Collapsible 제거
- `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx` - 삭제 예정

## Desired End State

**목표 구조 (스크린샷 기준):**
```
┌─────────────────────────────────────┐
│ Default Workspace ▼                 │
├─────────────────────────────────────┤
│   🗄️ Dataset                        │ ← 메뉴 아이템 (클릭 시 DatasetView)
│                                     │
│   📑 Board                   [+]    │ ← 섹션 헤더 (접기/펴기 없음)
│     Untitled Board 3               │ ← 선택됨 (배경 하이라이트)
│     8h ago                          │
│     광고 집행                        │
│     8h ago                          │
└─────────────────────────────────────┘
```

**UI 특징:**
- Dataset: 아이콘 + 텍스트로 구성된 단순 메뉴 아이템
- Board: 섹션 헤더 + 항상 표시되는 보드 목록
- 선택된 항목: 밝은 회색 배경의 라운드 박스
- 간결한 여백과 시각적 계층 구조

## What We're NOT Doing
- AssetListView 수정 (legacy로 간주)
- 기존 AddDatasetModal 수정 (그대로 사용)
- Board 목록 UI 변경 (기존 BoardList 컴포넌트 유지)

## Implementation Approach
1. Collapsible 제거를 위해 SidebarSection 컴포넌트 수정
2. Dataset용 SidebarMenuItem 컴포넌트 신규 생성
3. MainView 타입에 'datasets' 추가
4. DatasetView 컴포넌트 신규 생성
5. page.tsx에서 사이드바 구조 및 라우팅 수정
6. 사용하지 않는 DatasetList 컴포넌트 삭제

---

## - [x] Phase 1: SidebarSection 컴포넌트 수정

### Overview
Collapsible 기능을 제거하고 아이콘을 추가하여 단순한 섹션 헤더로 변경합니다.

### Changes Required:

#### 1. SidebarSection.tsx 수정
**File**: `frontend/pluto_duck_frontend/components/sidebar/SidebarSection.tsx`
**Changes**:
- Collapsible 관련 import 및 로직 제거
- `icon` prop 추가 (ReactNode 타입)
- `onClick` prop 추가 (섹션 헤더 클릭 이벤트)
- `isActive` prop 추가 (활성 상태 스타일링)
- ChevronDown 아이콘 제거
- 단순한 div 구조로 변경

**Interface 변경:**
```tsx
interface SidebarSectionProps {
  icon?: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  onAddClick?: () => void;
  children?: ReactNode;
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음: `npm run typecheck`
- [ ] Lint 통과: `npm run lint`

#### Manual Verification:
- [ ] 사이드바에서 chevron 아이콘 사라짐
- [ ] Board 섹션 항상 펼쳐진 상태로 표시
- [ ] + 버튼 정상 동작

---

## - [x] Phase 2: SidebarMenuItem 컴포넌트 생성

### Overview
Dataset처럼 클릭 시 뷰를 전환하는 독립적인 메뉴 아이템 컴포넌트를 생성합니다.

### Changes Required:

#### 1. SidebarMenuItem.tsx 생성
**File**: `frontend/pluto_duck_frontend/components/sidebar/SidebarMenuItem.tsx`
**Changes**: 새 파일 생성

**Props:**
- `icon`: 왼쪽에 표시할 아이콘 (ReactNode)
- `label`: 메뉴 텍스트
- `isActive`: 활성 상태 여부 (스타일링용)
- `onClick`: 클릭 핸들러

**스타일:**
- 패딩: `py-2 pl-[18px] pr-[14px]`
- 활성 상태: `bg-black/5` 배경
- 호버 상태: `hover:bg-black/5`
- 아이콘과 텍스트 간격: `gap-2`
- 텍스트: `text-sm text-foreground` (활성 시 `font-medium`)

#### 2. sidebar/index.ts 업데이트
**File**: `frontend/pluto_duck_frontend/components/sidebar/index.ts`
**Changes**: SidebarMenuItem export 추가

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음: `npm run typecheck`

#### Manual Verification:
- [ ] 컴포넌트가 정상적으로 렌더링됨

---

## - [x] Phase 3: MainView 타입 확장 및 라우팅

### Overview
MainView 타입에 'datasets'를 추가하고 메인 영역 라우팅 로직을 수정합니다.

### Changes Required:

#### 1. MainView 타입 확장
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Line 39 수정

변경 전:
```tsx
type MainView = 'boards' | 'assets';
```

변경 후:
```tsx
type MainView = 'boards' | 'assets' | 'datasets';
```

#### 2. 메인 영역 라우팅 수정
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Line 633-643 영역 수정

삼항 연산자를 조건부 렌더링으로 변경:
- `mainView === 'boards'`: BoardsView 렌더링
- `mainView === 'assets'`: AssetListView 렌더링
- `mainView === 'datasets'`: DatasetView 렌더링

#### 3. Dataset 클릭 시 Board 선택 해제
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Dataset 메뉴 클릭 핸들러에서 `selectBoard(null)` 또는 `setActiveBoard(null)` 호출

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음: `npm run typecheck`

#### Manual Verification:
- [ ] 각 mainView 값에 따라 올바른 컴포넌트 렌더링

---

## - [x] Phase 4: DatasetView 컴포넌트 생성

### Overview
메인 영역에 표시될 DatasetView 컴포넌트를 새로 생성합니다.

### Changes Required:

#### 1. datasets 폴더 및 DatasetView.tsx 생성
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**: 새 파일 생성

**Props:**
```tsx
interface DatasetViewProps {
  projectId: string;
  onOpenAddModal?: () => void;
}
```

**초기 구현 (MVP):**
- 헤더 영역: "Datasets" 타이틀 + "Add Dataset" 버튼
- 컨텐츠 영역: 데이터셋 목록 (그리드 또는 리스트)
- 빈 상태: 데이터셋이 없을 때 안내 메시지

**데이터 로딩:**
- `listFileAssets` API 사용 (CSV, Parquet 파일)
- `fetchCachedTables` API 사용 (DB 캐시 테이블)

#### 2. datasets/index.ts 생성
**File**: `frontend/pluto_duck_frontend/components/datasets/index.ts`
**Changes**: DatasetView export

#### 3. page.tsx에 import 추가
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: DatasetView import 추가

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음: `npm run typecheck`

#### Manual Verification:
- [ ] DatasetView가 메인 영역에 정상 렌더링
- [ ] "Add Dataset" 버튼 클릭 시 AddDatasetModal 열림
- [ ] 데이터셋 목록이 정상적으로 표시됨

---

## - [x] Phase 5: 사이드바 UI 적용

### Overview
page.tsx의 사이드바 영역을 새로운 구조로 변경합니다.

### Changes Required:

#### 1. 아이콘 import 추가
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Line 4에 `Database`, `Layers` 아이콘 import 추가

#### 2. 사이드바 구조 변경
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Line 572-602 영역 재구성

**새 구조:**
```tsx
<div className="flex-1 overflow-y-auto py-2">
  {/* Dataset - 메뉴 아이템 */}
  <SidebarMenuItem
    icon={<Database className="h-4 w-4" />}
    label="Dataset"
    isActive={mainView === 'datasets'}
    onClick={() => {
      setMainView('datasets');
      selectBoard(null); // Board 선택 해제
    }}
  />

  {/* Board - 섹션 헤더 + 리스트 */}
  <div className="mt-4">
    <SidebarSection
      icon={<Layers className="h-4 w-4" />}
      label="Board"
      isActive={mainView === 'boards'}
      onClick={() => setMainView('boards')}
      onAddClick={handleCreateBoard}
    >
      <BoardList ... />
    </SidebarSection>
  </div>
</div>
```

#### 3. DatasetList 사용 제거
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- DatasetList import 제거 (Line 21)
- sidebarDatasets state 제거 (Line 68)
- sidebarDatasets 로딩 로직 제거
- DatasetList 컴포넌트 사용 코드 제거

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음: `npm run typecheck`
- [ ] Lint 통과: `npm run lint`

#### Manual Verification:
- [ ] 스크린샷과 동일한 UI 레이아웃
- [ ] Dataset 클릭 시 DatasetView 표시
- [ ] Board 클릭 시 BoardsView 표시
- [ ] Board 목록 항상 표시됨

---

## - [x] Phase 6: DatasetList 컴포넌트 삭제

### Overview
더 이상 사용하지 않는 DatasetList 컴포넌트를 삭제합니다.

### Changes Required:

#### 1. DatasetList.tsx 삭제
**File**: `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx`
**Changes**: 파일 삭제

#### 2. sidebar/index.ts 업데이트
**File**: `frontend/pluto_duck_frontend/components/sidebar/index.ts`
**Changes**: DatasetList export 제거 (있다면)

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음: `npm run typecheck`
- [x] 빌드 성공: `npm run build`

#### Manual Verification:
- [ ] 앱이 정상적으로 동작

---

## Testing Strategy

### Unit Tests:
- SidebarMenuItem 컴포넌트 클릭 이벤트 테스트
- SidebarSection 아이콘 렌더링 테스트
- DatasetView 데이터 로딩 테스트

### Integration Tests:
- mainView 전환 시 올바른 컴포넌트 렌더링 확인
- Dataset 클릭 → DatasetView 표시 → Board 선택 해제 플로우

### Manual Testing Steps:
1. 앱 실행 후 사이드바 확인
2. Dataset 클릭 → DatasetView 표시 확인
3. Board 섹션 클릭 → BoardsView 표시 확인
4. Board 목록에서 보드 선택 → 해당 보드 로드 확인
5. Dataset 클릭 → Board 선택 해제 확인
6. "Add Dataset" 버튼 → AddDatasetModal 열림 확인
7. Board 섹션 + 버튼 → CreateBoardModal 열림 확인

## Performance Considerations
- DatasetView의 데이터셋 목록은 처음 마운트 시 한 번만 로드
- 필요 시 refreshTrigger prop으로 수동 새로고침 지원
- 대량의 데이터셋이 있을 경우 가상화 스크롤 고려 (추후)

## Migration Notes
- DatasetList 컴포넌트 삭제 전 page.tsx에서 사용 코드 먼저 제거
- Git history로 복구 가능하므로 과감하게 삭제

## References
- [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) - 메인 페이지 컴포넌트
- [SidebarSection.tsx](frontend/pluto_duck_frontend/components/sidebar/SidebarSection.tsx) - 현재 사이드바 섹션 컴포넌트
- [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) - 삭제 대상 컴포넌트
- [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) - 보드 목록 컴포넌트
- [AddDatasetModal.tsx](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx) - 데이터셋 추가 모달
- [docs/research/034_sidebar_menu_structure_simplification.md](docs/research/034_sidebar_menu_structure_simplification.md) - 리서치 문서
- 첨부된 UI 스크린샷
