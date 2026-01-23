---
date: 2026-01-22T14:30:00+09:00
researcher: Claude
topic: "Create Table API Flow & Data Diagnosis Implementation Research"
tags: [research, codebase, create-table, file-import, diagnosis, metadata]
status: complete
---

# Research: Create Table API Flow & Data Diagnosis Implementation

## Research Question
사이드바 Dataset +에서 CSV import 후 Scan 버튼 클릭 시 발생하는 현재 Create Table 플로우 조사. 진단 기능 추가를 위한 기존 API/백엔드 재활용 가능성 분석.

## Summary

### 현재 Create Table 플로우
1. **프론트엔드**: `importFile()` API 호출 → POST `/api/v1/asset/files`
2. **백엔드**: `FileAssetService.import_file()` → DuckDB `CREATE TABLE AS SELECT * FROM read_csv()`
3. **메타데이터**: `_file_assets.files` 테이블에 저장 (row_count, column_count, file_size 등)

### 진단 정보 저장 가능 위치
- **기존 `metadata JSON` 컬럼** 활용 가능 (data_source_tables, data_sources, cached_tables 등에 존재)
- **새 테이블 생성** 필요: 현재 schema/결측치/type mismatch 진단 결과를 저장하는 전용 테이블 없음
- **LLM 컨텍스트 저장**: 현재 구조 없음, 새로 설계 필요

---

## Detailed Findings

### 1. Frontend Create Table Flow

#### 진입점: AddDatasetModal
**File**: [AddDatasetModal.tsx](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx)

Scan 버튼 클릭 시 `handleScan()` 호출:
```typescript
// 각 파일에 대해 importFile() API 호출
const request: ImportFileRequest = {
  file_path: file.path,
  file_type: fileType as 'csv' | 'parquet',
  table_name: tableName,  // 파일명 기반 자동 생성
  name: file.name,
  overwrite: false,
  mode: 'replace',
};
await importFile(projectId, request);
```

#### API 함수
**File**: [fileAssetApi.ts:86-104](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L86-L104)

```typescript
export async function importFile(
  projectId: string,
  request: ImportFileRequest
): Promise<FileAsset> {
  const url = buildUrl('/files', projectId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse<FileAsset>(response);
}
```

#### ImportFileRequest 인터페이스
**File**: [fileAssetApi.ts:32-43](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L32-L43)

```typescript
export interface ImportFileRequest {
  file_path: string;
  file_type: FileType;        // 'csv' | 'parquet'
  table_name: string;
  name?: string;
  description?: string;
  overwrite?: boolean;
  mode?: ImportMode;          // 'replace' | 'append' | 'merge'
  target_table?: string;
  merge_keys?: string[];
  deduplicate?: boolean;
}
```

---

### 2. Backend API Endpoint

