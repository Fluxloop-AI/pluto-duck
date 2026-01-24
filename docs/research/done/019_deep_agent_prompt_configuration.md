---
date: 2026-01-15T17:30:00+09:00
researcher: Claude
topic: "Deep Agent 프롬프트 구성 및 톤앤매너 정의 위치 분석"
tags: [research, codebase, deep-agent, prompts, tone, style, middleware]
status: complete
---

# Research: Deep Agent 프롬프트 구성 및 톤앤매너 정의 위치 분석

## Research Question
Deep Agent가 사용자에게 대화를 출력하는 형식, 말투, 톤앤매너 등의 프롬프트가 어디에 어떻게 정의되어 있는지 조사

## Summary

Deep Agent의 프롬프트는 **레이어드 아키텍처**로 구성되어 있으며, 여러 미들웨어를 통해 최종 시스템 프롬프트가 조립됩니다:

1. **Default Agent Prompt** (`default_agent_prompt.md`) - 핵심 톤/스타일 정의
2. **Runtime System Prompt** (`agent.py`) - 백엔드 운영 정책
3. **Long-term Memory Prompt** (`memory.py`) - 메모리 기반 개인화
4. **Skills System Prompt** (`skills.py`) - 스킬 사용 가이드

**핵심 톤앤매너 정의 위치**:
```
backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md (25-28행)
```

---

## 1. 프롬프트 레이어 구조

```
┌─────────────────────────────────────────────────────────────┐
│  최종 시스템 프롬프트 (LLM에 전달)                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: Skills System Prompt (스킬 목록 + 사용 가이드)      │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Project Memory (/memories/projects/{id}/agent.md) │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: User Memory (/memories/user/agent.md)             │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Long-term Memory System Prompt                    │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Runtime System Prompt (백엔드 정책)                │
├─────────────────────────────────────────────────────────────┤
│  Layer 0: Default Agent Prompt (핵심 역할 + 톤앤매너)         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 핵심 프롬프트 파일들

### 2.1 Default Agent Prompt (핵심 톤앤매너)

**파일**: [default_agent_prompt.md](backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md)

**톤앤매너 정의** (25-28행):
```markdown
# Tone and Style
Be concise and direct. Answer in fewer than 4 lines unless the user asks for detail.
After working on a file, just stop - don't explain what you did unless asked.
Avoid unnecessary introductions or conclusions.
```

**주요 섹션**:

| 섹션 | 행 번호 | 내용 |
|------|---------|------|
| Core Role | 1-4 | AI 어시스턴트 역할 (데이터 분석, SQL, 리포트) |
| Memory-First Protocol | 6-23 | 세션 시작 시 메모리 확인 절차 |
| **Tone and Style** | 25-28 | **핵심 톤앤매너 정의** |
| Proactiveness | 30-32 | 능동성 수준 가이드 |
| Following Conventions | 34-36 | 기존 패턴 따르기 |
| Task Management | 40-41 | write_todos 사용 가이드 |
| File Reading | 43-60 | 파일 읽기 페이지네이션 |
| Subagents | 61-69 | 서브에이전트 위임 패턴 |
| Tools | 71-115 | 사용 가능한 도구 문서 |

---

### 2.2 Runtime System Prompt (백엔드 정책)

**파일**: [agent.py](backend/pluto_duck_backend/agent/core/deep/agent.py)

**함수**: `get_runtime_system_prompt()` (36-76행)

**내용**:
```python
def get_runtime_system_prompt() -> str:
    return """
    # Operating Environment
    You are operating in a backend environment with a virtual filesystem...

    # Path Handling
    - All paths must be absolute virtual paths starting with `/`
    - /workspace/ - project files
    - /memories/ - long-term memory
    - /skills/ - available skills

    # Human-in-the-Loop (HITL) Tool Approval
    - Some tools require user approval before execution
    - Wait for approval when prompted

    # Todo List Management
    - Use for complex tasks (3-6 items max)
    """
