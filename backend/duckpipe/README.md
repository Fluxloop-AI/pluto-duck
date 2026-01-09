# duckpipe

**Lightweight SQL Pipeline Engine for DuckDB**

duckpipe는 DuckDB 기반의 경량 SQL 파이프라인 엔진입니다. SQL 분석을 재사용 가능한 Asset으로 저장하고, 의존성을 자동으로 추적하여 올바른 순서로 실행합니다.

## 핵심 특징

- 🔗 **자동 의존성 추출**: SQL에서 참조하는 테이블을 자동으로 파싱
- 📊 **DAG 기반 실행**: 위상 정렬로 올바른 실행 순서 보장
- ⚡ **Freshness 체크**: 변경된 부분만 선택적으로 재실행
- 🔒 **Plan-before-Execute**: 실행 전 계획 검토 (HITL 지원)
- 💾 **YAML 기반 저장**: Git 버전 관리 가능한 Analysis 정의

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                         duckpipe                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │   Pipeline  │───▶│   Compile   │───▶│   Execute   │        │
│  │  (메인 API) │    │  (계획 생성) │    │  (실행)     │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │ FileStore   │    │ SQL Parser  │    │  DuckDB     │        │
│  │ (YAML 저장) │    │ (sqlglot)   │    │ (실행 엔진) │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 저장 구조: Code as File, State as DB

duckpipe는 **"Code as File, State as DB"** 원칙을 따릅니다.

### 저장 방식 요약

| 데이터 | 저장 위치 | 형식 | 이유 |
|--------|----------|------|------|
| **Analysis 정의** (SQL, 파라미터, 태그) | `analyses/{project}/` | YAML 파일 | Git 버전 관리, 수동 편집 가능 |
| **실행 이력/상태** | `_duckpipe.*` 스키마 | DuckDB 테이블 | 빠른 쿼리, 트랜잭션 지원 |

### 전체 스키마 구조

```
DuckDB Warehouse
├── (default)              # 기본 스키마 - 사용자 데이터
│   └── orders, customers, ...
│
├── analysis               # duckpipe 결과물 (Analysis 실행 결과)
│   └── monthly_sales, daily_report, ...
│
├── cache                  # 캐시된 외부 테이블 (SourceService)
│   └── pg_orders_cache, ...
│
├── _sources               # SourceService 메타데이터
│   ├── attached           # ATTACH된 외부 DB 연결 정보
│   └── cached_tables      # 캐시된 테이블 메타데이터
│
└── _duckpipe              # duckpipe 런타임 상태
    ├── run_history        # 모든 Analysis 실행 이력
    └── run_state          # 각 Analysis의 최신 상태 (Freshness용)
```

### 파일 vs 테이블 분리 이유

**YAML 파일로 저장 (Analysis 정의)**
- ✅ Git 버전 관리 가능 → 변경 이력 추적
- ✅ 코드 리뷰 가능 → PR에서 SQL 변경 검토
- ✅ 수동 편집 가능 → IDE에서 직접 수정
- ✅ 프로젝트 간 복사/이동 쉬움

**DuckDB 테이블로 저장 (런타임 상태)**
- ✅ 빠른 쿼리 → Freshness 체크 시 성능
- ✅ 트랜잭션 지원 → 실행 중 상태 일관성
- ✅ 인덱스 최적화 → 대량 이력 조회
- ✅ JOIN 가능 → 복잡한 상태 분석

### 파일 시스템 구조

```
project/
├── warehouse.duckdb           # DuckDB 웨어하우스
│
└── analyses/                  # Analysis YAML 파일들
    └── {project_id}/
        ├── monthly_sales.yaml
        ├── daily_report.yaml
        └── customer_cohort.yaml
```

---

## 폴더 구조

```
duckpipe/
├── __init__.py          # Public API exports
├── errors.py            # 커스텀 예외 클래스
├── README.md            # 이 문서
│
├── core/                # 핵심 로직
│   ├── analysis.py      # Analysis 데이터 모델
│   ├── ref.py           # Ref (의존성 참조) 모델
│   ├── plan.py          # ExecutionPlan, ExecutionStep
│   ├── result.py        # ExecutionResult, StepResult
│   └── pipeline.py      # Pipeline (메인 오케스트레이터)
│
├── parsing/             # SQL 파싱
│   ├── sql.py           # 의존성 추출 (extract_dependencies)
│   └── compiler.py      # SQL 컴파일 (파라미터 바인딩)
│
└── storage/             # 메타데이터 저장
    ├── base.py          # MetadataStore ABC
    └── file_store.py    # FileMetadataStore (YAML)
```

---

## 핵심 개념

### 1. Analysis (분석 정의)

재사용 가능한 SQL 분석 단위입니다.

