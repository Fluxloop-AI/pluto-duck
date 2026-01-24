# Backend File Diagnosis API Implementation Plan

## Overview
CSV/Parquet 파일 import 전 데이터 품질 진단 API를 구현합니다. 스키마 추출, 결측치 분석, 타입 불일치 검출 기능을 제공하여 사용자가 import 전 데이터 상태를 파악할 수 있게 합니다.

## Current State Analysis

### 기존 구현 상태
- **Create Table Flow**: 완전히 구현됨 (`POST /api/v1/asset/files`)
- **File Diagnosis**: 전혀 구현되지 않음

### 재활용 가능한 기존 요소
| 요소 | 위치 | 재활용 방식 |
|------|------|-------------|
| `connect_warehouse()` | `duckdb_utils.py` | 진단 시 DuckDB 연결에 그대로 사용 |
| `read_csv()` / `read_parquet()` | DuckDB 내장 | 스키마 추출 및 데이터 분석에 활용 |
| `get_file_asset_service()` 패턴 | `file_service.py` | 동일한 팩토리 패턴 적용 |
| `AssetValidationError` 등 | `errors.py` | 진단 에러 처리에 재활용 |

### 주요 제약사항
- DuckDB 연결은 `threading.RLock()`으로 직렬화되어야 함
- 대용량 파일 진단 시 타임아웃 고려 필요
- `project_id` 기반 멀티테넌트 격리 유지

## Desired End State

### 목표
1. `POST /api/v1/asset/files/diagnose` 엔드포인트 동작
2. 파일 스키마(컬럼명, 타입, nullable) 추출
3. 결측치(NULL) 개수 컬럼별 집계
4. 타입 불일치 샘플 검출 (예: VARCHAR 컬럼에 숫자만 있는 경우)
5. 진단 결과를 DB에 저장 (선택적, 캐싱용)

### 검증 방법
- 단위 테스트: `FileDiagnosisService` 메서드별 테스트
- 통합 테스트: API 엔드포인트 호출 및 응답 검증
- 수동 테스트: 실제 CSV 파일로 진단 결과 확인

## What We're NOT Doing
- LLM 컨텍스트 연동 (Plan 025에서 구현)
- 프론트엔드 UI (Plan 024에서 구현)
- 대용량 파일 비동기 처리 (추후 개선사항)
- 파일 해시 기반 캐시 무효화 (추후 개선사항)

## Implementation Approach
기존 `FileAssetService` 패턴을 따라 `FileDiagnosisService` 클래스를 생성하고, DuckDB의 `read_csv()`/`read_parquet()` 함수를 활용하여 테이블 생성 없이 파일을 직접 분석합니다.

---

## - [x] Phase 1: 진단 서비스 핵심 로직

### Overview
`FileDiagnosisService` 클래스를 생성하고 스키마 추출, 결측치 분석 기능을 구현합니다.

### Changes Required:

#### 1. 진단 서비스 클래스 생성
**File**: `backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py` (신규)

**Changes**:
- `FileDiagnosis` 데이터 클래스 정의: 진단 결과를 담는 구조체
  - `file_path`, `file_type`, `schema` (컬럼 정보 리스트)
  - `missing_values` (컬럼별 NULL 개수), `row_count`, `file_size_bytes`
  - `type_suggestions` (타입 개선 제안), `diagnosed_at`
- `FileDiagnosisService` 클래스 구현
  - `__init__(self, project_id: str, warehouse_path: Path)` - 기존 서비스와 동일한 초기화 패턴
  - `diagnose_file(self, file_path: str, file_type: str) -> FileDiagnosis` - 단일 파일 진단
  - `diagnose_files(self, files: List[DiagnoseFileRequest]) -> List[FileDiagnosis]` - 복수 파일 진단
- `get_file_diagnosis_service(project_id)` 팩토리 함수

**구현 세부사항**:
- 스키마 추출: `DESCRIBE SELECT * FROM read_csv('{path}', auto_detect=true)`
- 결측치 분석: 각 컬럼에 대해 `SELECT COUNT(*) FROM file WHERE column IS NULL`
- 파일 크기: Python `os.path.getsize()` 사용
- 행 수: `SELECT COUNT(*) FROM read_csv(...)`