```

---

### 2.3 Long-term Memory System Prompt (메모리 기반 개인화)

**파일**: [memory.py](backend/pluto_duck_backend/agent/core/deep/middleware/memory.py)

**상수**: `LONGTERM_MEMORY_SYSTEM_PROMPT` (37-131행)

**주요 내용**:

| 행 번호 | 내용 |
|---------|------|
| 46-51 | 메모리 파일 위치 정의 |
| 53-77 | 메모리 확인/읽기 시점 |
| **85** | **User Agent File = personality, style, universal behavior** |
| **88-91** | **저장 대상: 톤, 커뮤니케이션 스타일, 워크플로우** |
| 96-100 | Project Agent File = 프로젝트별 규칙 |

**User Memory에 저장되는 톤/스타일 항목** (88-91행):
```markdown
- General tone and communication style
- Universal workflows and methodologies
- Tool usage patterns
- Preferences that don't change per-project
```

---

### 2.4 Skills System Prompt (스킬 가이드)

**파일**: [skills.py](backend/pluto_duck_backend/agent/core/deep/middleware/skills.py)

**상수**: `SKILLS_SYSTEM_PROMPT` (32-75행)

**내용**:
- Progressive Disclosure 패턴 (44-50행)
- 스킬 적용 인식 방법 (66-73행)
- 스킬 실행 워크플로우 예시

---

## 3. 프롬프트 조립 프로세스

### 3.1 미들웨어 스택

**파일**: [agent.py](backend/pluto_duck_backend/agent/core/deep/agent.py) (157-164행)

```python
middleware = [
    ApprovalPersistenceMiddleware(hitl_config, approval_repo, event_sink),
    AgentMemoryMiddleware(backend, default_prompt),  # 프롬프트 조립
    SkillsMiddleware(backend),
    *extra_middleware,
]
```

### 3.2 시스템 프롬프트 빌드 함수

**파일**: [memory.py](backend/pluto_duck_backend/agent/core/deep/middleware/memory.py)

**함수**: `_build_system_prompt()` (203-238행)

```python
def _build_system_prompt(self, original_prompt: str, user_memory: str, project_memory: str) -> str:
    parts = []

    # 1. Default Agent Prompt (사용자 역할 + 톤앤매너)
    if self.default_agent_prompt:
        parts.append(self.default_agent_prompt)

    # 2. User Memory (개인 스타일)
    if user_memory:
        parts.append(f"## User Memory\n{user_memory}")

    # 3. Project Memory (프로젝트별 규칙)
    if project_memory:
        parts.append(f"## Project Memory\n{project_memory}")

    # 4. Long-term Memory Instructions
    parts.append(LONGTERM_MEMORY_SYSTEM_PROMPT)

    # 5. Runtime System Prompt
    parts.append(original_prompt)

    return "\n\n".join(parts)
