# LLM Context Integration Implementation Plan

## Overview
파일 진단 결과를 LLM 에이전트가 활용할 수 있도록 컨텍스트 연동을 구현합니다. 에이전트가 데이터 품질 이슈를 인지하고 더 정확한 SQL 생성 및 분석 제안을 할 수 있게 합니다.

## Current State Analysis

### 기존 컨텍스트 제공 방식
| 방식 | 설명 | 위치 |
|------|------|------|
| **스키마 도구** | `list_tables`, `describe_table`, `sample_rows` 온디맨드 조회 | `schema.py` |
| **context_assets** | 사용자 @ 멘션 시 XML 블록으로 메시지에 주입 | `orchestrator.py:184-189` |
| **장기 메모리** | `/memories/user/agent.md`, `/memories/projects/{id}/agent.md` | `memory.py` middleware |
| **대화 히스토리** | 전체 메시지 히스토리를 매 턴마다 전달 | `orchestrator.py:163-189` |

### 진단 정보가 필요한 시나리오
1. **데이터 분석 시**: "이 테이블 분석해줘" → 결측치/타입 이슈 알림
2. **SQL 생성 시**: VARCHAR로 저장된 숫자 컬럼 → 캐스팅 제안
3. **ETL 파이프라인 작성 시**: 데이터 정제 단계 자동 포함
4. **데이터 품질 리포트**: 진단 결과 요약 제공

## Desired End State

### 목표
1. 에이전트가 테이블의 진단 정보에 접근 가능
2. @ 멘션 시 관련 진단 정보가 컨텍스트에 포함
3. 데이터 품질 이슈 인지 후 적절한 SQL/분석 제안
4. 진단 결과 요약을 장기 메모리에 저장 가능

### 검증 방법
- "이 테이블에 문제가 있어?" 질문 시 진단 정보 기반 답변
- SQL 생성 시 타입 캐스팅이 필요한 컬럼 자동 처리
- 데이터 품질 리포트 요청 시 진단 결과 활용

## What We're NOT Doing
- 실시간 데이터 품질 모니터링
- 자동 데이터 정제 실행 (제안만)
- 진단 결과 기반 자동 스키마 변경

## Implementation Approach
3가지 통합 방식을 조합하여 구현합니다:
1. **새 도구**: `get_table_diagnosis` - 온디맨드 진단 정보 조회
2. **컨텍스트 주입**: @ 멘션 시 진단 요약 자동 포함
3. **프롬프트 가이드**: 진단 정보 활용 방법 안내

---

## - [ ] Phase 1: 진단 정보 조회 도구

### Overview
에이전트가 테이블의 진단 정보를 직접 조회할 수 있는 도구를 추가합니다.

### Changes Required:

#### 1. 진단 조회 도구 함수 생성
**File**: `backend/pluto_duck_backend/agent/core/deep/tools/schema.py`

**Changes**:
- `get_table_diagnosis(table: str, schema: str = "main")` 함수 추가
- 동작:
  1. 테이블명으로 `_file_assets.files`에서 `file_id` 조회
  2. `FileDiagnosisService.get_cached_diagnosis()` 호출
  3. 진단 결과를 dict로 반환 (스키마, 결측치, 타입 제안)
  4. 캐시 없으면 실시간 진단 실행 또는 "진단 정보 없음" 반환
- 반환 형식:
  - `schema`: 컬럼 정보 리스트
  - `missing_values`: 결측치가 있는 컬럼과 개수
  - `type_suggestions`: 타입 개선 제안
  - `row_count`, `diagnosed_at`

#### 2. 도구 빌더에 추가
**File**: `backend/pluto_duck_backend/agent/core/deep/tools/__init__.py`

**Changes**:
- `build_schema_tools()`에 `get_table_diagnosis` 도구 추가
- 도구 설명: "Get data quality diagnosis for a table including missing values, type issues, and improvement suggestions"

#### 3. 프롬프트에 도구 안내 추가
**File**: `backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md`

**Changes**:
- 도구 설명 섹션에 `get_table_diagnosis` 추가
- 사용 가이드: "데이터 분석 전 진단 정보를 확인하여 품질 이슈를 파악하세요"

### Success Criteria:

#### Automated Verification:
- [ ] 도구 함수 단위 테스트 통과
- [ ] 에이전트에서 도구 호출 가능 확인

#### Manual Verification:
- [ ] "테이블 진단 정보 알려줘" 질문 시 진단 결과 반환
- [ ] 진단 정보가 없는 테이블에 대해 적절한 응답

---

## - [ ] Phase 2: @ 멘션 시 진단 컨텍스트 주입

### Overview
사용자가 파일 에셋을 @ 멘션할 때 진단 요약을 자동으로 컨텍스트에 포함합니다.

### Changes Required:

#### 1. 컨텍스트 빌더 확장
**File**: `backend/pluto_duck_backend/agent/core/orchestrator.py`

**Changes**:
- `_build_context_assets_block()` 함수 추가 또는 기존 컨텍스트 주입 로직 확장
- `context_assets`에 `@file_assets/table_name` 형태의 멘션이 있으면:
  1. 해당 테이블의 진단 정보 조회
  2. 진단 요약을 컨텍스트 블록에 추가
- XML 형식 예시:
  ```xml
  <context_assets>
    <file_asset name="sales_data">
      <diagnosis>
        <issues>
          - Column 'price': 15 missing values (2.3%)
          - Column 'date': Stored as VARCHAR, could be DATE
        </issues>
      </diagnosis>
    </file_asset>
  </context_assets>
  ```

#### 2. 진단 요약 포맷터
**File**: `backend/pluto_duck_backend/agent/core/orchestrator.py` (또는 별도 유틸)