#### 2. 에러 클래스 추가
**File**: `backend/pluto_duck_backend/app/services/asset/errors.py`

**Changes**:
- `DiagnosisError` 클래스 추가 (AssetError 상속)
- 파일 접근 실패, 파싱 실패 등의 케이스 처리

### Success Criteria:

#### Automated Verification:
- [x] `pytest backend/tests/services/test_file_diagnosis.py` 통과
- [x] 문법 체크 통과

#### Manual Verification:
- [ ] 샘플 CSV 파일로 `diagnose_file()` 호출 시 올바른 스키마 반환
- [ ] NULL 값이 포함된 CSV에서 결측치 개수 정확히 집계

---

## - [x] Phase 2: API 엔드포인트 구현

### Overview
진단 서비스를 호출하는 REST API 엔드포인트를 추가합니다.

### Changes Required:

#### 1. Request/Response 모델 정의
**File**: `backend/pluto_duck_backend/app/api/v1/asset/router.py`

**Changes**:
- `DiagnoseFileRequest` Pydantic 모델 추가
  - `file_path: str`, `file_type: Literal["csv", "parquet"]`
- `DiagnoseFilesRequest` 모델 추가
  - `files: List[DiagnoseFileRequest]`
- `ColumnSchema` 모델 추가
  - `name: str`, `type: str`, `nullable: bool`
- `FileDiagnosisResponse` 모델 추가
  - `file_path`, `columns`, `missing_values`, `row_count`, `file_size_bytes`, `type_suggestions`, `diagnosed_at`
- `DiagnoseFilesResponse` 모델 추가
  - `diagnoses: List[FileDiagnosisResponse]`

#### 2. 엔드포인트 추가
**File**: `backend/pluto_duck_backend/app/api/v1/asset/router.py`

**Changes**:
- `POST /asset/files/diagnose` 엔드포인트 추가
  - Request: `DiagnoseFilesRequest`
  - Response: `DiagnoseFilesResponse`
  - Query param: `project_id`
- 에러 핸들링: `DiagnosisError` → HTTP 400, 파일 미존재 → HTTP 404

### Success Criteria:

#### Automated Verification:
- [x] API 통합 테스트 통과: `pytest backend/tests/api/test_diagnose_api.py`
- [x] 엔드포인트 동작 확인

#### Manual Verification:
- [ ] `curl -X POST /api/v1/asset/files/diagnose` 호출 시 정상 응답
- [ ] 잘못된 파일 경로 전송 시 적절한 에러 응답

---

## - [x] Phase 3: 타입 불일치 검출 (선택적 고급 기능)

### Overview
VARCHAR로 감지된 컬럼 중 실제로는 숫자/날짜일 수 있는 컬럼을 식별합니다.

### Changes Required:

#### 1. 타입 분석 로직 추가
**File**: `backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py`

**Changes**:
- `_analyze_type_suggestions(self, conn, read_expr, schema)` 메서드 추가
- VARCHAR 컬럼에 대해 샘플링하여 패턴 분석
  - 숫자 패턴: `TRY_CAST(column AS BIGINT/DOUBLE)` 성공률 체크
  - 날짜 패턴: `TRY_CAST(column AS DATE/TIMESTAMP)` 성공률 체크
- 90% 이상 캐스팅 성공 시 타입 제안 반환

#### 2. 샘플링 전략
- 전체 데이터 스캔 대신 LIMIT 1000으로 샘플링
- 대용량 파일 성능 보장

### Success Criteria:

#### Automated Verification:
- [x] 타입 제안 로직 단위 테스트 통과

#### Manual Verification:
- [ ] 숫자가 문자열로 저장된 CSV에서 `INTEGER` 또는 `DOUBLE` 제안 확인
- [ ] 날짜가 문자열로 저장된 CSV에서 `DATE` 또는 `TIMESTAMP` 제안 확인

---

