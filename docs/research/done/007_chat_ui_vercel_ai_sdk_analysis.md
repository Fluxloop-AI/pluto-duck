---
date: 2026-01-13T00:00:00Z
researcher: Claude
topic: "Chat UI Structure & Vercel AI SDK Usage Analysis"
tags: [research, codebase, chat, ui, vercel-ai-sdk, ai-elements, shadcn, streaming, architecture]
status: complete
---

# Research: Chat UI Structure & Vercel AI SDK Usage Analysis

## Research Question
채팅 UI 구조 파악 및 Vercel AI SDK 사용 여부 분석

## Summary

Vercel AI 생태계는 크게 두 부분으로 나뉩니다:

| 구분 | 패키지 | 역할 | 현재 사용 |
|------|--------|------|----------|
| **AI SDK** | `ai`, `@ai-sdk/react` | Hooks & Types | 타입만 사용 |
| **AI Elements** | shadcn 레지스트리 | UI 컴포넌트 | ✅ 사용 중 |

채팅 UI는 **AI Elements로 UI 컴포넌트**를 구성하고, 상태 관리와 스트리밍은 **커스텀 구현**되어 있습니다.

| 항목 | Vercel AI SDK 표준 | 현재 구현 |
|------|-------------------|----------|
| UI 컴포넌트 | AI Elements | ✅ AI Elements 사용 |
| 채팅 훅 | `useChat` | `useMultiTabChat` (커스텀) |
| 스트리밍 | fetch + async iterator | EventSource (SSE) |
| 메시지 관리 | 자동 누적 | 수동 상태 관리 |
| 도구 처리 | 자동 | 커스텀 그룹핑 로직 |

## Detailed Findings

### 1. 패키지 의존성

**파일**: `frontend/pluto_duck_frontend/package.json`

```json
{
  "ai": "^5.0.76",
  "@ai-sdk/react": "^2.0.76"
}
```

- 두 패키지 모두 설치되어 있지만 **타입 임포트용으로만 사용**
- `useChat`, `useCompletion`, `useAssistant` 훅 **미사용**
- `streamText`, `generateText` 함수 **미사용**

### 2. AI SDK 타입 사용 현황

| 타입 | 파일 | 용도 |
|------|------|------|
| `UIMessage` | message.tsx, branch.tsx | 메시지 역할(user/assistant) 타입 |
| `FileUIPart` | prompt-input.tsx | 파일 첨부 메타데이터 |
| `ChatStatus` | prompt-input.tsx | 전송 버튼 상태 (submitted/streaming/error) |
| `LanguageModelUsage` | context.tsx | 토큰 사용량 추적 |
| `ToolUIPart` | ChatPanel.tsx | 도구 실행 UI 상태 |
| `Experimental_GeneratedImage` | image.tsx | 생성된 이미지 데이터 |

### 3. AI Elements (UI 컴포넌트 라이브러리)

#### 3.1 AI Elements란?

**AI Elements**는 Vercel에서 제공하는 **공식 UI 컴포넌트 라이브러리**입니다.

```
┌─────────────────────────────────────────────────────────────────┐
│ Vercel AI 생태계                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 1. AI SDK (ai, @ai-sdk/react)                                   │
│    → Hooks & Types만 제공 (UI 없음)                              │
│    → useChat, useCompletion, UIMessage 등                       │
├─────────────────────────────────────────────────────────────────┤
│ 2. AI Elements (shadcn 레지스트리)                               │
│    → UI 컴포넌트 제공                                            │
│    → conversation, message, prompt-input, tool 등               │
│    → shadcn/ui 기반, 커스터마이징 가능                           │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 설치 방법

```bash
# AI Elements CLI로 설치 (권장)
npx ai-elements@latest

# 또는 shadcn CLI로 개별 설치
npx shadcn@latest add https://registry.ai-sdk.dev/tool.json
npx shadcn@latest add https://registry.ai-sdk.dev/conversation.json

