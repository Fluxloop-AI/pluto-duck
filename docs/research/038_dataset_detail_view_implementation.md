---
date: 2026-01-23T10:30:00+09:00
researcher: Claude
topic: "Dataset Detail View Implementation Research"
tags: [research, codebase, dataset, frontend, component-design]
status: complete
---

# Research: Dataset Detail View Implementation

## Research Question
사이드바에서 Dataset 클릭 시 중앙 보드 영역에 표시될 새로운 Dataset Detail View 컴포넌트 구현을 위한 조사. Board/Page 디자인 스타일을 반영하고, Summary | History | Table 탭 구조를 갖추며, 기존 테이블 미리보기 컴포넌트 재활용 가능성 검토.

## Summary

### 핵심 발견사항

1. **Board/Page 구조 완전 파악**: BoardsView + BoardToolbar + BoardEditor 패턴으로 구성되며, 탭 시스템이 잘 구현되어 있음
2. **테이블 컴포넌트 재활용 가능**: `AssetTableView` 컴포넌트가 가장 적합하며, 페이지네이션과 스타일링이 이미 구현됨
3. **라우팅 구조 확인**: `mainView` 상태로 뷰 전환 제어, 현재 `onSelect` 콜백이 비어있어 구현 필요
4. **디자인 패턴 일관성**: Tailwind CSS 클래스 패턴이 일관되게 사용됨

### 구현 방향 제안

- **새 컴포넌트**: `DatasetDetailView.tsx` 생성
- **탭 구조**: Summary | History | Table (BoardToolbar 패턴 참조하되 탭 추가/삭제 기능 제외)
- **테이블 재활용**: `AssetTableView` 컴포넌트 import하여 Table 탭에서 사용
- **라우팅**: `selectedDataset` 상태 추가하여 개별 데이터셋 뷰 지원

---

## Detailed Findings

### 1. Board/Page 컴포넌트 구조

#### 파일 구조
```
frontend/pluto_duck_frontend/
├── components/
│   ├── boards/
│   │   ├── BoardsView.tsx      # 메인 컨테이너 (240줄)
│   │   ├── BoardToolbar.tsx    # 탭 UI (153줄)
│   │   ├── BoardList.tsx       # 사이드바 목록 (192줄)
│   │   └── BoardTabs.tsx       # (미사용)
│   └── editor/
│       ├── BoardEditor.tsx     # Lexical 에디터 (302줄)
│       └── theme.ts            # 에디터 스타일
```

