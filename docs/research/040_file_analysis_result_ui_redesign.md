---
date: 2026-01-24T00:00:00+09:00
researcher: Claude
topic: "File Analysis Result UI 전면 재구성"
tags: [research, codebase, file-upload, diagnosis, ui-redesign]
status: complete
---

# Research: File Analysis Result UI 전면 재구성

## Research Question

현재 Add Dataset에서 파일 업로드 후 데이터 스캔 결과를 보여주는 "diagnosis result" 페이지의 UI를 전면적으로 재구성하려고 함. 첨부된 이미지를 참고하여 다음 기능을 구현해야 함:

1. 스캔된 데이터의 상태 표시 (정상/불량 - 인코딩 오류, 파일 비었음, 형식 문제 등)
2. Schema 100% 동일한 경우 Smart Suggestion 노출
3. 스캔된 데이터 요약 리스트를 왼쪽에 배치
4. 데이터 선택 시 오른쪽에 preview 제공
5. 데이터셋 이름 설정 가능 (기본값: 파일명 - 확장자 + 공백→언더바)

## Summary

현재 `DiagnosisResultView` 컴포넌트는 단순한 확장형 카드 리스트로 구현되어 있으며, 사용자가 제안한 분할 레이아웃(좌: 파일 리스트, 우: 상세 프리뷰)으로의 재구성이 필요함. 기존 코드베이스에서 schema 비교, merge/deduplicate 로직은 이미 구현되어 있으므로 UI 레이어만 재설계하면 됨.

## Detailed Findings

### 1. 현재 구현 분석

#### 1.1 핵심 파일 구조

| 파일 | 역할 | 라인 수 |
|------|------|---------|
| [AddDatasetModal.tsx](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx) | 3단계 업로드 플로우 (select → preview → diagnose) | 798 |
| [DiagnosisResultView.tsx](frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx) | 스캔 결과 표시 (재구성 대상) | 270 |
| [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) | 진단/임포트 API 클라이언트 | ~245 |
| [file_diagnosis_service.py](backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py) | 백엔드 진단 로직 | ~640 |

#### 1.2 현재 DiagnosisResultView 문제점

```
현재 레이아웃:
┌────────────────────────────────┐
│ Header: File Analysis          │
├────────────────────────────────┤
│ [Merge Banner - if schemas match] │
├────────────────────────────────┤
│ ▼ File 1 Card (expandable)     │
│ ▼ File 2 Card (expandable)     │
│ ▼ File 3 Card (expandable)     │
├────────────────────────────────┤
│ [Back]              [Import]   │
└────────────────────────────────┘
```

**문제점:**
- 확장형 카드만 있어 한 번에 하나의 파일만 상세 확인 가능
- 파일 상태(정상/오류) 시각적 구분 부족
- 테이블명 설정 기능 없음
- Raw data preview 없음
- Sample values 표시 없음

#### 1.3 목표 레이아웃 (이미지 기반)