```

---

## 4. 톤앤매너 수정 방법

### 4.1 기본 톤 수정 (개발자)

**파일 수정**: `backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md`

```markdown
# Tone and Style
<!-- 여기 내용을 수정 -->
Be concise and direct. Answer in fewer than 4 lines unless the user asks for detail.
```

### 4.2 사용자별 톤 커스터마이징 (런타임)

**메모리 파일**: `/memories/user/agent.md` (가상 파일시스템)

사용자가 "더 친근하게 말해줘" 같은 피드백을 주면, 에이전트가 이 파일에 저장:
```markdown
## Communication Style
- Use friendly, conversational tone
- Include occasional encouragement
```

### 4.3 프로젝트별 톤 커스터마이징

**메모리 파일**: `/memories/projects/{project_id}/agent.md`

프로젝트 특성에 맞는 스타일 저장:
```markdown
## Project Communication
- Use formal language for this enterprise project
- Always include data sources in responses
```

---

## 5. 응답 포맷팅 가이드라인 (Gap 분석)

### 5.1 현재 문제점

현재 `default_agent_prompt.md`의 Tone and Style 섹션에는 **포맷팅 지침이 없음**.

**현재 정의된 내용**:
```markdown
# Tone and Style
Be concise and direct. Answer in fewer than 4 lines unless the user asks for detail.
After working on a file, just stop - don't explain what you did unless asked.
Avoid unnecessary introductions or conclusions.
```

**결과**: 에이전트가 줄글(paragraph) 형태로 응답하여 가독성이 떨어짐.

### 5.2 문제 예시

**사용자 질문**:
> Help me create a dashboard. What visualizations would be most useful for my data?

**현재 응답** (줄글):
```
Quick question before I start: what are your primary goals and audience (executive, ops, analysts), what does your data look like (time series, events, users, products, geography), and how often does it refresh? Useful visualizations to cover common needs: KPI cards (top-line metrics), time-series line charts (trend + moving average), bar charts (category/product breakdowns), stacked bars or area charts (composition over time), funnel chart (conversion stages), cohort/retention heatmap, histogram or boxplot (distribution / outliers), scatter (correlations), choropleth/map (geo), and a detailed table with conditional formatting for drilldown. Interactive features to include: date-picker, segment filters, top-N selectors, drilldowns, and comparison (period-over-period); send a sample schema or CSV and I'll propose a 1-page layout and specific charts tailored to your data.
```

**원하는 응답** (구조화):
```markdown
## Quick Questions
- **Goals/Audience**: Executive, ops, or analysts?
- **Data type**: Time series, events, users, products, geo?
- **Refresh frequency**: Real-time, daily, weekly?

## Recommended Visualizations

### KPIs & Trends
- KPI cards (top-line metrics)
- Time-series line charts (trend + moving average)

### Breakdowns
- Bar charts (category/product)
- Stacked bars or area charts (composition over time)

### Analysis
- Funnel chart (conversion)
- Cohort/retention heatmap
- Histogram or boxplot (distribution/outliers)
- Scatter (correlations)
- Choropleth/map (geo)

### Drilldown
- Detailed table with conditional formatting

## Interactive Features
- Date-picker, segment filters, top-N selectors
- Drilldowns, period-over-period comparison

---

Send a sample schema or CSV and I'll propose a tailored layout.
```

### 5.3 해결 방안: Formatting Guidelines 추가

**수정 파일**: [default_agent_prompt.md:25-28](backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md#L25-L28)

**추가할 내용**:
```markdown
# Tone and Style
Be concise and direct. Answer in fewer than 4 lines unless the user asks for detail.
After working on a file, just stop - don't explain what you did unless asked.
Avoid unnecessary introductions or conclusions.

