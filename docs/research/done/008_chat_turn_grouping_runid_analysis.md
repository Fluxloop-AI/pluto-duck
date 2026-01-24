---
date: 2026-01-13T00:00:00Z
researcher: Claude
topic: "Chat Turn 그룹핑과 runId 의존성 분석"
tags: [research, codebase, chat, turn, runid, streaming, architecture]
status: complete
---

# Research: Chat Turn 그룹핑과 runId 의존성 분석

## Research Question
채팅 UI에서 유저 인풋과 response가 하나의 group으로 묶이는 구조(Turn 기반)와 runId의 관계, 그리고 이 구조에 의존하는 코드들 분석

## Summary

현재 채팅 UI는 **Turn 기반 그룹핑** 구조를 사용합니다. 이는 `runId`를 키로 하여 사용자 메시지, 어시스턴트 응답, 도구 실행, reasoning을 하나의 단위로 묶습니다.

| 구분 | 역할 | 필수 여부 |
|------|------|----------|
| **runId** | 백엔드 스트리밍 연결, 이벤트 매핑 | ✅ 필수 |
| **Turn 그룹핑** | UI에서 질문-응답 쌍을 시각적으로 묶음 | ❌ 선택 (디자인 결정) |

## Detailed Findings

### 1. ChatTurn 타입 정의

**파일**: `hooks/useMultiTabChat.ts:52-64`

```typescript
export interface ChatTurn {
  key: string;                      // 고유 식별자 (run-{runId} 또는 message-{messageId})
  runId: string | null;             // 실행 ID (핵심!)
  seq: number;                      // 시퀀스 번호 (정렬용)
  userMessages: DetailMessage[];    // 사용자 메시지들
  assistantMessages: DetailMessage[];   // 어시스턴트 메시지들
  otherMessages: DetailMessage[];   // 기타 메시지들
  events: ChatEvent[];              // 해당 runId의 모든 이벤트
  reasoningText: string;            // 추출된 reasoning 텍스트
  toolEvents: ChatEvent[];          // 도구 실행 이벤트들
  groupedToolEvents: GroupedToolEvent[];  // 도구들을 start/end로 그룹화
  isActive: boolean;                // 스트리밍 중인가?
}
```

### 2. runId 사용처 분석

#### 2.1 Turn 생성 시점
**파일**: `useMultiTabChat.ts:302-493`

| 위치 | 용도 | 설명 |
|------|------|------|
| 라인 354 | key 생성 | `key: run-${runId}` 형태의 고유 키 |
| 라인 375 | 그룹화 | `message.run_id ?? null`로 메시지 분류 |
| 라인 425 | 이벤트 매핑 | `eventsByRunId.get(turn.runId)` |
| 라인 426 | 활성 상태 판별 | `isActive = isStreaming && turn.runId === activeRunId` |

#### 2.2 API 호출에서의 runId
**파일**: `useMultiTabChat.ts:176-181`

```typescript
const { events: streamEvents, status: streamStatus, reset: resetStream } = useAgentStream({
  runId: activeRunId ?? undefined,
  eventsPath: activeRunId ? `/api/v1/agent/${activeRunId}/events` : undefined,
  enabled: !!activeTabId && !!activeRunId,
  autoReconnect: false,
});
```

- `activeRunId`를 기반으로 SSE 연결
- `/api/v1/agent/{runId}/events` 경로에서 스트림 수신

#### 2.3 메시지 생성/추가 시 runId

**새 대화 생성** (`useMultiTabChat.ts:719`):
```typescript
const response = await createConversation({
  question: prompt,
  model: selectedModel,
  metadata,
});
// response.run_id를 activeRunId로 설정
```

**메시지 추가** (`useMultiTabChat.ts:778`):
```typescript
const response = await appendMessage(currentTab.sessionId, {
  role: 'user',
  content: { text: prompt },
  model: selectedModel,
});
// response.run_id로 업데이트
```

### 3. 데이터 흐름 다이어그램

```
API 응답 (createConversation/appendMessage)
           │
           ▼
    response.run_id
           │
           ▼
    activeRunId (TabChatState)
           │
    ┌──────┴──────┬────────────┐
    │             │            │
    ▼             ▼            ▼
useAgentStream  Turn.runId  Turn.events
   (SSE)        (key)      (매핑)
    │             │            │
    │             ▼            │
    │      Turn.isActive       │
    │      (activeRunId 비교)  │
    │             │            │
    └─────────────┼────────────┘
                  │
                  ▼
         ChatPanel 렌더링
    (Reasoning, Tools 표시)
```

### 4. ChatTurn을 사용하는 컴포넌트

