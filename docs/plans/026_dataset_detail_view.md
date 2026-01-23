# Dataset Detail View Implementation Plan

## Overview
사이드바에서 Dataset 클릭 시 중앙 보드 영역에 표시되는 DatasetDetailView 컴포넌트 구현. Board/Page 디자인 스타일을 반영하고, Summary | History | Table 탭 구조를 갖추며, Table 탭에서 기존 AssetTableView 컴포넌트를 재활용한다.

## Current State Analysis

### 현재 구현 상태
- **사이드바 DatasetList**: `onSelect` 콜백이 비어있음 (`onSelect={() => {}}`)
- **중앙 DatasetView**: 전체 목록만 표시, 개별 상세 뷰 없음
- **mainView 상태**: `'boards' | 'assets' | 'datasets'` 3가지만 존재
- **AssetTableView**: 페이지네이션 포함된 테이블 컴포넌트 존재, 재활용 가능

### 재활용 가능 요소
- `AssetTableView`: Table 탭 내용으로 직접 사용 가능
- `BoardToolbar` 스타일 패턴: 탭 UI 구현 시 참조
- `previewFileData()` API: FileAsset 데이터 로드
- `fetchCachedTablePreview()` API: CachedTable 데이터 로드

## Desired End State

1. 사이드바에서 Dataset 클릭 시 중앙 영역에 DatasetDetailView 표시
2. Summary | History | Table 탭 UI (BoardToolbar 스타일 참조)
3. Table 탭: AssetTableView로 데이터 미리보기 표시
4. Summary/History 탭: Placeholder 표시 ("Coming soon")
5. 뒤로가기 버튼으로 목록 뷰로 복귀

### 검증 방법
- 사이드바 Dataset 클릭 → DatasetDetailView 표시
- 탭 전환 동작 확인
- Table 탭에서 데이터 로딩 및 페이지네이션 동작
- 뒤로가기 → DatasetView(목록)로 복귀

## What We're NOT Doing

- Summary 탭 실제 내용 구현 (placeholder만)
- History 탭 실제 내용 구현 (placeholder만)
- 중앙 DatasetView 목록에서의 detail view 진입 (사이드바에서만 진입)
- 탭 추가/삭제/이름변경 기능 (고정 탭 구조)

## Implementation Approach

BoardsView + BoardToolbar 패턴을 참조하여 DatasetDetailView + 탭 UI를 구현한다. 탭은 고정 구조(Summary/History/Table)로 하고, 동적 탭 관리 기능은 제외한다. Table 탭에서는 AssetTableView를 래핑하여 사용하고, dataset 타입(FileAsset vs CachedTable)에 따라 적절한 API를 호출한다.

---

## - [ ] Phase 1: 라우팅 및 상태 관리

### Overview
page.tsx에 selectedDataset 상태를 추가하고, 사이드바에서 dataset 선택 시 detail view로 전환되는 로직을 구현한다.

### Changes Required:

#### 1. page.tsx 상태 및 라우팅
**File**: `frontend/pluto_duck_frontend/app/page.tsx`

**Changes**:
- `selectedDataset` 상태 추가 (`Dataset | null`)
- DatasetList의 `onSelect` 콜백 구현: dataset 선택 시 `selectedDataset` 설정 및 `mainView`를 `'datasets'`로 변경
- 메인 뷰 렌더링 조건 수정: `mainView === 'datasets' && selectedDataset`일 때 DatasetDetailView 표시, 그렇지 않으면 기존 DatasetView 표시
- DatasetDetailView의 `onBack` 콜백: `selectedDataset`을 `null`로 설정하여 목록으로 복귀

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 컴파일 에러 없음
- [ ] ESLint 에러 없음

#### Manual Verification:
- [ ] 사이드바 Dataset 클릭 시 console.log 등으로 선택 확인 (아직 컴포넌트 미구현)
- [ ] mainView 상태 전환 정상 동작

---

## - [ ] Phase 2: DatasetDetailView 컴포넌트

### Overview
메인 컨테이너 컴포넌트와 탭 UI를 구현한다. BoardsView/BoardToolbar 패턴을 참조하되, 탭 추가/삭제/이름변경 기능은 제외한다.

### Changes Required:

#### 1. DatasetDetailView 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetDetailView.tsx` (신규)

**Props**:
```typescript
interface DatasetDetailViewProps {
  projectId: string;
  dataset: Dataset;  // FileAsset | CachedTable
  onBack: () => void;
}
```

**구조**:
- 헤더: 뒤로가기 버튼 + Dataset 이름
- 탭 바: Summary | History | Table (고정, BoardToolbar 스타일 참조)
- 콘텐츠 영역: 선택된 탭에 따른 내용 렌더링

**탭 상태 관리**:
```typescript
type DatasetTab = 'summary' | 'history' | 'table';
const [activeTab, setActiveTab] = useState<DatasetTab>('table');  // 기본값: table
```

**탭 UI 스타일** (BoardToolbar 참조):
- Active: `bg-muted text-foreground`
- Inactive: `text-muted-foreground hover:text-foreground hover:bg-muted/50`
- 컨테이너: `flex items-center gap-1`

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 컴파일 에러 없음
- [ ] ESLint 에러 없음

