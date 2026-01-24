---
date: 2026-01-15T14:30:00+09:00
researcher: Claude
topic: "Chat AI Agent Architecture & Flow"
tags: [research, codebase, agent, chat, tools, skills, streaming, architecture]
status: complete
---

# Research: 채팅창 AI 호출 아키텍처 및 작동 방식

## Research Question
현재 채팅창의 AI 호출이 어떻게 작동하는지, 에이전트 구조가 어떻게 되어있고 어떤 tool과 어떤 skill을 쓰도록 되어있는지 구체적인 아키텍처와 작동방식 flow

## Summary

Pluto Duck의 채팅 AI 시스템은 **LangGraph 기반 에이전트 아키텍처**를 사용하며, 다음 핵심 요소로 구성됩니다:

1. **Frontend**: React 컴포넌트 + EventSource 기반 SSE 스트리밍
2. **Backend**: FastAPI + LangGraph 에이전트 + 미들웨어 스택
3. **Tools**: DuckDB 쿼리/스키마/에셋/소스 관련 4개 카테고리 도구
4. **Skills**: 파일시스템 기반 워크플로우 템플릿 (progressive disclosure 패턴)
5. **이벤트 스트리밍**: asyncio Queue → SSE → EventSource

---

## Detailed Findings

### 1. Overall Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MultiTabChatPanel                                                          │
│    ├── TabBar (탭 네비게이션)                                                │
│    └── ChatPanel                                                            │
│          ├── Transcript (메시지 렌더링)                                      │
│          │     └── RenderItem → UserMessage/Reasoning/Tool/AssistantMessage │
│          └── Composer (입력창)                                               │
│                └── handleSubmit() → chatApi.ts                              │
│                                                                              │
│  useAgentStream (SSE EventSource)                                           │
│    └── events[] → useMultiTabChat → renderItems[]                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (FastAPI)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  /api/v1/chat/sessions                                                       │
│    └── POST → AgentRunManager.start_run_for_conversation()                   │
│                                                                              │
│  /api/v1/agent/{run_id}/events (SSE)                                        │
│    └── StreamingResponse(event_stream)                                       │
│                                                                              │
│  AgentOrchestrator                                                          │
│    └── build_deep_agent() → create_deep_agent()                             │
│          │                                                                   │
│          ├── Middleware Stack:                                               │
│          │   1. ApprovalPersistenceMiddleware (HITL)                        │
│          │   2. AgentMemoryMiddleware (장기 메모리)                          │
│          │   3. SkillsMiddleware (스킬 카탈로그)                             │
│          │   4. FilesystemMiddleware (파일 도구)                            │
│          │   5. SubAgentMiddleware (서브에이전트)                           │
│          │   6. PatchToolCallsMiddleware (도구 호출 패치)                    │
│          │                                                                   │
│          └── Tools: schema/query/asset/source                               │
│                                                                              │
│  PlutoDuckEventCallbackHandler → EventSink → asyncio.Queue → SSE           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Frontend Chat Architecture

#### 2.1 Component Hierarchy

```
frontend/pluto_duck_frontend/
├── components/chat/
│   ├── MultiTabChatPanel.tsx      # 멀티탭 컨테이너
│   ├── ChatPanel.tsx              # 단일 채팅 뷰
│   ├── TabBar.tsx                 # 탭 네비게이션
│   ├── Transcript.tsx             # 메시지 목록
│   ├── Composer.tsx               # 입력 컴포저
│   ├── MentionMenu.tsx            # @멘션 메뉴
│   └── renderers/
│       ├── RenderItem.tsx         # 타입별 디스패처
│       ├── UserMessageRenderer.tsx
│       ├── AssistantMessageRenderer.tsx
│       ├── ReasoningRenderer.tsx
│       └── ToolRenderer.tsx
├── hooks/
│   ├── useAgentStream.ts          # SSE 스트리밍
│   ├── useChatSession.ts          # 단일 세션 관리
│   └── useMultiTabChat.ts         # 멀티탭 세션 관리
├── lib/
│   ├── chatApi.ts                 # API 클라이언트
│   └── chatRenderUtils.ts         # 렌더링 유틸리티
└── types/
    ├── agent.ts                   # 에이전트 이벤트 타입
    └── chatRenderItem.ts          # 렌더 아이템 타입
```

