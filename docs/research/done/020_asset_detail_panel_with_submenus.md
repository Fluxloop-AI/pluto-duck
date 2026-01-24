---
date: 2026-01-15T17:30:00+09:00
researcher: Claude
topic: "Asset Detail Panel with Sub-menus (analyses, context, data source, memory)"
tags: [research, codebase, asset, sidebar, board, navigation, tabs]
status: complete
---

# Research: Asset 클릭 시 보드 영역 변경 및 하위 메뉴 구현

## Research Question
메인 사이드패널에서 asset을 클릭했을 때 나오는 화면과 인터랙션에 대해서. 이 assets 하단에 몇 가지 메뉴를 두고 싶음. 그래서 이 메뉴들을 클릭했을 때 보드 영역이 바뀌도록:
1. analyses
2. context
3. data source
4. memory

## Summary

현재 구조에서 Asset 선택 시 보드 영역이 변경되도록 하려면 다음 접근이 필요합니다:

1. **현재 상태**: 사이드바의 Assets 탭은 단순 placeholder만 표시하고, 실제 AssetListView는 메인 콘텐츠 영역에 렌더링
2. **제안 구조**: 개별 Asset 클릭 시 → 보드 영역에 Asset Detail Panel 표시 → 4개의 서브탭(analyses, context, data source, memory)으로 구성
3. **구현 패턴**: 기존 Chat Multi-Tab 시스템 또는 Board Tabs 패턴을 참조하여 구현 가능

---

## Detailed Findings

### 1. 현재 사이드패널 Asset 구조

#### 1.1 Main View 토글 구조

**파일:** [page.tsx](frontend/pluto_duck_frontend/app/page.tsx)

```typescript
// Line 57: mainView 상태
const [mainView, setMainView] = useState<MainView>('boards');
const [assetInitialTab, setAssetInitialTab] = useState<'analyses' | 'datasources'>('analyses');

// Lines 462-493: Boards/Assets 슬라이딩 토글
<div className="relative flex p-1 bg-muted rounded-lg mx-3 mb-2">
  {/* 슬라이딩 인디케이터 */}
  <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md bg-primary
    transition-all duration-200 ease-out ${
      mainView === 'boards' ? 'left-1' : 'left-[50%]'
    }`} />

  <button onClick={() => setMainView('boards')}>Boards</button>
  <button onClick={() => setMainView('assets')}>Assets</button>
</div>
```

#### 1.2 사이드바 콘텐츠

```typescript
// Lines 495-519: 사이드바 콘텐츠 조건부 렌더링
{mainView === 'boards' && (
  <BoardList
    boards={boards}
    activeId={activeBoard?.id}
    onSelect={(board: Board) => selectBoard(board)}
    onDelete={(board: Board) => deleteBoard(board.id)}
  />
)}

{mainView === 'assets' && (
  <div className="text-xs text-muted-foreground">
    View saved analyses in the main panel
  </div>
)}
```

**현재 문제점**: Assets 뷰에서 사이드바는 단순 텍스트만 표시하고 실제 Asset 목록은 메인 영역에서 렌더링

---

### 2. 메인 콘텐츠 영역 구조

#### 2.1 조건부 렌더링

**파일:** [page.tsx:504-508](frontend/pluto_duck_frontend/app/page.tsx#L504-L508)

```typescript
// 메인 영역: Board 또는 Asset 뷰
{mainView === 'boards' && activeBoard && (
  <BoardsView
    activeBoard={activeBoard}
    projectId={defaultProjectId}
    onBoardUpdate={handleBoardUpdate}
  />
)}

{mainView === 'assets' && (
  <AssetListView
    projectId={defaultProjectId}
    initialTab={assetInitialTab}
    refreshTrigger={dataSourcesRefresh}
  />
)}
```

#### 2.2 AssetListView 탭 구조

**파일:** [AssetListView.tsx](frontend/pluto_duck_frontend/components/assets/AssetListView.tsx)

현재 2개의 주요 탭:
- **Analyses** (Lines 524-539): SQL 분석 목록
- **Data Sources** (Lines 540-555): 연결된 데이터 소스 및 데이터셋

```typescript
// Lines 521-557: 현재 탭 구조
<div className="flex border-b border-border">
  <button
    onClick={() => setActiveMainTab('analyses')}
    className={activeMainTab === 'analyses' ? 'border-primary' : ''}
  >
    <BarChart2 /> Analyses
  </button>
  <button
    onClick={() => setActiveMainTab('datasources')}
    className={activeMainTab === 'datasources' ? 'border-primary' : ''}
  >
    <Database /> Data Sources
  </button>
