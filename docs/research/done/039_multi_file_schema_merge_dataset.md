---
date: 2026-01-24T10:30:00+09:00
researcher: Claude
topic: "다중 파일 스키마 일치 시 통합 데이터셋 생성 기능"
tags: [research, codebase, dataset, file-upload, schema-merge, modal]
status: complete
---

# Research: 다중 파일 스키마 일치 시 통합 데이터셋 생성 기능

## Research Question

Add Dataset 과정에서 사용자가 2개 이상의 파일을 업로드하고, 해당 파일들의 데이터 스키마가 100% 일치할 경우:
1. 체크박스를 노출하여 "n개의 파일을 하나의 데이터셋으로 통합해서 생성할까요?"를 묻고
2. 체크박스 선택 시 통합된 데이터셋 1개로 처리하는 플로우 구현 방안

## Summary

### 핵심 발견사항

1. **스키마 비교 데이터는 이미 존재**: `diagnoseFiles` API가 각 파일별 `columns` 배열(name, type, nullable)을 반환하므로, 프론트엔드에서 스키마 일치 여부를 비교할 수 있음

2. **통합 처리 메커니즘 존재**: 백엔드 `importFile` API가 `mode: 'append'` 옵션을 지원하여 여러 파일을 하나의 테이블로 통합 가능

3. **UI 수정 위치**: `DiagnosisResultView.tsx`에 체크박스 UI 추가 필요

4. **구현 복잡도**: 프론트엔드 변경만으로 구현 가능 (백엔드 변경 불필요)

---

## Detailed Findings

### 1. 현재 파일 업로드 플로우

**3단계 프로세스** (AddDatasetModal.tsx):
```
select → preview → diagnose
```

| Step | 컴포넌트 | 역할 |
|------|---------|------|
| `select` | SelectSourceView | 파일 소스 선택 (드래그&드롭, From Device) |
| `preview` | FilePreviewView | 선택된 파일 목록 확인, Scan 버튼 |
| `diagnose` | DiagnosisResultView | 스키마 프리뷰, Import 버튼 |

**파일 경로**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

### 2. 스키마 진단 API 응답 구조

**API**: `POST /api/v1/asset/files/diagnose`

**응답 구조** (`backend/pluto_duck_backend/app/api/v1/asset/router.py:993-1028`):
```typescript
interface DiagnoseFilesResponse {
  diagnoses: FileDiagnosis[];
}

interface FileDiagnosis {
  file_path: string;
  file_type: string;
  columns: ColumnSchema[];      // ← 스키마 비교에 사용
  missing_values: Record<string, number>;
  row_count: number;
  file_size_bytes: number;
  type_suggestions: TypeSuggestion[];
  diagnosed_at: string;
}

interface ColumnSchema {
  name: string;       // 컬럼명
  type: string;       // 데이터 타입 (BIGINT, VARCHAR, DATE 등)
  nullable: boolean;  // NULL 허용 여부
}
```

**중요**: 각 파일의 `columns` 배열을 비교하여 스키마 일치 여부 판단 가능

### 3. 스키마 일치 비교 로직 (구현 필요)

```typescript
// 프론트엔드에서 구현할 스키마 비교 함수
function areSchemasIdentical(diagnoses: FileDiagnosis[]): boolean {
  if (diagnoses.length < 2) return false;

  const baseSchema = diagnoses[0].columns;

  return diagnoses.slice(1).every(diagnosis => {
    if (diagnosis.columns.length !== baseSchema.length) return false;

    return diagnosis.columns.every((col, index) => {
      const baseCol = baseSchema[index];
      return col.name === baseCol.name && col.type === baseCol.type;
      // nullable은 비교에서 제외해도 됨 (데이터 특성일 뿐)
    });
  });
}
```

### 4. 현재 Import 처리 방식

**파일**: `AddDatasetModal.tsx:531-601` (`handleConfirmImport`)

```typescript
// 현재: 각 파일을 개별 테이블로 생성
for (const file of selectedFiles) {
  await importFile(projectId, {
    file_path: file.path,
    file_type: fileType,
    table_name: tableName,  // 각 파일마다 다른 테이블명
    name: file.name,
    overwrite: true,
  });
}
```

