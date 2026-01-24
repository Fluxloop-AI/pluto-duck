---
date: 2026-01-13T00:00:00Z
researcher: Claude
topic: "Chat UI 독립적 렌더링 구현 방안"
tags: [research, codebase, chat, ui, rendering, independent, flat-array]
status: complete
---

# Research: Chat UI 독립적 렌더링 구현 방안

## Research Question
API 의존성(runId 기반 스트리밍)을 수정하지 않고 User Input, Reasoning, Tool Call, Model Response를 독립적인 UI 요소로 렌더링하는 방법

## Summary

현재 Turn 기반 그룹핑 구조를 **UI 레이어에서만** Flat Array 구조로 변환하여 독립적 렌더링이 가능합니다. 핵심은:

| 레이어 | 변경 여부 | 설명 |
|--------|----------|------|
| **Backend API** | ❌ 변경 없음 | runId 기반 SSE 스트리밍 유지 |
| **useAgentStream** | ❌ 변경 없음 | 이벤트 수신 로직 유지 |
| **useMultiTabChat** | ⚡ 부분 변경 | `turns` → `renderItems` 변환 함수 추가 |
| **ChatPanel** | ✅ 변경 | `turns.map()` → `renderItems.map()` |

## Detailed Findings

### 1. 현재 아키텍처 분석

#### 1.1 데이터 흐름
```
Backend API ─→ useAgentStream (SSE) ─→ useMultiTabChat (Turn 생성) ─→ ChatPanel (렌더링)
                    │                         │
                    │                         ▼
                    │                   ChatTurn[] (runId로 그룹화)
                    │                         │
                    ▼                         ▼
              streamEvents[]           turns.map(turn => ...)
```