## - [x] Phase 4: 진단 결과 저장 (선택적)

### Overview
진단 결과를 DB에 캐싱하여 재진단 시 빠른 조회를 지원합니다.

### Changes Required:

#### 1. 진단 결과 테이블 생성
**File**: `backend/pluto_duck_backend/app/services/asset/file_diagnosis_service.py`

**Changes**:
- `_ensure_metadata_tables()` 메서드에 `_file_assets.file_diagnoses` 테이블 생성 로직 추가
- 테이블 스키마:
  - `id` (TEXT, PK), `project_id`, `file_path`, `file_type`
  - `schema_info` (JSON), `missing_values` (JSON), `type_suggestions` (JSON)
  - `row_count`, `column_count`, `file_size_bytes`
  - `diagnosed_at` (TIMESTAMP)

#### 2. 저장/조회 로직
**Changes**:
- `save_diagnosis(self, diagnosis: FileDiagnosis) -> str` 메서드 추가
- `get_cached_diagnosis(self, file_path: str) -> Optional[FileDiagnosis]` 메서드 추가
- `delete_cached_diagnosis(self, file_path: str) -> bool` 메서드 추가
- API에 `use_cache: bool = True` 파라미터 추가

### Success Criteria:

#### Automated Verification:
- [x] 저장/조회 단위 테스트 통과

#### Manual Verification:
- [ ] 동일 파일 재진단 시 캐시에서 빠르게 반환 확인
- [ ] `_file_assets.file_diagnoses` 테이블에 데이터 저장 확인

---

## Testing Strategy

### Unit Tests:
- `FileDiagnosisService.diagnose_file()` - 정상 CSV/Parquet 진단
- `FileDiagnosisService.diagnose_file()` - 파일 미존재 에러
- `FileDiagnosisService.diagnose_file()` - 빈 파일 처리
- `_analyze_type_suggestions()` - 타입 제안 정확도

### Integration Tests:
- `POST /api/v1/asset/files/diagnose` - 단일 파일 진단
- `POST /api/v1/asset/files/diagnose` - 복수 파일 진단
- 에러 응답 형식 검증

### Manual Testing Steps:
1. 결측치가 있는 CSV 파일 준비
2. API 호출하여 진단 결과 확인
3. 반환된 `missing_values`가 실제 NULL 개수와 일치하는지 검증
4. 타입 제안이 합리적인지 확인

## Performance Considerations
- **샘플링**: 타입 분석 시 LIMIT 1000으로 제한
- **병렬 처리**: 복수 파일 진단 시 순차 처리 (DuckDB 연결 직렬화 제약)
- **타임아웃**: 대용량 파일 진단 시 30초 타임아웃 설정 고려
- **캐싱**: Phase 4에서 진단 결과 캐싱으로 재진단 성능 개선

## Migration Notes
- 기존 API에 영향 없음 (새 엔드포인트 추가만)
- `_file_assets.file_diagnoses` 테이블은 서비스 초기화 시 자동 생성

---

## References

### Files Read During Planning:
- [file_service.py](backend/pluto_duck_backend/app/services/asset/file_service.py) - FileAssetService 패턴 참고
- [router.py](backend/pluto_duck_backend/app/api/v1/asset/router.py) - API 엔드포인트 패턴 참고
- [duckdb_utils.py](backend/pluto_duck_backend/app/services/duckdb_utils.py) - DuckDB 연결 패턴 참고
- [errors.py](backend/pluto_duck_backend/app/services/asset/errors.py) - 에러 클래스 패턴 참고
- [config.py](backend/pluto_duck_backend/app/core/config.py) - 설정 패턴 참고

### Research Documents:
- [033_create_table_api_and_diagnosis_flow.md](docs/research/033_create_table_api_and_diagnosis_flow.md) - 현재 플로우 분석 및 진단 기능 제안

### External Resources:
- [DuckDB read_csv documentation](https://duckdb.org/docs/data/csv/overview) - CSV 읽기 옵션
- [DuckDB TRY_CAST](https://duckdb.org/docs/sql/functions/cast) - 타입 캐스팅 함수
