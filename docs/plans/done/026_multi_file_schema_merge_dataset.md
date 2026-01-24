# Multi-File Schema Merge Dataset Implementation Plan

## Overview

Add Dataset 과정에서 사용자가 2개 이상의 파일을 업로드하고 해당 파일들의 스키마가 100% 일치할 경우, 체크박스를 통해 하나의 통합 데이터셋으로 생성할 수 있는 옵션을 제공한다.

## Current State Analysis

### 현재 플로우
1. 사용자가 파일 선택 (select step)
2. 파일 목록 확인 및 Scan 클릭 (preview step)
3. `diagnoseFiles` API 호출 → 각 파일별 스키마 정보 반환
4. 진단 결과 확인 및 Import 클릭 (diagnose step)
5. 각 파일을 **개별 테이블**로 생성

### 이미 존재하는 인프라
- `diagnoseFiles` API가 `columns: ColumnSchema[]` (name, type, nullable) 반환
- `importFile` API가 `mode: 'append'` 옵션 지원
- 백엔드 `file_service.py`에서 append 모드 시 스키마 호환성 검증 수행

## Desired End State

- 2개 이상 파일 업로드 + 스키마 100% 일치 시 체크박스 UI 노출
- 체크박스 선택 시: 첫 번째 파일로 테이블 생성 → 나머지 파일 append
- 체크박스 미선택 시: 기존 동작 (개별 테이블 생성)

### 검증 방법
1. 동일 스키마 CSV 2개 업로드 → 체크박스 노출 확인
2. 체크박스 선택 후 Import → 단일 테이블 생성, 행 수 = 합계
3. 다른 스키마 파일 업로드 → 체크박스 미노출 확인

## What We're NOT Doing

- 중복 제거(deduplicate) 옵션 UI 추가 (단순화)
- 사용자 테이블명 입력 UI (첫 번째 파일명 자동 사용)
- 다른 파일 타입(CSV + Parquet) 혼합 통합 허용
- 컬럼 순서가 다른 경우 자동 재정렬

## Implementation Approach

프론트엔드 변경만으로 구현. 기존 백엔드 append 모드를 활용하여 첫 번째 파일은 `replace` 모드로, 나머지 파일은 `append` 모드로 순차 임포트.

---

## - [x] Phase 1: Schema Comparison Logic

### Overview
파일 진단 결과에서 모든 파일의 스키마가 동일한지 비교하는 유틸리티 함수 추가.

### Changes Required:

#### 1. AddDatasetModal.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- 파일 상단(헬퍼 함수 영역, line ~46 근처)에 `areSchemasIdentical` 함수 추가
- 비교 기준: 컬럼 개수, 컬럼명(대소문자 무시), 컬럼 타입
- 동일 파일 타입만 허용 체크 포함

함수 시그니처:
```typescript
function areSchemasIdentical(diagnoses: FileDiagnosis[]): boolean
```

비교 로직:
1. 파일 2개 미만이면 `false` 반환
2. 모든 파일의 file_type이 동일한지 확인
3. 첫 번째 파일의 columns를 기준으로 나머지 파일 비교
4. 컬럼 개수, 각 컬럼의 name(toLowerCase), type이 모두 일치해야 `true`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] 콘솔에서 함수 테스트 가능 (diagnoses 배열로 호출)

---

## - [x] Phase 2: UI State Management

### Overview
스키마 일치 여부와 통합 체크박스 상태를 관리하는 state 추가 및 DiagnosisResultView에 props 전달.

### Changes Required:

#### 1. AddDatasetModal.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- 새 state 추가: `mergeFiles: boolean` (기본값 `false`)
- 새 derived 값: `schemasMatch: boolean` (diagnoseResults 변경 시 계산)
- `handleScan` 완료 후 `schemasMatch` 계산하여 저장
- DiagnosisResultView에 새 props 전달: `schemasMatch`, `mergeFiles`, `onMergeFilesChange`

#### 2. DiagnosisResultView.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx`

**Changes**:
- Props 인터페이스 확장:
  - `schemasMatch: boolean`
  - `mergeFiles: boolean`
  - `onMergeFilesChange: (checked: boolean) => void`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] React DevTools에서 state 변경 확인 가능

---

## - [x] Phase 3: Merge Checkbox UI

### Overview
DiagnosisResultView 헤더 영역에 스키마 일치 시 통합 옵션 체크박스 UI 추가.

### Changes Required:

#### 1. DiagnosisResultView.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx`

