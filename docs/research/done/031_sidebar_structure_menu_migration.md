---
date: 2026-01-22T10:30:00+09:00
researcher: Claude
topic: "사이드바 구조 분석 - Boards/Assets 스위치 해체 및 Assets 메뉴 이동"
tags: [research, sidebar, navigation, assets, boards, ui-restructure]
status: complete
---

# Research: 사이드바 구조 분석 - Boards/Assets 스위치 해체

## Research Question
현재 사이드바의 상단 boards/assets 스위치 구조를 해체하고, assets 메뉴를 하단 Settings 위에 별도 메뉴로 배치하기 위한 현재 구조 분석

## Summary
- 사이드바는 3개 영역으로 구성: Header(ProjectSelector), Content(Boards/Assets 스위치 + 리스트), Footer(Settings)
- Boards/Assets 스위치는 sliding indicator가 있는 segmented control 형태
- `mainView` state (`'boards' | 'assets'`)로 뷰 전환 관리
- Settings 버튼은 사이드바 최하단에 고정 위치
- Assets를 별도 메뉴로 분리하려면 스위치 UI 제거 후 Settings 위에 Assets 버튼 추가 필요

## Detailed Findings

### 1. 사이드바 전체 구조

**파일:** [page.tsx:529-619](frontend/pluto_duck_frontend/app/page.tsx#L529-L619)

```
┌─────────────────────────────┐
│ Header (pt-3 pb-3)          │
│ ┌─────────────────────────┐ │
│ │ ProjectSelector │ + btn │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ Content (flex-1, scroll)    │
│ ┌─────────────────────────┐ │
│ │ [Boards] [Assets] ← 스위치│ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ BoardList / AssetInfo   │ │
│ │ (조건부 렌더링)           │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ Footer (pb-4)               │
│ ┌─────────────────────────┐ │
│ │ ⚙️ Settings             │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

**Flexbox 구조:**
```tsx
<aside className="lg:flex lg:flex-col w-64">
  <div className="flex h-full flex-col">
    {/* Header - 고정 높이 */}
    <div className="pl-[18px] pr-[14px] pt-3 pb-3">...</div>

    {/* Content - flex-1로 남은 공간 차지, 스크롤 가능 */}
    <div className="flex-1 overflow-y-auto px-3 py-3">...</div>

    {/* Footer - 고정 높이, 하단 고정 */}
    <div className="space-y-2 px-3 pb-4">...</div>
  </div>
</aside>
```

### 2. Boards/Assets 스위치 (제거 대상)

**파일:** [page.tsx:557-589](frontend/pluto_duck_frontend/app/page.tsx#L557-L589)

**현재 구현:**
```tsx
{/* View Tabs */}
<div className="relative mb-3 flex rounded-lg bg-card p-1">
  {/* Sliding indicator */}
  <div
    className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md bg-primary transition-all duration-200 ease-out ${
      mainView === 'boards' ? 'left-1' : 'left-[50%]'
    }`}
  />
  <button onClick={() => setMainView('boards')}>
    <Layers className="h-3.5 w-3.5" />
    Boards
  </button>
  <button onClick={() => setMainView('assets')}>
    <Package className="h-3.5 w-3.5" />
    Assets
  </button>
</div>
```

**State 정의:** [page.tsx:108](frontend/pluto_duck_frontend/app/page.tsx#L108)
```tsx
const [mainView, setMainView] = useState<MainView>('boards');
```

**Type 정의:** [page.tsx:34](frontend/pluto_duck_frontend/app/page.tsx#L34)
```tsx
type MainView = 'boards' | 'assets';
```

### 3. 조건부 렌더링 영역

**사이드바 내 조건부 콘텐츠:** [page.tsx:591-605](frontend/pluto_duck_frontend/app/page.tsx#L591-L605)
```tsx
{mainView === 'boards' && (
  <BoardList boards={boards} ... />
)}

{mainView === 'assets' && (
  <div className="text-xs text-muted-foreground">
    View saved analyses in the main panel
  </div>
)}
```

**메인 패널 조건부 렌더링:** [page.tsx:624-629](frontend/pluto_duck_frontend/app/page.tsx#L624-L629)
```tsx
{mainView === 'boards' ? (
  <BoardsView ref={boardsViewRef} projectId={defaultProjectId} activeBoard={activeBoard} />
) : (
  <AssetListView projectId={defaultProjectId} initialTab={assetInitialTab} refreshTrigger={dataSourcesRefresh} />
)}
```

### 4. Settings 버튼 (Assets 버튼 위치 참고)

**파일:** [page.tsx:608-617](frontend/pluto_duck_frontend/app/page.tsx#L608-L617)

```tsx
<div className="space-y-2 px-3 pb-4">
  <button
    type="button"
    className="flex w-full items-center gap-2 rounded-lg px-[10px] py-2 text-sm hover:bg-black/10 transition-colors"
    onClick={() => setSettingsOpen(true)}
  >
    <SettingsIcon className="h-4 w-4" />
    <span>Settings</span>
  </button>
</div>
```

### 5. Assets 관련 네비게이션 트리거

다른 컴포넌트에서 Assets로 이동하는 코드:

**DataSourcesModal:** [page.tsx:685](frontend/pluto_duck_frontend/app/page.tsx#L685)
```tsx
onNavigateToAssets={() => {
  setAssetInitialTab('datasources');
  setMainView('assets');
}}
```

**ConnectFolderModal:** [page.tsx:728](frontend/pluto_duck_frontend/app/page.tsx#L728)
```tsx
setMainView('assets');
```

### 6. 관련 컴포넌트

| 컴포넌트 | 파일 | 설명 |
|---------|------|------|
| AssetListView | [AssetListView.tsx](frontend/pluto_duck_frontend/components/assets/AssetListView.tsx) | 메인 패널에 표시되는 Assets 뷰 |
| BoardsView | [BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx) | 메인 패널에 표시되는 Boards 뷰 |
| BoardList | [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) | 사이드바의 보드 목록 |
| ProjectSelector | [ProjectSelector.tsx](frontend/pluto_duck_frontend/components/projects/ProjectSelector.tsx) | 사이드바 헤더의 프로젝트 선택기 |

## Code References

- `frontend/pluto_duck_frontend/app/page.tsx:529-619` - 전체 사이드바 구조
- `frontend/pluto_duck_frontend/app/page.tsx:557-589` - Boards/Assets 스위치 UI
- `frontend/pluto_duck_frontend/app/page.tsx:108` - mainView state 정의
- `frontend/pluto_duck_frontend/app/page.tsx:34` - MainView type 정의
- `frontend/pluto_duck_frontend/app/page.tsx:591-605` - 사이드바 조건부 콘텐츠
- `frontend/pluto_duck_frontend/app/page.tsx:624-629` - 메인 패널 조건부 렌더링
- `frontend/pluto_duck_frontend/app/page.tsx:608-617` - Settings 버튼

## Architecture Insights

### 변경에 필요한 작업 목록

1. **스위치 UI 제거** (line 557-589)
   - `<div className="relative mb-3 flex rounded-lg bg-card p-1">` 전체 블록 삭제

2. **Assets 버튼 추가** (line 608 위)
   - Settings 버튼과 동일한 스타일로 Assets 버튼 추가
   - `Package` 아이콘 사용
   - `onClick={() => setMainView('assets')}` 핸들러

3. **사이드바 조건부 콘텐츠 수정** (line 591-605)
   - Assets 선택 시 표시되는 placeholder 텍스트 제거
   - BoardList는 항상 표시되도록 변경 (또는 조건부 유지)

4. **mainView state 유지**
   - 기존 `mainView` state와 로직은 그대로 유지
   - 메인 패널의 조건부 렌더링 로직 유지

### 예상 변경 후 구조

```
┌─────────────────────────────┐
│ Header                      │
│ ProjectSelector + New Board │
├─────────────────────────────┤
│ Content (flex-1, scroll)    │
│ BoardList (항상 표시)        │
│                             │
├─────────────────────────────┤
│ Footer                      │
│ 📦 Assets  ← 새로 추가      │
│ ⚙️ Settings                 │
└─────────────────────────────┘
```

## Open Questions

1. **BoardList 조건부 표시 여부**: Assets 선택 시에도 BoardList를 계속 표시할 것인지?
2. **Active 상태 표시**: Assets 버튼이 선택되었을 때 시각적 피드백 필요한지?
3. **Asset 하위 탭 선택**: 기존에 `assetInitialTab`으로 analyses/datasources 구분했는데, 이 로직 유지 방법?
