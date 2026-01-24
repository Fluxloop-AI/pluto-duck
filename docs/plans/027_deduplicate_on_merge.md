# Deduplicate on Merge Implementation Plan

## Overview

데이터셋 통합(merge) 시 중복된 행을 제거하는 옵션을 추가한다. 기본값은 활성화(켜짐) 상태이며, 사용자가 필요시 끌 수 있다.

## Current State Analysis

### 현재 플로우
1. 사용자가 동일 스키마 파일 2개+ 업로드
2. "N개의 파일을 하나의 데이터셋으로 통합" 체크박스 노출
3. 체크 시 첫 번째 파일 replace → 나머지 파일 append
4. **중복 제거 없이** 모든 행 추가

### 이미 존재하는 인프라
- `ImportFileRequest.deduplicate?: boolean` 타입 정의됨 (`fileAssetApi.ts:42`)
- 백엔드 `file_service.py:292-308`에서 `deduplicate=true` 시 `DISTINCT + EXCEPT` 쿼리 실행
- 현재 프론트엔드에서 `deduplicate` 값을 API에 전달하지 않음

## Desired End State

- 통합 체크박스 선택 시 하위에 중복 제거 체크박스 노출
- 중복 제거 체크박스 기본값: **켜짐 (권장)**
- append 호출 시 `deduplicate` 값을 API에 전달

### UI 구조
```
☑️ 3개의 파일을 하나의 데이터셋으로 통합 (총 1,500행)
   └─ ☑️ 중복된 행 제거 (권장)
```

### 검증 방법
1. 동일 스키마 CSV 2개 (일부 행 중복) 업로드
2. 통합 체크 + 중복 제거 체크 → Import
3. 결과 테이블에 중복 행 없음 확인
4. 중복 제거 해제 후 Import → 중복 행 존재 확인

## What We're NOT Doing

- 중복 행 개수 미리보기 (성능상 사전 계산 부담)
- 중복 기준 컬럼 선택 UI (전체 행 비교만 지원)
- 첫 번째 파일 내부의 중복 제거 (append 시에만 적용)

## Implementation Approach

프론트엔드 변경만으로 구현. 기존 백엔드 `deduplicate` 옵션을 활용.

---

## - [x] Phase 1: State 추가

### Overview
중복 제거 옵션 상태를 관리하는 state 추가 및 DiagnosisResultView에 props 전달.

### Changes Required:

#### 1. AddDatasetModal.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- 새 state 추가: `removeDuplicates: boolean` (기본값 `true`)
- 모달 리셋 시 `removeDuplicates`를 `true`로 초기화
- DiagnosisResultView에 새 props 전달: `removeDuplicates`, `onRemoveDuplicatesChange`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] React DevTools에서 state 확인 가능

---

## - [x] Phase 2: Props 확장 및 UI 추가

### Overview
DiagnosisResultView에 중복 제거 체크박스 UI 추가. 통합 체크박스 하위에 들여쓰기로 표시.

### Changes Required:

#### 1. DiagnosisResultView.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx`

**Changes**:
- Props 인터페이스 확장:
  - `removeDuplicates: boolean`
  - `onRemoveDuplicatesChange: (checked: boolean) => void`
- 통합 체크박스 배너 내부에 중복 제거 체크박스 추가
- 조건: `mergeFiles === true`일 때만 표시
- 스타일: 들여쓰기 + 작은 폰트 + "(권장)" 라벨

UI 구조 변경:
```tsx
{/* Merge Files Banner */}
{schemasMatch && diagnoses.length >= 2 && (
  <div className="...">
    {/* 기존 통합 체크박스 */}
    <label>
      <input type="checkbox" checked={mergeFiles} ... />
      N개의 파일을 하나의 데이터셋으로 통합
    </label>

    {/* 새로 추가: 중복 제거 체크박스 */}
    {mergeFiles && (
      <label className="ml-7 mt-2">
        <input type="checkbox" checked={removeDuplicates} ... />
        중복된 행 제거 (권장)
      </label>
    )}
  </div>
)}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] 통합 체크 시 중복 제거 체크박스 노출
- [ ] 통합 체크 해제 시 중복 제거 체크박스 숨김
- [ ] 중복 제거 체크박스 기본값 켜짐

---

## - [x] Phase 3: API 호출에 deduplicate 전달

### Overview
통합 Import 시 `deduplicate` 값을 API 요청에 포함.

### Changes Required:

#### 1. AddDatasetModal.tsx
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- `handleConfirmImport` 함수에서 append 호출 시 `deduplicate: removeDuplicates` 추가
- 첫 번째 파일 (replace 모드)에는 적용하지 않음 (append에만 의미 있음)

수정 위치: `handleConfirmImport` 내 append 호출 부분 (약 line 638-646)

변경 전:
```typescript
await importFile(projectId, {
  file_path: file.path,
  file_type: appendFileType,
  table_name: tableName,
  name: file.name,
  mode: 'append',
  target_table: tableName,
});
```

변경 후:
```typescript
await importFile(projectId, {
  file_path: file.path,
  file_type: appendFileType,
  table_name: tableName,
  name: file.name,
  mode: 'append',
  target_table: tableName,
  deduplicate: removeDuplicates,
});
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음
- [x] 빌드 성공: `npm run build`

#### Manual Verification:
- [ ] 중복 행 있는 파일 2개로 테스트
- [ ] 중복 제거 켜짐 → 중복 행 제거됨
- [ ] 중복 제거 꺼짐 → 중복 행 유지됨

---

## Testing Strategy

### Manual Testing Steps:

1. **중복 제거 테스트**
   - 동일 스키마 CSV 2개 준비 (일부 행 동일)
   - Add Dataset → 두 파일 선택 → Scan
   - 통합 체크 + 중복 제거 체크 (기본값) → Import
   - 데이터셋 열어서 중복 행 없음 확인

2. **중복 유지 테스트**
   - 동일 스키마 CSV 2개 준비 (일부 행 동일)
   - Add Dataset → 두 파일 선택 → Scan
   - 통합 체크 + 중복 제거 **해제** → Import
   - 데이터셋 열어서 중복 행 존재 확인

3. **UI 조건부 표시 테스트**
   - 통합 체크 → 중복 제거 체크박스 보임
   - 통합 해제 → 중복 제거 체크박스 안 보임

4. **비통합 Import 테스트**
   - 통합 체크 안 함 → Import
   - 개별 테이블로 생성됨 (기존 동작 유지)

---

## Performance Considerations

- 중복 제거는 append 시점에만 수행 (DuckDB의 DISTINCT + EXCEPT)
- 대용량 파일의 경우 추가 시간 소요 가능
- 사용자가 성능 우려 시 체크박스 해제 가능

---

## References

### Files Read
- `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx` - 메인 모달 컴포넌트
- `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx` - 진단 결과 뷰
- `frontend/pluto_duck_frontend/lib/fileAssetApi.ts` - API 타입 및 함수
- `docs/plans/026_multi_file_schema_merge_dataset.md` - 이전 구현 계획

### Backend References (변경 불필요, 참고용)
- `backend/pluto_duck_backend/app/services/asset/file_service.py:292-308` - deduplicate 처리 로직