```python
from duckpipe import Analysis

analysis = Analysis(
    id="monthly_sales",           # 고유 식별자
    name="월별 매출",              # 표시 이름
    sql="SELECT month, SUM(amount) FROM orders GROUP BY 1",
    materialize="table",          # view | table | append | parquet
    tags=["sales", "monthly"],
)
```

**Materialization 옵션:**

| 타입 | 설명 | SQL |
|------|------|-----|
| `view` | 가상 뷰 (매번 계산) | `CREATE OR REPLACE VIEW` |
| `table` | 물리 테이블 (저장) | `CREATE OR REPLACE TABLE` |
| `append` | 기존 테이블에 추가 | `INSERT INTO` |
| `parquet` | Parquet 파일 내보내기 | `COPY TO` |

### 2. Ref (의존성 참조)

Analysis 간의 의존성을 표현합니다.

```python
from duckpipe import Ref, RefType

# 타입별 참조
Ref(RefType.ANALYSIS, "daily_sales")   # → analysis:daily_sales
Ref(RefType.SOURCE, "pg.orders")       # → source:pg.orders
Ref(RefType.FILE, "/data/sales.parquet") # → file:/data/sales.parquet

# 문자열에서 파싱
Ref.parse("analysis:monthly_sales")
Ref.parse("source:postgres_orders")
```

### 3. Pipeline (오케스트레이터)

Analysis 등록, 컴파일, 실행을 관리합니다.

```python
from duckpipe import Pipeline, FileMetadataStore
from pathlib import Path
import duckdb

# 초기화
store = FileMetadataStore(Path("./analyses"))
pipe = Pipeline(store)

# Analysis 등록
pipe.register(analysis)

# 컴파일 (실행 계획 생성)
conn = duckdb.connect("warehouse.duckdb")
plan = pipe.compile("monthly_sales", conn=conn)

# 실행
result = pipe.execute(conn, plan)
```

---

## 동작 원리: 의존성 기반 실행

### 시나리오

```sql
-- Analysis 1: daily_sales
SELECT date, customer_id, SUM(amount) FROM orders GROUP BY 1, 2

-- Analysis 2: customer_segments  
SELECT customer_id, segment FROM customers

-- Analysis 3: sales_by_segment (두 개에 의존!)
SELECT s.date, c.segment, SUM(s.total)
FROM analysis.daily_sales s
JOIN analysis.customer_segments c ON s.customer_id = c.customer_id
GROUP BY 1, 2

-- Analysis 4: final_report
SELECT * FROM analysis.sales_by_segment WHERE total > 1000
```

### 의존성 그래프 (DAG)

```
   daily_sales      customer_segments
        │                   │
        └─────────┬─────────┘
                  ▼
          sales_by_segment
                  │
                  ▼
            final_report
```

### 실행 흐름

```
run("final_report")
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Step 1: 의존성 수집 (재귀적)                              │
│  ─────────────────────────────────                        │
│  final_report                                              │
│    └─ sales_by_segment                                    │
│         ├─ daily_sales                                     │
│         └─ customer_segments                               │
│                                                            │
│  결과: {final_report, sales_by_segment,                   │
│         daily_sales, customer_segments}                    │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Step 2: DAG 구성                                          │
│  ─────────────────                                         │
│  dag = {                                                   │
│    "daily_sales": [],                                      │
│    "customer_segments": [],                                │
│    "sales_by_segment": ["daily_sales", "customer_segments"]│
│    "final_report": ["sales_by_segment"],                  │
│  }                                                         │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Step 3: 위상 정렬 (Topological Sort)                      │
│  ─────────────────────────────────────                    │
│  graphlib.TopologicalSorter 사용                          │
│                                                            │
│  실행 순서:                                                │
│  [daily_sales, customer_segments, sales_by_segment,       │
│   final_report]                                            │
│                                                            │
│  ※ daily_sales와 customer_segments는 순서 무관            │
│    (서로 독립적이므로 병렬 실행 가능)                       │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Step 4: Freshness 체크                                    │
│  ──────────────────────                                   │
│  각 Analysis의 마지막 실행 시간과 의존성 비교:             │
│                                                            │
│  daily_sales:      last_run = 10:00                       │
│  customer_segments: last_run = 09:00 (fresh)              │
│  sales_by_segment:  last_run = 09:30                      │
│    → daily_sales(10:00) > 09:30 → STALE!                  │
│  final_report:      last_run = 09:30                      │
│    → sales_by_segment가 stale → STALE!                    │
│                                                            │
│  결과:                                                     │
│  - daily_sales:       SKIP (이미 실행됨)                   │
│  - customer_segments: SKIP (fresh)                        │
│  - sales_by_segment:  RUN  (의존성 업데이트됨)             │
│  - final_report:      RUN  (target)                       │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Step 5: ExecutionPlan 생성                                │
│  ─────────────────────────                                │
│  ExecutionPlan(                                            │
│    target_id="final_report",                              │
│    steps=[                                                 │
│      ExecutionStep("daily_sales", SKIP, "fresh"),         │
│      ExecutionStep("customer_segments", SKIP, "fresh"),   │
│      ExecutionStep("sales_by_segment", RUN, "stale"),     │
│      ExecutionStep("final_report", RUN, "target"),        │
│    ]                                                       │
│  )                                                         │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Step 6: 실행 (execute)                                    │
│  ───────────────────────                                  │
│  Step 1: daily_sales       → SKIP                         │
│  Step 2: customer_segments → SKIP                         │
│  Step 3: sales_by_segment  → CREATE OR REPLACE TABLE ...  │
│  Step 4: final_report      → CREATE OR REPLACE TABLE ...  │
│                                                            │
│  → ExecutionResult(success=True, step_results=[...])      │
└───────────────────────────────────────────────────────────┘
```

