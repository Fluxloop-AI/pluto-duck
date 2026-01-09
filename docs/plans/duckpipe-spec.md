# duckpipe: Lightweight SQL Pipeline Engine for DuckDB

작성일: 2026-01-08  
상태: Draft (v3 - Ref Model, Safe Binding, Plan/Execute 분리)  
관련: `docs/Pluto_Duck_new_flow.md`

---

## 1. 개요

### 정의

`duckpipe`는 DuckDB 기반의 **경량 SQL 파이프라인 엔진**입니다.  
dbt의 핵심 개념(DAG, materialization, freshness)을 차용하되, **로컬 환경에 최적화**된 단순한 구현을 목표로 합니다.

### 핵심 철학

- **Minimal**: dbt의 20% 기능으로 80% 유스케이스 커버
- **DuckDB-native**: DuckDB만 지원, 다른 adapter 없음
- **Embedded-first**: 독립 CLI 없이, 라이브러리로만 동작
- **Code as File, State as DB**: 정의(코드)는 파일, 실행 상태만 DB에 저장
- **Connection Injection**: DB 연결은 외부에서 주입받아 동시성 문제 회피
- **Typed Ref Model**: 의존성을 명확한 타입으로 구분 (analysis/source/file)
- **Plan before Execute**: 실행 전 계획을 먼저 생성, HITL/Agent 연동 용이

### Pluto Duck과의 관계

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PLUTO DUCK                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│  │  Agent  │  │   API   │  │   UI    │  │  HITL   │               │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘               │
│       │            │            │            │                      │
│       └────────────┼────────────┴────────────┘                      │
│                    │                                                │
│            ┌───────▼───────┐                                        │
│            │ Asset Service │ ◄─── DB Connection Pool 관리           │
│            └───────┬───────┘                                        │
│                    │                                                │
│            ┌───────▼───────┐                                        │
│            │   compile()   │ ──→ Plan (검토/승인 가능)              │
│            └───────┬───────┘                                        │
│                    │ HITL 승인 후                                   │
│            ┌───────▼───────┐                                        │
│            │   execute()   │ ──→ 실제 DB 변경                       │
│            └───────────────┘                                        │
└─────────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DUCKPIPE                                     │
│                    (내부 라이브러리)                                  │
│                                                                      │
│  ┌────────────────────────┐    ┌────────────────────────┐          │
│  │   FileMetadataStore    │    │       Pipeline          │          │
│  │  (YAML 파일 기반)       │    │                         │          │
│  │                        │    │  compile() → Plan       │          │
│  │  analyses/             │───▶│  execute(Plan) → Result │          │
│  │  ├── model_a.yaml      │    │                         │          │
│  │  └── model_b.yaml      │    └────────────────────────┘          │
│  └────────────────────────┘                                         │
│                                                                      │
│  [DuckDB 내부: _duckpipe 스키마 - 실행 상태만]                       │
│  ├── run_history                                                    │
│  └── run_state                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 핵심 설계 원칙

### 2.1. Code as File, State as DB

**문제**: SQL 로직(코드)을 DuckDB 내부에 저장하면:
- Git 버전 관리 불가
- DB 파손 시 로직까지 손실
- 이식성 부족

**해결**: 저장소 이원화

| 구분 | 저장 위치 | 예시 |
|------|-----------|------|
| **정의 (Code)** | 파일 시스템 (YAML + SQL) | `~/.pluto-duck/analyses/monthly_revenue.yaml` |
| **실행 상태 (State)** | DuckDB `_duckpipe` 스키마 | `run_history`, `run_state` 테이블 |

### 2.2. Connection Injection

**문제**: duckpipe가 자체적으로 `duckdb.connect()`를 호출하면:
- DuckDB의 단일 Writer 제약으로 락 충돌
- 웹 서버 환경에서 Connection Pool 관리 불가

**해결**: Connection을 외부에서 주입

```python
# ❌ Bad: duckpipe가 직접 연결
pipe = Pipeline(warehouse_path="...")
pipe.run("monthly_revenue")

# ✅ Good: 호출자가 연결 주입
conn = connection_pool.acquire()  # Pluto Duck이 관리
plan = pipe.compile("monthly_revenue")
result = pipe.execute(conn, plan)
conn.release()
```

### 2.3. Typed Ref Model (v3 신규)

**문제**: 의존성이 그냥 문자열이면:
- `depends_on: ["a"]`가 Analysis ID인지, 테이블명인지 모호
- SQL의 `FROM analysis.a`와 `depends_on: ["a"]`가 불일치
- 자동 의존성 추출 결과를 신뢰할 수 없음

**해결**: 의존성을 **타입 접두사**로 구분

| Ref 타입 | 형식 | 예시 | 설명 |
|----------|------|------|------|
| `analysis` | `analysis:<id>` | `analysis:monthly_revenue` | 다른 Analysis 참조 |
| `source` | `source:<schema>.<table>` | `source:pg.orders` | 외부 데이터 소스 |
| `file` | `file:<path>` | `file:/data/sales.parquet` | 로컬 파일 |

**규칙**:
1. Analysis 결과는 **반드시 `analysis.<id>`** 스키마에 물질화
2. SQL에서 다른 Analysis 참조 시 **`analysis.<id>`** 형태로 작성
3. 의존성 자동 추출 시 `analysis.*` 테이블은 → `analysis:*` ref로 변환

```yaml
# 예시: monthly_revenue.yaml
id: monthly_revenue
name: 월별 매출

sql: |
  SELECT date_trunc('month', order_date) as month,
         sum(amount) as revenue
  FROM source.pg_orders           -- 외부 소스
  JOIN analysis.customer_segments -- 다른 Analysis 참조 (analysis.<id>)
  ON ...

# 자동 추출된 의존성 (저장 시 계산)
depends_on:
  - source:pg.orders
  - analysis:customer_segments
```

### 2.4. Safe Parameter Binding (v3 신규)

**문제**: 정규식 기반 `:param` 치환은:
- 문자열 리터럴 내부 오탐 (`'contains :param'`)
- 주석 내부 오탐 (`-- :param`)
- `::` 타입 캐스팅과 혼동 (`value::int`)
- SQL Injection 위험

**해결**: 2단계 파라미터 바인딩

```python
# 1단계: compile() - SQL 파싱 후 파라미터 위치 식별
#    - sqlglot으로 AST 파싱
#    - Placeholder 노드만 추출 (문자열/주석 내부 제외)
#    - 순서 보존 리스트 생성

# 2단계: execute() - DuckDB prepared statement 사용
#    - :name → $1, $2, ... 로 변환
#    - conn.execute(sql, params) 형태로 안전한 바인딩
```

**지원 타입**:

| 타입 | Python | SQL 변환 |
|------|--------|----------|
| `string` | `str` | `'escaped_value'` |
| `int` | `int` | `123` |
| `float` | `float` | `123.45` |
| `date` | `str` / `date` | `DATE '2025-01-01'` |
| `datetime` | `str` / `datetime` | `TIMESTAMP '2025-01-01 00:00:00'` |
| `list` | `List[T]` | `(v1, v2, v3)` (IN 절용) |
| `null` | `None` | `NULL` |

### 2.5. Plan before Execute (v3 신규)

