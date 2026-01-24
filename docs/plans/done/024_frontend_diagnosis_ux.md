# Frontend Diagnosis UX Implementation Plan

## Overview
CSV/Parquet 파일 import 전 진단 결과를 사용자에게 보여주는 프론트엔드 UI를 구현합니다. 사용자가 파일 선택 후 스키마와 데이터 품질 이슈를 확인하고, 이를 기반으로 import 여부를 결정할 수 있게 합니다.

## Current State Analysis

### 기존 구현 상태
- **AddDatasetModal**: 파일 선택 → 바로 Scan(import) 버튼 클릭 흐름
- **FilePreviewModal**: 이미 import된 파일의 데이터 미리보기 (참고용)

### 현재 UX 흐름
```
파일 선택 → [Scan 버튼] → 바로 import 실행 → 완료/에러
```

### 목표 UX 흐름
```
파일 선택 → [Scan 버튼] → 진단 API 호출 → 진단 결과 표시 → [Confirm Import] → import 실행
```

### 재활용 가능한 기존 요소
| 요소 | 위치 | 재활용 방식 |
|------|------|-------------|
| `handleResponse<T>()` | `fileAssetApi.ts` | 진단 API 응답 처리에 그대로 사용 |
| `buildUrl()` | `fileAssetApi.ts` | 진단 엔드포인트 URL 생성에 사용 |
| 테이블 렌더링 패턴 | `FilePreviewModal.tsx` | 스키마 테이블 UI에 참고 |
| 로딩/에러 상태 패턴 | `AddDatasetModal.tsx` | 진단 로딩 상태에 적용 |

## Desired End State

### 목표
1. Scan 버튼 클릭 시 진단 API 먼저 호출
2. 진단 결과를 모달 내에서 시각적으로 표시
   - 스키마 테이블 (컬럼명, 타입, nullable)
   - 결측치 경고 (NULL 개수가 많은 컬럼 하이라이트)
   - 타입 제안 표시 (있는 경우)
3. 사용자가 확인 후 Import 버튼으로 실제 import 진행
4. 뒤로가기로 파일 선택 화면으로 돌아갈 수 있음

### 검증 방법
- 수동 테스트: 다양한 CSV 파일로 진단 → import 흐름 확인
- 스토리북: DiagnosisResultView 컴포넌트 독립 테스트

## What We're NOT Doing
- LLM 컨텍스트 표시 (Plan 025에서 구현)
- 진단 결과 기반 자동 타입 변환 옵션
- 진단 결과 저장/불러오기 UI (백엔드 캐시만 활용)

## Implementation Approach
기존 AddDatasetModal의 step 기반 흐름을 확장하여 `'select' | 'diagnose' | 'confirm'` 3단계로 변경합니다. 진단 결과는 별도 컴포넌트로 분리하여 재사용성을 높입니다.

---

## - [x] Phase 1: 진단 API 클라이언트 추가

### Overview
백엔드 진단 API를 호출하는 프론트엔드 함수를 추가합니다.

### Changes Required:

#### 1. 타입 정의 추가
**File**: `frontend/pluto_duck_frontend/lib/fileAssetApi.ts`

**Changes**:
- `DiagnoseFileRequest` 인터페이스 추가
  - `file_path: string`, `file_type: FileType`
- `ColumnSchema` 인터페이스 추가
  - `name: string`, `type: string`, `nullable: boolean`
- `TypeSuggestion` 인터페이스 추가
  - `column: string`, `current_type: string`, `suggested_type: string`, `confidence: number`
- `FileDiagnosis` 인터페이스 추가
  - `file_path`, `schema: ColumnSchema[]`, `missing_values: Record<string, number>`
  - `row_count`, `file_size_bytes`, `type_suggestions: TypeSuggestion[]`, `diagnosed_at`
- `DiagnoseFilesResponse` 인터페이스 추가
  - `diagnoses: FileDiagnosis[]`

#### 2. API 함수 추가
**File**: `frontend/pluto_duck_frontend/lib/fileAssetApi.ts`

**Changes**:
- `diagnoseFiles(projectId, files)` 함수 추가
  - POST `/api/v1/asset/files/diagnose` 호출
  - 기존 `handleResponse<T>()` 패턴 사용

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] 브라우저 콘솔에서 `diagnoseFiles()` 호출 시 정상 응답 확인

---

## - [x] Phase 2: AddDatasetModal 흐름 수정

### Overview
AddDatasetModal의 단계를 확장하여 진단 결과 표시 단계를 추가합니다.

### Changes Required:

#### 1. Step 타입 확장
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- `Step` 타입을 `'select' | 'diagnose' | 'confirm'`으로 확장
- `diagnosisResults` 상태 추가: `FileDiagnosis[] | null`
- `isDiagnosing` 상태 추가: 진단 중 로딩 상태

#### 2. handleScan 로직 변경
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- 기존: Scan 버튼 → 바로 `importFile()` 호출
- 변경: Scan 버튼 → `diagnoseFiles()` 호출 → `setStep('diagnose')` → 결과 표시
- 진단 성공 시 `diagnosisResults` 상태 업데이트
- 진단 실패 시 에러 표시

#### 3. 새로운 Import 버튼 로직
**Changes**:
- `handleConfirmImport()` 함수 추가
- diagnose 단계에서 "Import" 버튼 클릭 시 기존 `importFile()` 로직 실행
- 현재 `handleScan()`의 import 로직을 이 함수로 이동