---

## 핵심 코드 상세

### 1. 의존성 자동 추출 (`parsing/sql.py`)

SQL에서 `analysis.*` 또는 `source.*` 테이블 참조를 파싱합니다.

```python
import sqlglot
from sqlglot import exp

def extract_dependencies(sql: str) -> List[Ref]:
    """SQL에서 의존성 추출"""
    parsed = sqlglot.parse_one(sql, dialect="duckdb")
    refs = []
    
    for table in parsed.find_all(exp.Table):
        schema = table.db   # e.g., "analysis"
        name = table.name   # e.g., "daily_sales"
        
        if schema == "analysis":
            refs.append(Ref(RefType.ANALYSIS, name))
        elif schema == "source":
            refs.append(Ref(RefType.SOURCE, name))
    
    return refs
```

**예시:**

```python
sql = """
SELECT s.date, c.segment, SUM(s.total)
FROM analysis.daily_sales s
JOIN analysis.customer_segments c ON s.customer_id = c.customer_id
"""

deps = extract_dependencies(sql)
# [Ref(ANALYSIS, "daily_sales"), Ref(ANALYSIS, "customer_segments")]
```

### 2. 재귀적 의존성 수집 (`core/pipeline.py`)

```python
def _collect_analysis_dependencies(self, analysis_id: str) -> Set[str]:
    """재귀적으로 모든 Analysis 의존성 수집"""
    visited: Set[str] = set()

    def collect(aid: str) -> None:
        if aid in visited:
            return
        visited.add(aid)

        analysis = self.metadata.get(aid)
        if not analysis:
            return

        for ref in analysis.depends_on:
            if ref.type == RefType.ANALYSIS:
                collect(ref.name)

    collect(analysis_id)
    return visited
```

### 3. 위상 정렬 (`core/pipeline.py`)

Python 표준 라이브러리 `graphlib`을 사용합니다.

```python
from graphlib import TopologicalSorter, CycleError

def _topological_sort(self, analysis_ids: Set[str]) -> List[str]:
    """의존성 순서대로 정렬"""
    # DAG 구성
    dag = {}
    for aid in analysis_ids:
        analysis = self.metadata.get(aid)
        deps = [ref.name for ref in analysis.depends_on 
                if ref.type == RefType.ANALYSIS and ref.name in analysis_ids]
        dag[aid] = deps
    
    try:
        sorter = TopologicalSorter(dag)
        return list(sorter.static_order())
    except CycleError as e:
        raise CircularDependencyError(f"순환 의존성: {e.args[1]}")
```

### 4. Freshness 체크 (`core/pipeline.py`)

```python
def _is_stale(self, conn, analysis: Analysis) -> bool:
    """의존성이 더 최신이면 stale"""
    # 내 마지막 실행 시간
    state = conn.execute("""
        SELECT last_run_at FROM _duckpipe.run_state 
        WHERE analysis_id = ?
    """, [analysis.id]).fetchone()
    
    if not state or not state[0]:
        return True  # 한 번도 실행 안 함
    
    my_last_run = state[0]
    
    # 의존성 체크
    for ref in analysis.depends_on:
        if ref.type != RefType.ANALYSIS:
            continue
        
        dep_state = conn.execute("""
            SELECT last_run_at FROM _duckpipe.run_state 
            WHERE analysis_id = ?
        """, [ref.name]).fetchone()
        
        if dep_state and dep_state[0] and dep_state[0] > my_last_run:
            return True  # 의존성이 더 최근에 업데이트됨
    
    return False
```

---

## 순환 의존성 감지

A → B → C → A 같은 순환이 있으면 에러가 발생합니다.