#### BoardTab 인터페이스 (재활용 가능)
**파일**: [boardsApi.ts:7-11](frontend/pluto_duck_frontend/lib/boardsApi.ts#L7-L11)
```typescript
export interface BoardTab {
  id: string;           // nanoid로 생성
  name: string;         // 'Page 1', 'Page 2' 등
  content: string | null;
}
```

#### 탭 관리 핵심 로직
**파일**: [BoardsView.tsx:153-187](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx#L153-L187)
- `handleAddTab()`: 새 탭 추가 → **Dataset View에서는 제외**
- `handleSelectTab()`: 탭 전환 → **필요**
- `handleRenameTab()`: 탭 이름 변경 → **제외** (고정 탭명 사용)
- `handleDeleteTab()`: 탭 삭제 → **제외**

#### BoardToolbar 레이아웃 구조
**파일**: [BoardToolbar.tsx:71-152](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx#L71-L152)
```tsx
<div className="flex items-center bg-background pt-2">
  <div className="w-full max-w-4xl pl-6">
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
      {/* 탭 버튼들 */}
    </div>
  </div>
</div>
```

**탭 스타일 패턴**:
- Active: `bg-muted text-foreground`
- Inactive: `text-muted-foreground hover:text-foreground hover:bg-muted/50`

---

### 2. 테이블 컴포넌트 재활용 분석

#### 사용 가능한 테이블 컴포넌트

| 컴포넌트 | 파일 | 재활용 적합성 | 이유 |
|---------|------|--------------|------|
| **AssetTableView** | [AssetTableView.tsx](frontend/pluto_duck_frontend/components/editor/components/AssetTableView.tsx) | ⭐ 최적 | 페이지네이션 내장, 독립적 |
| CachedTablePreviewModal | CachedTablePreviewModal.tsx | 보통 | 모달 내부용, 분리 필요 |
| TableCard | TableCard.tsx | 낮음 | 카드 UI용, 목적 다름 |

#### AssetTableView Props
**파일**: [AssetTableView.tsx:6-11](frontend/pluto_duck_frontend/components/editor/components/AssetTableView.tsx#L6-L11)
```typescript
interface AssetTableViewProps {
  columns: string[];      // 컬럼명 배열
  rows: any[][];          // 2D 데이터 배열
  totalRows: number;      // 전체 행 수
  rowsPerPage: number;    // 페이지당 행 수 (기본: 10)
}
```

#### AssetTableView 렌더링 구조
**파일**: [AssetTableView.tsx:51-92](frontend/pluto_duck_frontend/components/editor/components/AssetTableView.tsx#L51-L92)
```tsx
<table className="w-full text-sm border-collapse">
  <thead>
    <tr className="border-b border-border">
      {columns.map((col, i) => (
        <th key={i} className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
          {col}
        </th>
      ))}
    </tr>
  </thead>
  <tbody>
    {paginatedRows.map((row, rowIdx) => (
      <tr key={rowIdx} className="border-b border-border/50 hover:bg-muted/30">
        {row.map((cell, cellIdx) => (
          <td key={cellIdx} className="px-4 py-2 font-mono text-xs whitespace-nowrap">
            {formatCell(cell)}
          </td>
        ))}
      </tr>
    ))}
  </tbody>
</table>
```

#### 페이지네이션 UI
**파일**: [AssetTableView.tsx:95-122](frontend/pluto_duck_frontend/components/editor/components/AssetTableView.tsx#L95-L122)
- 이전/다음 버튼
- 현재 페이지 표시 (`Page X of Y`)
- 전체 행 수 표시 (`(N total rows)`)

#### 데이터 로드 API
**파일**: [fileAssetApi.ts:165-174](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L165-L174)
```typescript
export async function previewFileData(
  projectId: string,
  fileId: string,
  limit: number = 100
): Promise<FilePreview> {
  const baseUrl = buildUrl(`/files/${fileId}/preview`, projectId);
  const url = `${baseUrl}&limit=${limit}`;
  return handleResponse<FilePreview>(await fetch(url));
}
```

**FilePreview 타입** ([fileAssetApi.ts:56-60](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L56-L60)):
```typescript
export interface FilePreview {
  columns: string[];
  rows: any[][];
  total_rows: number;
}
```

---

### 3. 사이드바 Dataset List 라우팅

#### 현재 구현 상태
**파일**: [page.tsx:655-678](frontend/pluto_duck_frontend/app/page.tsx#L655-L678)
```tsx
<DatasetList
  datasets={sidebarDatasets}
  maxItems={3}
  onSelect={() => {}}  // ⚠️ 현재 비어있음!
  onBrowseAll={() => {
    setMainView('datasets');
  }}
  onDelete={async (dataset) => { ... }}
/>
```

**문제점**: `onSelect` 콜백이 구현되지 않아 개별 데이터셋 클릭이 동작하지 않음

#### 필요한 변경사항

1. **새 상태 추가** (page.tsx):
```typescript
const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
```

2. **onSelect 구현**:
```typescript
onSelect={(dataset) => {
  setSelectedDataset(dataset);
  setMainView('datasets');  // 또는 새 mainView 값 'dataset-detail'
}}
```

3. **mainView 조건 분기**:
```typescript
mainView === 'datasets' && selectedDataset ? (
  <DatasetDetailView dataset={selectedDataset} projectId={projectId} />
) : mainView === 'datasets' ? (
  <DatasetView ... />  // 기존 전체 목록 뷰
) : ...
```

---

### 4. 중앙 뷰 렌더링 구조

#### 현재 mainView 타입
**파일**: [page.tsx:39](frontend/pluto_duck_frontend/app/page.tsx#L39)
```typescript
type MainView = 'boards' | 'assets' | 'datasets';
```

#### 뷰 렌더링 조건
**파일**: [page.tsx:709-720](frontend/pluto_duck_frontend/app/page.tsx#L709-L720)
```tsx
{mainView === 'boards' ? (
  <BoardsView ref={boardsViewRef} projectId={defaultProjectId} activeBoard={activeBoard} />
) : mainView === 'datasets' ? (
  <DatasetView projectId={defaultProjectId} onOpenAddModal={...} refreshTrigger={...} />
) : (
  <AssetListView projectId={defaultProjectId} initialTab={assetInitialTab} refreshTrigger={...} />
)}
```

#### 레이아웃 컨테이너
**파일**: [page.tsx:707-708](frontend/pluto_duck_frontend/app/page.tsx#L707-L708)
```tsx
<div className={`flex flex-1 overflow-hidden rounded-[10px] bg-background m-2 border border-black/10`}>
  <div className="relative flex flex-1 flex-col overflow-hidden">
```

---

### 5. 스타일링 패턴 요약

#### 공통 Tailwind 클래스 패턴

| 용도 | 클래스 |
|-----|-------|
| 컨테이너 | `flex h-full flex-col` |
| 콘텐츠 영역 | `flex-1 overflow-hidden relative` |
| 탭 Active | `bg-muted text-foreground` |
| 탭 Inactive | `text-muted-foreground hover:bg-muted/50` |
| 헤더 | `sticky top-0 bg-muted/80 backdrop-blur` |
| 테이블 행 | `border-b border-border/50 hover:bg-muted/30` |
| 버튼 | `px-3 py-1.5 rounded-lg transition-colors` |

---

## Code References

### 핵심 파일
- [BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx) - 메인 뷰 컴포넌트 패턴
- [BoardToolbar.tsx](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx) - 탭 UI 패턴
- [AssetTableView.tsx](frontend/pluto_duck_frontend/components/editor/components/AssetTableView.tsx) - 재활용할 테이블 컴포넌트
- [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) - 사이드바 데이터셋 목록
- [DatasetView.tsx](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx) - 현재 데이터셋 뷰
- [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) - 메인 레이아웃 및 라우팅

### API 파일
- [fileAssetApi.ts:165-174](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L165-L174) - `previewFileData()` 함수
- [sourceApi.ts:223-231](frontend/pluto_duck_frontend/lib/sourceApi.ts#L223-L231) - `fetchCachedTables()` 함수
- [boardsApi.ts:7-18](frontend/pluto_duck_frontend/lib/boardsApi.ts#L7-L18) - BoardTab 인터페이스

---

## Architecture Insights

### 1. 컴포넌트 분리 패턴
- **View 컴포넌트**: 전체 레이아웃 관리 (BoardsView, DatasetView)
- **Toolbar 컴포넌트**: 헤더 및 탭 UI (BoardToolbar → DatasetDetailToolbar)
- **Content 컴포넌트**: 실제 콘텐츠 렌더링 (BoardEditor → Summary/History/Table 콘텐츠)

### 2. 상태 관리 패턴
- **로컬 상태**: useState로 탭 상태 관리
- **Props drilling**: 부모에서 자식으로 콜백 전달
- **Debounced 저장**: 빈번한 변경 시 API 호출 최적화

### 3. 재활용 가능 요소
- `AssetTableView`: Table 탭 내용으로 직접 사용 가능
- `BoardToolbar` 스타일 패턴: 탭 UI 구현 시 참조
- `previewFileData()` API: 데이터 로드에 사용

---

## Implementation Recommendation

### 새 컴포넌트 구조

```
frontend/pluto_duck_frontend/components/datasets/
├── DatasetView.tsx           # 기존 (전체 목록)
├── DatasetDetailView.tsx     # 신규 (개별 상세)
├── DatasetDetailToolbar.tsx  # 신규 (Summary|History|Table 탭)
└── tabs/
    ├── SummaryTab.tsx        # 신규 (데이터셋 요약 정보)
    ├── HistoryTab.tsx        # 신규 (변경 이력)
    └── TableTab.tsx          # 신규 (AssetTableView 래핑)
```

### DatasetDetailView Props 제안

```typescript
interface DatasetDetailViewProps {
  projectId: string;
  dataset: FileAsset | CachedTable;
  onBack?: () => void;  // 목록으로 돌아가기
}
```

### 탭 구조 (고정, 추가/삭제 불가)

```typescript
type DatasetTab = 'summary' | 'history' | 'table';

const tabs: { id: DatasetTab; name: string }[] = [
  { id: 'summary', name: 'Summary' },
  { id: 'history', name: 'History' },
  { id: 'table', name: 'Table' },
];
```

---

## Open Questions

1. **History 탭 데이터**: 데이터셋 변경 이력을 어디서 가져오는지? 백엔드 API 필요 여부?
2. **Summary 탭 내용**: 어떤 정보를 표시할지? (스키마, 통계, 메타데이터 등)
3. **뒤로가기 동작**: 목록 뷰로 돌아갈 때 상태 유지 여부?
4. **CachedTable vs FileAsset**: 두 타입의 테이블 미리보기 API가 다른데 통합 방법?

---

## Next Steps

1. `DatasetDetailView.tsx` 컴포넌트 생성
2. `DatasetDetailToolbar.tsx` 탭 UI 구현 (Board 패턴 참조)
3. `page.tsx`에 `selectedDataset` 상태 및 라우팅 로직 추가
4. Summary/History/Table 각 탭 컴포넌트 구현
5. 테이블 탭에서 `AssetTableView` 재활용
