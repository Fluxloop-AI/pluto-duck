---
date: 2026-01-14T00:00:00Z
researcher: Claude
topic: "Tool Call UI - Content Types and Message Classification"
tags: [research, codebase, chat-ui, tool-call, classification, deepagents]
status: complete
---

# Research: Tool Call UI Content Types and Message Classification

## Research Question
Tool Call UI에 나타날 수 있는 내용의 유형과 메시지 종류 파악, 표시 방법 분류

---

## Summary

Tool Call UI는 **3가지 상태**와 **2가지 특수 렌더링 모드**로 구성됩니다:
- **상태**: pending (실행 중), completed (완료), error (오류)
- **특수 렌더링**: `write_todos` (Task Queue), 일반 Tool (Collapsible)

현재 **2개의 Tool 시스템**이 존재합니다:
1. **Deepagents Filesystem Tools** - 파일 시스템 조작 (`ls`, `read_file`, `edit_file` 등)
2. **Pluto Duck Backend Tools** - 데이터 분석 (`run_sql`, `list_tables` 등)

---

## 1. Tool Call에 나타날 수 있는 내용 유형

### 1.1 Tool 상태 (ToolItem.state)

| 상태 | 설명 | UI 표시 |
|------|------|---------|
| `pending` | 도구 실행 중 | 로딩 아이콘, "Pending" 뱃지 |
| `completed` | 도구 실행 완료 | 체크 아이콘 (녹색), "Done" 뱃지 |
| `error` | 도구 실행 실패 | X 아이콘 (빨강), "Error" 뱃지 |

### 1.2 UI 레벨 상태 (ToolUIState) - 확장된 상태

```typescript
// tool-types.ts
type ToolUIState =
  | "input-streaming"      // 입력 스트리밍 중
  | "input-available"      // 입력 완료, 실행 대기
  | "approval-requested"   // 사용자 승인 요청 (노랑)
  | "approval-responded"   // 승인 응답됨 (파랑)
  | "output-available"     // 결과 사용 가능 (녹색)
  | "output-error"         // 오류 발생 (빨강)
  | "output-denied"        // 거부됨 (주황)
```

---

## 2. 사용 가능한 Tool 목록

### 2.1 Deepagents Filesystem Tools (주요 사용)

**파일**: [filesystem.py](backend/deepagents/middleware/filesystem.py)

| Tool 이름 | 용도 | Input | 실제 Output Content |
|-----------|------|-------|---------------------|
| `ls` | 디렉토리 목록 | `{path: string}` | `['/path/to/file1', '/path/to/file2']` |
| `read_file` | 파일 읽기 | `{file_path, offset?, limit?}` | 줄번호 포함 파일 내용 (cat -n 형식) |
| `write_file` | 파일 생성 | `{file_path, content}` | `Updated file /path/to/file.txt` |
| `edit_file` | 파일 수정 | `{file_path, old_string, new_string}` | `Successfully replaced N instance(s)...` |
| `glob` | 패턴 파일 검색 | `{pattern, path?}` | 매칭된 파일 경로 목록 |
| `grep` | 텍스트 검색 | `{pattern, path?, glob?, output_mode?}` | 검색 결과 (파일/라인/카운트) |
| `execute` | 명령 실행 | `{command}` | 명령 출력 + exit code |

### 2.2 Pluto Duck Backend Tools (데이터 분석)

#### Schema Tools (스키마 조회)
| Tool 이름 | 용도 | Input | Output |
|-----------|------|-------|--------|
| `list_tables` | 테이블 목록 조회 | `{include_views?: boolean}` | 테이블명 배열 |
| `describe_table` | 테이블 구조 조회 | `{table: string}` | 컬럼 정보, 타입, 행 수 |
| `sample_rows` | 샘플 데이터 조회 | `{table: string, limit?: number}` | 샘플 행 데이터 |

#### Query Tools (쿼리 실행)
| Tool 이름 | 용도 | Input | Output |
|-----------|------|-------|--------|
| `run_sql` | SQL 실행 | `{sql: string}` | `{run_id, result_table, error?, preview}` |

#### Asset Tools (분석 자산 관리)
| Tool 이름 | 용도 | Input | Output |
|-----------|------|-------|--------|
| `save_analysis` | 분석 저장 | `{name, sql, materialize?, tags?}` | 저장 결과 |
| `run_analysis` | 분석 실행 | `{name, params?}` | 실행 결과 |
| `list_analyses` | 분석 목록 | `{tag?: string}` | 분석 목록 |
| `get_analysis` | 분석 상세 | `{name: string}` | SQL, 파라미터, 태그 |
| `get_lineage` | 데이터 계보 | `{name: string}` | 의존성 그래프 |
| `get_freshness` | 신선도 확인 | `{name: string}` | 재실행 필요 여부 |
| `delete_analysis` | 분석 삭제 | `{name: string}` | 삭제 결과 |
| `list_files` | 파일 자산 목록 | `{}` | CSV/Parquet 파일 목록 |