#### 2.2 Message Submission Flow

```typescript
// 1. User types message → handleSubmit in ChatPanel.tsx:204-223
handleSubmit({ prompt, contextAssets })

// 2. If no session → createConversation API call
const response = await chatApi.createConversation({
  question: prompt,
  model: selectedModel,
  metadata: { context_assets, project_id }
})
// Returns: { id, run_id, events_url }

// 3. If existing session → appendMessage API call
const response = await chatApi.appendMessage(sessionId, {
  role: 'user',
  content: { text: prompt },
  model: selectedModel,
  metadata: { context_assets }
})
// Returns: { status, run_id, events_url }

// 4. Update activeRunId → triggers useAgentStream
setActiveRunId(response.run_id)
```

#### 2.3 SSE Streaming (useAgentStream.ts)

```typescript
const source = new EventSource(eventsUrl)

source.onopen = () => setStatus('streaming')

source.onmessage = (event) => {
  const parsed = JSON.parse(event.data) as AgentEventAny
  setEvents(prev => [...prev, parsed])

  // Auto-close on run end
  if (parsed.type === 'run' && parsed.subtype === 'end') {
    source.close()
    setStatus('idle')
  }
}

source.onerror = () => {
  setStatus('error')
  // Optional auto-reconnect
}
```

#### 2.4 Render Item Types

```typescript
type ChatRenderItem =
  | UserMessageItem      // role: 'user'
  | ReasoningItem        // type: 'reasoning' (확장 사고)
  | ToolItem             // type: 'tool' (도구 호출)
  | AssistantMessageItem // role: 'assistant'
```

---

### 3. Backend Agent Architecture

#### 3.1 Entry Point

```python
# backend/pluto_duck_backend/agent/core/deep/agent.py

def build_deep_agent(
    conversation_id: str,
    project_id: str | None,
    broker: ApprovalBroker,
    hitl_config: PlutoDuckHITLConfig,
    emit: Callable[[AgentEvent], Awaitable[None]],
    extra_middleware: Iterable[AgentMiddleware] = (),
) -> CompiledStateGraph:
    """
    1. 가상 파일시스템 라우팅 설정
    2. LLM 프로바이더 생성
    3. 미들웨어 스택 구성
    4. create_deep_agent() 호출
    """
```

#### 3.2 Virtual Filesystem Routing

```python
routes = {
    "/workspace/": workspace_fs,    # 대화별 작업 공간
    "/memories/": memories_fs,      # 영구 메모리 저장소
    "/skills/": skills_fs,          # 스킬 라이브러리
}
backend = CompositeBackend(routes=routes)
```

#### 3.3 Middleware Stack (실행 순서)

| 순서 | 미들웨어 | 책임 |
|------|----------|------|
| 1 | `ApprovalPersistenceMiddleware` | HITL 승인 게이트 (write_file, edit_file, task) |
| 2 | `AgentMemoryMiddleware` | 사용자/프로젝트 메모리 로드 및 시스템 프롬프트 주입 |
| 3 | `SkillsMiddleware` | 스킬 카탈로그 로드 및 progressive disclosure |
| 4 | `FilesystemMiddleware` | ls, read_file, write_file, edit_file, glob, grep |
| 5 | `SubAgentMiddleware` | task 도구로 서브에이전트 생성 |
| 6 | `PatchToolCallsMiddleware` | 끊긴 tool_calls 메시지 복구 |

#### 3.4 LLM Invocation Pattern