</div>
```

---

### 3. 제안: Asset Detail Panel 아키텍처

#### 3.1 새로운 상태 구조

```typescript
// page.tsx에 추가할 상태
type AssetDetailView = 'list' | 'detail';
type AssetDetailTab = 'analyses' | 'context' | 'datasource' | 'memory';

const [assetDetailView, setAssetDetailView] = useState<AssetDetailView>('list');
const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
const [activeAssetTab, setActiveAssetTab] = useState<AssetDetailTab>('analyses');
```

#### 3.2 제안 컴포넌트 구조

```
frontend/pluto_duck_frontend/components/assets/
├── AssetListView.tsx            # 기존: Asset 목록 뷰
├── AssetDetailPanel.tsx         # 새로: Asset 상세 패널 (보드 영역)
│   ├── AssetDetailTabs.tsx      # 새로: 4개 서브탭 네비게이션
│   ├── AnalysesTab.tsx          # 새로: analyses 탭 콘텐츠
│   ├── ContextTab.tsx           # 새로: context 탭 콘텐츠
│   ├── DataSourceTab.tsx        # 새로: data source 탭 콘텐츠
│   └── MemoryTab.tsx            # 새로: memory 탭 콘텐츠
├── AssetSidebarList.tsx         # 새로: 사이드바용 Asset 목록
└── ...
```

#### 3.3 데이터 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│                         page.tsx                                 │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │ Sidebar          │    │ Main Content                      │   │
│  │                  │    │                                    │   │
│  │ mainView=assets  │    │ assetDetailView=list              │   │
│  │ ┌──────────────┐ │    │ ┌──────────────────────────────┐  │   │
│  │ │AssetSidebar  │ │    │ │  AssetListView               │  │   │
│  │ │List          │ │    │ │  (현재 전체 목록)             │  │   │
│  │ │              │ │    │ └──────────────────────────────┘  │   │
│  │ │ • Asset A ◄──┼─┼────┼─ onClick → setSelectedAssetId     │   │
│  │ │ • Asset B    │ │    │           setAssetDetailView      │   │
│  │ │ • Asset C    │ │    │                                    │   │
│  │ └──────────────┘ │    │ assetDetailView=detail             │   │
│  │                  │    │ ┌──────────────────────────────┐  │   │
│  │ [Sub-menus]      │    │ │  AssetDetailPanel            │  │   │
│  │ • analyses       │    │ │  ┌────────────────────────┐  │  │   │
│  │ • context        │    │ │  │ Tabs: analyses|context │  │  │   │
│  │ • data source    │    │ │  │      |datasource|memory│  │  │   │
│  │ • memory         │    │ │  └────────────────────────┘  │  │   │
│  │                  │    │ │  [Tab Content Area]          │  │   │
│  └──────────────────┘    │ └──────────────────────────────┘  │   │
│                          └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

### 4. 참조할 기존 패턴

#### 4.1 Chat Multi-Tab 패턴 (가장 성숙한 패턴)

**파일:** [TabBar.tsx](frontend/pluto_duck_frontend/components/chat/TabBar.tsx)

```typescript
// Lines 9-17: Props 인터페이스
interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  sessions: ChatSessionSummary[];
  onSelectSession: (session: ChatSessionSummary) => void;
}

// Lines 56-96: 탭 렌더링
{tabs.map((tab) => (
  <button
    key={tab.id}
    onClick={() => onSelectTab(tab.id)}
    className={`... ${activeTabId === tab.id ? 'bg-background' : ''}`}
  >
    {tab.title}
  </button>
))}
```

#### 4.2 Board Toolbar 탭 패턴

**파일:** [BoardToolbar.tsx](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx)

```typescript
// Lines 75-148: 탭 렌더링 with 인라인 편집
{tabs.map((tab) => (
  <div key={tab.id} className="group relative">
    {editingTabId === tab.id ? (
      <input value={editingName} onChange={...} onBlur={finishEditing} />
    ) : (
      <button onClick={() => onSelectTab(tab.id)}>
        {tab.name}
      </button>
    )}
  </div>
))}
```

#### 4.3 슬라이딩 토글 패턴

**파일:** [page.tsx:464-467](frontend/pluto_duck_frontend/app/page.tsx#L464-L467)

```typescript
// 슬라이딩 인디케이터 애니메이션
<div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md bg-primary
  transition-all duration-200 ease-out ${
    mainView === 'boards' ? 'left-1' : 'left-[50%]'
  }`}
/>
```