#### Manual Verification:
- [ ] DatasetDetailView 렌더링 확인
- [ ] 탭 전환 UI 동작 확인
- [ ] 뒤로가기 버튼 동작 확인

---

## - [ ] Phase 3: Table 탭 구현

### Overview
AssetTableView를 활용하여 Table 탭 내용을 구현한다. Dataset 타입에 따라 적절한 API를 호출하여 데이터를 로드한다.

### Changes Required:

#### 1. Table 탭 콘텐츠
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetDetailView.tsx`

**데이터 로딩 로직**:
- `isFileAsset(dataset)` 체크하여 타입 구분
- FileAsset: `previewFileData(projectId, dataset.id)` 호출
- CachedTable: `fetchCachedTablePreview(projectId, dataset.local_table)` 호출
- 로딩 상태, 에러 상태 처리

**AssetTableView 사용**:
```typescript
<AssetTableView
  columns={preview.columns}
  rows={preview.rows}
  totalRows={preview.total_rows}
  rowsPerPage={10}
/>
```

**스타일 조정**:
- 테이블 컨테이너에 적절한 패딩 추가
- 기존 DatasetView/BoardsView와 일관된 레이아웃 유지

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 컴파일 에러 없음
- [ ] ESLint 에러 없음

#### Manual Verification:
- [ ] FileAsset 선택 시 테이블 데이터 로딩 및 표시
- [ ] CachedTable 선택 시 테이블 데이터 로딩 및 표시
- [ ] 페이지네이션 동작 확인
- [ ] 로딩/에러 상태 표시 확인

---

## - [ ] Phase 4: Placeholder 탭 구현

### Overview
Summary와 History 탭에 placeholder 내용을 추가한다.

### Changes Required:

#### 1. Placeholder 컴포넌트
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetDetailView.tsx`

**Summary 탭 placeholder**:
- 중앙 정렬된 "Coming soon" 메시지
- 간단한 아이콘 (예: FileText)
- 향후 표시될 내용 힌트: "Dataset schema, statistics, and metadata"

**History 탭 placeholder**:
- 중앙 정렬된 "Coming soon" 메시지
- 간단한 아이콘 (예: History)
- 향후 표시될 내용 힌트: "Change history and version tracking"

**스타일**: DatasetView의 empty state 패턴 참조
```typescript
<div className="flex h-full flex-col items-center justify-center gap-4">
  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
    <Icon className="h-8 w-8 text-muted-foreground" />
  </div>
  <div className="text-center">
    <h3 className="text-lg font-medium">Coming soon</h3>
    <p className="mt-1 text-sm text-muted-foreground">...</p>
  </div>
</div>
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 컴파일 에러 없음
- [ ] ESLint 에러 없음

#### Manual Verification:
- [ ] Summary 탭 선택 시 placeholder 표시
- [ ] History 탭 선택 시 placeholder 표시

---

## Testing Strategy

### Unit Tests:
- 현재 범위에서는 unit test 추가 불필요 (UI 컴포넌트 중심)

### Integration Tests:
- 현재 범위에서는 integration test 추가 불필요

### Manual Testing Steps:
1. 사이드바에서 FileAsset 타입 dataset 클릭 → DatasetDetailView 표시 확인
2. 사이드바에서 CachedTable 타입 dataset 클릭 → DatasetDetailView 표시 확인
3. Table 탭에서 데이터 로딩 및 표시 확인
4. 페이지네이션 동작 확인 (이전/다음 버튼)
5. Summary 탭 클릭 → placeholder 표시
6. History 탭 클릭 → placeholder 표시
7. 뒤로가기 버튼 클릭 → DatasetView(목록) 복귀
8. 다른 dataset 선택 → 새 dataset detail 표시

---

## Performance Considerations

- 테이블 데이터는 기본 100행만 로드 (previewFileData의 기본값)
- 페이지네이션은 클라이언트 사이드로 처리 (이미 로드된 데이터 내에서)
- 대용량 데이터셋의 경우 추후 서버 사이드 페이지네이션 고려 필요

---

## References

### 참조한 파일
- [page.tsx:655-678](frontend/pluto_duck_frontend/app/page.tsx#L655-L678) - DatasetList onSelect 현재 상태
- [page.tsx:709-720](frontend/pluto_duck_frontend/app/page.tsx#L709-L720) - mainView 렌더링 조건
- [BoardToolbar.tsx](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx) - 탭 UI 패턴
- [BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx) - 메인 뷰 컴포넌트 패턴
- [AssetTableView.tsx](frontend/pluto_duck_frontend/components/editor/components/AssetTableView.tsx) - 재활용할 테이블 컴포넌트
- [DatasetView.tsx](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx) - 기존 dataset 목록 뷰
- [fileAssetApi.ts:165-174](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L165-L174) - previewFileData API

### 연구 문서
- [038_dataset_detail_view_implementation.md](docs/research/038_dataset_detail_view_implementation.md) - 구현 리서치