```python
# LangGraph state graph execution
agent.ainvoke(
    {"messages": messages},
    config={"callbacks": [PlutoDuckEventCallbackHandler(emit)]}
)

# Model generates tool_calls → tool_node executes → ToolMessage returned
# Middleware intercepts: approval check → filesystem eviction → execution
```

---

### 4. Tools Configuration

#### 4.1 Available Tools

| 카테고리 | 도구 | 설명 |
|----------|------|------|
| **Schema** | `list_tables` | DuckDB 테이블 목록 |
| | `describe_table` | 테이블 스키마/메타데이터 |
| | `sample_rows` | 샘플 행 조회 |
| **Query** | `run_sql` | SQL 쿼리 실행 (탐색용) |
| **Asset** | `save_analysis` | SQL을 재사용 가능한 Asset으로 저장 |
| | `run_analysis` | 저장된 분석 실행 |
| | `list_analyses` | 저장된 분석 목록 |
| | `get_analysis` | 분석 상세 조회 |
| | `get_lineage` | 데이터 리니지 (upstream/downstream) |
| | `get_freshness` | 분석 신선도 확인 |
| | `delete_analysis` | 분석 삭제 |
| | `list_files` | 임포트된 파일 에셋 목록 |
| **Source** | `list_sources` | 연결된 데이터 소스 목록 |
| | `list_source_tables` | 소스의 테이블 목록 |
| | `list_cached_tables` | 캐시된 테이블 목록 |

#### 4.2 Tool Registration

```python
# backend/pluto_duck_backend/agent/core/deep/tools/__init__.py

def build_default_tools(*, workspace_root: Path, project_id: str | None):
    tools = [
        *build_schema_tools(warehouse_path=...),
        *build_query_tools(warehouse_path=...),
        *build_asset_tools(warehouse_path=..., project_id=...),
    ]
    if project_id:
        tools.extend(build_source_tools(project_id=...))
    return tools
```

#### 4.3 Tool Execution Flow

```
LLM AIMessage.tool_calls
    ↓
LangGraph tool_node
    ↓
Middleware 인터셉트 (approval, eviction)
    ↓
Tool 함수 실행
    ↓
ToolMessage(content=result)
    ↓
EventCallbackHandler → TOOL/START, TOOL/END 이벤트
    ↓
asyncio.Queue → SSE → Frontend
```

---

### 5. Skills Configuration

#### 5.1 Built-in Skills (4개)

| 스킬 | 설명 | 사용 시점 |
|------|------|----------|
| `source-explorer` | 연결된 데이터 소스 탐색 | 데이터베이스 발견, 테이블 브라우징 |
| `sql-analysis` | DuckDB SQL 분석 워크플로우 | SQL 작성, 데이터 분석, 리포트 생성 |
| `data-lineage` | 데이터 의존성/신선도 추적 | 리니지 파악, 신선도 검증 |
| `skill-creator` | 새 스킬 생성 가이드 | 스킬 정의 생성/수정 |

#### 5.2 Skill Definition Format (SKILL.md)

```yaml
---
name: lowercase-with-hyphens
description: 스킬 사용 시점과 기능 설명
license: (optional)
compatibility: (optional)
metadata: (optional)
allowed-tools: (optional)
---

# Skill Title

워크플로우 단계, 예시, 도구 사용 가이드
```

#### 5.3 Progressive Disclosure Pattern

```python
# SkillsMiddleware가 시스템 프롬프트에 주입하는 내용:
"""
## Skills System

**Available Skills:**
- source-explorer: Explore connected data sources...
  → Path: /skills/user/skills/source-explorer/SKILL.md
- sql-analysis: Workflow for SQL analysis...
  → Path: /skills/user/skills/sql-analysis/SKILL.md

**How to Use:**
1. 적용 가능한 스킬 인식
2. 경로를 통해 전체 내용 읽기 (read_file)
3. 스킬 지시 따르기
"""
```

#### 5.4 Skills vs Tools