---

### 5. Asset 타입 및 데이터 모델

#### 5.1 주요 Asset 타입

| Type | File | Purpose |
|------|------|---------|
| Analysis | [assetsApi.ts:22-33](frontend/pluto_duck_frontend/lib/assetsApi.ts#L22-L33) | SQL 쿼리 정의 및 실행 |
| FileAsset | [fileAssetApi.ts:16-28](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L16-L28) | 임포트된 CSV/Parquet 파일 |
| Source | [sourceApi.ts:16-27](frontend/pluto_duck_frontend/lib/sourceApi.ts#L16-L27) | DB 연결 정보 |
| CachedTable | [sourceApi.ts:33-42](frontend/pluto_duck_frontend/lib/sourceApi.ts#L33-L42) | 캐시된 테이블 데이터 |

#### 5.2 서브탭 콘텐츠 매핑

| Sub-tab | 표시할 데이터 | 관련 API |
|---------|--------------|----------|
| **analyses** | 선택된 Asset의 SQL, 실행 결과, 히스토리 | `getAnalysis()`, `getRunHistory()` |
| **context** | Asset의 설명, 태그, 메타데이터 | Asset 자체 필드들 |
| **data source** | Asset이 참조하는 데이터 소스, 리니지 | `getLineage()`, `fetchSources()` |
| **memory** | 해당 Asset 관련 대화 기록, 메모 | 새로 구현 필요 (memories API) |

---

### 6. 구현 가이드

#### 6.1 사이드바 Asset 목록 컴포넌트

```typescript
// components/assets/AssetSidebarList.tsx (새로 생성)
interface AssetSidebarListProps {
  assets: Asset[];
  selectedId: string | null;
  onSelect: (asset: Asset) => void;
  activeTab: AssetDetailTab;
  onTabChange: (tab: AssetDetailTab) => void;
}

export function AssetSidebarList({
  assets,
  selectedId,
  onSelect,
  activeTab,
  onTabChange,
}: AssetSidebarListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Asset 목록 */}
      <div className="flex-1 overflow-auto">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className={selectedId === asset.id ? 'bg-accent' : ''}
          >
            {asset.name}
          </button>
        ))}
      </div>

      {/* 서브 메뉴 (선택된 Asset이 있을 때만 표시) */}
      {selectedId && (
        <div className="border-t border-border pt-2 mt-2">
          <SubMenuTabs activeTab={activeTab} onTabChange={onTabChange} />
        </div>
      )}
    </div>
  );
}
```

#### 6.2 서브메뉴 탭 컴포넌트

```typescript
// components/assets/SubMenuTabs.tsx (새로 생성)
const SUB_MENUS = [
  { id: 'analyses', label: 'Analyses', icon: BarChart2 },
  { id: 'context', label: 'Context', icon: FileText },
  { id: 'datasource', label: 'Data Source', icon: Database },
  { id: 'memory', label: 'Memory', icon: Brain },
] as const;

interface SubMenuTabsProps {
  activeTab: AssetDetailTab;
  onTabChange: (tab: AssetDetailTab) => void;
}

export function SubMenuTabs({ activeTab, onTabChange }: SubMenuTabsProps) {
  return (
    <div className="flex flex-col gap-1 px-2">
      {SUB_MENUS.map((menu) => (
        <button
          key={menu.id}
          onClick={() => onTabChange(menu.id)}
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm
            ${activeTab === menu.id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted'
            }`}
        >
          <menu.icon className="h-4 w-4" />
          {menu.label}
        </button>
      ))}
    </div>
  );
}
```

#### 6.3 Asset Detail Panel (보드 영역)

```typescript
// components/assets/AssetDetailPanel.tsx (새로 생성)
interface AssetDetailPanelProps {
  asset: Asset;
  activeTab: AssetDetailTab;
  projectId: string;
}

