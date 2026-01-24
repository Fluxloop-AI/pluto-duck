---
date: 2026-01-24T10:30:00+09:00
researcher: Claude
topic: "Dataset Tab과 MainView 동기화 문제"
tags: [research, codebase, frontend, ux, bug]
status: complete
---

# Research: Dataset Tab과 MainView 동기화 문제

## Research Question

데이터셋 탭을 클릭하면 첫번째 데이터셋이 리스트에서 선택된 것으로 표시되지만, 중앙 뷰는 변경되지 않는 현상 조사. 한 번 더 클릭해야 실제로 데이터셋 디테일 뷰가 나타남.

## Summary

**Root Cause**: Datasets 탭 클릭 핸들러가 `sidebarTab`만 변경하고 `mainView`는 변경하지 않음. Boards 탭과의 비대칭적인 동작.

**결과**: 사이드바에서 데이터셋이 선택된 것처럼 보이지만, 중앙 뷰는 여전히 이전 뷰(boards)를 표시. 사용자가 데이터셋을 한 번 더 클릭해야 중앙 뷰가 변경됨.

## Detailed Findings

### 상태 관리 구조

`WorkspacePage` 컴포넌트에서 관리하는 주요 상태:

```typescript
// page.tsx:70, 72, 119
const [sidebarTab, setSidebarTab] = useState<'boards' | 'datasets'>('boards');
const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
const [mainView, setMainView] = useState<MainView>('boards');
```

- `sidebarTab`: 사이드바에서 어떤 탭이 활성화되어 있는지 (Boards/Datasets)
- `selectedDataset`: 현재 선택된 데이터셋 객체
- `mainView`: 중앙 영역에 표시할 뷰 ('boards' | 'datasets' | 'assets')

### 문제의 핵심 코드

**Boards 탭 클릭 핸들러** (page.tsx:606-611):
```typescript
onClick={() => {
  setSidebarTab('boards');
  setMainView('boards');  // ← mainView도 변경
}}
```

**Datasets 탭 클릭 핸들러** (page.tsx:621-623):
```typescript
onClick={() => setSidebarTab('datasets')}  // ← mainView 변경 없음!
```

### 자동 선택 로직

데이터셋 로드 후 자동 선택하는 effect (page.tsx:268-286):

```typescript
useEffect(() => {
  if (sidebarDatasets.length === 0) return;
  if (selectedDataset) return;

  if (typeof window !== 'undefined') {
    const storedId = localStorage.getItem(SELECTED_DATASET_ID_KEY);
    if (storedId) {
      const dataset = sidebarDatasets.find(d => d.id === storedId);
      if (dataset) {
        setSelectedDataset(dataset);  // selectedDataset만 설정
        return;
      }
    }
    setSelectedDataset(sidebarDatasets[0]);  // mainView는 변경 안함
  }
}, [sidebarDatasets]);
```

### 수동 선택 핸들러

DatasetList의 onSelect 콜백 (page.tsx:675-678):

```typescript
onSelect={(dataset) => {
  setSelectedDataset(dataset);
  setMainView('datasets');  // ← 여기서 mainView 변경됨
}}
```

### 중앙 뷰 렌더링 로직

page.tsx:739-778에서 `mainView` 값에 따라 렌더링:

```typescript
{mainView === 'boards' ? (
  <BoardsView ... />
) : mainView === 'datasets' ? (
  selectedDataset ? (
    <DatasetDetailView ... />
  ) : (
    // Empty state
  )
) : (
  <AssetListView ... />
)}
```

## 버그 재현 흐름

1. 사용자가 Boards 탭에서 작업 중 (`mainView = 'boards'`)
2. Datasets 탭 클릭
   - `sidebarTab` → 'datasets' ✓
   - `mainView` → 여전히 'boards' ✗
3. 자동 선택 effect 실행
   - `selectedDataset` → 첫번째 데이터셋 설정 ✓
   - `mainView` → 여전히 'boards' ✗
4. 사이드바: 데이터셋 선택된 것처럼 표시
5. 중앙 뷰: 여전히 BoardsView 표시
6. 사용자가 데이터셋 한 번 더 클릭
   - `setMainView('datasets')` 호출 → 중앙 뷰 변경 ✓

## Code References

- `frontend/pluto_duck_frontend/app/page.tsx:606-611` - Boards 탭 핸들러 (올바른 동작)
- `frontend/pluto_duck_frontend/app/page.tsx:621-623` - Datasets 탭 핸들러 (문제 있음)
- `frontend/pluto_duck_frontend/app/page.tsx:268-286` - 자동 선택 effect
- `frontend/pluto_duck_frontend/app/page.tsx:675-678` - 수동 선택 핸들러
- `frontend/pluto_duck_frontend/app/page.tsx:739-778` - 중앙 뷰 렌더링 로직

## 해결 방안

### Option 1: 탭 핸들러 수정 (권장)

Datasets 탭 클릭 핸들러를 Boards 탭과 동일하게 수정:

```typescript
onClick={() => {
  setSidebarTab('datasets');
  setMainView('datasets');  // 이 줄 추가
}}
```

**장점**: 간단하고 명확한 수정, Boards 탭과 일관된 동작

### Option 2: 자동 선택 effect에서 mainView 변경

```typescript
useEffect(() => {
  // ...
  if (dataset) {
    setSelectedDataset(dataset);
    if (sidebarTab === 'datasets') {
      setMainView('datasets');
    }
  }
}, [sidebarDatasets, sidebarTab]);
```

**단점**: 의존성 배열 복잡해짐, 의도치 않은 side effect 가능성

## Architecture Insights

- `sidebarTab`과 `mainView`가 분리되어 있는 것은 의도적인 설계로 보임 (예: Assets 뷰는 사이드바 탭과 무관)
- 그러나 Boards/Datasets 탭의 경우 사이드바 탭과 메인 뷰가 동기화되어야 하는 것이 자연스러운 UX
- 현재 Boards 탭은 이 동기화가 구현되어 있으나, Datasets 탭은 누락됨

## Open Questions

- Assets 버튼 클릭 시 `sidebarTab`은 어떻게 처리되는가? (현재 변경 없음)
- 향후 탭이 추가될 경우 이 패턴을 어떻게 일관성 있게 유지할 것인가?