**문제**: 바로 `run()`하면:
- Agent가 "뭘 하려는지" 설명 불가
- HITL 승인 전에 side-effect 예측 불가
- 실행 취소/롤백 전략 세우기 어려움

**해결**: `compile()` → `execute()` 2단계 분리

```python
# 1. 계획 생성 (DB 변경 없음)
plan = pipe.compile("revenue_dashboard", params={"year": 2025})

# 2. 계획 검토 (Agent/HITL에서 활용)
print(plan.summary())
# """
# Execution Plan for 'revenue_dashboard':
#   1. [SKIP]  analysis:monthly_revenue (already fresh)
#   2. [RUN]   analysis:customer_ltv (stale: dependency updated)
#   3. [RUN]   analysis:revenue_dashboard (target)
# 
# Side Effects:
#   - CREATE OR REPLACE TABLE analysis.customer_ltv
#   - CREATE OR REPLACE TABLE analysis.revenue_dashboard
# """

# 3. 승인 후 실행
if approved:
    result = pipe.execute(conn, plan)
```

### 2.6. Materialization 전략

| 전략 | SQL | 용도 |
|------|-----|------|
| `view` | `CREATE OR REPLACE VIEW analysis.<id> AS` | 가벼운 변환, 항상 최신 |
| `table` | `CREATE OR REPLACE TABLE analysis.<id> AS` | 무거운 연산, 전체 갱신 |
| `append` | `INSERT INTO analysis.<id> SELECT ...` | 증분 적재 (로그, 이벤트) |
| `parquet` | `COPY (...) TO '<path>' (FORMAT PARQUET)` | 파일 export |

---

## 3. 데이터 모델

### 3.1. Analysis 정의 (YAML 파일)

```yaml
# ~/.pluto-duck/analyses/monthly_revenue.yaml

id: monthly_revenue
name: 월별 매출
description: 주문 테이블에서 월별 매출 집계

sql: |
  SELECT date_trunc('month', order_date) as month,
         sum(amount) as revenue
  FROM source.pg_orders
  WHERE order_date >= :start_date
  GROUP BY 1

materialize: table
# result_table은 자동: analysis.monthly_revenue

# 파라미터 정의 (선택)
parameters:
  start_date:
    type: date
    default: "2020-01-01"
    description: 집계 시작일

# 메타데이터
tags:
  - revenue
  - monthly

created_at: 2026-01-08T10:00:00
updated_at: 2026-01-08T10:00:00

# 의존성 (자동 추출, 명시도 가능)
depends_on:
  - source:pg.orders
```

### 3.2. Ref (의존성 참조)

```python
from dataclasses import dataclass
from enum import Enum

class RefType(Enum):
    ANALYSIS = "analysis"   # 다른 Analysis
    SOURCE = "source"       # 외부 데이터 소스
    FILE = "file"           # 로컬 파일

@dataclass(frozen=True)
class Ref:
    """타입화된 의존성 참조"""
    type: RefType
    name: str  # analysis:foo → "foo", source:pg.orders → "pg.orders"
    
    @classmethod
    def parse(cls, ref_str: str) -> "Ref":
        """문자열에서 Ref 파싱"""
        if ":" not in ref_str:
            # 레거시 호환: 타입 없으면 analysis로 추정
            return cls(RefType.ANALYSIS, ref_str)
        
        type_str, name = ref_str.split(":", 1)
        ref_type = RefType(type_str)
        return cls(ref_type, name)
    
    def __str__(self) -> str:
        return f"{self.type.value}:{self.name}"
    
    def to_table_name(self) -> str:
        """SQL에서 사용할 테이블명 반환"""
        if self.type == RefType.ANALYSIS:
            return f"analysis.{self.name}"
        elif self.type == RefType.SOURCE:
            return f"source.{self.name.replace('.', '_')}"
        elif self.type == RefType.FILE:
            return f"read_parquet('{self.name}')"
        raise ValueError(f"Unknown ref type: {self.type}")
```

### 3.3. Analysis

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any

@dataclass
class ParameterDef:
    """파라미터 정의"""
    name: str
    type: str = "string"  # string | int | float | date | datetime | list
    default: Optional[Any] = None
    description: Optional[str] = None

@dataclass
class Analysis:
    """Analysis 정의 (파일에서 로드)"""
    id: str
    name: str
    sql: str
    materialize: str = "table"  # view | table | append | parquet
    
    description: Optional[str] = None
    parameters: List[ParameterDef] = field(default_factory=list)
    depends_on: List[Ref] = field(default_factory=list)  # Typed refs
    tags: List[str] = field(default_factory=list)
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    @property
    def result_table(self) -> str:
        """결과 테이블명 (항상 analysis.<id>)"""
        return f"analysis.{self.id}"
    
    def get_analysis_dependencies(self) -> List[str]:
        """Analysis 타입 의존성만 추출"""
        return [ref.name for ref in self.depends_on if ref.type == RefType.ANALYSIS]
```

### 3.4. ExecutionPlan (v3 신규)

```python
from dataclasses import dataclass, field
from enum import Enum

class StepAction(Enum):
    RUN = "run"       # 실행 필요
    SKIP = "skip"     # 이미 fresh
    FAIL = "fail"     # 의존성 실패로 스킵

@dataclass
class ExecutionStep:
    """실행 계획의 단일 단계"""
    analysis_id: str
    action: StepAction
    reason: str
    
    # 실행될 SQL (action=RUN인 경우)
    compiled_sql: Optional[str] = None
    bound_params: Optional[List[Any]] = None
    
    # Side effects
    target_table: Optional[str] = None
    operation: Optional[str] = None  # CREATE VIEW | CREATE TABLE | INSERT | COPY

@dataclass
class ExecutionPlan:
    """전체 실행 계획"""
    target_id: str
    steps: List[ExecutionStep] = field(default_factory=list)
    params: Dict[str, Any] = field(default_factory=dict)
    
    created_at: datetime = field(default_factory=datetime.now)
    
    def summary(self) -> str:
        """사람이 읽을 수 있는 요약"""
        lines = [f"Execution Plan for '{self.target_id}':"]
        
        for i, step in enumerate(self.steps, 1):
            action_str = f"[{step.action.value.upper()}]".ljust(8)
            lines.append(f"  {i}. {action_str} analysis:{step.analysis_id} ({step.reason})")
        
        lines.append("")
        lines.append("Side Effects:")
        for step in self.steps:
            if step.action == StepAction.RUN and step.target_table:
                lines.append(f"  - {step.operation} {step.target_table}")
        
        return "\n".join(lines)
    
    def get_runnable_steps(self) -> List[ExecutionStep]:
        """실행할 step만 필터"""
        return [s for s in self.steps if s.action == StepAction.RUN]
    
    def will_modify_tables(self) -> List[str]:
        """변경될 테이블 목록"""
        return [s.target_table for s in self.steps 
                if s.action == StepAction.RUN and s.target_table]

@dataclass
class ExecutionResult:
    """실행 결과"""
    plan: ExecutionPlan
    success: bool
    step_results: List["StepResult"] = field(default_factory=list)
    
    @property
    def failed_step(self) -> Optional["StepResult"]:
        for r in self.step_results:
            if r.status == "failed":
                return r
        return None