#### 4. Step 렌더링 분기
**Changes**:
- `step === 'select'`: 기존 파일 선택 UI
- `step === 'diagnose'`: 진단 결과 표시 UI (Phase 3에서 구현)
- "Back" 버튼으로 이전 단계 이동 가능

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] Scan 버튼 클릭 시 진단 API 호출 확인 (Network 탭)
- [ ] 진단 완료 후 화면 전환 확인

---

## - [x] Phase 3: 진단 결과 UI 컴포넌트

### Overview
진단 결과를 시각적으로 표시하는 컴포넌트를 구현합니다.

### Changes Required:

#### 1. DiagnosisResultView 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx` (신규)

**Changes**:
- Props: `diagnosis: FileDiagnosis`, `fileName: string`
- 파일 요약 정보 표시: 파일명, 행 수, 컬럼 수, 파일 크기
- 스키마 테이블 렌더링: 컬럼명, 타입, nullable 여부
- 결측치 경고 배지: NULL이 있는 컬럼에 경고 아이콘 + 개수 표시
- 타입 제안 표시: 제안이 있는 경우 컬럼 옆에 힌트 표시

#### 2. UI 세부 디자인
**스키마 테이블**:
- 컬럼: Name | Type | Nullable | Issues
- 결측치가 있는 행은 `bg-yellow-50` 배경
- 타입 제안이 있는 경우 Type 컬럼에 `→ suggested_type` 표시

**요약 정보**:
- 아이콘과 함께 표시: 📄 파일명, 📊 행 수, 📋 컬럼 수, 💾 파일 크기
- 문제가 있으면 경고 배너 표시

#### 3. AddDatasetModal에 통합
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- `step === 'diagnose'` 일 때 `DiagnosisResultView` 렌더링
- 복수 파일인 경우 탭 또는 아코디언으로 각 파일 진단 결과 표시
- 하단에 "Back", "Import All" 버튼 배치

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음
- [x] 컴포넌트 렌더링 에러 없음

#### Manual Verification:
- [ ] 스키마 테이블이 올바르게 렌더링됨
- [ ] 결측치가 있는 컬럼에 경고 표시됨
- [ ] 타입 제안이 있는 경우 표시됨

---

## - [x] Phase 4: 로딩/에러 상태 및 마무리

### Overview
진단 중 로딩 상태, 에러 처리, 전체 흐름 마무리를 구현합니다.

### Changes Required:

#### 1. 로딩 상태 UI
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- `isDiagnosing` 상태일 때 로딩 스피너 표시
- "Analyzing files..." 메시지와 진행률 표시 (파일 개수 기준)
- Scan 버튼 비활성화

#### 2. 에러 처리
**Changes**:
- 진단 실패 시 에러 메시지 표시
- "Retry" 버튼으로 재시도 가능
- 일부 파일만 실패한 경우 성공한 파일 결과는 표시하고 실패 파일 목록 별도 표시

#### 3. Import 진행 중 상태
**Changes**:
- Import 버튼 클릭 후 `isImporting` 상태 관리
- 파일별 import 진행 상태 표시 (성공 ✓, 실패 ✗, 진행중 ⏳)
- 모든 import 완료 후 모달 닫기

#### 4. 접근성 및 키보드 네비게이션
**Changes**:
- Enter 키로 다음 단계 진행
- Escape 키로 모달 닫기
- 포커스 관리 (단계 전환 시 적절한 요소에 포커스)

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] 진단 중 로딩 스피너 표시됨
- [ ] 에러 발생 시 사용자 친화적 메시지 표시
- [ ] 전체 흐름(선택→진단→import)이 매끄럽게 동작

---

## Testing Strategy

### Unit Tests:
- `DiagnosisResultView` 컴포넌트 렌더링 테스트
- 결측치 경고 표시 로직 테스트
- 타입 제안 표시 로직 테스트

### Integration Tests:
- AddDatasetModal 전체 흐름 E2E 테스트
- API 호출 및 상태 전환 테스트

### Manual Testing Steps:
1. 정상 CSV 파일 선택 → Scan → 진단 결과 확인 → Import
2. 결측치가 있는 CSV → 경고 표시 확인
3. 잘못된 파일 경로 → 에러 메시지 확인
4. 복수 파일 선택 → 각 파일 진단 결과 확인
5. Import 중간에 모달 닫기 시도 → 경고 또는 방지

## Performance Considerations
- 대용량 파일 진단 시 로딩 상태 명확히 표시
- 진단 결과 캐싱은 백엔드에서 처리 (프론트엔드는 매번 API 호출)
- 복수 파일 진단 결과 렌더링 시 가상화 불필요 (파일 수 제한적)

## Migration Notes
- 기존 사용자 흐름 변경: Scan → 바로 import에서 Scan → 진단 확인 → import로 변경
- 기존 컴포넌트 수정이므로 별도 마이그레이션 불필요

---

## References

### Files Read During Planning:
- [AddDatasetModal.tsx](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx) - 현재 모달 구조 참고
- [FilePreviewModal.tsx](frontend/pluto_duck_frontend/components/data-sources/FilePreviewModal.tsx) - 테이블 렌더링 패턴 참고
- [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) - API 호출 패턴 참고

### Research Documents:
- [033_create_table_api_and_diagnosis_flow.md](docs/research/033_create_table_api_and_diagnosis_flow.md) - 진단 기능 요구사항

### Related Plans:
- [023_backend_file_diagnosis_api.md](docs/plans/023_backend_file_diagnosis_api.md) - 백엔드 API (선행 필수)

### UI/UX References:
- Radix UI Dialog - 모달 컴포넌트
- Tailwind CSS - 스타일링