# 전체 설치
npx shadcn@latest add https://registry.ai-sdk.dev/all.json
```

#### 3.3 shadcn 방식의 특징

| 특징 | 설명 |
|------|------|
| npm 패키지 아님 | `node_modules`에 없음 |
| 소스 코드 복사 | 설치 시 프로젝트에 직접 복사됨 |
| 커스터마이징 가능 | 복사된 코드 자유롭게 수정 가능 |
| 의존성 독립 | 버전 업데이트에 영향 안 받음 |

#### 3.4 현재 프로젝트에 설치된 AI Elements 컴포넌트

**위치**: `components/ai-elements/`

| 카테고리 | 컴포넌트 |
|---------|----------|
| **Chatbot** | conversation, message, prompt-input, tool, reasoning, code-block, actions, branch, chain-of-thought, context, image, inline-citation, loader, open-in-chat, plan, queue, response, shimmer, sources, suggestion, task, confirmation |
| **Vibe-Coding** | artifact, web-preview |
| **Workflow** | canvas, connection, controls, edge, node, panel, toolbar |

총 **32개 컴포넌트** 설치됨.

#### 3.5 주요 컴포넌트 사용 현황

| 컴포넌트 | 파일 | 용도 |
|---------|------|------|
| `Conversation` | conversation.tsx | 스크롤 컨테이너 (StickToBottom) |
| `PromptInput` | prompt-input.tsx | 입력창 (모델 선택, 파일 첨부 등) |
| `Tool` | tool.tsx | 도구 실행 카드 (Collapsible 기반) |
| `Reasoning` | reasoning.tsx | AI 추론 과정 표시 |
| `CodeBlock` | code-block.tsx | 코드 블록 (구문 강조) |
| `Message` | message.tsx | 메시지 컨테이너 |
| `Response` | response.tsx | AI 응답 포맷팅 |

### 4. 실제 채팅 아키텍처 (커스텀 구현)

```
┌─────────────────────────────────────────────────────────────────┐
│                        ChatPanel (UI)                           │
│  - 입력 상태 관리 (input, mentionOpen)                          │
│  - 메시지 렌더링만 담당                                          │
└─────────────────────────────────────────────────────────────────┘
                               ↓ props
┌─────────────────────────────────────────────────────────────────┐
│               useMultiTabChat (상태 관리 허브)                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ State                                                     │  │
│  │ - sessions: ChatSessionSummary[]                          │  │
│  │ - tabs: ChatTab[] (최대 10개)                              │  │
│  │ - activeTabId: string | null                              │  │
│  │ - tabStatesRef: Map<string, TabChatState>                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Computed                                                  │  │
│  │ - turns: ChatTurn[] (메모이제이션)                         │  │
│  │ - isStreaming: boolean                                    │  │
│  │ - lastAssistantMessageId: string                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               ↓ uses
┌─────────────────────────────────────────────────────────────────┐
│                 useAgentStream (스트리밍)                        │
│  - EventSource로 SSE 연결                                       │
│  - URL: /api/v1/agent/{runId}/events                           │
│  - 상태: 'idle' | 'connecting' | 'streaming' | 'error'          │
│  - 자동 재연결 (2초 간격)                                        │
│  - 최근 150개 이벤트만 메모리 유지                               │
└─────────────────────────────────────────────────────────────────┘
                               ↓ calls
┌─────────────────────────────────────────────────────────────────┐
│                      chatApi (REST API)                         │
│  - createConversation(): 새 대화 생성                           │
│  - appendMessage(): 메시지 추가                                  │
│  - fetchDetail(): 세션 상세 조회                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5. 데이터 플로우

#### 5.1 메시지 전송 흐름

```
사용자 입력 (ChatPanel)
    ↓
handleSubmit() → SubmitPayload { prompt, contextAssets? }
    ↓
useMultiTabChat.handleSubmit()
    ├─ 새 대화: createConversation() API
    └─ 기존 대화: appendMessage() API
    ↓
Response { run_id, conversation_id }
    ↓
useAgentStream이 EventSource 스트림 시작
    ↓
서버가 SSE로 AgentEvent 전송
    ↓
streamEvents[]에 이벤트 누적
    ↓
turns 메모이제이션이 storedEvents + streamEvents 병합
    ↓
ChatPanel 리렌더링
```

#### 5.2 스트림 종료 감지

```typescript
// useMultiTabChat.ts:289-299
const runHasEndedStream = useMemo(
  () =>
    streamEvents.some(event =>
      (event.type === 'run' && event.subtype === 'end') ||
      (event.type === 'message' && event.subtype === 'final'),
    ),
  [streamEvents],
);

const isStreaming = (streamStatus === 'streaming' || streamStatus === 'connecting')
  && !runHasEndedStream;
```

### 6. 도구(Tool) 처리 로직

#### 6.1 이벤트 그룹핑 알고리즘

**파일**: `hooks/useMultiTabChat.ts:442-485`

```typescript
interface GroupedToolEvent {
  toolName: string;
  state: 'pending' | 'completed' | 'error';
  input?: string;
  output?: any;
  error?: string;
  startEvent?: ChatEvent;
  endEvent?: ChatEvent;
}
```

처리 순서:
1. `turn.events`에서 `type === 'tool'` 필터링
2. `toolMap`을 `${toolName}-${counter}`로 인덱싱
3. **Start 이벤트**: input과 함께 pending 상태로 생성
4. **End 이벤트**: 같은 이름의 가장 최근 pending 도구 찾아 output 업데이트
5. **Error 이벤트**: 상태를 'error'로 변경
6. **고아 이벤트**: 매칭되지 않은 end 이벤트는 새 항목 생성

#### 6.2 헬퍼 함수들

**파일**: `components/chat/ChatPanel.tsx:88-136`