export function AssetDetailPanel({
  asset,
  activeTab,
  projectId
}: AssetDetailPanelProps) {
  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-medium">{asset.name}</h2>
        <p className="text-sm text-muted-foreground">{asset.description}</p>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'analyses' && (
          <AnalysesTabContent asset={asset} projectId={projectId} />
        )}
        {activeTab === 'context' && (
          <ContextTabContent asset={asset} />
        )}
        {activeTab === 'datasource' && (
          <DataSourceTabContent asset={asset} projectId={projectId} />
        )}
        {activeTab === 'memory' && (
          <MemoryTabContent asset={asset} projectId={projectId} />
        )}
      </div>
    </div>
  );
}
```

#### 6.4 page.tsx 수정 사항

```typescript
// page.tsx에 추가할 상태 및 렌더링 로직

// 새 상태 추가
const [selectedAssetForDetail, setSelectedAssetForDetail] = useState<Asset | null>(null);
const [activeAssetTab, setActiveAssetTab] = useState<AssetDetailTab>('analyses');

// 사이드바 수정 (Lines 503-519 대체)
{mainView === 'assets' && (
  <AssetSidebarList
    assets={allAssets}
    selectedId={selectedAssetForDetail?.id ?? null}
    onSelect={(asset) => setSelectedAssetForDetail(asset)}
    activeTab={activeAssetTab}
    onTabChange={setActiveAssetTab}
  />
)}

// 메인 영역 수정
{mainView === 'assets' && selectedAssetForDetail && (
  <AssetDetailPanel
    asset={selectedAssetForDetail}
    activeTab={activeAssetTab}
    projectId={defaultProjectId}
  />
)}

{mainView === 'assets' && !selectedAssetForDetail && (
  <AssetListView
    projectId={defaultProjectId}
    initialTab={assetInitialTab}
    refreshTrigger={dataSourcesRefresh}
    onSelectAsset={(asset) => setSelectedAssetForDetail(asset)}
  />
)}
```

---

## Code References

### 현재 구조
- [page.tsx:57](frontend/pluto_duck_frontend/app/page.tsx#L57) - mainView 상태 정의
- [page.tsx:462-493](frontend/pluto_duck_frontend/app/page.tsx#L462-L493) - Boards/Assets 슬라이딩 토글
- [page.tsx:495-519](frontend/pluto_duck_frontend/app/page.tsx#L495-L519) - 사이드바 콘텐츠
- [AssetListView.tsx](frontend/pluto_duck_frontend/components/assets/AssetListView.tsx) - Asset 목록 뷰
- [AssetDetailModal.tsx](frontend/pluto_duck_frontend/components/assets/AssetDetailModal.tsx) - Asset 상세 모달

### 참조 패턴
- [TabBar.tsx](frontend/pluto_duck_frontend/components/chat/TabBar.tsx) - Chat 탭 바 컴포넌트
- [useMultiTabChat.ts](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts) - 멀티탭 상태 관리
- [BoardToolbar.tsx](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx) - Board 탭 툴바
- [BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx) - Board 뷰 상태 관리

### API
- [assetsApi.ts](frontend/pluto_duck_frontend/lib/assetsApi.ts) - Asset CRUD API
- [sourceApi.ts](frontend/pluto_duck_frontend/lib/sourceApi.ts) - Source API
- [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) - File Asset API

---

## Architecture Insights

### 1. 상태 계층 구조
- **App Level**: `mainView`, `selectedAssetForDetail`, `activeAssetTab`
- **Component Level**: 각 탭 콘텐츠의 로컬 상태

### 2. 네비게이션 패턴
- 사이드바에서 Asset 선택 → 보드 영역 변경
- 서브메뉴에서 탭 선택 → 보드 콘텐츠 변경
- 두 선택이 독립적으로 작동해야 함

### 3. 디자인 고려사항
- 서브메뉴는 Asset 선택 시에만 표시
- 보드 영역은 선택된 Asset이 없을 때 목록 뷰 표시
- 탭 전환 시 스크롤 위치 유지 필요

---

## Open Questions

1. **Memory 탭 데이터 소스**: 현재 메모리 관련 API가 어떻게 구성되어 있는지 추가 조사 필요
2. **Context 탭 범위**: "context"가 정확히 무엇을 의미하는지 명확히 정의 필요 (메타데이터? 사용 컨텍스트?)
3. **다중 Asset 선택**: 여러 Asset을 동시에 선택/비교하는 기능이 필요한지 확인 필요
4. **백 네비게이션**: Asset 상세에서 목록으로 돌아가는 UX 패턴 결정 필요