@dataclass
class StepResult:
    """단일 step 실행 결과"""
    run_id: str
    analysis_id: str
    status: str  # success | failed | skipped
    started_at: datetime
    finished_at: Optional[datetime] = None
    rows_affected: Optional[int] = None
    error: Optional[str] = None
    duration_ms: Optional[int] = None
```

---

## 4. 저장소 설계

### 4.1. 파일 시스템 구조

```
~/.pluto-duck/
├── warehouse.duckdb           # 메인 데이터 웨어하우스
│
└── analyses/                  # Analysis 정의 디렉토리
    ├── monthly_revenue.yaml
    ├── customer_ltv.yaml
    └── revenue_dashboard.yaml
```

### 4.2. DuckDB 스키마

```sql
-- 분석 결과 저장 스키마 (Analysis 물질화 대상)
CREATE SCHEMA IF NOT EXISTS analysis;

-- 외부 소스 매핑 스키마 (ATTACH된 DB의 뷰)
CREATE SCHEMA IF NOT EXISTS source;

-- duckpipe 런타임 상태 스키마
CREATE SCHEMA IF NOT EXISTS _duckpipe;

-- 실행 이력
CREATE TABLE IF NOT EXISTS _duckpipe.run_history (
    run_id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    status TEXT NOT NULL,            -- pending | running | success | failed | skipped
    rows_affected BIGINT,
    error TEXT,
    duration_ms INTEGER,
    params JSON                      -- 실행 시 사용된 파라미터
);