```
┌─────────────────────────────────────────────────────────────────┐
│ File Analysis Result                     [Cancel] [Import 4 Files]│
├─────────────────────┬───────────────────────────────────────────┤
│ Scanned Files (4)   │ File Details: google_ads_2025...          │
├─────────────────────┤─────────────────────────────────────────────┤
│ ✨ Smart Suggestion │ Table Configuration                        │
│ ☑ 2개의 파일을...   │ ┌──────────────────────────────────────┐   │
│   ☑ 중복 행 제거    │ │ google_ads_202501                    │   │
├─────────────────────┤ └──────────────────────────────────────┘   │
│ ✓ google_ads_...    │                                            │
│   2.4 MB • 15,420   │ Column Schema (Detected Types)             │
│ ✓ meta_facebook_... │ ┌────────────┬─────────────┬────────────┐  │
│   1.8 MB • 12,100   │ │ Column     │ Type        │ Sample     │  │
│ ⚠ tiktok_ads_...    │ ├────────────┼─────────────┼────────────┤  │
│   3.1 MB • 21,500   │ │ Date       │ 📅 Date     │ 2025-01-22 │  │
│   (Spend column)    │ │ Campaign   │ 🔤 String   │ Spring_... │  │
│ ✓ linkedin_ads_...  │ │ Impressions│ #️⃣ Integer  │ 15,240     │  │
│   0.9 MB • 5,600    │ │ Cost       │ 💰 Currency │ ₩1,500,000 │  │
│                     │ │ CTR        │ 📊 Percent  │ 8.14%      │  │
│                     │ └────────────┴─────────────┴────────────┘  │
│                     │                                            │
│                     │ Raw Data Preview (Top 5 Rows)              │
│                     │ ┌────────┬────────────┬────────┬───────┐   │
│                     │ │ Date   │ Campaign   │ Impr.  │ ...   │   │
│                     │ ├────────┼────────────┼────────┼───────┤   │
│                     │ │ 2025.. │ Spring_... │ 15,240 │ ...   │   │
│                     │ └────────┴────────────┴────────┴───────┘   │
└─────────────────────┴───────────────────────────────────────────┘
```

### 2. 기존 데이터 구조 분석

#### 2.1 FileDiagnosis 인터페이스 (현재)

```typescript
// frontend/pluto_duck_frontend/lib/fileAssetApi.ts
interface FileDiagnosis {
  file_path: string;
  file_type: string;        // 'csv' | 'parquet'
  columns: ColumnSchema[];
  missing_values: Record<string, number>;  // 컬럼별 null 개수
  row_count: number;
  file_size_bytes: number;
  type_suggestions: TypeSuggestion[];      // 타입 제안
  diagnosed_at: string;
}

interface ColumnSchema {
  name: string;
  type: string;           // 'varchar', 'bigint', 'double', etc.
  nullable: boolean;
}

interface TypeSuggestion {
  column_name: string;
  current_type: string;
  suggested_type: string;
  confidence: number;     // 0.0 ~ 1.0
  sample_values?: string[];
}
```

#### 2.2 백엔드 API 응답

현재 `/api/v1/asset/files/diagnose` 엔드포인트에서 반환하는 정보:
- 파일 메타데이터 (경로, 타입, 크기, 행 수)
- 컬럼 스키마 (이름, 타입, nullable)
- 결측값 통계 (컬럼별 null 개수)
- 타입 제안 (confidence 기반)

**현재 부족한 정보:**
- Sample values (프리뷰 데이터)
- 파일 검증 상태 (encoding error, empty file 등)
- 상세 오류 메시지

### 3. 필요한 변경 사항

#### 3.1 백엔드 확장

**새로운 필드 추가가 필요한 FileDiagnosis:**

```python
# 제안: file_diagnosis_service.py 확장
@dataclass
class FileDiagnosis:
    # 기존 필드
    file_path: str
    file_type: str
    columns: List[ColumnSchema]
    missing_values: Dict[str, int]
    row_count: int
    file_size_bytes: int
    type_suggestions: List[TypeSuggestion]
    diagnosed_at: str

    # 새로운 필드 (추가 필요)
    status: str                    # 'valid' | 'warning' | 'error'
    status_message: Optional[str]  # 오류/경고 메시지
    sample_rows: List[List[Any]]   # 상위 5개 행 데이터
    sample_values: Dict[str, List[str]]  # 컬럼별 샘플 값 (3-5개)
```

#### 3.2 프론트엔드 컴포넌트 재구성

**새로운 컴포넌트 구조:**