#### Source Tools (외부 소스 연결)
| Tool 이름 | 용도 | Input | Output |
|-----------|------|-------|--------|
| `list_sources` | 소스 목록 | `{}` | 연결된 데이터 소스 목록 |
| `list_source_tables` | 소스 테이블 목록 | `{source: string}` | 테이블 목록 |
| `list_cached_tables` | 캐시 테이블 목록 | `{}` | 로컬 캐시된 테이블 목록 |

#### Special Tools (특수 도구)
| Tool 이름 | 용도 | Input | Output |
|-----------|------|-------|--------|
| `write_todos` | 할 일 목록 관리 | `{todos: Todo[]}` | 업데이트된 목록 |

---

## 3. 현재 Output 표시 문제점 (ToolMessage Wrapper 이슈)

### 3.1 문제 현상

현재 Tool 결과가 **LangChain ToolMessage 객체 전체**가 직렬화되어 표시됩니다.

**현재 표시되는 형태** (문제):
```json
{
  "type": "tool",
  "content": "['/memories/projects/', '/memories/user']",
  "tool_call_id": "call_tuWxnrktQIi3jIYLEnU4NWu..."
}
```

**사용자에게 보여야 할 형태**:
```
['/memories/projects/', '/memories/user']
```

### 3.2 문제 원인