#### 4.1 ChatPanel (메인 렌더링)
**파일**: `components/chat/ChatPanel.tsx:202-375`

```typescript
{turns.map(turn => (
  <div key={turn.key} className="group pl-[14px] pr-3 py-6 space-y-4">
    {/* User Messages */}
    {turn.userMessages.map(message => ...)}

    {/* Reasoning Section */}
    {turn.runId && (turn.isActive || turn.reasoningText) && (
      <Reasoning isStreaming={turn.isActive} defaultOpen={true}>
        <ReasoningTrigger />
        <ReasoningContent>{turn.reasoningText || ''}</ReasoningContent>
      </Reasoning>
    )}

    {/* Tool Events */}
    {turn.groupedToolEvents.length > 0 && (
      <div className="space-y-2">
        {turn.groupedToolEvents.map((grouped, index) => (
          <Tool key={...}>...</Tool>
        ))}
      </div>
    )}

    {/* Assistant Messages */}
    {turn.assistantMessages.map(message => ...)}
  </div>
))}
```

#### 4.2 MultiTabChatPanel
**파일**: `components/chat/MultiTabChatPanel.tsx:36, 164`

```typescript
const { turns, ... } = useMultiTabChat({ ... });

<ChatPanel turns={turns} ... />
```

### 5. 메시지별 렌더링으로 변경 시 영향 분석

#### 5.1 변경 필요 파일

| 영향도 | 파일 | 변경 내용 |
|--------|------|----------|
| **HIGH** | useMultiTabChat.ts | Turn 생성 로직 리팩토링 |
| **HIGH** | ChatPanel.tsx | `turns.map()` → `messages.map()` |
| **MEDIUM** | MultiTabChatPanel.tsx | Props 변경 |
| **LOW** | useAgentStream.ts | 변경 불필요 |

#### 5.2 유지해야 할 것
- `DetailMessage.run_id` 필드
- `useAgentStream`의 runId 기반 스트리밍
- 이벤트 매핑 로직 (`eventsByRunId`)

#### 5.3 재설계 필요
- Reasoning, Tool 이벤트를 어떤 메시지에 붙일지
- Turn 컨텍스트 없이 도구 start/end 매칭
- 스트리밍 중인 메시지 표시 방법

#### 5.4 손실될 기능

| 기능 | 현재 구현 | 메시지별 렌더링 시 |
|------|---------|------------------|
| Turn별 Reasoning | Turn 단위로 표시 | 메시지와 분리되어 표시 필요 |
| Tool Event 그룹화 | Turn 내에서 start/end 매칭 | 메시지와의 연결 관계 불명확 |
| Active Turn 표시 | runId === activeRunId | 현재 실행 중인 run의 메시지 표시 필요 |

## Code References

### 핵심 파일

| 파일 | 역할 |
|------|------|
| [useMultiTabChat.ts](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts) | Turn 생성, 상태 관리 |
| [useAgentStream.ts](frontend/pluto_duck_frontend/hooks/useAgentStream.ts) | SSE 스트리밍 |
| [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx) | Turn 렌더링 |
| [MultiTabChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/MultiTabChatPanel.tsx) | Turn 소비 |

### 핵심 라인 참조

- `useMultiTabChat.ts:52-64` - ChatTurn 타입 정의
- `useMultiTabChat.ts:302-493` - Turn 생성 useMemo 블록
- `useMultiTabChat.ts:176-181` - useAgentStream 호출
- `ChatPanel.tsx:202-375` - turns.map() 렌더링 루프

## Architecture Insights

### 1. Turn 기반 그룹핑의 장점
- 질문-응답 쌍이 시각적으로 연결됨
- 도구 호출이 어떤 질문의 응답인지 명확
- 브랜칭/편집 시 단위가 명확
- 컨텍스트 관리 용이

### 2. Turn 기반 그룹핑의 단점
- ChatGPT, Claude 같은 앱과 다른 UX
- 메시지별 개별 스타일링 어려움
- 긴 응답 시 한 그룹이 너무 커짐

### 3. 설계 결정 요약
- **runId는 필수** - 백엔드 스트리밍에 사용
- **Turn 그룹핑은 선택** - UI 디자인 결정
- **현재 Reasoning/Tool UI가 Turn에 의존** - 분리하려면 재설계 필요

## Open Questions

1. 메시지별 렌더링으로 변경 시 Reasoning 표시 위치는?
2. Tool 이벤트를 어떤 메시지와 연결할 것인가?
3. 스트리밍 중 표시를 메시지 단위로 어떻게 할 것인가?
4. 기존 Turn 기반 UI를 유지하면서 스타일만 변경하는 것도 가능한가?
