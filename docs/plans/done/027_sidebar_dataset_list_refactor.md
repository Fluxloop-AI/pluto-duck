# Sidebar Dataset List Refactor Implementation Plan

## Overview

사이드바의 Dataset 목록을 개선하여 3개 제한을 제거하고, "Browse all datasets" 버튼과 관련 legacy view를 삭제하며, 마지막으로 선택한 dataset을 localStorage에 저장하여 탭 전환 시에도 유지되도록 한다.

## Current State Analysis

### 현재 구조
- **DatasetList 컴포넌트** (`components/sidebar/DatasetList.tsx`):
  - `maxItems = 3` 기본값으로 3개만 표시
  - `datasets.slice(0, maxItems)`로 제한 적용
  - "Browse all datasets..." 버튼 항상 표시

- **DatasetView 컴포넌트** (`components/datasets/DatasetView.tsx`):
  - "Browse all datasets" 클릭 시 표시되는 전체 목록 view
  - 삭제 대상 (legacy)

- **Dataset 선택 상태** (`app/page.tsx`):
  - `useState<Dataset | null>(null)` - persistence 없음
  - 탭 전환이나 새로고침 시 선택 상태 유실

### 참고: BoardList 구조
- 제한 없이 모든 board 표시 (`boards.map()`)
- 부모의 `overflow-y-auto`로 스크롤 처리

## Desired End State

1. **Dataset 목록**: 제한 없이 모든 dataset 표시, 스크롤 가능
2. **Browse all 버튼/view**: 완전히 제거됨
3. **Dataset 선택 persistence**: localStorage에 저장되어 탭 전환/새로고침 후에도 유지
4. **Dataset 탭 진입 시**: 이전 선택 dataset 표시, 없으면 첫 번째 dataset 자동 선택

## What We're NOT Doing

- URL 기반 routing (dataset ID를 URL에 포함) - 추후 필요시 별도 구현
- Backend에 선택 상태 저장 (Project UI State) - localStorage로 충분
- Dataset 정렬/필터링 기능 추가

## Implementation Approach

변경은 크게 3가지로 나뉨:
1. DatasetList 컴포넌트에서 제한/버튼 제거
2. Legacy DatasetView 삭제 및 page.tsx 업데이트
3. localStorage 기반 선택 persistence 추가

---

## - [x] Phase 1: DatasetList 컴포넌트 수정

### Overview
DatasetList에서 3개 제한과 "Browse all datasets" 버튼을 제거하여 BoardList와 동일한 구조로 변경한다.

### Changes Required:

#### 1. DatasetList.tsx 수정
**File**: `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx`

**Changes**:
- Props interface에서 `maxItems`와 `onBrowseAll` 제거
- `datasets.slice(0, maxItems)` 대신 전체 datasets 렌더링
- "Browse all datasets..." 버튼 JSX 제거 (2곳: empty state와 일반 상태)
- `FolderSearch` import 제거

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 컴파일 에러 없음: `npm run typecheck`
- [ ] Lint 통과: `npm run lint`

#### Manual Verification:
- [ ] 사이드바에서 모든 dataset이 표시됨 (3개 이상인 경우 확인)
- [ ] "Browse all datasets..." 버튼이 사라짐
- [ ] 스크롤이 정상 동작함

---

## - [x] Phase 2: Legacy DatasetView 삭제 및 page.tsx 정리

### Overview
DatasetView 컴포넌트를 삭제하고 page.tsx에서 관련 코드를 제거한다.

### Changes Required:

#### 1. DatasetView.tsx 삭제
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`

**Changes**: 파일 삭제

#### 2. page.tsx에서 DatasetView 관련 코드 제거
**File**: `frontend/pluto_duck_frontend/app/page.tsx`

**Changes**:
- `DatasetView` import 제거
- DatasetList의 `onBrowseAll` prop 제거
- mainView === 'datasets' 조건부 렌더링에서 `!selectedDataset` 케이스 수정:
  - DatasetView 대신 빈 상태 UI 또는 첫 번째 dataset 자동 선택 로직 적용

#### 3. datasets/index.ts 업데이트 (있는 경우)
**File**: `frontend/pluto_duck_frontend/components/datasets/index.ts`

**Changes**: DatasetView export 제거

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 컴파일 에러 없음: `npm run typecheck`
- [ ] Lint 통과: `npm run lint`
- [ ] 빌드 성공: `npm run build`

#### Manual Verification:
- [ ] Dataset 탭에서 에러 없이 DatasetDetailView가 표시됨
- [ ] 기존 기능 (dataset 선택, 삭제) 정상 동작

---

## - [x] Phase 3: Dataset 선택 localStorage Persistence

### Overview
선택된 dataset ID를 localStorage에 저장하여 탭 전환이나 새로고침 후에도 선택 상태를 유지한다.

### Changes Required:

#### 1. page.tsx에 localStorage 로직 추가
**File**: `frontend/pluto_duck_frontend/app/page.tsx`

**Changes**:

**상수 정의**:
- `SELECTED_DATASET_ID_KEY = 'pluto_selected_dataset_id'` 상수 추가 (기존 `SIDEBAR_COLLAPSED_KEY` 근처)

**Dataset 선택 시 저장**:
- `setSelectedDataset` 호출 시 localStorage에 dataset.id 저장
- null로 설정 시 localStorage에서 제거

**초기 로드 시 복원**:
- `sidebarDatasets`가 로드된 후:
  1. localStorage에서 저장된 ID 확인
  2. 해당 ID의 dataset이 존재하면 선택
  3. 존재하지 않거나 저장된 ID가 없으면 첫 번째 dataset 선택

**탭 전환 시 동작**:
- `sidebarTab`이 'datasets'로 변경될 때:
  - 현재 `selectedDataset`이 없으면 저장된 ID 또는 첫 번째 dataset 선택
  - 있으면 유지

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 컴파일 에러 없음: `npm run typecheck`
- [ ] Lint 통과: `npm run lint`

#### Manual Verification:
- [ ] Dataset 선택 후 Boards 탭으로 이동했다가 Dataset 탭으로 돌아오면 이전 선택 유지
- [ ] 페이지 새로고침 후에도 선택 상태 유지
- [ ] 선택한 dataset 삭제 후 첫 번째 dataset으로 자동 전환
- [ ] Dataset이 없을 때 적절한 빈 상태 UI 표시

---

## Testing Strategy

### Unit Tests:
- localStorage mock을 사용한 persistence 로직 테스트 (필요시)

### Integration Tests:
- 해당 없음

### Manual Testing Steps:
1. 4개 이상의 dataset 추가 후 사이드바에서 모두 표시되는지 확인
2. "Browse all datasets..." 버튼이 없는지 확인
3. Dataset 선택 → Boards 탭 → Dataset 탭 → 이전 선택 유지 확인
4. 페이지 새로고침 후 선택 상태 유지 확인
5. 선택된 dataset 삭제 후 첫 번째 dataset으로 전환 확인
6. 모든 dataset 삭제 후 빈 상태 UI 확인

## Performance Considerations

- localStorage 접근은 동기적이지만 작은 문자열(ID)만 저장하므로 성능 영향 없음

## Migration Notes

- 기존 사용자의 경우 localStorage에 저장된 dataset ID가 없으므로 첫 번째 dataset이 자동 선택됨
- 별도의 migration 작업 불필요

## References

- [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) - 현재 구현
- [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) - 참고 구현
- [DatasetView.tsx](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx) - 삭제 대상
- [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) - 메인 state 관리
- [DatasetDetailView.tsx](frontend/pluto_duck_frontend/components/datasets/DatasetDetailView.tsx) - 상세 view (유지)