-- 실행 상태 (Analysis별 최신 상태)
CREATE TABLE IF NOT EXISTS _duckpipe.run_state (
    analysis_id TEXT PRIMARY KEY,
    last_run_id TEXT,
    last_run_at TIMESTAMP,
    last_run_status TEXT,
    last_run_error TEXT
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_run_history_analysis 
ON _duckpipe.run_history(analysis_id, started_at DESC);
```

---

## 5. Pipeline API

### 5.1. 기본 사용법

```python
from duckpipe import Pipeline, Analysis, FileMetadataStore, Ref, RefType
from pathlib import Path
import duckdb

# 초기화
metadata_store = FileMetadataStore(Path("~/.pluto-duck/analyses").expanduser())
pipe = Pipeline(metadata_store)

# Analysis 등록
pipe.register(Analysis(
    id="monthly_revenue",
    name="월별 매출",
    sql="""
        SELECT date_trunc('month', order_date) as month,
               sum(amount) as revenue
        FROM source.pg_orders
        WHERE order_date >= :start_date
        GROUP BY 1
    """,
    materialize="table",
    parameters=[
        ParameterDef(name="start_date", type="date", default="2020-01-01")
    ]
    # depends_on은 자동 추출됨
))

# 1. 계획 생성 (DB 연결 불필요)
plan = pipe.compile("monthly_revenue", params={"start_date": "2025-01-01"})

# 2. 계획 검토
print(plan.summary())
print(f"Will modify: {plan.will_modify_tables()}")

# 3. 실행 (Connection 주입)
conn = duckdb.connect("~/.pluto-duck/warehouse.duckdb")
try:
    result = pipe.execute(conn, plan)
    
    if result.success:
        print(f"Success! {len(result.step_results)} steps completed")
    else:
        print(f"Failed at: {result.failed_step.analysis_id}")
        print(f"Error: {result.failed_step.error}")
finally:
    conn.close()

# 편의 메서드: compile + execute 한번에 (force 실행)
result = pipe.run(conn, "monthly_revenue", params={...}, force=True)
```

### 5.2. Pipeline 클래스

```python
from uuid import uuid4
from graphlib import TopologicalSorter, CycleError
from duckpipe.parsing import extract_dependencies, compile_sql
from duckpipe.errors import DuckpipeError, AnalysisNotFoundError, CircularDependencyError

class Pipeline:
    def __init__(self, metadata_store: MetadataStore):
        self.metadata = metadata_store
        self._dag_cache: Optional[Dict[str, List[Ref]]] = None
    
    # ─────────────────────────────────────────────────
    # Registration
    # ─────────────────────────────────────────────────
    
    def register(self, analysis: Analysis) -> None:
        """Analysis 등록/수정"""
        # 의존성 자동 추출 (비어있으면)
        if not analysis.depends_on:
            analysis.depends_on = extract_dependencies(analysis.sql)
        
        # ID 유효성 검증
        validate_identifier(analysis.id)
        
        # 시간 설정
        if not analysis.created_at:
            analysis.created_at = datetime.now()
        analysis.updated_at = datetime.now()
        
        self.metadata.save(analysis)
        self._invalidate_dag_cache()
    
    def get(self, analysis_id: str) -> Optional[Analysis]:
        return self.metadata.get(analysis_id)
    
    def list_all(self) -> List[Analysis]:
        return self.metadata.list_all()
    
    def delete(self, analysis_id: str) -> None:
        self.metadata.delete(analysis_id)
        self._invalidate_dag_cache()
    
    # ─────────────────────────────────────────────────
    # Compile (Plan 생성) - DB 연결 필요 없음 for freshness 외
    # ─────────────────────────────────────────────────
    
    def compile(
        self,
        analysis_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        force: bool = False,
        conn: Optional[duckdb.DuckDBPyConnection] = None,  # freshness 체크용
    ) -> ExecutionPlan:
        """
        실행 계획 생성.
        conn이 주어지면 freshness 체크, 없으면 모두 RUN으로 계획.
        """
        analysis = self.metadata.get(analysis_id)
        if not analysis:
            raise AnalysisNotFoundError(f"Analysis '{analysis_id}' not found")
        
        # 의존성 수집 (Analysis 타입만)
        all_analysis_ids = self._collect_analysis_dependencies(analysis_id)
        
        # 위상 정렬
        execution_order = self._topological_sort(all_analysis_ids)
        
        # 각 step 생성
        steps = []
        for aid in execution_order:
            a = self.metadata.get(aid)
            if not a:
                continue
            
            # Freshness 판정
            if force:
                action = StepAction.RUN
                reason = "forced"
            elif conn and not self._is_stale(conn, a):
                action = StepAction.SKIP
                reason = "already fresh"
            else:
                action = StepAction.RUN
                reason = "stale" if conn else "no freshness check"
            
            # SQL 컴파일
            compiled_sql = None
            bound_params = None
            operation = None
            
            if action == StepAction.RUN:
                # 해당 analysis의 파라미터만 적용 (target만 params 받음)
                step_params = params if aid == analysis_id else None
                compiled_sql, bound_params = compile_sql(
                    a.sql, 
                    a.materialize, 
                    a.result_table,
                    step_params
                )
                operation = self._get_operation_name(a.materialize)
            
            steps.append(ExecutionStep(
                analysis_id=aid,
                action=action,
                reason=reason,
                compiled_sql=compiled_sql,
                bound_params=bound_params,
                target_table=a.result_table if action == StepAction.RUN else None,
                operation=operation,
            ))
        
        return ExecutionPlan(
            target_id=analysis_id,
            steps=steps,
            params=params or {},
        )
    
    def _get_operation_name(self, materialize: str) -> str:
        return {
            "view": "CREATE OR REPLACE VIEW",
            "table": "CREATE OR REPLACE TABLE",
            "append": "INSERT INTO",
            "parquet": "COPY TO FILE",
        }.get(materialize, "UNKNOWN")
    
    # ─────────────────────────────────────────────────
    # Execute (Plan 실행)
    # ─────────────────────────────────────────────────
    
    def execute(
        self,
        conn: duckdb.DuckDBPyConnection,
        plan: ExecutionPlan,
    ) -> ExecutionResult:
        """
        실행 계획 수행.
        """
        # 런타임 스키마 보장
        self._ensure_runtime_schema(conn)
        self._ensure_analysis_schema(conn)
        
        step_results = []
        success = True
        
        for step in plan.steps:
            if step.action == StepAction.SKIP:
                step_results.append(StepResult(
                    run_id=str(uuid4()),
                    analysis_id=step.analysis_id,
                    status="skipped",
                    started_at=datetime.now(),
                ))
                continue
            
            if step.action == StepAction.FAIL:
                step_results.append(StepResult(
                    run_id=str(uuid4()),
                    analysis_id=step.analysis_id,
                    status="skipped",
                    started_at=datetime.now(),
                    error=step.reason,
                ))
                continue
            
            # RUN
            result = self._execute_step(conn, step)
            step_results.append(result)
            
            if result.status == "failed":
                success = False
                # 이후 step들을 FAIL로 마킹
                break
        
        return ExecutionResult(
            plan=plan,
            success=success,
            step_results=step_results,
        )
    
    def _execute_step(
        self,
        conn: duckdb.DuckDBPyConnection,
        step: ExecutionStep,
    ) -> StepResult:
        """단일 step 실행"""
        run_id = str(uuid4())
        started_at = datetime.now()
        
        # 실행 시작 기록
        conn.execute("""
            INSERT INTO _duckpipe.run_history (run_id, analysis_id, started_at, status)
            VALUES (?, ?, ?, 'running')
        """, [run_id, step.analysis_id, started_at])
        
        try:
            # Prepared statement로 안전하게 실행
            if step.bound_params:
                conn.execute(step.compiled_sql, step.bound_params)
            else:
                conn.execute(step.compiled_sql)
            
            # 행 수 조회 (table/append인 경우)
            rows_affected = None
            if step.operation in ("CREATE OR REPLACE TABLE", "INSERT INTO"):
                try:
                    count = conn.execute(f"SELECT COUNT(*) FROM {step.target_table}").fetchone()
                    rows_affected = count[0] if count else None
                except:
                    pass
            
            finished_at = datetime.now()
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)
            
            self._record_run_end(conn, run_id, step.analysis_id, "success", 
                                rows_affected, None, duration_ms)
            
            return StepResult(
                run_id=run_id,
                analysis_id=step.analysis_id,
                status="success",
                started_at=started_at,
                finished_at=finished_at,
                rows_affected=rows_affected,
                duration_ms=duration_ms,
            )
        
        except Exception as e:
            finished_at = datetime.now()
            duration_ms = int((finished_at - started_at).total_seconds() * 1000)
            error_msg = str(e)
            
            self._record_run_end(conn, run_id, step.analysis_id, "failed",
                                None, error_msg, duration_ms)
            
            return StepResult(
                run_id=run_id,
                analysis_id=step.analysis_id,
                status="failed",
                started_at=started_at,
                finished_at=finished_at,
                error=error_msg,
                duration_ms=duration_ms,
            )
    
    # ─────────────────────────────────────────────────
    # Convenience: run = compile + execute
    # ─────────────────────────────────────────────────
    
    def run(
        self,
        conn: duckdb.DuckDBPyConnection,
        analysis_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> ExecutionResult:
        """compile + execute 한번에"""
        plan = self.compile(analysis_id, params=params, force=force, conn=conn)
        return self.execute(conn, plan)
    
    # ─────────────────────────────────────────────────
    # Status & History
    # ─────────────────────────────────────────────────
    
    def status(self, conn: duckdb.DuckDBPyConnection, analysis_id: str) -> AnalysisStatus:
        """Analysis 상태 조회"""
        analysis = self.metadata.get(analysis_id)
        if not analysis:
            raise AnalysisNotFoundError(f"Analysis '{analysis_id}' not found")
        
        self._ensure_runtime_schema(conn)
        
        state = conn.execute("""
            SELECT last_run_at, last_run_status
            FROM _duckpipe.run_state
            WHERE analysis_id = ?
        """, [analysis_id]).fetchone()
        
        last_run_at = state[0] if state else None
        last_run_status = state[1] if state else None
        
        # 역방향 의존성
        depended_by = []
        for a in self.metadata.list_all():
            if any(ref.type == RefType.ANALYSIS and ref.name == analysis_id 
                   for ref in a.depends_on):
                depended_by.append(a.id)
        
        return AnalysisStatus(
            analysis_id=analysis_id,
            is_stale=self._is_stale(conn, analysis),
            last_run_at=last_run_at,
            last_run_status=last_run_status,
            depends_on=[str(ref) for ref in analysis.depends_on],
            depended_by=depended_by,
        )
    
    def get_run_history(
        self,
        conn: duckdb.DuckDBPyConnection,
        analysis_id: str,
        limit: int = 10,
    ) -> List[StepResult]:
        """실행 이력 조회"""
        self._ensure_runtime_schema(conn)
        
        rows = conn.execute("""
            SELECT run_id, analysis_id, started_at, finished_at,
                   status, rows_affected, error, duration_ms
            FROM _duckpipe.run_history
            WHERE analysis_id = ?
            ORDER BY started_at DESC
            LIMIT ?
        """, [analysis_id, limit]).fetchall()
        
        return [
            StepResult(
                run_id=row[0],
                analysis_id=row[1],
                started_at=row[2],
                finished_at=row[3],
                status=row[4],
                rows_affected=row[5],
                error=row[6],
                duration_ms=row[7],
            )
            for row in rows
        ]
    
    def preview(
        self,
        conn: duckdb.DuckDBPyConnection,
        analysis_id: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """실행 없이 미리보기"""
        analysis = self.metadata.get(analysis_id)
        if not analysis:
            raise AnalysisNotFoundError(f"Analysis '{analysis_id}' not found")
        
        # 파라미터 바인딩
        compiled_sql, bound_params = compile_sql(
            analysis.sql,
            "preview",  # 특수 모드
            None,
            params
        )
        
        preview_sql = f"SELECT * FROM ({compiled_sql}) LIMIT {limit}"
        
        if bound_params:
            result = conn.execute(preview_sql, bound_params)
        else:
            result = conn.execute(preview_sql)
        
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        
        return [dict(zip(columns, row)) for row in rows]
    
    # ─────────────────────────────────────────────────
    # DAG
    # ─────────────────────────────────────────────────
    
    def get_dag(self) -> Dict[str, List[str]]:
        """전체 DAG (Analysis ID → 의존하는 Analysis ID 목록)"""
        if self._dag_cache is not None:
            return self._dag_cache
        
        dag = {}
        for analysis in self.metadata.list_all():
            dag[analysis.id] = analysis.get_analysis_dependencies()
        
        self._dag_cache = dag
        return dag
    
    # ─────────────────────────────────────────────────
    # Private Methods
    # ─────────────────────────────────────────────────
    
    def _ensure_runtime_schema(self, conn: duckdb.DuckDBPyConnection) -> None:
        """런타임 스키마 초기화"""
        conn.execute("CREATE SCHEMA IF NOT EXISTS _duckpipe")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS _duckpipe.run_history (
                run_id TEXT PRIMARY KEY,
                analysis_id TEXT NOT NULL,
                started_at TIMESTAMP NOT NULL,
                finished_at TIMESTAMP,
                status TEXT NOT NULL,
                rows_affected BIGINT,
                error TEXT,
                duration_ms INTEGER,
                params JSON
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS _duckpipe.run_state (
                analysis_id TEXT PRIMARY KEY,
                last_run_id TEXT,
                last_run_at TIMESTAMP,
                last_run_status TEXT,
                last_run_error TEXT
            )
        """)
    
    def _ensure_analysis_schema(self, conn: duckdb.DuckDBPyConnection) -> None:
        """analysis 스키마 초기화"""
        conn.execute("CREATE SCHEMA IF NOT EXISTS analysis")
    
    def _record_run_end(
        self,
        conn: duckdb.DuckDBPyConnection,
        run_id: str,
        analysis_id: str,
        status: str,
        rows_affected: Optional[int],
        error: Optional[str],
        duration_ms: int,
    ) -> None:
        finished_at = datetime.now()
        
        conn.execute("""
            UPDATE _duckpipe.run_history
            SET finished_at = ?, status = ?, rows_affected = ?, error = ?, duration_ms = ?
            WHERE run_id = ?
        """, [finished_at, status, rows_affected, error, duration_ms, run_id])
        
        conn.execute("""
            INSERT INTO _duckpipe.run_state (analysis_id, last_run_id, last_run_at, last_run_status, last_run_error)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (analysis_id) DO UPDATE SET
                last_run_id = EXCLUDED.last_run_id,
                last_run_at = EXCLUDED.last_run_at,
                last_run_status = EXCLUDED.last_run_status,
                last_run_error = EXCLUDED.last_run_error
        """, [analysis_id, run_id, finished_at, status, error])
    
    def _is_stale(self, conn: duckdb.DuckDBPyConnection, analysis: Analysis) -> bool:
        """Freshness 체크"""
        state = conn.execute("""
            SELECT last_run_at FROM _duckpipe.run_state WHERE analysis_id = ?
        """, [analysis.id]).fetchone()
        
        if not state or not state[0]:
            return True
        
        last_run_at = state[0]
        
        # Analysis 의존성만 체크 (source는 항상 fresh로 간주)
        for ref in analysis.depends_on:
            if ref.type != RefType.ANALYSIS:
                continue
            
            dep_state = conn.execute("""
                SELECT last_run_at FROM _duckpipe.run_state WHERE analysis_id = ?
            """, [ref.name]).fetchone()
            
            if dep_state and dep_state[0] and dep_state[0] > last_run_at:
                return True
        
        return False
    
    def _collect_analysis_dependencies(self, analysis_id: str) -> Set[str]:
        """Analysis 타입 의존성만 재귀 수집"""
        visited = set()
        
        def collect(aid: str):
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
    
    def _topological_sort(self, analysis_ids: Set[str]) -> List[str]:
        """위상 정렬"""
        graph = {}
        for aid in analysis_ids:
            analysis = self.metadata.get(aid)
            if analysis:
                deps = set(analysis.get_analysis_dependencies()) & analysis_ids
                graph[aid] = deps
            else:
                graph[aid] = set()
        
        ts = TopologicalSorter(graph)
        try:
            return list(ts.static_order())
        except CycleError as e:
            raise CircularDependencyError(f"Circular dependency detected: {e}")
    
    def _invalidate_dag_cache(self) -> None:
        self._dag_cache = None
```

---

## 6. SQL 파싱 및 컴파일

### 6.1. 의존성 추출

```python
# duckpipe/parsing/sql.py

import sqlglot
from sqlglot import exp
from typing import List
from duckpipe.core.ref import Ref, RefType

def extract_dependencies(sql: str, dialect: str = "duckdb") -> List[Ref]:
    """
    SQL에서 참조하는 테이블을 Typed Ref로 추출.
    
    규칙:
    - analysis.* → RefType.ANALYSIS
    - source.* → RefType.SOURCE  
    - 기타 → RefType.SOURCE (외부 테이블로 추정)
    """
    try:
        parsed = sqlglot.parse_one(sql, dialect=dialect)
    except Exception:
        return []
    
    # CTE 이름 수집
    cte_names = set()
    for cte in parsed.find_all(exp.CTE):
        if cte.alias:
            cte_names.add(cte.alias.lower())
    
    refs = []
    seen = set()
    
    for table in parsed.find_all(exp.Table):
        # 스키마.테이블 형태로 추출
        schema = table.db or ""
        name = table.name or ""
        full_name = f"{schema}.{name}" if schema else name
        
        # CTE 제외
        if full_name.lower() in cte_names or name.lower() in cte_names:
            continue
        
        # 중복 제거
        if full_name in seen:
            continue
        seen.add(full_name)
        
        # 타입 결정
        if schema.lower() == "analysis":
            refs.append(Ref(RefType.ANALYSIS, name))
        elif schema.lower() == "source":
            refs.append(Ref(RefType.SOURCE, name))
        elif full_name.startswith("/") or full_name.endswith(".parquet"):
            refs.append(Ref(RefType.FILE, full_name))
        else:
            # 기본: 외부 소스로 추정
            refs.append(Ref(RefType.SOURCE, full_name))
    
    return refs
```

### 6.2. SQL 컴파일 (Safe Binding)

```python
# duckpipe/parsing/compiler.py

import re
from typing import Tuple, List, Optional, Dict, Any
import sqlglot
from sqlglot import exp

def compile_sql(
    sql: str,
    materialize: str,
    result_table: Optional[str],
    params: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Optional[List[Any]]]:
    """
    SQL 컴파일: 파라미터 바인딩 + materialization 래핑.
    
    Returns:
        (compiled_sql, bound_params)
        - bound_params가 None이면 파라미터 없음
        - bound_params가 리스트면 순서대로 $1, $2, ... 에 바인딩
    """
    # 1. 파라미터 추출 및 치환
    bound_sql, bound_params = _bind_parameters(sql, params)
    
    # 2. Materialization 래핑
    if materialize == "preview":
        # 미리보기: 그대로 반환
        return bound_sql, bound_params
    elif materialize == "view":
        final_sql = f"CREATE OR REPLACE VIEW {_quote_identifier(result_table)} AS {bound_sql}"
    elif materialize == "table":
        final_sql = f"CREATE OR REPLACE TABLE {_quote_identifier(result_table)} AS {bound_sql}"
    elif materialize == "append":
        # 테이블 존재 보장은 execute 단계에서 별도 처리
        final_sql = f"INSERT INTO {_quote_identifier(result_table)} {bound_sql}"
    elif materialize == "parquet":
        # result_table을 경로로 사용
        final_sql = f"COPY ({bound_sql}) TO '{result_table}' (FORMAT PARQUET)"
    else:
        raise ValueError(f"Unknown materialization: {materialize}")
    
    return final_sql, bound_params


def _bind_parameters(
    sql: str,
    params: Optional[Dict[str, Any]],
) -> Tuple[str, Optional[List[Any]]]:
    """
    :param_name → $N 변환 + 파라미터 리스트 생성.
    
    sqlglot을 사용해 AST 레벨에서 Placeholder를 찾아 안전하게 변환.
    문자열/주석 내부는 건드리지 않음.
    """
    if not params:
        return sql, None
    
    try:
        parsed = sqlglot.parse_one(sql, dialect="duckdb")
    except Exception:
        # 파싱 실패 시 폴백: 정규식 (주의 필요)
        return _bind_parameters_fallback(sql, params)
    
    # Placeholder 찾기
    placeholders = []
    for node in parsed.walk():
        # sqlglot의 Placeholder 노드 (예: :name)
        if isinstance(node, exp.Placeholder):
            name = node.name or node.this
            if name and name in params:
                placeholders.append((node, name))
    
    if not placeholders:
        return sql, None
    
    # 치환 및 파라미터 리스트 생성
    bound_params = []
    param_index = 1
    
    for node, name in placeholders:
        value = params[name]
        
        # 리스트 파라미터 처리 (IN 절용)
        if isinstance(value, (list, tuple)):
            # (?, ?, ?) 형태로 확장
            inner_placeholders = ", ".join([f"${param_index + i}" for i in range(len(value))])
            node.replace(sqlglot.parse_one(f"({inner_placeholders})", dialect="duckdb"))
            bound_params.extend(value)
            param_index += len(value)
        else:
            node.replace(sqlglot.parse_one(f"${param_index}", dialect="duckdb"))
            bound_params.append(_convert_param_value(value))
            param_index += 1
    
    return parsed.sql(dialect="duckdb"), bound_params


def _bind_parameters_fallback(
    sql: str,
    params: Dict[str, Any],
) -> Tuple[str, Optional[List[Any]]]:
    """
    폴백: 정규식 기반 바인딩 (sqlglot 파싱 실패 시).
    
    주의: 문자열 내부 :param도 치환될 수 있음.
    """
    bound_params = []
    param_index = 1
    
    def replacer(match):
        nonlocal param_index
        name = match.group(1)
        if name not in params:
            return match.group(0)  # 그대로 유지
        
        value = params[name]
        if isinstance(value, (list, tuple)):
            placeholders = ", ".join([f"${param_index + i}" for i in range(len(value))])
            bound_params.extend(value)
            param_index += len(value)
            return f"({placeholders})"
        else:
            bound_params.append(_convert_param_value(value))
            result = f"${param_index}"
            param_index += 1
            return result
    
    # :: 타입캐스트는 건드리지 않음
    pattern = r'(?<!:):(\w+)(?!:)'
    bound_sql = re.sub(pattern, replacer, sql)
    
    return bound_sql, bound_params if bound_params else None


def _convert_param_value(value: Any) -> Any:
    """파라미터 값 변환"""
    if value is None:
        return None
    elif isinstance(value, (int, float, str, bool)):
        return value
    elif hasattr(value, 'isoformat'):  # date, datetime
        return value.isoformat()
    else:
        return str(value)


def _quote_identifier(identifier: str) -> str:
    """
    식별자 안전하게 quote.
    
    schema.table 형태도 처리.
    """
    if not identifier:
        raise ValueError("Identifier cannot be empty")
    
    parts = identifier.split(".")
    quoted_parts = []
    
    for part in parts:
        # 유효한 식별자인지 검증
        if not _is_valid_identifier(part):
            raise ValueError(f"Invalid identifier: {part}")
        
        # 예약어이거나 특수문자 포함 시 quote
        if _needs_quoting(part):
            quoted_parts.append(f'"{part}"')
        else:
            quoted_parts.append(part)
    
    return ".".join(quoted_parts)


def _is_valid_identifier(s: str) -> bool:
    """유효한 SQL 식별자인지 검증"""
    if not s:
        return False
    # 알파벳/언더스코어로 시작, 이후 알파벳/숫자/언더스코어
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', s))


def _needs_quoting(s: str) -> bool:
    """quoting이 필요한지 확인"""
    # DuckDB 예약어 목록 (일부)
    reserved = {
        'select', 'from', 'where', 'table', 'view', 'create', 'insert',
        'update', 'delete', 'drop', 'alter', 'index', 'order', 'group',
        'by', 'having', 'limit', 'offset', 'join', 'on', 'and', 'or',
        'not', 'null', 'true', 'false', 'as', 'in', 'is', 'like', 'between',
        'case', 'when', 'then', 'else', 'end', 'union', 'all', 'distinct',
    }
    return s.lower() in reserved


def validate_identifier(identifier: str) -> None:
    """식별자 유효성 검증 (예외 발생)"""
    if not identifier:
        raise ValidationError("Identifier cannot be empty")
    
    parts = identifier.split(".")
    for part in parts:
        if not _is_valid_identifier(part):
            raise ValidationError(
                f"Invalid identifier '{part}'. "
                "Must start with letter or underscore, "
                "contain only letters, numbers, and underscores."
            )
```

---

## 7. 에러 처리

```python
# duckpipe/errors.py

class DuckpipeError(Exception):
    """Base exception"""
    pass

class AnalysisNotFoundError(DuckpipeError):
    """Analysis가 존재하지 않음"""
    pass

class CircularDependencyError(DuckpipeError):
    """순환 의존성 감지"""
    pass

class ExecutionError(DuckpipeError):
    """SQL 실행 실패"""
    def __init__(self, analysis_id: str, original_error: Exception):
        self.analysis_id = analysis_id
        self.original_error = original_error
        super().__init__(f"Failed to execute '{analysis_id}': {original_error}")

class ValidationError(DuckpipeError):
    """Analysis 정의 검증 실패"""
    pass

class ParameterError(DuckpipeError):
    """파라미터 바인딩 오류"""
    pass

class CompilationError(DuckpipeError):
    """SQL 컴파일 오류"""
    pass
```

---

## 8. 패키지 구조

```
backend/
└── duckpipe/
    ├── __init__.py              # public API exports
    ├── core/
    │   ├── __init__.py
    │   ├── ref.py               # Ref, RefType
    │   ├── analysis.py          # Analysis, ParameterDef
    │   ├── plan.py              # ExecutionPlan, ExecutionStep
    │   ├── result.py            # ExecutionResult, StepResult
    │   ├── pipeline.py          # Pipeline 메인 클래스
    │   └── dag.py               # DAG 로직 + topological sort
    ├── parsing/
    │   ├── __init__.py
    │   ├── sql.py               # extract_dependencies
    │   └── compiler.py          # compile_sql, _bind_parameters
    ├── storage/
    │   ├── __init__.py
    │   ├── base.py              # MetadataStore ABC
    │   ├── file_store.py        # FileMetadataStore (YAML)
    │   └── runtime.py           # DuckDB 런타임 상태
    ├── freshness/
    │   ├── __init__.py
    │   └── checker.py           # Freshness 판정 로직
    ├── errors.py
    └── types.py
```

---

## 9. 의존성

```toml
[project]
name = "duckpipe"
version = "0.1.0"
description = "Lightweight SQL Pipeline Engine for DuckDB"
dependencies = [
    "duckdb>=0.9.0",
    "sqlglot>=20.0.0",
    "pyyaml>=6.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-cov",
]
```

---

## 10. Pluto Duck 연동

```python
# backend/pluto_duck_backend/app/services/assets/service.py

from duckpipe import Pipeline, Analysis, FileMetadataStore, ExecutionPlan
from duckpipe.core.ref import Ref, RefType

class AssetService:
    def __init__(self):
        settings = get_settings()
        self.warehouse_path = Path(settings.duckdb.path).expanduser()
        
        analyses_path = self.warehouse_path.parent / "analyses"
        self.metadata_store = FileMetadataStore(analyses_path)
        self.pipe = Pipeline(self.metadata_store)
    
    @contextmanager
    def get_connection(self):
        conn = duckdb.connect(str(self.warehouse_path))
        try:
            yield conn
        finally:
            conn.close()
    
    def save_analysis(self, name: str, sql: str, **kwargs) -> Analysis:
        """Analysis 저장"""
        from slugify import slugify
        
        analysis = Analysis(
            id=slugify(name, separator="_"),
            name=name,
            sql=sql,
            **kwargs
        )
        self.pipe.register(analysis)
        return analysis
    
    def compile_analysis(
        self,
        analysis_id: str,
        params: Dict[str, Any] = None,
    ) -> ExecutionPlan:
        """
        실행 계획 생성 (HITL 승인 전 단계).
        Agent가 이 결과를 사용자에게 설명할 수 있음.
        """
        with self.get_connection() as conn:
            return self.pipe.compile(analysis_id, params=params, conn=conn)
    
    def execute_plan(self, plan: ExecutionPlan) -> ExecutionResult:
        """
        승인된 계획 실행.
        """
        with self.get_connection() as conn:
            return self.pipe.execute(conn, plan)
    
    def run_analysis(
        self,
        analysis_id: str,
        params: Dict[str, Any] = None,
        force: bool = False,
    ) -> ExecutionResult:
        """compile + execute 한번에 (HITL 없이 바로 실행)"""
        with self.get_connection() as conn:
            return self.pipe.run(conn, analysis_id, params=params, force=force)


# Agent Tool 예시
async def save_analysis_tool(
    name: str,
    sql: str,
    description: str = None,
) -> str:
    """SQL을 재사용 가능한 Analysis로 저장"""
    service = get_asset_service()
    analysis = service.save_analysis(name, sql, description=description)
    return f"Analysis '{analysis.id}' saved. Result will be in: {analysis.result_table}"


async def run_analysis_tool(
    analysis_id: str,
    params: Dict[str, Any] = None,
) -> str:
    """
    Analysis 실행.
    
    이 도구는 HITL 승인이 필요합니다.
    실행 전 계획을 먼저 검토합니다.
    """
    service = get_asset_service()
    
    # 1. 계획 생성 및 설명
    plan = service.compile_analysis(analysis_id, params)
    
    explanation = f"""
실행 계획:
{plan.summary()}

변경될 테이블: {', '.join(plan.will_modify_tables())}

이 작업을 진행하시겠습니까?
"""
    
    # 2. HITL 승인 요청 (Pluto Duck의 HITL 시스템 사용)
    approved = await request_approval(
        action="run_analysis",
        description=explanation,
        plan=plan,
    )
    
    if not approved:
        return "사용자가 실행을 거부했습니다."
    
    # 3. 실행
    result = service.execute_plan(plan)
    
    if result.success:
        return f"Analysis '{analysis_id}' 실행 완료. {len(result.step_results)} steps."
    else:
        return f"실행 실패: {result.failed_step.error}"
```

---

## 11. 테스트

```python
import pytest
import duckdb
from pathlib import Path
from duckpipe import Pipeline, Analysis, FileMetadataStore, ParameterDef
from duckpipe.core.ref import Ref, RefType
from duckpipe.errors import CircularDependencyError

@pytest.fixture
def pipe(tmp_path):
    store = FileMetadataStore(tmp_path / "analyses")
    return Pipeline(store)

@pytest.fixture
def conn(tmp_path):
    connection = duckdb.connect(str(tmp_path / "test.duckdb"))
    yield connection
    connection.close()


def test_compile_and_execute(pipe, conn):
    """compile → execute 분리 테스트"""
    pipe.register(Analysis(
        id="test",
        name="Test",
        sql="SELECT 1 as value",
        materialize="table",
    ))
    
    # 1. compile
    plan = pipe.compile("test")
    
    assert plan.target_id == "test"
    assert len(plan.steps) == 1
    assert plan.steps[0].action.value == "run"
    assert "analysis.test" in plan.will_modify_tables()
    
    # 2. execute
    result = pipe.execute(conn, plan)
    
    assert result.success
    assert result.step_results[0].status == "success"
    
    # 결과 확인
    rows = conn.execute("SELECT * FROM analysis.test").fetchall()
    assert rows[0][0] == 1


def test_typed_ref_extraction(pipe):
    """Typed Ref 자동 추출"""
    pipe.register(Analysis(
        id="combined",
        name="Combined",
        sql="""
            SELECT *
            FROM source.pg_orders o
            JOIN analysis.customer_segments c ON o.customer_id = c.id
        """,
        materialize="table",
    ))
    
    analysis = pipe.get("combined")
    
    # 자동 추출된 의존성 확인
    source_refs = [r for r in analysis.depends_on if r.type == RefType.SOURCE]
    analysis_refs = [r for r in analysis.depends_on if r.type == RefType.ANALYSIS]
    
    assert len(source_refs) == 1
    assert source_refs[0].name == "pg_orders"
    
    assert len(analysis_refs) == 1
    assert analysis_refs[0].name == "customer_segments"


def test_parameter_binding(pipe, conn):
    """파라미터 바인딩 테스트"""
    pipe.register(Analysis(
        id="param_test",
        name="Param Test",
        sql="SELECT :value as v, :name as n",
        materialize="table",
        parameters=[
            ParameterDef(name="value", type="int"),
            ParameterDef(name="name", type="string"),
        ]
    ))
    
    result = pipe.run(conn, "param_test", params={"value": 42, "name": "hello"})
    
    assert result.success
    rows = conn.execute("SELECT * FROM analysis.param_test").fetchall()
    assert rows[0] == (42, "hello")


def test_list_parameter(pipe, conn):
    """리스트 파라미터 (IN 절)"""
    # 테스트 데이터 생성
    conn.execute("CREATE TABLE source.items (id INT, name TEXT)")
    conn.execute("INSERT INTO source.items VALUES (1, 'a'), (2, 'b'), (3, 'c')")
    
    pipe.register(Analysis(
        id="list_param",
        name="List Param",
        sql="SELECT * FROM source.items WHERE id IN :ids",
        materialize="table",
        parameters=[
            ParameterDef(name="ids", type="list"),
        ]
    ))
    
    result = pipe.run(conn, "list_param", params={"ids": [1, 3]})
    
    assert result.success
    rows = conn.execute("SELECT * FROM analysis.list_param ORDER BY id").fetchall()
    assert len(rows) == 2
    assert rows[0][0] == 1
    assert rows[1][0] == 3


def test_dependency_chain(pipe, conn):
    """의존성 체인 실행"""
    pipe.register(Analysis(id="a", name="A", sql="SELECT 1 as value", materialize="table"))
    pipe.register(Analysis(
        id="b", name="B",
        sql="SELECT value * 2 as value FROM analysis.a",
        materialize="table"
    ))
    pipe.register(Analysis(
        id="c", name="C",
        sql="SELECT value * 3 as value FROM analysis.b",
        materialize="table"
    ))
    
    # c 실행 → a, b도 실행됨
    plan = pipe.compile("c", conn=conn)
    
    assert len(plan.steps) == 3
    assert [s.analysis_id for s in plan.steps] == ["a", "b", "c"]
    
    result = pipe.execute(conn, plan)
    
    assert result.success
    
    # 결과: 1 * 2 * 3 = 6
    rows = conn.execute("SELECT * FROM analysis.c").fetchall()
    assert rows[0][0] == 6


def test_freshness_skip(pipe, conn):
    """Freshness 체크 - 이미 fresh면 스킵"""
    pipe.register(Analysis(id="fresh", name="Fresh", sql="SELECT 1", materialize="table"))
    
    # 첫 실행
    result1 = pipe.run(conn, "fresh")
    assert result1.success
    
    # 두 번째 compile - SKIP으로 계획됨
    plan2 = pipe.compile("fresh", conn=conn)
    assert plan2.steps[0].action.value == "skip"
    
    # 강제 실행
    plan3 = pipe.compile("fresh", conn=conn, force=True)
    assert plan3.steps[0].action.value == "run"


def test_plan_summary(pipe):
    """Plan summary 출력"""
    pipe.register(Analysis(id="a", name="A", sql="SELECT 1", materialize="table"))
    pipe.register(Analysis(
        id="b", name="B",
        sql="SELECT * FROM analysis.a",
        materialize="table"
    ))
    
    plan = pipe.compile("b", force=True)
    summary = plan.summary()
    
    assert "analysis:a" in summary
    assert "analysis:b" in summary
    assert "analysis.a" in summary or "analysis.b" in summary


def test_circular_dependency(pipe, conn):
    """순환 의존성 감지"""
    pipe.register(Analysis(
        id="x", name="X",
        sql="SELECT * FROM analysis.y",
        materialize="table",
        depends_on=[Ref(RefType.ANALYSIS, "y")]
    ))
    pipe.register(Analysis(
        id="y", name="Y",
        sql="SELECT * FROM analysis.x",
        materialize="table",
        depends_on=[Ref(RefType.ANALYSIS, "x")]
    ))
    
    with pytest.raises(CircularDependencyError):
        pipe.compile("x")
```

---

## 12. 로드맵

### Phase 1: Core (2주)

- [ ] `Ref`, `RefType` 구현
- [ ] `Analysis` 모델 + `FileMetadataStore`
- [ ] `ExecutionPlan`, `ExecutionStep` 구현
- [ ] `Pipeline.compile()` - 계획 생성
- [ ] `Pipeline.execute()` - 계획 실행
- [ ] `compile_sql()` - Safe Parameter Binding
- [ ] `extract_dependencies()` - Typed Ref 추출
- [ ] DAG + topological sort
- [ ] 기본 테스트

### Phase 2: Freshness + History (1주)

- [ ] Freshness 체크 로직
- [ ] `_duckpipe.run_history` / `run_state`
- [ ] `status()`, `get_run_history()`
- [ ] `preview()` 미리보기

### Phase 3: Pluto Duck 연동 (1주)

- [ ] `AssetService` 연동
- [ ] Agent tools (`save_analysis`, `run_analysis`)
- [ ] HITL 승인 플로우 연동
- [ ] UI 연동 (Asset Library)

### Phase 4: 고도화 (이후)

- [ ] `append` 모드 (테이블 자동 생성 포함)
- [ ] Parquet export
- [ ] 부분 실패 처리 (계속 진행 옵션)
- [ ] 병렬 실행 (독립 노드)
- [ ] (선택) OSS 분리

---

## 13. ADR (Architecture Decision Records)

### ADR-001: Code as File, State as DB

**상황**: SQL 로직을 어디에 저장할 것인가?

**결정**: Analysis 정의(Code) → 파일 시스템 (YAML), 실행 상태(State) → DuckDB

**이유**: Git 버전 관리, DB 파손 시 로직 보존, 이식성

---

### ADR-002: Connection Injection

**상황**: DuckDB 연결을 어떻게 관리할 것인가?

**결정**: `Pipeline.execute(conn, plan)` 형태로 외부에서 주입

**이유**: DuckDB 단일 Writer 제약 회피, Connection Pool 통합 용이

---

### ADR-003: Typed Ref Model (v3)

**상황**: 의존성이 Analysis ID인지, 테이블명인지 모호

**결정**: 
- 의존성을 `analysis:`, `source:`, `file:` 접두사로 구분
- Analysis는 반드시 `analysis.<id>`에 물질화
- SQL에서 다른 Analysis 참조 시 `analysis.<id>` 형태로 작성

**이유**:
- 자동 의존성 추출 결과를 신뢰할 수 있음
- DAG/lineage가 단단해짐
- 나중에 바꾸기 가장 비싼 결정이므로 지금 고정

---

### ADR-004: Safe Parameter Binding (v3)

**상황**: `:param` 치환 시 SQL Injection 및 오탐 위험

**결정**:
- sqlglot AST 파싱으로 Placeholder 노드만 추출
- `:name` → `$N` 변환 + prepared statement 바인딩
- 리스트 파라미터 → `(?, ?, ?)` 확장

**이유**:
- 문자열/주석 내부 오탐 방지
- `::` 타입캐스트와 혼동 방지
- SQL Injection 방지

---

### ADR-005: Plan before Execute (v3)

**상황**: Agent/HITL이 "뭘 하려는지" 설명 및 승인 필요

**결정**:
- `compile()` → `ExecutionPlan` 반환 (DB 변경 없음)
- `execute(conn, plan)` → 실제 실행
- `run()` = `compile() + execute()` 편의 메서드

**이유**:
- HITL 승인 전에 side-effect 예측 가능
- Agent가 사용자에게 설명 가능
- 롤백 전략 수립 용이

---

### ADR-006: Identifier Safety (v3)

**상황**: `result_table` 등 사용자 입력이 SQL에 직접 삽입됨

**결정**:
- `validate_identifier()` - 유효한 식별자인지 검증
- `_quote_identifier()` - 필요시 double-quote 처리
- 예약어/특수문자 포함 시 자동 quote

**이유**:
- SQL Injection 방지
- 예약어 충돌 방지

---

## 14. 미결정 사항

1. **Source 스키마 매핑**: `source.pg_orders`가 실제로 `pg.orders`를 가리키도록 하는 방법 (VIEW? ATTACH?)
2. **런타임 상태 DB 분리**: 추후 락 경합 문제 시 `_duckpipe_state.duckdb` 분리 고려
3. **증분 처리 확장**: `append` 외에 `merge`/`incremental` 전략 필요성
4. **병렬 실행**: 독립 노드 병렬 실행 (복잡도 증가, Phase 4로 연기)