**Changes**:
- `format_diagnosis_summary(diagnosis: FileDiagnosis) -> str` 함수 추가
- 간결한 텍스트 형식으로 진단 결과 포맷팅
- 이슈가 없으면 "No data quality issues detected" 반환

### Success Criteria:

#### Automated Verification:
- [ ] 컨텍스트 주입 로직 단위 테스트 통과

#### Manual Verification:
- [ ] @file_assets/table 멘션 시 진단 정보가 컨텍스트에 포함됨
- [ ] 에이전트가 진단 정보를 인지하고 응답에 반영

---

## - [ ] Phase 3: 프롬프트 엔지니어링

### Overview
에이전트가 진단 정보를 효과적으로 활용하도록 시스템 프롬프트를 개선합니다.

### Changes Required:

#### 1. 진단 활용 가이드 추가
**File**: `backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md`

**Changes**:
- "Data Quality Awareness" 섹션 추가:
  ```markdown
  ## Data Quality Awareness

  When working with file assets (imported CSV/Parquet files):

  1. **Check diagnosis first**: Use `get_table_diagnosis` before complex analysis
  2. **Handle missing values**:
     - Mention the issue to the user
     - Use COALESCE or IFNULL in SQL when appropriate
  3. **Type suggestions**:
     - If a VARCHAR column should be numeric, use TRY_CAST
     - Suggest schema improvements when relevant
  4. **Context blocks**:
     - If <context_assets> contains diagnosis info, incorporate it
  ```

#### 2. SQL 생성 가이드라인 강화
**Changes**:
- SQL 생성 시 진단 정보 활용 예시 추가
- 타입 캐스팅 패턴 안내
- 결측치 처리 패턴 안내

### Success Criteria:

#### Manual Verification:
- [ ] 에이전트가 진단 정보를 언급하며 분석 제안
- [ ] SQL 생성 시 타입 이슈 자동 처리 (캐스팅 포함)
- [ ] 결측치 경고 및 처리 방법 제안

---

## - [ ] Phase 4: 프로젝트 메모리 통합 (선택적)

### Overview
진단 요약을 프로젝트 메모리에 저장하여 장기적으로 활용할 수 있게 합니다.

### Changes Required:

#### 1. 진단 요약 메모리 섹션
**File**: 프로젝트 메모리 구조 (`/memories/projects/{id}/agent.md`)

**Changes**:
- 메모리 파일에 "Data Quality Notes" 섹션 자동 추가 패턴 정의
- 형식 예시:
  ```markdown
  ## Data Quality Notes

  ### sales_data (imported 2026-01-23)
  - 15 missing values in 'price' column
  - 'date' column: consider converting to DATE type

  ### customers (imported 2026-01-22)
  - No issues detected
  ```

#### 2. 자동 업데이트 로직
**File**: `backend/pluto_duck_backend/agent/core/deep/middleware/memory.py` 또는 별도 유틸

**Changes**:
- 파일 import 시 진단 요약을 프로젝트 메모리에 추가하는 옵션
- 기존 진단 정보 업데이트 로직
- 에이전트가 메모리 섹션을 읽어 장기적으로 품질 이슈 인지

### Success Criteria:

#### Manual Verification:
- [ ] 파일 import 후 프로젝트 메모리에 진단 요약 저장 확인
- [ ] 다음 대화에서 에이전트가 저장된 진단 정보 참조

---

## Testing Strategy

### Unit Tests:
- `get_table_diagnosis` 도구 함수 테스트
- `format_diagnosis_summary` 포맷터 테스트
- 컨텍스트 주입 로직 테스트

### Integration Tests:
- 에이전트 대화에서 진단 도구 호출 테스트
- @ 멘션 시 컨텍스트 포함 테스트

### Manual Testing Steps:
1. 결측치가 있는 CSV import
2. 에이전트에게 "이 테이블 분석해줘" 요청
3. 진단 정보가 응답에 반영되는지 확인
4. SQL 생성 시 타입 캐스팅이 포함되는지 확인
5. @ 멘션 시 컨텍스트에 진단 정보 포함 확인

## Performance Considerations
- 진단 정보 조회는 캐시 우선 (Phase 4 of Plan 023)
- @ 멘션 시 진단 요약은 간결하게 유지 (토큰 절약)
- 대량 테이블 멘션 시 요약 생략 옵션

## Migration Notes
- 기존 에이전트 동작에 영향 없음 (도구 추가만)
- 프로젝트 메모리 형식은 하위 호환 유지
- 프롬프트 변경은 점진적으로 적용

---

## References

### Files Read During Planning:
- [orchestrator.py](backend/pluto_duck_backend/agent/core/orchestrator.py) - 컨텍스트 주입 패턴
- [schema.py](backend/pluto_duck_backend/agent/core/deep/tools/schema.py) - 스키마 도구 패턴
- [memory.py](backend/pluto_duck_backend/agent/core/deep/middleware/memory.py) - 메모리 미들웨어
- [default_agent_prompt.md](backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md) - 시스템 프롬프트
- [__init__.py](backend/pluto_duck_backend/agent/core/deep/tools/__init__.py) - 도구 빌더

### Research Documents:
- [033_create_table_api_and_diagnosis_flow.md](docs/research/033_create_table_api_and_diagnosis_flow.md) - 진단 기능 요구사항

### Related Plans:
- [023_backend_file_diagnosis_api.md](docs/plans/023_backend_file_diagnosis_api.md) - 백엔드 진단 API (선행 필수)
- [024_frontend_diagnosis_ux.md](docs/plans/024_frontend_diagnosis_ux.md) - 프론트엔드 진단 UX

### External Resources:
- [LangChain Tool Documentation](https://python.langchain.com/docs/modules/tools/) - 도구 정의 패턴
- [deepagents library](https://github.com/anthropics/deepagents) - 에이전트 프레임워크