**Changes**:
- Checkbox import 추가 (`@/components/ui/checkbox`)
- 헤더와 스크롤 영역 사이에 조건부 체크박스 배너 추가
- 조건: `schemasMatch && diagnoses.length >= 2`
- 체크박스 라벨: `"{n}개의 파일을 하나의 데이터셋으로 통합"`
- 예상 총 행 수 표시: `"(총 {totalRows}행)"`
- 스타일: 파란색 배경의 정보성 배너

UI 구조:
```
[Header: File Analysis]
[Merge Banner - 조건부]  ← 새로 추가
[Scrollable File Cards]
[Footer: Back / Import]
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음
- [x] ESLint 에러 없음 (no ESLint config in project)

#### Manual Verification:
- [ ] 동일 스키마 파일 2개 업로드 시 체크박스 배너 노출
- [ ] 체크박스 토글 시 상태 변경
- [ ] 다른 스키마 파일 업로드 시 배너 미노출

---

## - [x] Phase 4: Merged Import Logic

### Overview
체크박스 선택 시 여러 파일을 하나의 테이블로 통합 임포트하는 로직 구현.

### Changes Required:

#### 1. AddDatasetModal.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- `handleConfirmImport` 함수 수정
- 분기 처리: `mergeFiles && schemasMatch` 여부에 따라 다른 로직 실행

통합 임포트 로직:
1. 첫 번째 파일의 이름으로 테이블명 생성
2. 첫 번째 파일: `mode: 'replace'`, `overwrite: true`로 테이블 생성
3. 나머지 파일들: 순차적으로 `mode: 'append'`, `target_table: 첫 번째 테이블명`으로 추가
4. Asset 이름: `"Merged: {n} files"` 또는 첫 번째 파일명

에러 처리:
- 첫 번째 파일 실패 시: 전체 실패 처리
- 나머지 파일 실패 시: 경고 로그 후 계속 진행 (partial success)

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음
- [x] 빌드 성공: `npm run build`

#### Manual Verification:
- [ ] 체크박스 미선택 → 기존 동작 (개별 테이블)
- [ ] 체크박스 선택 → 단일 테이블 생성
- [ ] 생성된 테이블 행 수 = 모든 파일 행 수 합계
- [ ] 사이드바에 단일 데이터셋만 표시

---

## Testing Strategy

### Manual Testing Steps:

1. **동일 스키마 파일 테스트**
   - 동일한 컬럼 구조의 CSV 2개 준비 (예: sales_jan.csv, sales_feb.csv)
   - Add Dataset → 두 파일 선택 → Scan
   - 체크박스 배너 노출 확인
   - 체크박스 선택 → Import
   - 사이드바에 1개 데이터셋만 표시되는지 확인
   - 데이터셋 클릭 → 행 수가 두 파일 합계인지 확인

2. **다른 스키마 파일 테스트**
   - 다른 컬럼 구조의 CSV 2개 준비
   - Add Dataset → 두 파일 선택 → Scan
   - 체크박스 배너 미노출 확인
   - Import → 2개 개별 데이터셋 생성 확인

3. **파일 타입 혼합 테스트**
   - CSV 1개 + Parquet 1개 (동일 스키마)
   - 체크박스 배너 미노출 확인 (다른 타입이므로)

4. **단일 파일 테스트**
   - 파일 1개만 업로드
   - 체크박스 배너 미노출 확인

5. **체크박스 미선택 테스트**
   - 동일 스키마 파일 2개 업로드
   - 체크박스 미선택 상태로 Import
   - 2개 개별 데이터셋 생성 확인

---

## Performance Considerations

- 스키마 비교는 O(n*m) 복잡도 (n=파일 수, m=컬럼 수)
- 일반적인 사용 케이스(파일 10개 미만, 컬럼 100개 미만)에서 무시 가능
- 통합 임포트는 순차 실행 필수 (첫 번째 파일로 테이블 생성 후 append)

---

## References

### Files Read
- `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx` - 메인 모달 컴포넌트
- `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx` - 진단 결과 뷰
- `frontend/pluto_duck_frontend/lib/fileAssetApi.ts` - API 타입 및 함수

### Research Document
- `docs/research/039_multi_file_schema_merge_dataset.md` - 기능 리서치 문서

### Backend References (변경 불필요, 참고용)
- `backend/pluto_duck_backend/app/services/asset/file_service.py:282-324` - Append 모드 처리
- `backend/pluto_duck_backend/app/api/v1/asset/router.py:764-789` - ImportFileRequest 모델
