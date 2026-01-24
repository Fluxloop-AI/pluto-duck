---
date: 2026-01-23T11:00:00+09:00
researcher: Claude
topic: "사이드바 메뉴 구조 단순화 - 접기/펴기 제거 및 Dataset 메뉴 전환"
tags: [research, sidebar, navigation, dataset, ui-restructure, menu]
status: complete
---

# Research: 사이드바 메뉴 구조 단순화

## Research Question
1. Dataset/Board 접기/펴기 기능 제거
2. Dataset/Board 앞에 아이콘 추가 (database, layers)
3. Dataset을 메뉴로 처리해서 클릭 시 보드 영역에서 Dataset 관리 화면을 표시

## Summary

현재 사이드바는 `SidebarSection` 컴포넌트로 Dataset/Board 섹션을 구현하고 있으며, Collapsible 기능이 내장되어 있습니다. 요청된 변경사항을 구현하려면:

1. **접기/펴기 제거**: `SidebarSection` 수정 또는 새 컴포넌트 생성
2. **아이콘 추가**: `Database` (Dataset), `Layers` (Board) 아이콘 사용
3. **Dataset 메뉴화**: `mainView` state에 `'datasets'` 타입 추가하고, 클릭 시 DatasetView 컴포넌트 렌더링

## Detailed Findings

### 1. 현재 사이드바 구조