```
components/data-sources/
├── AddDatasetModal.tsx          # 기존 유지
├── DiagnosisResultView.tsx      # 완전 재작성
│   ├── FileListPanel.tsx        # 왼쪽: 파일 리스트
│   ├── SmartSuggestionBanner.tsx # 스마트 제안 배너
│   ├── FileDetailPanel.tsx      # 오른쪽: 상세 정보
│   │   ├── TableNameInput.tsx   # 테이블명 입력
│   │   ├── ColumnSchemaTable.tsx # 스키마 테이블
│   │   └── RawDataPreview.tsx   # 데이터 프리뷰
│   └── types.ts                 # 공통 타입
```

### 4. Schema 비교 및 Smart Suggestion 로직

#### 4.1 현재 구현 (AddDatasetModal.tsx:48-80)

```typescript
function areSchemasIdentical(diagnoses: FileDiagnosis[]): boolean {
  if (diagnoses.length < 2) return false;

  const first = diagnoses[0];
  const allSameType = diagnoses.every(d => d.file_type === first.file_type);
  if (!allSameType) return false;

  const firstColumns = first.columns;

  for (let i = 1; i < diagnoses.length; i++) {
    const current = diagnoses[i];
    if (current.columns.length !== firstColumns.length) return false;

    for (let j = 0; j < firstColumns.length; j++) {
      if (firstColumns[j].name.toLowerCase() !== current.columns[j].name.toLowerCase()) return false;
      if (firstColumns[j].type !== current.columns[j].type) return false;
    }
  }
  return true;
}
```

#### 4.2 Smart Suggestion UI 요구사항

이미지 기반으로 다음 기능 구현 필요:

1. **Schema 일치 시 표시:**
   - "✨ Smart Suggestion" 헤더
   - 주 체크박스: "{N}개의 파일을 하나의 데이터셋으로 통합 (총 {rows}행)"
   - 하위 체크박스: "중복된 행 제거 (권장)" - 기본 체크됨

2. **Schema 불일치 시:**
   - Smart Suggestion 배너 숨김

### 5. 컬럼 타입 아이콘 매핑

이미지에서 보이는 타입별 아이콘:

| 타입 | 아이콘 | 설명 |
|------|--------|------|
| Date (YYYY-MM-DD) | 📅 Calendar | 날짜 형식 |
| String | 🔤 Text | 문자열 |
| Integer | #️⃣ Hash | 정수 |
| Currency (KRW) | 💰 Money | 통화 (원화 기호 표시) |
| Percentage | 📊 Chart | 백분율 (% 표시) |

**구현 방안:**
```typescript
const TYPE_CONFIG: Record<string, { icon: LucideIcon; label: string }> = {
  'date': { icon: Calendar, label: 'Date (YYYY-MM-DD)' },
  'timestamp': { icon: Calendar, label: 'Datetime' },
  'varchar': { icon: Type, label: 'String' },
  'text': { icon: Type, label: 'String' },
  'bigint': { icon: Hash, label: 'Integer' },
  'integer': { icon: Hash, label: 'Integer' },
  'double': { icon: Hash, label: 'Decimal' },
  'decimal': { icon: Coins, label: 'Currency' },
  'boolean': { icon: ToggleLeft, label: 'Boolean' },
};
```

### 6. 데이터셋 이름 생성 로직

#### 6.1 현재 구현 (AddDatasetModal.tsx:83-92)

```typescript
function generateTableName(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.(csv|parquet)$/i, '');
  // Convert to valid identifier: lowercase, replace non-alphanumeric with underscore
  return nameWithoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 63);
}
```

#### 6.2 수정 요구사항

- 공백만 언더바로 변경 (다른 특수문자는 제거)
- 대소문자 유지 가능
- 사용자가 직접 수정 가능한 입력 필드

```typescript
function generateTableName(filename: string): string {
  const nameWithoutExt = filename.replace(/\.(csv|parquet)$/i, '');
  return nameWithoutExt
    .replace(/\s+/g, '_')           // 공백 → 언더바
    .replace(/[^a-zA-Z0-9_]+/g, '') // 특수문자 제거
    .substring(0, 63);
}
```

### 7. 파일 상태 검증 로직

#### 7.1 상태 분류