## Formatting Guidelines
- Use **bullet points** when listing 3+ items
- Use **headers** (##, ###) to separate distinct sections
- Use **numbered lists** for sequential steps or ranked items
- Use **bold** for key terms or important concepts
- Use **code blocks** for SQL, file paths, or technical content
- Add blank lines between sections for readability
- For complex answers, structure as: Overview → Details → Next Steps
```

### 5.4 대안적 접근

| 방법 | 장점 | 단점 |
|------|------|------|
| **A. 프롬프트 수정** | 즉시 적용, 모든 응답에 영향 | 프롬프트 길이 증가 |
| **B. 메모리 저장** | 사용자별 커스텀 가능 | 사용자가 직접 요청해야 함 |
| **C. 스킬별 포맷 정의** | 스킬마다 최적화된 포맷 | 스킬 외 응답은 영향 없음 |

**권장**: A + B 조합 (기본 포맷팅 지침 + 사용자 피드백으로 개인화)

---

## 6. 설정 가능한 파라미터

### 6.1 환경 변수

**파일**: [config.py](backend/pluto_duck_backend/app/core/config.py) (72-75행)

```python
class AgentSettings(BaseModel):
    text_verbosity: Literal["low", "medium", "high"] = "medium"
    reasoning_effort: Literal["low", "medium", "high"] = "medium"
    max_output_tokens: Optional[int] = None
```

**환경 변수**:
- `PLUTODUCK_AGENT__TEXT_VERBOSITY` - 응답 상세도
- `PLUTODUCK_AGENT__REASONING_EFFORT` - 추론 깊이

### 6.2 Settings API

**파일**: [router.py](backend/pluto_duck_backend/app/api/v1/chat/router.py) (239-252행)

```
GET  /api/v1/chat/settings    # 설정 조회
PUT  /api/v1/chat/settings    # 설정 업데이트
```

---

## 7. 프롬프트 로딩 모듈

**파일**: [prompts/__init__.py](backend/pluto_duck_backend/agent/core/deep/prompts/__init__.py)

```python
def load_prompt(filename: str) -> str:
    """리소스에서 프롬프트 파일 로드"""
    path = resources.files(__package__) / filename
    return path.read_text()

def load_default_agent_prompt() -> str:
    """기본 에이전트 프롬프트 로드"""
    return load_prompt("default_agent_prompt.md")
```

---

## Code References

### 프롬프트 정의
- [default_agent_prompt.md](backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md) - 핵심 톤앤매너 (25-28행)
- [prompts/__init__.py](backend/pluto_duck_backend/agent/core/deep/prompts/__init__.py) - 프롬프트 로더

### 미들웨어
- [memory.py](backend/pluto_duck_backend/agent/core/deep/middleware/memory.py) - 메모리 미들웨어 (LONGTERM_MEMORY_SYSTEM_PROMPT: 37-131행)
- [skills.py](backend/pluto_duck_backend/agent/core/deep/middleware/skills.py) - 스킬 미들웨어 (SKILLS_SYSTEM_PROMPT: 32-75행)
- [approvals.py](backend/pluto_duck_backend/agent/core/deep/middleware/approvals.py) - HITL 승인

### 에이전트 빌더
- [agent.py](backend/pluto_duck_backend/agent/core/deep/agent.py) - 에이전트 빌드 (get_runtime_system_prompt: 36-76행, build_deep_agent: 90-192행)
- [orchestrator.py](backend/pluto_duck_backend/agent/core/orchestrator.py) - 오케스트레이터 (_execute_run: 152-286행)

### 설정
- [config.py](backend/pluto_duck_backend/app/core/config.py) - AgentSettings (60-95행)
- [router.py](backend/pluto_duck_backend/app/api/v1/chat/router.py) - Settings API (239-252행)

### Deepagents 라이브러리
- [graph.py](backend/deepagents/graph.py) - BASE_AGENT_PROMPT (24행)
- [subagents.py](backend/deepagents/middleware/subagents.py) - TASK_SYSTEM_PROMPT (181-207행)

---

## Architecture Insights

1. **레이어드 아키텍처**: 프롬프트가 여러 레이어로 분리되어 각각 독립적으로 관리됨
2. **메모리 기반 개인화**: 사용자 피드백을 메모리 파일에 저장하여 톤/스타일 학습 가능
3. **미들웨어 패턴**: 각 미들웨어가 시스템 프롬프트를 점진적으로 확장
4. **Dual-layer Memory**: 사용자 전역 설정과 프로젝트별 설정 분리

---

## Open Questions

1. **한국어 톤앤매너**: 현재 프롬프트가 영어로만 작성됨 - 한국어 사용자를 위한 별도 프롬프트 필요?
2. **동적 톤 전환**: 대화 중 톤을 동적으로 변경하는 메커니즘 필요?
3. **톤 프리셋**: 미리 정의된 톤 프리셋 (formal, casual, technical 등) 제공?
4. **포맷팅 가이드라인**: Formatting Guidelines 섹션을 `default_agent_prompt.md`에 추가할 것인지 결정 필요
5. **컨텍스트별 포맷**: 짧은 응답 vs 긴 응답에 다른 포맷팅 규칙 적용?