#### 1.2 ChatTurn 구조 (현재)
**파일**: [useMultiTabChat.ts:52-64](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts#L52-L64)

```typescript
export interface ChatTurn {
  key: string;                      // `run-${runId}`
  runId: string | null;             // API 스트리밍 연결 키
  seq: number;                      // 정렬 순서
  userMessages: DetailMessage[];    // 유저 메시지들
  assistantMessages: DetailMessage[];
  reasoningText: string;            // 추출된 reasoning
  groupedToolEvents: GroupedToolEvent[];
  isActive: boolean;                // 스트리밍 중 여부
}
```

#### 1.3 렌더링 구조 (현재)
**파일**: [ChatPanel.tsx:202-375](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L202-L375)

```tsx
{turns.map(turn => (
  <div key={turn.key} className="group py-6 space-y-4">
    {/* 1. User Messages */}
    {turn.userMessages.map(message => (...))}

    {/* 2. Reasoning */}
    {turn.reasoningText && <Reasoning ... />}

    {/* 3. Tools */}
    {turn.groupedToolEvents.map(tool => (...))}

    {/* 4. Assistant Messages */}
    {turn.assistantMessages.map(message => (...))}
  </div>
))}
```

### 2. 독립적 렌더링을 위한 새로운 데이터 구조

#### 2.1 ChatRenderItem 타입 제안

```typescript
/**
 * 독립적으로 렌더링 가능한 채팅 아이템
 * Turn 그룹핑 없이 개별 요소로 렌더링
 */
export type ChatRenderItem =
  | UserMessageItem
  | ReasoningItem
  | ToolItem
  | AssistantMessageItem;

interface BaseRenderItem {
  id: string;                    // 고유 식별자
  runId: string | null;          // API 연결 유지 (필수!)
  seq: number;                   // 전역 정렬 순서
  timestamp: string;             // 표시 시간
  isStreaming: boolean;          // 개별 스트리밍 상태
}

interface UserMessageItem extends BaseRenderItem {
  type: 'user-message';
  content: string;
  mentions?: string[];           // @mentions
}

interface ReasoningItem extends BaseRenderItem {
  type: 'reasoning';
  content: string;               // reasoning 텍스트
  phase: 'streaming' | 'complete';
}

interface ToolItem extends BaseRenderItem {
  type: 'tool';
  toolName: string;
  state: 'pending' | 'completed' | 'error';
  input?: string;
  output?: any;
  error?: string;
}

interface AssistantMessageItem extends BaseRenderItem {
  type: 'assistant-message';
  content: string;
}
```

#### 2.2 Turn → RenderItems 변환 함수

**추가 위치**: `useMultiTabChat.ts` 또는 새로운 유틸리티 파일

```typescript
/**
 * ChatTurn 배열을 flat한 ChatRenderItem 배열로 변환
 * API 의존성 유지하면서 UI만 독립적으로 렌더링
 */
export function flattenTurnsToRenderItems(turns: ChatTurn[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let globalSeq = 0;

  turns.forEach(turn => {
    const baseProps = {
      runId: turn.runId,
      isStreaming: turn.isActive,
    };

    // 1. User Messages
    turn.userMessages.forEach(msg => {
      items.push({
        ...baseProps,
        id: `user-${msg.id}`,
        type: 'user-message',
        seq: globalSeq++,
        timestamp: msg.created_at,
        content: extractText(msg.content),
        isStreaming: false, // 유저 메시지는 스트리밍 없음
      });
    });

    // 2. Reasoning (존재하면)
    if (turn.reasoningText || turn.isActive) {
      items.push({
        ...baseProps,
        id: `reasoning-${turn.runId}`,
        type: 'reasoning',
        seq: globalSeq++,
        timestamp: new Date().toISOString(),
        content: turn.reasoningText,
        phase: turn.isActive ? 'streaming' : 'complete',
      });
    }

    // 3. Tools (개별적으로)
    turn.groupedToolEvents.forEach((tool, idx) => {
      items.push({
        ...baseProps,
        id: `tool-${turn.runId}-${idx}`,
        type: 'tool',
        seq: globalSeq++,
        timestamp: tool.startEvent?.timestamp || new Date().toISOString(),
        toolName: tool.toolName,
        state: tool.state,
        input: tool.input,
        output: tool.output,
        error: tool.error,
        isStreaming: tool.state === 'pending' && turn.isActive,
      });
    });

    // 4. Assistant Messages
    turn.assistantMessages.forEach(msg => {
      items.push({
        ...baseProps,
        id: `assistant-${msg.id}`,
        type: 'assistant-message',
        seq: globalSeq++,
        timestamp: msg.created_at,
        content: extractText(msg.content),
        isStreaming: turn.isActive && !turn.reasoningText, // 응답 스트리밍 중
      });
    });
  });

  return items;
}

function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (content?.text) return content.text;
  return JSON.stringify(content);
}
```

### 3. ChatPanel 렌더링 변경

#### 3.1 새로운 렌더링 구조

```tsx
// ChatPanel.tsx

interface ConversationMessagesProps {
  renderItems: ChatRenderItem[];  // turns 대신 renderItems
  // ... 기타 props
}

const ConversationMessages = memo(function ConversationMessages({
  renderItems,
  lastAssistantMessageId,
  onCopy,
  onRegenerate,
}: ConversationMessagesProps) {
  return (
    <>
      {renderItems.map((item, idx) => {
        const nextItem = renderItems[idx + 1];
        const isLastOfRun = nextItem?.runId !== item.runId;

        return (
          <div
            key={item.id}
            className={cn(
              "pl-[14px] pr-3",
              isLastOfRun ? "pb-6" : "pb-2"  // Run 간 간격 조절
            )}
          >
            <RenderItem item={item} onCopy={onCopy} onRegenerate={onRegenerate} />
          </div>
        );
      })}
    </>
  );
});

// 타입별 렌더러
function RenderItem({ item, onCopy, onRegenerate }) {
  switch (item.type) {
    case 'user-message':
      return <UserMessageRenderer item={item} />;
    case 'reasoning':
      return <ReasoningRenderer item={item} />;
    case 'tool':
      return <ToolRenderer item={item} />;
    case 'assistant-message':
      return <AssistantMessageRenderer item={item} onCopy={onCopy} />;
  }
}
```

#### 3.2 개별 렌더러 컴포넌트

```tsx
// UserMessageRenderer
function UserMessageRenderer({ item }: { item: UserMessageItem }) {
  return (
    <div className="flex justify-end">
      <div className="rounded-2xl bg-primary px-4 py-3 text-primary-foreground">
        <p className="text-sm">{renderTextWithMentions(item.content)}</p>
      </div>
    </div>
  );
}

// ReasoningRenderer
function ReasoningRenderer({ item }: { item: ReasoningItem }) {
  return (
    <Reasoning isStreaming={item.phase === 'streaming'} defaultOpen={true}>
      <ReasoningTrigger />
      <ReasoningContent>{item.content || ''}</ReasoningContent>
    </Reasoning>
  );
}

// ToolRenderer
function ToolRenderer({ item }: { item: ToolItem }) {
  const toolState = item.state === 'pending' ? 'input-streaming'
    : item.state === 'error' ? 'output-error'
    : 'output-available';

  return (
    <Tool defaultOpen={item.state === 'pending'}>
      <ToolHeader state={toolState} type={`tool-${item.toolName}`} title={item.toolName} />
      <ToolContent>
        {item.input && <ToolInput input={item.input} />}
        {(item.output || item.error) && (
          <ToolOutput
            output={item.output ? JSON.stringify(item.output, null, 2) : undefined}
            errorText={item.error}
          />
        )}
      </ToolContent>
    </Tool>
  );
}

// AssistantMessageRenderer
function AssistantMessageRenderer({ item, onCopy }: { item: AssistantMessageItem; onCopy: (text: string) => void }) {
  return (
    <div className="flex gap-4">
      <div className="flex-1 space-y-4">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Response>{item.content}</Response>
        </div>
      </div>
    </div>
  );
}
```

### 4. 시각적 그룹핑 전략 (Turn 없이)

#### 4.1 스페이싱을 통한 암묵적 그룹핑

```tsx
// runId가 바뀌면 더 큰 간격
const isLastOfRun = nextItem?.runId !== item.runId;

<div className={cn(
  "pl-[14px] pr-3",
  isLastOfRun ? "pb-6" : "pb-2"  // 6 vs 2 spacing
)}>
```

#### 4.2 시각적 구분선 (선택적)

```tsx
{isLastOfRun && idx < renderItems.length - 1 && (
  <div className="border-b border-border/50 my-4" />
)}
```

#### 4.3 타임스탬프 구분자 (선택적)

```tsx
const shouldShowTimeSeparator = (items: ChatRenderItem[], idx: number) => {
  const current = items[idx];
  const previous = items[idx - 1];
  if (!previous) return false;

  const timeDiff = new Date(current.timestamp).getTime()
                 - new Date(previous.timestamp).getTime();
  return timeDiff > 5 * 60 * 1000; // 5분 이상 차이
};
```

### 5. 스트리밍 상태 관리

#### 5.1 현재 문제점
- `turn.isActive` 하나로 전체 Turn 스트리밍 상태 관리
- 개별 요소(reasoning, tool, message)별 상태 구분 불가

#### 5.2 개선된 스트리밍 상태

```typescript
interface StreamingState {
  isReasoningStreaming: boolean;
  toolStreamingStates: Map<string, 'pending' | 'executing' | 'complete'>;
  isMessageStreaming: boolean;
}

// Event 기반 상태 파생
function deriveStreamingState(events: ChatEvent[], runId: string): StreamingState {
  const reasoningEvents = events.filter(e => e.type === 'reasoning');
  const toolEvents = events.filter(e => e.type === 'tool');
  const messageEvents = events.filter(e => e.type === 'message');

  return {
    isReasoningStreaming: reasoningEvents.some(e =>
      e.subtype === 'start' || e.subtype === 'chunk'
    ) && !reasoningEvents.some(e => e.subtype === 'end'),

    toolStreamingStates: new Map(/* tool별 상태 */),

    isMessageStreaming: messageEvents.some(e =>
      e.subtype === 'chunk'
    ) && !messageEvents.some(e => e.subtype === 'final'),
  };
}
```

### 6. 구현 단계별 계획

#### Phase 1: 타입 정의 (영향 없음)
1. `ChatRenderItem` 타입 정의
2. `flattenTurnsToRenderItems` 유틸리티 함수 작성

#### Phase 2: 변환 레이어 추가 (기존 코드 유지)
1. `useMultiTabChat`에 `renderItems` 반환값 추가
2. 기존 `turns` 반환 유지 (하위 호환성)

```typescript
// useMultiTabChat.ts
return {
  // 기존 유지
  turns,

  // 새로 추가
  renderItems: useMemo(
    () => flattenTurnsToRenderItems(turns),
    [turns]
  ),
};
```

#### Phase 3: ChatPanel 마이그레이션
1. `ConversationMessages`에 `renderItems` prop 추가
2. 개별 렌더러 컴포넌트 작성
3. 점진적으로 `turns.map()` → `renderItems.map()` 전환

#### Phase 4: 스트리밍 상태 세분화 (선택적)
1. 개별 요소별 스트리밍 상태 추가
2. 더 세밀한 UI 피드백

### 7. API 의존성 유지 확인

#### 변경하지 않는 것들

| 파일 | 역할 | 상태 |
|------|------|------|
| `lib/chatApi.ts` | REST API 호출 | ❌ 변경 없음 |
| `useAgentStream.ts` | SSE 스트리밍 | ❌ 변경 없음 |
| `useMultiTabChat.ts` (데이터 fetch) | 세션/메시지 로드 | ❌ 변경 없음 |
| Backend API endpoints | `/api/v1/agent/{runId}/events` | ❌ 변경 없음 |

#### 변경하는 것들 (UI 레이어만)

| 파일 | 변경 내용 |
|------|----------|
| `useMultiTabChat.ts` | `renderItems` computed value 추가 |
| `ChatPanel.tsx` | 렌더링 로직 변경 |
| `MultiTabChatPanel.tsx` | props 전달 변경 |

## Code References

### 핵심 파일

| 파일 | 역할 | 변경 여부 |
|------|------|----------|
| [useMultiTabChat.ts](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts) | Turn 생성 | 부분 변경 |
| [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx) | 렌더링 | 변경 |
| [useAgentStream.ts](frontend/pluto_duck_frontend/hooks/useAgentStream.ts) | SSE | 변경 없음 |
| [chatApi.ts](frontend/pluto_duck_frontend/lib/chatApi.ts) | API | 변경 없음 |

### 기존 컴포넌트 재사용

| 컴포넌트 | 파일 | 독립적 사용 가능 |
|----------|------|-----------------|
| Reasoning | [reasoning.tsx](frontend/pluto_duck_frontend/components/ai-elements/reasoning.tsx) | ✅ |
| Tool | [tool.tsx](frontend/pluto_duck_frontend/components/ai-elements/tool.tsx) | ✅ |
| Response | [response.tsx](frontend/pluto_duck_frontend/components/ai-elements/response.tsx) | ✅ |
| Message | [message.tsx](frontend/pluto_duck_frontend/components/ai-elements/message.tsx) | ✅ |

## Architecture Insights

### 1. 관심사 분리
- **데이터 레이어**: `useMultiTabChat` - API 호출, Turn 생성 (runId 기반)
- **변환 레이어**: `flattenTurnsToRenderItems` - Turn → RenderItem 변환
- **뷰 레이어**: `ChatPanel` - RenderItem 렌더링

### 2. 하위 호환성
- 기존 `turns` 데이터 구조 유지
- 새로운 `renderItems`는 `turns`에서 파생
- 점진적 마이그레이션 가능

### 3. 유연성
- 렌더링 순서 변경 가능 (예: tool을 response 뒤에)
- 개별 요소별 스타일링/애니메이션 적용 용이
- 새로운 요소 타입 추가 용이

## Open Questions

1. **Reasoning 위치**: User message 바로 다음? 아니면 response 직전?
2. **Tool 위치**: Reasoning과 Response 사이? 아니면 Response 다음?
3. **빈 Reasoning 처리**: 스트리밍 중에만 표시? 완료 후에도 유지?
4. **시각적 그룹핑**: 스페이싱만? 구분선? 배경색?
5. **스트리밍 인디케이터**: 개별 요소마다? 전체에 하나?