| 상태 | 아이콘 | 색상 | 조건 |
|------|--------|------|------|
| valid | ✓ (체크) | green | 오류 없음 |
| warning | ⚠ (경고) | yellow | 경미한 문제 (null 값, 타입 제안 등) |
| error | ✕ (엑스) | red | 심각한 문제 (읽기 실패, 인코딩 오류 등) |

#### 7.2 검증 항목

```typescript
function getFileStatus(diagnosis: FileDiagnosis): FileStatus {
  // Error 조건
  if (diagnosis.row_count === 0) {
    return { status: 'error', message: 'File is empty' };
  }
  if (diagnosis.columns.length === 0) {
    return { status: 'error', message: 'No columns detected' };
  }

  // Warning 조건
  const totalNulls = Object.values(diagnosis.missing_values).reduce((a, b) => a + b, 0);
  const hasTypeSuggestions = diagnosis.type_suggestions.length > 0;

  if (totalNulls > 0 || hasTypeSuggestions) {
    const messages = [];
    if (totalNulls > 0) messages.push(`${totalNulls} null values`);
    if (hasTypeSuggestions) messages.push(`${diagnosis.type_suggestions.length} type hints`);
    return { status: 'warning', message: messages.join(', ') };
  }

  return { status: 'valid', message: null };
}
```

### 8. Raw Data Preview 구현

#### 8.1 현재 프리뷰 API

```typescript
// fileAssetApi.ts
export async function previewFileData(
  projectId: string,
  fileId: string,
  limit: number = 100
): Promise<FilePreview> {
  // GET /api/v1/asset/files/{fileId}/preview
}
```

**문제:** 현재 API는 import된 파일만 프리뷰 가능 (진단 단계에서는 사용 불가)

#### 8.2 필요한 신규 API

진단 단계에서 raw data 프리뷰를 위해 새 엔드포인트 필요:

```python
# router.py 추가
@router.post("/files/preview-raw")
async def preview_raw_file(
    project_id: str,
    file_path: str,
    file_type: Literal["csv", "parquet"],
    limit: int = 5
) -> RawFilePreview:
    """
    Import 전 파일의 raw data preview 반환
    """
    pass
```

**또는** diagnose API 응답에 sample_rows 포함:

```python
# file_diagnosis_service.py 수정
def _get_sample_rows(self, read_expr: str, limit: int = 5) -> List[List[Any]]:
    query = f"SELECT * FROM {read_expr} LIMIT {limit}"
    result = self.db.execute(query).fetchall()
    return [list(row) for row in result]
```

## Code References