| 측면 | Tools | Skills |
|------|-------|--------|
| **메커니즘** | 직접 함수 호출 | Markdown 가이드/워크플로우 |
| **저장소** | Python 코드 | 파일시스템 (SKILL.md) |
| **실행** | 즉시 (tool_node) | 에이전트가 읽고 해석 |
| **발견** | 에이전트 초기화 시 하드코딩 | 디렉토리에서 동적 스캔 |
| **범위** | 전역 | 사용자/프로젝트별 |
| **편집** | 불가 | 사용자 편집 가능 |

---

### 6. Event Streaming Pipeline

#### 6.1 Event Types

```python
class EventType(Enum):
    REASONING = "reasoning"  # LLM 추론 단계
    TOOL = "tool"           # 도구 호출
    MESSAGE = "message"     # 채팅 메시지
    RUN = "run"             # 실행 상태 변경

class EventSubType(Enum):
    START = "start"         # 시작
    CHUNK = "chunk"         # 중간 청크 (스트리밍)
    END = "end"             # 완료
    FINAL = "final"         # 최종 상태
    ERROR = "error"         # 오류
```

#### 6.2 Event Flow

```
LangChain AsyncCallbackHandler
    │
    ├── on_llm_start() → REASONING/START
    ├── on_llm_end()   → REASONING/CHUNK (text 추출)
    ├── on_tool_start() → TOOL/START
    └── on_tool_end()   → TOOL/END
    │
    ▼
EventSink.emit(AgentEvent)
    │
    ▼
AgentRun.queue.put(event.to_dict())
    │
    ▼
StreamingResponse (SSE)
    │ "data: {...}\n\n"
    ▼
Frontend EventSource
    │
    ▼
useAgentStream.events[]
    │
    ▼
useMultiTabChat.turns[]
    │
    ▼
flattenTurnsToRenderItems()
    │
    ▼
ChatRenderItem[] → RenderItem → Specific Renderer
```

---

### 7. API Endpoints

#### 7.1 Chat API

| Endpoint | Method | 설명 |
|----------|--------|------|
| `/api/v1/chat/sessions` | GET | 세션 목록 |
| `/api/v1/chat/sessions` | POST | 새 대화 생성 |
| `/api/v1/chat/sessions/{id}` | GET | 대화 상세 |
| `/api/v1/chat/sessions/{id}` | DELETE | 대화 삭제 |
| `/api/v1/chat/sessions/{id}/messages` | POST | 메시지 추가 |

#### 7.2 Agent API

| Endpoint | Method | 설명 |
|----------|--------|------|
| `/api/v1/agent/run` | POST | 새 에이전트 실행 |
| `/api/v1/agent/{run_id}` | GET | 실행 결과 |
| `/api/v1/agent/{run_id}/events` | GET | SSE 이벤트 스트림 |
| `/api/v1/agent/{run_id}/approvals` | GET | 승인 목록 |
| `/api/v1/agent/{run_id}/approvals/{id}/decision` | POST | 승인 결정 |

#### 7.3 Typical Request/Response

```typescript
// POST /api/v1/chat/sessions
Request: {
  question?: string,
  model?: string,
  metadata?: { context_assets, project_id }
}
Response: {
  id: string,
  run_id?: string,
  events_url?: string  // "/api/v1/agent/{run_id}/events"
}

// SSE Event Format
"data: {
  \"type\": \"tool\",
  \"subtype\": \"end\",
  \"content\": { \"tool\": \"run_sql\", \"output\": {...} },
  \"metadata\": { \"run_id\": \"...\" },
  \"timestamp\": \"2026-01-15T...\"
}\n\n"
```

---

## Code References

### Frontend
- [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx) - 메인 채팅 인터페이스
- [MultiTabChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/MultiTabChatPanel.tsx) - 멀티탭 관리
- [useAgentStream.ts](frontend/pluto_duck_frontend/hooks/useAgentStream.ts) - SSE 스트리밍 훅
- [useMultiTabChat.ts](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts) - 멀티탭 세션 관리
- [chatApi.ts](frontend/pluto_duck_frontend/lib/chatApi.ts) - API 클라이언트
- [RenderItem.tsx](frontend/pluto_duck_frontend/components/chat/renderers/RenderItem.tsx) - 타입별 렌더러 디스패처
- [ToolRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx) - 도구 호출 렌더링