### 5. 통합 데이터셋 처리 방식 (구현 필요)

**백엔드 지원 확인**: `backend/pluto_duck_backend/app/services/asset/file_service.py:282-324`

```python
# append 모드 - 기존 테이블에 행 추가
elif mode == "append":
    if deduplicate:
        conn.execute(f"""
            INSERT INTO {safe_table}
            SELECT * FROM (SELECT DISTINCT * FROM {read_expr})
            EXCEPT
            SELECT * FROM {safe_table}
        """)
    else:
        conn.execute(f"INSERT INTO {safe_table} SELECT * FROM {read_expr}")
```

**프론트엔드 구현 방안**:
```typescript
// 통합 모드 선택 시
async function handleMergedImport() {
  const mergedTableName = generateTableName(selectedFiles[0].name);

  // 첫 번째 파일: replace 모드로 테이블 생성
  await importFile(projectId, {
    file_path: selectedFiles[0].path,
    file_type: getFileType(selectedFiles[0].name),
    table_name: mergedTableName,
    name: `Merged: ${selectedFiles.length} files`,
    mode: 'replace',
    overwrite: true,
  });

  // 나머지 파일들: append 모드로 추가
  for (let i = 1; i < selectedFiles.length; i++) {
    await importFile(projectId, {
      file_path: selectedFiles[i].path,
      file_type: getFileType(selectedFiles[i].name),
      table_name: mergedTableName,
      target_table: mergedTableName,
      mode: 'append',
      deduplicate: false,  // 또는 true (사용자 선택)
    });
  }
}
```

### 6. 체크박스 UI 추가 위치

**파일**: `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx`

**현재 구조** (라인 151-223):
```tsx
export function DiagnosisResultView({
  diagnoses,
  files,
  onBack,
  onImport,
  onClose,
  isImporting,
}: DiagnosisResultViewProps)
```

**수정 필요 사항**:
1. Props에 스키마 일치 여부 및 통합 선택 상태 추가
2. 헤더 영역에 체크박스 UI 추가
3. Import 버튼 클릭 시 통합 여부에 따라 다른 처리

---

## Code References

### Frontend

| 파일 | 라인 | 설명 |
|------|------|------|
| `components/data-sources/AddDatasetModal.tsx` | 268-661 | 메인 모달 컴포넌트 |
| `components/data-sources/AddDatasetModal.tsx` | 483-528 | `handleScan` - 진단 API 호출 |
| `components/data-sources/AddDatasetModal.tsx` | 531-601 | `handleConfirmImport` - Import 처리 |
| `components/data-sources/DiagnosisResultView.tsx` | 151-223 | 진단 결과 표시 컴포넌트 |
| `components/data-sources/DiagnosisResultView.tsx` | 48-148 | `FileDiagnosisCard` - 파일별 카드 |
| `lib/fileAssetApi.ts` | 223-243 | `diagnoseFiles` API 함수 |
| `lib/fileAssetApi.ts` | 129-147 | `importFile` API 함수 |
| `lib/fileAssetApi.ts` | 32-43 | `ImportFileRequest` 타입 정의 |

### Backend

| 파일 | 라인 | 설명 |
|------|------|------|
| `app/api/v1/asset/router.py` | 1035-1103 | `/files/diagnose` 엔드포인트 |
| `app/api/v1/asset/router.py` | 845-880 | `/files` POST 엔드포인트 |
| `app/api/v1/asset/router.py` | 764-789 | `ImportFileRequest` 모델 |
| `app/api/v1/asset/router.py` | 993-1028 | 응답 모델 정의 |
| `app/services/asset/file_service.py` | 268-281 | Replace 모드 처리 |
| `app/services/asset/file_service.py` | 282-324 | Append 모드 처리 (통합에 사용) |
| `app/services/asset/file_service.py` | 292-308 | 스키마 호환성 검증 |
| `app/services/asset/file_diagnosis_service.py` | 233-253 | 스키마 추출 로직 |

---

## Architecture Insights

### 데이터 흐름