**File**: [router.py:843-878](backend/pluto_duck_backend/app/api/v1/asset/router.py#L843-L878)

```python
@router.post("/files", response_model=FileAssetResponse)
async def import_file(
    request: ImportFileRequest,
    project_id: str = Query(..., description="Project ID"),
):
    service = get_file_asset_service(project_id)
    asset = await service.import_file(
        file_path=request.file_path,
        file_type=request.file_type,
        table_name=request.table_name,
        name=request.name,
        description=request.description,
        overwrite=request.overwrite,
        mode=request.mode or "replace",
        target_table=request.target_table,
        merge_keys=request.merge_keys,
        deduplicate=request.deduplicate,
    )
    return FileAssetResponse(asset=asset)
```

---

### 3. Backend Service Logic

**File**: [file_service.py:202-424](backend/pluto_duck_backend/app/services/asset/file_service.py#L202-L424)

#### 핵심 테이블 생성 로직 (Replace Mode)
```python
# Lines 258-280
if file_type == "csv":
    read_expr = f"read_csv('{file_path}', auto_detect=true)"
elif file_type == "parquet":
    read_expr = f"read_parquet('{file_path}')"

if overwrite:
    conn.execute(f"DROP TABLE IF EXISTS {safe_table}")
conn.execute(f"CREATE TABLE {safe_table} AS SELECT * FROM {read_expr}")
```

#### 메타데이터 수집 및 저장
```python
# Lines 357-410
row_count = conn.execute(f"SELECT COUNT(*) FROM {safe_table}").fetchone()[0]
column_count = len(conn.execute(f"DESCRIBE {safe_table}").fetchall())

# _file_assets.files 테이블에 저장
INSERT INTO _file_assets.files (
    id, project_id, name, file_path, file_type, table_name,
    description, row_count, column_count, file_size_bytes,
    created_at, updated_at
) VALUES (...)
```

#### DuckDB 연결 관리
**File**: [duckdb_utils.py:9-23](backend/pluto_duck_backend/app/services/duckdb_utils.py#L9-L23)

```python
_duckdb_conn_lock = threading.RLock()

@contextmanager
def connect_warehouse(path: Path):
    with _duckdb_conn_lock:
        con = duckdb.connect(str(path))
        yield con
```

---

### 4. 기존 메타데이터 저장 구조

#### A. 파일 에셋 메타데이터
**Schema**: `_file_assets.files`
**File**: [file_service.py:177-196](backend/pluto_duck_backend/app/services/asset/file_service.py#L177-L196)

| 컬럼 | 타입 | 용도 |
|------|------|------|
| id | UUID | Primary Key |
| project_id | UUID | 프로젝트 격리 |
| name | VARCHAR | 표시 이름 |
| file_path | VARCHAR | 원본 파일 경로 |
| file_type | VARCHAR | csv/parquet |
| table_name | VARCHAR | DuckDB 테이블명 |
| row_count | BIGINT | 행 수 |
| column_count | INTEGER | 컬럼 수 |
| file_size_bytes | BIGINT | 파일 크기 |
| created_at | TIMESTAMP | 생성 시간 |
| updated_at | TIMESTAMP | 수정 시간 |

#### B. 데이터 소스 메타데이터 (외부 DB 연결용)
**Table**: `data_source_tables`
**File**: [repository.py:149-162](backend/pluto_duck_backend/app/services/chat/repository.py#L149-L162)

```sql
CREATE TABLE IF NOT EXISTS data_source_tables (
    id UUID PRIMARY KEY,
    data_source_id UUID NOT NULL,
    source_table VARCHAR,
    target_table VARCHAR NOT NULL,
    rows_count INTEGER,
    status VARCHAR DEFAULT 'active',
    last_imported_at TIMESTAMP,
    metadata JSON,  -- 확장 가능한 JSON 필드
    ...
)
```

#### C. 캐시 테이블 메타데이터
**Schema**: `_sources.cached_tables`
**File**: [repository.py:268-278](backend/pluto_duck_backend/app/services/chat/repository.py#L268-L278)

```sql
CREATE TABLE IF NOT EXISTS _sources.cached_tables (
    id VARCHAR PRIMARY KEY,
    source_name VARCHAR NOT NULL,
    source_table VARCHAR NOT NULL,
    local_table VARCHAR UNIQUE NOT NULL,
    cached_at TIMESTAMP NOT NULL,
    row_count BIGINT,
    metadata JSON,  -- 확장 가능한 JSON 필드
    ...
)
```

---

### 5. 실행 히스토리 저장 구조

**Schema**: `_duckpipe.run_history`
**File**: [repository.py:298-327](backend/pluto_duck_backend/app/services/chat/repository.py#L298-L327)

```sql
CREATE TABLE IF NOT EXISTS _duckpipe.run_history (
    run_id VARCHAR PRIMARY KEY,
    analysis_id VARCHAR NOT NULL,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    status VARCHAR NOT NULL,      -- running, success, failed
    rows_affected BIGINT,
    error VARCHAR,
    duration_ms INTEGER,
    params JSON                    -- 실행 파라미터
);

CREATE INDEX idx_run_history_analysis ON _duckpipe.run_history(analysis_id);
CREATE INDEX idx_run_history_started ON _duckpipe.run_history(started_at DESC);
```

---

### 6. 스키마 조회 기능 (참고용)

**File**: [schema.py:83-102](backend/pluto_duck_backend/agent/core/deep/tools/schema.py#L83-L102)

```python
def describe_table(table_name: str, schema_name: str = "main") -> TableSchema:
    """Get column information and row count for a table"""
    with connect_warehouse(warehouse_path) as conn:
        columns = conn.execute(f"PRAGMA table_info('{schema_name}.{table_name}')").fetchall()
        row_count = conn.execute(f"SELECT COUNT(*) FROM {schema_name}.{table_name}").fetchone()[0]

    return TableSchema(
        columns=[
            ColumnInfo(name=col[1], type=col[2], not_null=col[3], default=col[4], primary_key=col[5])
            for col in columns
        ],
        row_count=row_count
    )
```

---

## Code References

### Frontend
- [AddDatasetModal.tsx](frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx) - Scan 버튼 및 import 로직
- [fileAssetApi.ts:86-104](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L86-L104) - importFile() API 함수
- [fileAssetApi.ts:32-43](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L32-L43) - ImportFileRequest 인터페이스

### Backend API
- [router.py:843-878](backend/pluto_duck_backend/app/api/v1/asset/router.py#L843-L878) - POST /asset/files 엔드포인트
- [router.py:762-787](backend/pluto_duck_backend/app/api/v1/asset/router.py#L762-L787) - ImportFileRequest 모델

### Backend Service
- [file_service.py:202-424](backend/pluto_duck_backend/app/services/asset/file_service.py#L202-L424) - import_file() 전체 로직
- [file_service.py:258-280](backend/pluto_duck_backend/app/services/asset/file_service.py#L258-L280) - CREATE TABLE 로직
- [file_service.py:357-410](backend/pluto_duck_backend/app/services/asset/file_service.py#L357-L410) - 메타데이터 저장

### Metadata Schema
- [repository.py:149-162](backend/pluto_duck_backend/app/services/chat/repository.py#L149-L162) - data_source_tables (JSON metadata 포함)
- [repository.py:268-278](backend/pluto_duck_backend/app/services/chat/repository.py#L268-L278) - cached_tables (JSON metadata 포함)
- [repository.py:298-327](backend/pluto_duck_backend/app/services/chat/repository.py#L298-L327) - run_history

---

## Architecture Insights

### 현재 아키텍처 패턴

1. **3-Tier 구조**:
   - Direct File Import (CSV/Parquet → DuckDB)
   - External Source Attachment (PostgreSQL, MySQL, SQLite)
   - Table Caching (외부 테이블 → 로컬 복사)

2. **메타데이터 저장 패턴**:
   - 기본 필드: id, project_id, created_at, updated_at
   - **확장 필드**: `metadata JSON` - 유연한 확장 가능

3. **스레드 안전성**:
   - `threading.RLock()`으로 DuckDB 연결 직렬화

### 진단 기능 추가를 위한 재활용 포인트

| 기존 요소 | 재활용 방식 |
|-----------|-------------|
| `importFile()` API | 진단 후 테이블 생성에 그대로 사용 |
| `read_csv()` DuckDB 함수 | 진단 시 스키마 추출에 활용 |
| `DESCRIBE` 명령어 | 컬럼 타입 정보 추출 |
| `metadata JSON` 패턴 | 진단 결과 저장에 활용 |
| `run_history` 패턴 | 진단 히스토리 저장에 참고 |

---

## Implementation Recommendations

### 1. 새 진단 API 엔드포인트 제안

```
POST /api/v1/asset/files/diagnose
```

**Request**:
```json
{
  "files": [
    {"file_path": "/path/to/file1.csv", "file_type": "csv"},
    {"file_path": "/path/to/file2.csv", "file_type": "csv"}
  ]
}
```

**Response**:
```json
{
  "diagnoses": [
    {
      "file_path": "/path/to/file1.csv",
      "schema": {
        "columns": [
          {"name": "id", "type": "INTEGER", "nullable": false},
          {"name": "name", "type": "VARCHAR", "nullable": true}
        ]
      },
      "issues": {
        "missing_values": {"name": 15, "email": 3},
        "type_mismatches": [
          {"column": "price", "expected": "DOUBLE", "found": "VARCHAR", "sample": "N/A"}
        ]
      },
      "row_count": 1000,
      "file_size_bytes": 45678
    }
  ]
}
```

### 2. 진단 결과 저장 테이블 제안

```sql
CREATE TABLE IF NOT EXISTS _file_assets.file_diagnoses (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    file_path VARCHAR NOT NULL,
    file_type VARCHAR NOT NULL,

    -- 스키마 정보
    schema_info JSON,           -- 컬럼명, 타입, nullable 등

    -- 품질 진단 결과
    missing_values JSON,        -- {"column_name": count}
    type_mismatches JSON,       -- [{"column", "expected", "found", "samples"}]
    duplicate_rows INTEGER,

    -- 통계
    row_count BIGINT,
    column_count INTEGER,
    file_size_bytes BIGINT,

    -- 메타데이터
    diagnosed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON               -- 향후 확장용
);
```

### 3. Python 진단 로직 위치 제안

**File**: `backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py`

```python
class FileDiagnosisService:
    async def diagnose_file(self, file_path: str, file_type: str) -> FileDiagnosis:
        """CSV/Parquet 파일 진단"""
        with connect_warehouse(self.warehouse_path) as conn:
            # 1. 스키마 추출
            read_expr = f"read_csv('{file_path}', auto_detect=true)"
            schema = conn.execute(f"DESCRIBE SELECT * FROM {read_expr}").fetchall()

            # 2. 결측치 분석
            missing_values = {}
            for col in schema:
                count = conn.execute(f"""
                    SELECT COUNT(*) FROM {read_expr} WHERE "{col[0]}" IS NULL
                """).fetchone()[0]
                if count > 0:
                    missing_values[col[0]] = count

            # 3. 타입 불일치 검출 (문자열 컬럼에서 숫자 패턴 등)
            # ...

            return FileDiagnosis(schema=schema, missing_values=missing_values, ...)
```

---

## Open Questions

1. **진단 결과 유효기간**: 파일이 변경되면 진단 결과 무효화 필요? (파일 해시 저장?)
2. **LLM 컨텍스트 연동**: 진단 결과를 어떤 형태로 LLM에 전달할 것인가?
3. **실시간 vs 배치**: 대용량 파일의 경우 백그라운드 진단 필요 여부
4. **진단 범위**: 초기에는 어느 수준까지 진단할 것인가? (스키마만 vs 전체 데이터 스캔)