**[event_mapper.py:52-59](backend/pluto_duck_backend/agent/core/deep/event_mapper.py#L52-L59)**:

```python
def _json_safe(self, value: Any) -> Any:
    # ToolMessage 전체를 직렬화
    if isinstance(value, ToolMessage):
        payload: dict[str, Any] = {
            "type": getattr(value, "type", value.__class__.__name__),
            "content": getattr(value, "content", None),  # ← 이것만 필요
        }
        if isinstance(value, ToolMessage):
            payload["tool_call_id"] = getattr(value, "tool_call_id", None)  # ← 불필요
        return payload
```

### 3.3 데이터 흐름 상세

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Backend (Python)                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Tool 실행 (filesystem.py)                                                │
│     └── ls("/memories/") → "['/memories/projects/', '/memories/user']"      │
│                                                                              │
│  2. LangChain이 ToolMessage 생성                                             │
│     └── ToolMessage(content="[...]", tool_call_id="call_xxx")               │
│                                                                              │
│  3. 이벤트 변환 (event_mapper.py:117-128)                                     │
│     └── on_tool_end(output) → _json_safe(output)                            │
│         ↓                                                                    │
│     ToolMessage 전체 직렬화:                                                  │
│     { "type": "tool",                                                        │
│       "content": "['/memories/...']",     ← 실제 결과                        │
│       "tool_call_id": "call_xxx" }        ← 내부 추적용 (불필요)              │
│                                                                              │
│  4. SSE로 전송                                                               │
│     AgentEvent(type=TOOL, subtype=END, content={                            │
│       "tool": "ls",                                                          │
│       "output": { "type": "tool", "content": "...", "tool_call_id": "..." } │
│     })                                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Frontend (TypeScript)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  5. SSE 수신 (useAgentStream.ts)                                             │
│     event.content.output → 그대로 저장                                       │
│                                                                              │
│  6. Tool 그룹핑 (useMultiTabChat.ts:447-494)                                 │
│     GroupedToolEvent.output = event.content.output                          │
│                                                                              │
│  7. RenderItem 변환 (chatRenderUtils.ts:85-99)                               │
│     ToolItem.output = GroupedToolEvent.output                               │
│                                                                              │
│  8. 렌더링 (ToolRenderer.tsx:195-199)                                        │
│     JSON.stringify(item.output, null, 2) → ToolOutput에 전달                 │
│                                                                              │
│  9. 표시 (tool.tsx:137-143)                                                  │
│     CodeBlock으로 JSON 전체 표시 (wrapper 포함)                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Tool별 실제 Content vs 현재 표시

| Tool | 실제 반환 Content | 현재 표시 (문제) |
|------|-------------------|------------------|
| `ls` | `['/memories/projects/', '/memories/user']` | `{"type": "tool", "content": "[...]", "tool_call_id": "..."}` |
| `read_file` | `     1→# File content\n     2→line 2...` | `{"type": "tool", "content": "     1→...", "tool_call_id": "..."}` |
| `write_file` | `Updated file /path/to/file.txt` | `{"type": "tool", "content": "Updated...", "tool_call_id": "..."}` |
| `edit_file` | `Successfully replaced 1 instance(s)...` | `{"type": "tool", "content": "Successfully...", "tool_call_id": "..."}` |
| `glob` | `/src/main.py\n/test.py` | 동일한 wrapper |
| `grep` | `file.py:\n  12: matched line` | 동일한 wrapper |

### 3.5 수정 방안

**Option A: Frontend에서 content 추출** (권장)
```typescript
// ToolRenderer.tsx 또는 tool.tsx에서
const actualContent = output?.content ?? output;
```

**Option B: Backend에서 content만 전송**
```python
# event_mapper.py에서
if isinstance(value, ToolMessage):
    return value.content  # wrapper 없이 content만
```

---

## 4. 메시지 타입 분류 및 표시 방법

### 4.1 현재 렌더링 분류 (2가지)

#### A. 일반 Tool (Collapsible 형태)

```
┌─────────────────────────────────────────────────┐
│ 🔧 Read File · config.json          [Done ✓]  ▼│
├─────────────────────────────────────────────────┤
│ Parameters                                      │
│ ┌─────────────────────────────────────────────┐ │
│ │ { "file_path": "/config.json" }             │ │
│ └─────────────────────────────────────────────┘ │
│ Result                                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ (파일 내용 또는 결과 메시지)                   │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**파일**: [ToolRenderer.tsx:186-203](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx#L186-L203)

#### B. Todo List (Queue 형태)

```
┌─────────────────────────────────────────────────┐
│ Tasks (2/5)                                     │
├─────────────────────────────────────────────────┤
│ ✓ 데이터 로드하기                                │
│ ✓ 스키마 분석하기                                │
│ ○ 쿼리 작성하기                                  │
│ ○ 결과 검증하기                                  │
│ ○ 분석 저장하기                                  │
└─────────────────────────────────────────────────┘
```

**파일**: [ToolRenderer.tsx:150-180](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx#L150-L180)

---

### 4.2 제안: 확장된 메시지 타입 분류

Tool의 **목적**과 **출력 형태**에 따라 더 세분화된 분류:

#### Category A: 파일 시스템 (Filesystem)
- **특징**: 파일/디렉토리 작업, 텍스트 결과
- **Tools**: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`
- **제안 UI**: 파일 경로는 링크로, 파일 내용은 코드 블록으로

#### Category B: 데이터 조회 (Data Retrieval)
- **특징**: 테이블/데이터 형태의 결과 반환
- **Tools**: `list_tables`, `describe_table`, `sample_rows`, `run_sql`
- **제안 UI**: 테이블 형태로 결과 표시

#### Category C: 작업 관리 (Task Management)
- **특징**: 진행 상태/목록 관리
- **Tools**: `write_todos`
- **현재 UI**: Queue 컴포넌트 (이미 구현됨)

#### Category D: 메타데이터 조회 (Metadata Query)
- **특징**: 구조/설정 정보 반환
- **Tools**: `get_analysis`, `get_lineage`, `list_analyses`, `list_sources`
- **제안 UI**: 구조화된 정보 카드

#### Category E: 상태 변경 (State Mutation)
- **특징**: CRUD 작업, 성공/실패 결과
- **Tools**: `save_analysis`, `delete_analysis`, `run_analysis`
- **제안 UI**: 간단한 상태 메시지 + 아이콘

#### Category F: 명령 실행 (Command Execution)
- **특징**: 셸 명령 실행, stdout/stderr 출력
- **Tools**: `execute`
- **제안 UI**: 터미널 스타일 출력

---

## 5. Tool Input/Output 구조 상세

### 5.1 Input 구조

**현재 처리 방식** ([ToolRenderer.tsx:41-63](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx#L41-L63)):
```typescript
// 주요 파라미터 추출 우선순위
const keyFields = [
  'file_path', 'filePath', 'path',      // 파일 작업
  'command', 'cmd',                      // 명령 실행
  'query', 'search', 'pattern',          // 검색 작업
  'url', 'uri',                          // 네트워크 작업
  'name', 'title',                       // 일반 식별자
];
```

### 5.2 Filesystem Tools Output 형식

| Tool | 반환 형식 | 예시 |
|------|----------|------|
| `ls` | 경로 배열 (string) | `"['/dir/file1', '/dir/file2']"` |
| `read_file` | 줄번호 포함 텍스트 | `"     1→line1\n     2→line2"` |
| `write_file` | 성공 메시지 | `"Updated file /path/to/file.txt"` |
| `edit_file` | 성공 메시지 | `"Successfully replaced 1 instance(s) of the string in '/path'"` |
| `glob` | 파일 경로 목록 | `"/src/main.py\n/test.py"` |
| `grep` | 검색 결과 | `"file.py:\n  12: matched line"` |
| `execute` | 명령 출력 + exit code | `"output...\n[Command succeeded with exit code 0]"` |

---

## 6. 현재 UI 컴포넌트 구조

```
ToolRenderer
├── write_todos?
│   └── Queue (ai-elements/queue.tsx)
│       ├── QueueList
│       └── QueueItem
│           ├── QueueItemIndicator (○/✓)
│           └── QueueItemContent
│
└── Other tools
    └── Tool (ai-elements/tool.tsx)
        ├── ToolHeader
        │   ├── WrenchIcon
        │   ├── Title (toolName · keyParam)
        │   ├── StatusBadge
        │   └── ChevronIcon
        └── ToolContent (Collapsible)
            ├── ToolInput (JSON CodeBlock)
            └── ToolOutput (JSON CodeBlock / Error)
```

---

## Code References

### 핵심 파일 (Frontend)
- [ToolRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx) - 렌더링 분기 로직
- [tool.tsx](frontend/pluto_duck_frontend/components/ai-elements/tool.tsx) - Tool UI 컴포넌트
- [tool-types.ts](frontend/pluto_duck_frontend/components/ai-elements/tool-types.ts) - 타입 정의
- [queue.tsx](frontend/pluto_duck_frontend/components/ai-elements/queue.tsx) - Todo Queue 컴포넌트
- [chatRenderItem.ts](frontend/pluto_duck_frontend/types/chatRenderItem.ts) - ToolItem 타입

### 데이터 변환 (Frontend)
- [useMultiTabChat.ts:447-494](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts#L447-L494) - Tool 이벤트 그룹핑
- [chatRenderUtils.ts:42-119](frontend/pluto_duck_frontend/lib/chatRenderUtils.ts#L42-L119) - RenderItem 변환
- [useAgentStream.ts](frontend/pluto_duck_frontend/hooks/useAgentStream.ts) - SSE 수신

### Deepagents Filesystem Tools (Backend)
- [filesystem.py](backend/deepagents/middleware/filesystem.py) - Tool 정의 및 구현
- [utils.py](backend/deepagents/backends/utils.py) - 출력 포맷팅 유틸리티
- [event_mapper.py](backend/pluto_duck_backend/agent/core/deep/event_mapper.py) - 이벤트 변환 (문제 원인)

### Pluto Duck Backend Tools
- [schema.py](backend/pluto_duck_backend/agent/core/deep/tools/schema.py) - 스키마 조회 도구
- [query.py](backend/pluto_duck_backend/agent/core/deep/tools/query.py) - SQL 실행 도구
- [asset.py](backend/pluto_duck_backend/agent/core/deep/tools/asset.py) - 분석 자산 도구
- [source.py](backend/pluto_duck_backend/agent/core/deep/tools/source.py) - 데이터 소스 도구

---

## Architecture Insights

### 현재 아키텍처의 특징

1. **2-track 렌더링**: `write_todos`만 특별 처리, 나머지는 동일한 Collapsible 형태
2. **상태 단순화**: 백엔드 7가지 상태 → 프론트엔드 3가지 상태로 매핑
3. **입력 요약**: 주요 파라미터만 헤더에 표시, 상세는 확장 시 표시
4. **출력 형식**: 모든 출력을 JSON CodeBlock으로 통일

### 발견된 문제점

1. **ToolMessage Wrapper 노출**: 사용자에게 불필요한 메타데이터(`type`, `tool_call_id`) 표시
2. **Output 타입 미구분**: 파일 내용, 목록, 상태 메시지 모두 동일한 JSON 형태로 표시
3. **Input 표시 형식**: Python dict 형태로 표시됨 (`"{'path': '/memories/'}"`)

### 개선 가능한 부분

1. **Output content 추출**: wrapper에서 `content` 값만 추출하여 표시
2. **카테고리별 특화 렌더링**: 파일 내용은 코드 블록, 목록은 리스트, 상태는 간단한 메시지
3. **승인 플로우 UI**: `approval-requested`, `approval-responded` 상태 활용
4. **에러 세분화**: 에러 타입별 다른 안내 메시지
5. **실시간 진행률**: 긴 작업의 경우 진행 상태 표시

---

## Open Questions

1. **Output 수정 위치**: Frontend에서 content 추출 vs Backend에서 content만 전송?
2. **승인 플로우**: `approval-requested` 상태의 UI는 현재 미사용 - 활성화 필요?
3. **결과 미리보기**: SQL 실행 결과를 테이블로 미리보기 표시할지?
4. **Tool 그룹핑**: 연속된 같은 종류의 Tool 호출을 그룹핑할지?
5. **히스토리**: Tool 실행 히스토리를 별도로 관리할 필요 있는지?