```
[사용자] 파일 선택 (2개 이상)
    ↓
[AddDatasetModal] step: 'preview'
    ↓
[Scan 버튼 클릭]
    ↓
[diagnoseFiles API] → FileDiagnosis[] 반환
    ↓
[프론트엔드] 스키마 비교 (areSchemasIdentical)
    ↓
[조건 충족] 2개 이상 파일 && 스키마 100% 일치
    ↓
[DiagnosisResultView] 체크박스 노출
    "3개의 파일을 하나의 데이터셋으로 통합해서 생성할까요?"
    ↓
[Import 버튼 클릭]
    ├── 체크 안 됨 → 기존 로직 (개별 테이블)
    └── 체크 됨 → 통합 로직 (첫 파일 replace + 나머지 append)
```

### 설계 결정 사항

1. **스키마 비교 기준**:
   - 컬럼 개수 일치
   - 컬럼 순서 일치
   - 컬럼명 일치 (대소문자 구분?)
   - 컬럼 타입 일치
   - nullable은 제외 가능 (데이터 특성)

2. **통합 테이블명 결정**:
   - 첫 번째 파일명 기반
   - 또는 사용자 입력 받기

3. **중복 제거 옵션**:
   - `deduplicate: true/false` 선택 UI 추가 고려

---

## Implementation Plan

### Phase 1: 프론트엔드 수정

1. **DiagnosisResultView.tsx 수정**
   - Props 확장: `onMergedImport`, `schemasMatch`
   - 체크박스 상태: `useState<boolean>(false)`
   - 체크박스 UI 추가 (스키마 일치 시만 표시)

2. **AddDatasetModal.tsx 수정**
   - `areSchemasIdentical` 함수 추가
   - `handleMergedImport` 함수 추가
   - DiagnosisResultView에 새 props 전달

### Phase 2: 스키마 비교 로직

```typescript
// lib/schemaUtils.ts (새 파일)
export function areSchemasIdentical(diagnoses: FileDiagnosis[]): boolean {
  if (diagnoses.length < 2) return false;

  const baseSchema = diagnoses[0].columns;

  return diagnoses.slice(1).every(diagnosis => {
    if (diagnosis.columns.length !== baseSchema.length) return false;

    return diagnosis.columns.every((col, index) => {
      const baseCol = baseSchema[index];
      // 컬럼명과 타입만 비교 (순서도 일치해야 함)
      return col.name.toLowerCase() === baseCol.name.toLowerCase()
          && col.type === baseCol.type;
    });
  });
}
```

### Phase 3: 체크박스 UI

```tsx
// DiagnosisResultView.tsx 내부
{schemasMatch && diagnoses.length >= 2 && (
  <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-950 border-b">
    <Checkbox
      id="merge-files"
      checked={mergeFiles}
      onCheckedChange={setMergeFiles}
    />
    <label htmlFor="merge-files" className="text-sm">
      {diagnoses.length}개의 파일을 하나의 데이터셋으로 통합해서 생성할까요?
    </label>
  </div>
)}
```

### Phase 4: 통합 Import 로직

```typescript
// AddDatasetModal.tsx
const handleConfirmImport = useCallback(async () => {
  if (mergeFiles && schemasMatch) {
    // 통합 모드
    await handleMergedImport();
  } else {
    // 기존 개별 모드
    await handleIndividualImport();
  }
}, [mergeFiles, schemasMatch, ...]);
```

---

## Open Questions

1. **스키마 비교 엄격도**: 컬럼명 대소문자 구분 여부? 순서 일치 필수?

2. **통합 테이블명**: 첫 파일명 자동 사용 vs 사용자 입력?

3. **중복 제거**: 통합 시 중복 행 제거 옵션 제공할지?

4. **행 수 표시**: 통합 예상 행 수 미리 보여줄지? (sum of all row_counts)

5. **파일 타입 혼합**: CSV + Parquet 혼합 통합 허용할지?

---

## 예상 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `DiagnosisResultView.tsx` | 체크박스 UI, Props 확장 |
| `AddDatasetModal.tsx` | 스키마 비교 로직, 통합 Import 로직 |
| `lib/fileAssetApi.ts` | (변경 불필요 - 기존 API 활용) |
| `backend/**` | (변경 불필요 - append 모드 기존 지원) |