```python
# 순환 의존성 예시
analysis_a.depends_on = [Ref(ANALYSIS, "c")]
analysis_b.depends_on = [Ref(ANALYSIS, "a")]
analysis_c.depends_on = [Ref(ANALYSIS, "b")]

pipe.compile("a")
# CircularDependencyError: 순환 의존성: ['a', 'c', 'b', 'a']
```

---

## 파라미터 바인딩

동적 파라미터를 안전하게 바인딩합니다.

```python
analysis = Analysis(
    id="sales_report",
    sql="SELECT * FROM orders WHERE date >= :start_date AND region = :region",
    parameters=[
        ParameterDef(name="start_date", type="date", required=True),
        ParameterDef(name="region", type="string", default="KR"),
    ],
)

# 실행 시 파라미터 전달
plan = pipe.compile("sales_report", params={
    "start_date": "2024-01-01",
    "region": "US",
})
```

**컴파일 결과:**

```sql
-- 원본
SELECT * FROM orders WHERE date >= :start_date AND region = :region

-- 컴파일 후 (Prepared Statement)
SELECT * FROM orders WHERE date >= $1 AND region = $2
-- bound_params: ["2024-01-01", "US"]
```

---

## 메타데이터 저장 (YAML)

Analysis 정의는 YAML 파일로 저장되어 Git 버전 관리가 가능합니다.

```yaml
# analyses/monthly_sales.yaml
id: monthly_sales
name: 월별 매출
sql: |
  SELECT 
    date_trunc('month', order_date) as month,
    SUM(amount) as total
  FROM analysis.daily_sales
  GROUP BY 1
materialize: table
tags:
  - sales
  - monthly
depends_on:
  - analysis:daily_sales
created_at: 2024-01-15T10:30:00
updated_at: 2024-01-20T14:22:00
```

---

## API 사용 예시

### 기본 사용법

```python
from duckpipe import Pipeline, Analysis, FileMetadataStore
from pathlib import Path
import duckdb

# 1. 초기화
store = FileMetadataStore(Path("./analyses"))
pipe = Pipeline(store)
conn = duckdb.connect("warehouse.duckdb")

# 2. Analysis 등록
pipe.register(Analysis(
    id="base_orders",
    name="기본 주문",
    sql="SELECT * FROM source.raw_orders WHERE status = 'completed'",
    materialize="table",
))

pipe.register(Analysis(
    id="daily_summary",
    name="일별 요약",
    sql="SELECT date, COUNT(*), SUM(amount) FROM analysis.base_orders GROUP BY 1",
    materialize="table",
))

# 3. 실행 (의존성 자동 처리)
result = pipe.run(conn, "daily_summary")

if result.success:
    print("✅ 실행 완료!")
    for step in result.step_results:
        print(f"  {step.analysis_id}: {step.status} ({step.duration_ms}ms)")
```

### Plan-before-Execute (HITL)

```python
# 1. 계획 생성 (실행 안 함)
plan = pipe.compile("daily_summary", conn=conn)

# 2. 계획 검토
print(f"Target: {plan.target_id}")
for step in plan.steps:
    print(f"  {step.analysis_id}: {step.action} - {step.reason}")

# 3. 승인 후 실행
if user_approved:
    result = pipe.execute(conn, plan)
```

---

## 에러 처리

```python
from duckpipe.errors import (
    DuckpipeError,           # 기본 에러
    AnalysisNotFoundError,   # Analysis 없음
    CircularDependencyError, # 순환 의존성
    ExecutionError,          # 실행 실패
    ValidationError,         # 유효성 검사 실패
    ParameterError,          # 파라미터 오류
    CompilationError,        # 컴파일 오류
)

try:
    result = pipe.run(conn, "nonexistent")
except AnalysisNotFoundError as e:
    print(f"Analysis를 찾을 수 없습니다: {e.analysis_id}")
except CircularDependencyError as e:
    print(f"순환 의존성이 감지되었습니다: {e}")
except ExecutionError as e:
    print(f"실행 실패: {e}")
```

---

## 런타임 상태 (DuckDB 테이블)

duckpipe는 `_duckpipe` 스키마에 런타임 상태를 저장합니다.

```sql
-- 실행 이력
CREATE TABLE _duckpipe.run_history (
    run_id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    status TEXT NOT NULL,  -- running, success, failed
    rows_affected BIGINT,
    error TEXT,
    duration_ms INTEGER
);

-- 최신 상태 (Freshness 체크용)
CREATE TABLE _duckpipe.run_state (
    analysis_id TEXT PRIMARY KEY,
    last_run_id TEXT,
    last_run_at TIMESTAMP,
    last_run_status TEXT,
    last_run_error TEXT
);
```

---

## 라이선스

MIT License - Pluto Duck 프로젝트의 일부입니다.