### Backend
- [agent.py](backend/pluto_duck_backend/agent/core/deep/agent.py) - 에이전트 빌더
- [orchestrator.py](backend/pluto_duck_backend/agent/core/orchestrator.py) - 에이전트 실행 관리
- [event_mapper.py](backend/pluto_duck_backend/agent/core/deep/event_mapper.py) - LangChain 콜백 핸들러
- [events.py](backend/pluto_duck_backend/agent/core/events.py) - 이벤트 타입 정의
- [skills.py](backend/pluto_duck_backend/agent/core/deep/middleware/skills.py) - 스킬 미들웨어
- [tools/__init__.py](backend/pluto_duck_backend/agent/core/deep/tools/__init__.py) - 도구 빌더
- [router.py](backend/pluto_duck_backend/app/api/v1/agent/router.py) - 에이전트 API
- [chat/router.py](backend/pluto_duck_backend/app/api/v1/chat/router.py) - 채팅 API

### Skills
- [sql-analysis/SKILL.md](backend/pluto_duck_backend/templates/skills/sql-analysis/SKILL.md)
- [source-explorer/SKILL.md](backend/pluto_duck_backend/templates/skills/source-explorer/SKILL.md)
- [data-lineage/SKILL.md](backend/pluto_duck_backend/templates/skills/data-lineage/SKILL.md)
- [skill-creator/SKILL.md](backend/pluto_duck_backend/templates/skills/skill-creator/SKILL.md)

### Middleware
- [deepagents/middleware/filesystem.py](backend/deepagents/middleware/filesystem.py) - 파일시스템 도구
- [deepagents/middleware/subagents.py](backend/deepagents/middleware/subagents.py) - 서브에이전트
- [deepagents/middleware/patch_tool_calls.py](backend/deepagents/middleware/patch_tool_calls.py) - 도구 호출 패치

---

## Architecture Insights

### 1. Event-Sourced Design
- 모든 에이전트 활동이 이벤트로 캡처되어 스트리밍
- DuckDB에 영구 저장되어 재생/감사 가능
- 프론트엔드는 이벤트 기반으로 UI 상태 파생

### 2. Middleware Pattern
- LangGraph의 미들웨어 아키텍처로 관심사 분리
- 각 미들웨어가 `before_agent`, `wrap_model_call` 훅 구현
- 순차 실행으로 시스템 프롬프트/상태 누적

### 3. Progressive Disclosure for Skills
- 토큰 효율성을 위해 스킬 전문은 필요시에만 로드
- 시스템 프롬프트에는 이름/설명만 포함
- 에이전트가 read_file로 필요한 스킬 내용 조회

### 4. Virtual Filesystem Abstraction
- 모든 파일 경로가 가상 경로 (`/workspace/`, `/memories/`, `/skills/`)
- CompositeBackend가 실제 물리 경로로 라우팅
- 대화/프로젝트 격리 보장

### 5. HITL (Human-in-the-Loop) Integration
- 위험한 도구(write_file, edit_file, task)는 승인 필요
- ApprovalBroker가 asyncio.Future로 실행 차단
- API를 통해 승인/거부/수정 결정

---

## Open Questions

1. **스트리밍 최적화**: 대용량 도구 결과(>20k 토큰)의 eviction 정책 개선 여지
2. **서브에이전트 제한**: 현재 서브에이전트 깊이/폭 제한 메커니즘 미확인
3. **스킬 캐싱**: 스킬 메타데이터가 매 턴 디스크에서 로드되는 것이 성능에 영향
4. **메모리 관리**: 장시간 실행 시 asyncio.Queue 메모리 제한 정책 필요성