**파일:** [page.tsx:558-627](frontend/pluto_duck_frontend/app/page.tsx#L558-L627)

```
┌─────────────────────────────────────┐
│ Header (ProjectSelector)            │
├─────────────────────────────────────┤
│ Content (flex-1, overflow-y-auto)   │
│ ┌─────────────────────────────────┐ │
│ │ Dataset ▼          [+]          │ │ ← SidebarSection (Collapsible)
│ │   📊 Dataset 1                  │ │
│ │   📊 Dataset 2                  │ │
│ │   🔍 Browse all datasets...     │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ Board ▼            [+]          │ │ ← SidebarSection (Collapsible)
│ │   Untitled Board 1              │ │
│ │   ...                           │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Footer                              │
│   📦 Assets                         │
│   ⚙️ Settings                       │
└─────────────────────────────────────┘
```

### 2. SidebarSection 컴포넌트 분석

**파일:** [SidebarSection.tsx](frontend/pluto_duck_frontend/components/sidebar/SidebarSection.tsx)

```tsx
// 현재 구조 - Collapsible 사용
export function SidebarSection({ label, defaultOpen, onAddClick, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between py-1 pl-[18px] pr-[14px]">
        <CollapsibleTrigger className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          <ChevronDown className={`h-4 w-4 ${isOpen ? '' : '-rotate-90'}`} />
        </CollapsibleTrigger>
        {onAddClick && <PlusButton onClick={onAddClick} />}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
```

### 3. 요청된 UI 구조 (이미지 기반)

```
┌─────────────────────────────────────┐
│ Default Workspace ▼                 │
├─────────────────────────────────────┤
│                                     │
│   📊 Dataset                        │ ← 클릭 시 mainView='datasets'
│                                     │
│   📑 Board                   [+]    │ ← 섹션 헤더 (접기/펴기 없음)
│     │ Untitled Board 3  · 8h ago   │ │ ← 하이라이트 (선택됨)
│     │ 광고 집행        · 8h ago    │ │
│                                     │
└─────────────────────────────────────┘
```

### 4. mainView State 확장

**현재 타입:** [page.tsx:39](frontend/pluto_duck_frontend/app/page.tsx#L39)
```tsx
type MainView = 'boards' | 'assets';
```

**변경 필요:**
```tsx
type MainView = 'boards' | 'assets' | 'datasets';
```

**현재 라우팅:** [page.tsx:633-643](frontend/pluto_duck_frontend/app/page.tsx#L633-L643)
```tsx
{mainView === 'boards' ? (
  <BoardsView ref={boardsViewRef} projectId={defaultProjectId} activeBoard={activeBoard} />
) : (
  <AssetListView projectId={defaultProjectId} initialTab={assetInitialTab} refreshTrigger={dataSourcesRefresh} />
)}
```

**변경 후:**
```tsx
{mainView === 'boards' && (
  <BoardsView ref={boardsViewRef} projectId={defaultProjectId} activeBoard={activeBoard} />
)}
{mainView === 'assets' && (
  <AssetListView projectId={defaultProjectId} initialTab={assetInitialTab} refreshTrigger={dataSourcesRefresh} />
)}
{mainView === 'datasets' && (
  <DatasetView projectId={defaultProjectId} refreshTrigger={dataSourcesRefresh} />
)}
```

### 5. 아이콘 선정

| 섹션 | 추천 아이콘 | lucide-react 이름 | 이유 |
|------|------------|------------------|------|
| Dataset | 📊 | `Database` | 데이터 저장소 개념을 명확히 전달 |
| Board | 📑 | `Layers` | 여러 레이어/보드가 겹쳐진 개념 |

**대체 옵션:**
- Dataset: `Table2`, `Table`, `HardDrive`
- Board: `LayoutGrid`, `Presentation`, `Kanban`

### 6. 새 SidebarMenuItem 컴포넌트 설계

접기/펴기 없는 단순 메뉴 아이템:

```tsx
// components/sidebar/SidebarMenuItem.tsx
interface SidebarMenuItemProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  onAddClick?: () => void;
}

export function SidebarMenuItem({
  icon,
  label,
  isActive,
  onClick,
  onAddClick,
}: SidebarMenuItemProps) {
  return (
    <div className="flex items-center justify-between py-1 pl-[18px] pr-[14px]">
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-2 text-sm transition-colors ${
          isActive
            ? 'text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {icon}
        <span>{label}</span>
      </button>
      {onAddClick && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddClick();
          }}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-200 transition-colors"
        >
          <Plus className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
```

### 7. 변경된 사이드바 구조

```tsx
// page.tsx 사이드바 영역
<div className="flex-1 overflow-y-auto py-2">
  {/* Dataset - 메뉴 아이템 (클릭 시 DatasetView로 전환) */}
  <SidebarMenuItem
    icon={<Database className="h-4 w-4" />}
    label="Dataset"
    isActive={mainView === 'datasets'}
    onClick={() => setMainView('datasets')}
  />

  {/* Board - 섹션 헤더 + 리스트 (접기/펴기 없음) */}
  <div className="mt-4">
    <SidebarMenuItem
      icon={<Layers className="h-4 w-4" />}
      label="Board"
      isActive={mainView === 'boards'}
      onClick={() => setMainView('boards')}
      onAddClick={handleCreateBoard}
    />
    <div className="px-[14px] mt-1">
      <BoardList
        boards={boards}
        activeId={activeBoard?.id}
        onSelect={(board) => {
          setMainView('boards');
          selectBoard(board);
        }}
        onDelete={(board) => deleteBoard(board.id)}
        onUpdate={(boardId, data) => updateBoard(boardId, data)}
      />
    </div>
  </div>
</div>
```

### 8. DatasetView 컴포넌트 설계 (참고: AssetListView)

**AssetListView 패턴 참고:** [AssetListView.tsx](frontend/pluto_duck_frontend/components/assets/AssetListView.tsx)

DatasetView에 필요한 기능:
1. **데이터셋 목록 표시**: 그리드/리스트 뷰
2. **데이터셋 추가**: 드래그앤드롭, 파일 선택
3. **데이터셋 상세**: 클릭 시 미리보기/편집
4. **검색/필터**: 이름, 타입 등으로 필터링

```tsx
// components/datasets/DatasetView.tsx
interface DatasetViewProps {
  projectId: string;
  refreshTrigger?: number;
}

export function DatasetView({ projectId, refreshTrigger }: DatasetViewProps) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // ... 데이터 로딩 및 UI 구현

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h1 className="text-xl font-semibold">Datasets</h1>
        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Dataset
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Grid/List of datasets */}
      </div>

      {/* Add Dataset Modal */}
      <AddDatasetModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        projectId={projectId}
      />
    </div>
  );
}
```

### 9. 기존 데이터셋 관련 컴포넌트

| 컴포넌트 | 파일 | 용도 | 상태 |
|---------|------|------|------|
| DatasetList | [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) | 사이드바 데이터셋 목록 | ❌ 삭제 예정 |
| AddDatasetModal | [AddDatasetModal.tsx](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx) | 데이터셋 추가 모달 | ✅ 유지 |
| TableCard | AssetListView 내부 | 테이블/파일 카드 | ✅ 유지 |

### 10. 데이터 타입

**현재 사용 중인 타입:** [DatasetList.tsx:7](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx#L7)
```tsx
type Dataset = FileAsset | CachedTable;
```

**관련 타입들:**
- `FileAsset`: [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) - CSV/Parquet 파일
- `CachedTable`: [sourceApi.ts](frontend/pluto_duck_frontend/lib/sourceApi.ts) - DB 캐시 테이블

## Code References

- `frontend/pluto_duck_frontend/app/page.tsx:39` - MainView 타입 정의
- `frontend/pluto_duck_frontend/app/page.tsx:115` - mainView state
- `frontend/pluto_duck_frontend/app/page.tsx:572-602` - 현재 SidebarSection 사용
- `frontend/pluto_duck_frontend/app/page.tsx:633-643` - mainView 기반 라우팅
- `frontend/pluto_duck_frontend/components/sidebar/SidebarSection.tsx` - 접기/펴기 컴포넌트 (수정 예정)
- `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx` - 데이터셋 목록 (삭제 예정)
- `frontend/pluto_duck_frontend/components/assets/AssetListView.tsx` - DatasetView 참고용

## Architecture Insights

### 변경 작업 목록

1. **DatasetList 컴포넌트 삭제**
   - `components/sidebar/DatasetList.tsx` 삭제
   - `page.tsx`에서 import 및 사용 코드 제거

2. **SidebarSection 컴포넌트 수정**
   - `components/sidebar/SidebarSection.tsx` 수정
   - Collapsible 제거, 아이콘 prop 추가
   - 또는 새 `SidebarMenuItem` 컴포넌트 생성

3. **MainView 타입 확장**
   - `page.tsx:39` - `'datasets'` 추가

4. **사이드바 영역 수정**
   - `page.tsx:572-602` - 접기/펴기 제거, 아이콘 추가
   - Dataset은 메뉴로, Board는 헤더 + 리스트 구조

5. **메인 영역 라우팅 수정**
   - `page.tsx:633-643` - `datasets` 케이스 추가
   - DatasetView 컴포넌트 렌더링

6. **DatasetView 컴포넌트 생성**
   - `components/datasets/DatasetView.tsx` 생성
   - AssetListView 패턴 참고

7. **아이콘 임포트 추가**
   - `page.tsx:4` - `Database`, `Layers` 추가

## Implementation Plan

### Phase 1: 구조 변경 및 정리
1. `DatasetList.tsx` 컴포넌트 삭제 (git history로 복구 가능)
2. `SidebarSection.tsx` 수정 - Collapsible 제거, 아이콘 prop 추가
3. `MainView` 타입에 `'datasets'` 추가
4. 사이드바 UI 변경 (접기/펴기 제거, 아이콘 추가)

### Phase 2: DatasetView 구현
1. `DatasetView` 컴포넌트 생성
2. 기존 `AddDatasetModal` 연동
3. 데이터셋 그리드/리스트 뷰 구현
4. 메인 영역 라우팅 추가

### Phase 3: 상세 기능
1. 데이터셋 미리보기/편집
2. 검색/필터 기능
3. 드래그앤드롭 업로드

## Decisions Made

1. **Board 섹션 처리**: ✅ 접기/펴기 불필요 - 항상 펼쳐진 상태로 유지
2. **DatasetView vs AssetListView 통합**: ✅ 현재는 별도 유지
   - AssetView 기능을 하나씩 재배치해보는 실험 단계
   - 실패 시 원복 예정이므로 통합 여부는 나중에 판단
3. **사이드바 DatasetList 컴포넌트**: ✅ 지금 삭제
   - Git history가 버전 관리하므로 deprecated 유지 불필요
   - Dead code 방지 및 코드베이스 깔끔하게 유지
   - 필요 시 이전 커밋으로 복구 가능