### 핵심 파일
- [AddDatasetModal.tsx:302-797](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx#L302-L797) - 메인 모달 컴포넌트
- [DiagnosisResultView.tsx:156-268](frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx#L156-L268) - 현재 진단 결과 뷰 (재작성 대상)
- [DiagnosisResultView.tsx:200-234](frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx#L200-L234) - 현재 merge 배너 UI
- [AddDatasetModal.tsx:48-80](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx#L48-L80) - Schema 비교 함수

### 백엔드 서비스
- [file_diagnosis_service.py:432-515](backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py#L432-L515) - 진단 메인 로직
- [file_diagnosis_service.py:233-253](backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py#L233-L253) - 스키마 추출
- [file_diagnosis_service.py:299-430](backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py#L299-L430) - 타입 분석

### API 정의
- [fileAssetApi.ts:223-243](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L223-L243) - 진단 API 호출
- [router.py:1035-1103](backend/pluto_duck_backend/app/api/v1/asset/router.py#L1035-L1103) - 진단 API 엔드포인트

## Architecture Insights

### 현재 아키텍처

```
User Action Flow:
┌─────────────────────────────────────────────────────────────────┐
│ AddDatasetModal                                                 │
│  ├── Step 1: SelectSourceView (파일 선택/드래그)                 │
│  ├── Step 2: FilePreviewView (파일 리스트 확인)                  │
│  └── Step 3: DiagnosisResultView (진단 결과) ← 재구성 대상       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Backend API                                                     │
│  └── POST /api/v1/asset/files/diagnose                         │
│       └── FileDiagnosisService.diagnose_file()                 │
└─────────────────────────────────────────────────────────────────┘
```

### 상태 관리 (AddDatasetModal)

```typescript
// 현재 상태 변수들
const [step, setStep] = useState<'select' | 'preview' | 'diagnose'>('select');
const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
const [diagnosisResults, setDiagnosisResults] = useState<FileDiagnosis[] | null>(null);
const [mergeFiles, setMergeFiles] = useState(false);
const [schemasMatch, setSchemasMatch] = useState(false);
const [removeDuplicates, setRemoveDuplicates] = useState(true);

// 추가 필요한 상태
const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
const [tableNames, setTableNames] = useState<Record<string, string>>({});
```

### Import 플로우 (Merge 모드)

```
1. 첫 번째 파일: mode='replace'로 테이블 생성
2. 나머지 파일: mode='append'로 데이터 추가
3. deduplicate=true 시 중복 제거
```

## Implementation Plan

### Phase 1: 백엔드 API 확장

**파일:** `backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py`

1. `FileDiagnosis` 모델에 새 필드 추가:
   - `status: Literal['valid', 'warning', 'error']`
   - `status_message: Optional[str]`
   - `sample_rows: List[List[Any]]` (상위 5행)
   - `sample_values: Dict[str, List[str]]` (컬럼별 샘플)

2. `_get_sample_rows()` 메서드 구현:
   - 상위 5개 행 데이터 추출
   - 컬럼별 고유값 샘플 추출

3. `_determine_status()` 메서드 구현:
   - 파일 상태 결정 로직

### Phase 2: 프론트엔드 타입 및 API 업데이트

**파일:** `frontend/pluto_duck_frontend/lib/fileAssetApi.ts`

1. `FileDiagnosis` 인터페이스 확장
2. API 응답 처리 업데이트

### Phase 3: DiagnosisResultView 재설계

**새 컴포넌트 파일:**

1. **FileListPanel.tsx** - 왼쪽 파일 리스트
   - 파일 상태 아이콘 (✓ / ⚠ / ✕)
   - 파일 크기, 행 수 표시
   - 선택 상태 하이라이트
   - 클릭 시 상세 패널 업데이트

2. **SmartSuggestionBanner.tsx** - 스마트 제안
   - Schema 일치 감지
   - Merge 체크박스
   - Deduplicate 체크박스

3. **FileDetailPanel.tsx** - 오른쪽 상세 패널
   - 테이블명 입력 필드
   - 컬럼 스키마 테이블 (아이콘 포함)
   - Raw data 프리뷰 테이블

4. **DiagnosisResultView.tsx** - 메인 컨테이너
   - Split 레이아웃 (좌/우)
   - 상태 관리
   - Import 핸들러

### Phase 4: UI 스타일링

1. 타입별 아이콘 및 색상 시스템
2. 파일 상태별 스타일
3. 반응형 레이아웃
4. 스크롤 영역 처리

## Open Questions

1. **Sample values 개수**: 컬럼당 몇 개의 샘플 값을 표시할 것인가? (이미지에서는 2-3개)

2. **Multi-file merge 시 테이블명**: merge 선택 시 단일 테이블명만 입력? 아니면 첫 번째 파일명 기반 자동 생성?

3. **오류 파일 처리**: 심각한 오류(인코딩 실패 등)가 있는 파일도 Import 버튼에 포함할 것인가?

4. **통화/퍼센트 감지**: Currency (KRW), Percentage 타입은 현재 백엔드에서 감지하지 않음. 구현 필요 여부?

5. **Modal 크기**: 현재 600x580px. 분할 레이아웃을 위해 확장 필요? (900x600px 제안)