```typescript
getToolState()   // 이벤트 subtype → UI 상태 매핑
getToolType()    // 도구 이름 추출
getToolInput()   // 입력 파라미터 정규화
getToolOutput()  // 출력/결과 정규화
getToolError()   // 에러 메시지 추출
```

### 7. Vercel AI SDK 표준과의 비교

#### 7.1 사용하지 않는 기능

| Vercel AI SDK 기능 | 현재 상태 | 대체 구현 |
|-------------------|----------|----------|
| `useChat` 훅 | ❌ 미사용 | `useMultiTabChat` |
| `useAssistant` 훅 | ❌ 미사용 | 커스텀 로직 |
| fetch 스트리밍 | ❌ 미사용 | EventSource (SSE) |
| 자동 메시지 누적 | ❌ 미사용 | 수동 상태 관리 |
| Vercel 메시지 포맷 | ❌ 미사용 | 커스텀 포맷 |

#### 7.2 커스텀 구현의 이유

| 요구사항 | Vercel AI SDK | 커스텀 구현 |
|---------|--------------|------------|
| 멀티탭 지원 | ❌ 단일 대화 | ✅ 최대 10개 동시 관리 |
| 복잡한 이벤트 처리 | ❌ 기본 메시지만 | ✅ reasoning, tool, custom events |
| 도구 호출 그룹핑 | ❌ 자동 | ✅ start/end 매칭 로직 |
| 백엔드 통합 | OpenAI 클라이언트 | 직접 REST API |

### 8. 컴포넌트 구조 요약

```
MultiTabChatPanel
├── TabBar (px-2 pt-3 pb-1)
│   └── 탭 목록 + 새 탭 버튼 + 히스토리 버튼
└── ChatPanel
    ├── Conversation (ConversationContent p-4)
    │   └── Turn (px-4 py-6 space-y-4)
    │       ├── User Message (rounded-2xl bg-primary px-4 py-3)
    │       ├── Reasoning (Collapsible)
    │       ├── Tool Events (space-y-2)
    │       │   └── Tool (mb-2 border rounded-md)
    │       │       ├── ToolHeader (px-2 py-1.5)
    │       │       ├── ToolInput (px-2 pb-2)
    │       │       └── ToolOutput (px-2 pb-2)
    │       └── Assistant Message (prose)
    └── Input Area (pt-4)
        └── PromptInput (px-4 pb-4)
            └── InputGroup (border rounded-md)
```

## Code References

### 핵심 파일

| 파일 | 역할 |
|------|------|
| [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx) | 채팅 UI 렌더링 |
| [useMultiTabChat.ts](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts) | 멀티탭 상태 관리 |
| [useAgentStream.ts](frontend/pluto_duck_frontend/hooks/useAgentStream.ts) | SSE 스트리밍 |
| [chatApi.ts](frontend/pluto_duck_frontend/lib/chatApi.ts) | REST API 클라이언트 |
| [tool.tsx](frontend/pluto_duck_frontend/components/ai-elements/tool.tsx) | 도구 카드 UI |

### AI SDK 타입 사용 파일

| 파일 | 임포트 | 라인 |
|------|--------|------|
| message.tsx | `UIMessage` | 7 |
| branch.tsx | `UIMessage` | 5 |
| image.tsx | `Experimental_GeneratedImage` | 2 |
| prompt-input.tsx | `ChatStatus`, `FileUIPart` | 38 |
| context.tsx | `LanguageModelUsage` | 11 |
| ChatPanel.tsx | `ToolUIPart` | 5 |

## Architecture Insights

### 1. 타입-온리 의존성
- Vercel AI SDK는 런타임 기능이 아닌 TypeScript 타입만 사용
- 실제 채팅 로직은 100% 커스텀 구현
- 향후 AI SDK 훅으로 마이그레이션 가능하나 현재는 독립적

### 2. Redux-like 패턴
- `useMultiTabChat`이 중앙 "스토어" 역할
- 스트림 이벤트가 "액션"처럼 동작
- `turns`, `isStreaming` 등이 "셀렉터" 역할
- 비동기 사이드 이펙트는 `useEffect`로 처리

### 3. 메모이제이션 전략
- `turns` 계산이 핵심 메모이제이션
- 입력 변경 시 불필요한 리렌더링 방지
- `ConversationMessages` 컴포넌트도 별도 메모이제이션

## Open Questions

1. **AI Elements 커스터마이징**: 현재 기본 디자인이 다소 단순함 - Tool 카드, 메시지 버블 등 UI 개선 필요
2. **AI SDK 훅 마이그레이션 여부**: `useChat` 사용 시 멀티탭 지원 방법?
3. **메모리 관리**: 150개 이벤트 제한이 긴 대화에서 문제가 될 수 있음
4. **도구 매칭 로직**: 동일 이름 도구 동시 실행 시 순서 의존성 문제
5. **@ai-sdk/react 미사용**: 설치되어 있으나 실제 임포트 없음 - 제거 가능?
