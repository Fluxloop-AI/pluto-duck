---
date: 2026-01-14T12:00:00Z
researcher: Claude
topic: "Chat Suggestion/Choice UI Components"
tags: [research, chat, ui, suggestions, interactive-components]
status: complete
---

# Research: Chat Suggestion/Choice UI Components

## Research Question

채팅창 인터랙션 개선을 위해 에이전트가 사용자에게 제안이나 선택지를 버튼 등 UI로 제시하려면 어떻게 해야 하는지, 현재 활용 가능한 컴포넌트가 있는지, 없다면 어떻게 구성해야 할지 조사

## Summary

**핵심 발견: 이미 `Suggestion` 컴포넌트가 존재함!**

코드베이스에 이미 제안/선택지 UI를 위한 컴포넌트들이 잘 구현되어 있습니다:

1. **`Suggestion` + `Suggestions` 컴포넌트** (`ai-elements/suggestion.tsx`) - 가장 직접적으로 사용 가능
2. **`Action` + `Actions` 컴포넌트** (`ai-elements/actions.tsx`) - 아이콘 버튼용
3. **다양한 shadcn/ui 컴포넌트** - Button, Badge, DropdownMenu, Command 등

현재 메시지 렌더링 시스템은 4가지 타입(`user-message`, `assistant-message`, `reasoning`, `tool`)만 지원하므로, 새로운 `suggestion` 타입을 추가하거나 assistant 메시지 내에서 제안을 렌더링하는 방식으로 확장 가능합니다.

---

## Detailed Findings

### 1. 기존 Suggestion 컴포넌트 (즉시 사용 가능!)

**파일:** [suggestion.tsx](frontend/pluto_duck_frontend/components/ai-elements/suggestion.tsx)

```typescript
// Suggestions - 수평 스크롤 가능한 제안 컨테이너
<Suggestions className="...">
  <Suggestion suggestion="Option A" onClick={(text) => handleSelect(text)} />
  <Suggestion suggestion="Option B" onClick={(text) => handleSelect(text)} />
</Suggestions>
```

**주요 특징:**
- `Suggestion` 컴포넌트: 개별 제안 버튼 (Lines 31-56)
  - `suggestion` prop으로 텍스트 전달
  - `onClick` 콜백으로 선택 처리
  - `rounded-full` 스타일로 pill 형태
  - Button 기반으로 다양한 variant/size 지원

- `Suggestions` 컴포넌트: 컨테이너 (Lines 13-24)
  - `ScrollArea` 기반 수평 스크롤
  - `gap-2` 간격으로 자동 배치

### 2. 현재 메시지 렌더링 시스템

**메시지 타입 정의:** [chatRenderItem.ts](frontend/pluto_duck_frontend/types/chatRenderItem.ts)

```typescript
type ChatRenderItem =
  | UserMessageItem      // 사용자 메시지
  | ReasoningItem        // 에이전트 추론 과정
  | ToolItem             // 도구 실행
  | AssistantMessageItem // 에이전트 응답
```

**렌더러 라우팅:** [RenderItem.tsx](frontend/pluto_duck_frontend/components/chat/renderers/RenderItem.tsx#L31-L64)

```typescript
switch (item.type) {
  case 'user-message': return <UserMessageRenderer ... />
  case 'reasoning': return <ReasoningRenderer ... />
  case 'tool': return <ToolRenderer ... />
  case 'assistant-message': return <AssistantMessageRenderer ... />
}
```

### 3. 활용 가능한 UI 컴포넌트 목록

| 컴포넌트 | 파일 | 용도 |
|---------|------|------|
| **Suggestion** | `ai-elements/suggestion.tsx` | 제안 버튼 (pill 형태) |
| **Action** | `ai-elements/actions.tsx` | 아이콘 버튼 + 툴팁 |
| **Button** | `ui/button.tsx` | 범용 버튼 (6 variants, 4 sizes) |
| **Badge** | `ui/badge.tsx` | 태그/칩 형태 (4 variants) |
| **DropdownMenu** | `ui/dropdown-menu.tsx` | 드롭다운 선택 메뉴 |
| **Command** | `ui/command.tsx` | 검색 가능한 커맨드 팔레트 |
| **Select** | `ui/select.tsx` | 단일 선택 드롭다운 |
| **Card** | `ui/card.tsx` | 카드 컨테이너 |

### 4. 백엔드 이벤트 시스템

**이벤트 타입:** [events.py](backend/pluto_duck_backend/agent/core/events.py#L11-L27)

```python
class EventType(str, Enum):
    REASONING = "reasoning"
    TOOL = "tool"
    MESSAGE = "message"
    RUN = "run"
    # 새로운 타입 추가 가능: SUGGESTION = "suggestion"

class EventSubType(str, Enum):
    START = "start"
    CHUNK = "chunk"
    END = "end"
    FINAL = "final"
    ERROR = "error"
```

**이벤트 전송:** [orchestrator.py](backend/pluto_duck_backend/agent/core/orchestrator.py#L156-L159)

```python
async def emit(event: AgentEvent) -> None:
    payload = event.to_dict()
    await run.queue.put(payload)  # SSE로 프론트엔드에 전송
    repo.log_event(run.conversation_id, payload)  # DB에 저장
```

---

## Architecture Insights

### 현재 데이터 흐름

```
Backend Agent → AgentEvent → SSE Stream → useAgentStream hook
                                              ↓
                                    useMultiTabChat (이벤트 처리)
                                              ↓
                                    ChatRenderItem[] 생성
                                              ↓
                                    RenderItem (타입별 라우팅)
                                              ↓
                                    *MessageRenderer 컴포넌트
```

### 제안 UI 구현을 위한 두 가지 접근법

#### 접근법 A: 새로운 메시지 타입 추가 (권장)

1. **타입 정의 추가** (`chatRenderItem.ts`):
```typescript
interface SuggestionItem extends BaseRenderItem {
  type: 'suggestion';
  suggestions: Array<{
    id: string;
    label: string;
    value: string;
    description?: string;
  }>;
  prompt?: string;  // "다음 중 하나를 선택해주세요:"
  multiSelect?: boolean;
}
```

2. **백엔드 이벤트 타입 추가** (`events.py`):
```python
class EventType(str, Enum):
    # ... existing types
    SUGGESTION = "suggestion"
```

3. **렌더러 추가** (`SuggestionRenderer.tsx`):
```typescript
export function SuggestionRenderer({ item, onSelect }: Props) {
  return (
    <div className="pl-2 pr-2 py-2">
      {item.prompt && <p className="text-sm mb-2">{item.prompt}</p>}
      <Suggestions>
        {item.suggestions.map(s => (
          <Suggestion
            key={s.id}
            suggestion={s.label}
            onClick={() => onSelect(s.value)}
          />
        ))}
      </Suggestions>
    </div>
  );
}
```

4. **RenderItem에 라우팅 추가**:
```typescript
case 'suggestion': return <SuggestionRenderer item={item} onSelect={...} />
```

#### 접근법 B: Assistant 메시지 내 인라인 렌더링

Markdown 확장 또는 특수 마커를 사용하여 assistant 메시지 내에서 제안을 렌더링:

```typescript
// AssistantMessageRenderer.tsx 수정
// 메시지 끝에 suggestions 데이터가 있으면 렌더링
{item.suggestions && (
  <Suggestions className="mt-2">
    {item.suggestions.map(s => (
      <Suggestion key={s.id} suggestion={s.label} onClick={...} />
    ))}
  </Suggestions>
)}
```

---

## Code References

### 핵심 파일들

- [suggestion.tsx:31-56](frontend/pluto_duck_frontend/components/ai-elements/suggestion.tsx#L31-L56) - Suggestion 컴포넌트
- [suggestion.tsx:13-24](frontend/pluto_duck_frontend/components/ai-elements/suggestion.tsx#L13-L24) - Suggestions 컨테이너
- [chatRenderItem.ts:77-81](frontend/pluto_duck_frontend/types/chatRenderItem.ts#L77-L81) - ChatRenderItem 타입 정의
- [RenderItem.tsx:31-64](frontend/pluto_duck_frontend/components/chat/renderers/RenderItem.tsx#L31-L64) - 렌더러 라우팅
- [AssistantMessageRenderer.tsx:65-114](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx#L65-L114) - 어시스턴트 메시지 렌더링
- [events.py:11-27](backend/pluto_duck_backend/agent/core/events.py#L11-L27) - 백엔드 이벤트 타입
- [orchestrator.py:156-159](backend/pluto_duck_backend/agent/core/orchestrator.py#L156-L159) - 이벤트 전송
- [useAgentStream.ts:23-111](frontend/pluto_duck_frontend/hooks/useAgentStream.ts#L23-L111) - SSE 스트리밍 훅
- [useMultiTabChat.ts:443-494](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts#L443-L494) - 이벤트 처리

### UI 컴포넌트

- [button.tsx:7-58](frontend/pluto_duck_frontend/components/ui/button.tsx#L7-L58) - Button variants/sizes
- [badge.tsx:1-37](frontend/pluto_duck_frontend/components/ui/badge.tsx#L1-L37) - Badge 컴포넌트
- [dropdown-menu.tsx:78-94](frontend/pluto_duck_frontend/components/ui/dropdown-menu.tsx#L78-L94) - DropdownMenuItem
- [command.tsx:111-125](frontend/pluto_duck_frontend/components/ui/command.tsx#L111-L125) - CommandItem

---

## Implementation Recommendations

### 최소 구현 (Quick Win)

기존 `Suggestion` 컴포넌트를 활용하여 assistant 메시지 아래에 제안 버튼 추가:

**수정 파일:**
1. `AssistantMessageItem` 타입에 `suggestions` 필드 추가
2. `AssistantMessageRenderer`에서 suggestions 렌더링
3. 백엔드에서 메시지와 함께 suggestions 데이터 전송

### 전체 구현 (Full Feature)

새로운 `suggestion` 이벤트 타입으로 독립적인 제안 UI:

**수정 파일:**
1. `EventType` enum에 `SUGGESTION` 추가 (백엔드)
2. `SuggestionItem` 타입 정의 (프론트엔드)
3. `SuggestionRenderer` 컴포넌트 생성
4. `RenderItem`에 라우팅 추가
5. `useMultiTabChat`에서 suggestion 이벤트 처리
6. 에이전트 로직에서 suggestion 이벤트 emit

### 사용자 선택 처리

선택된 값은 새로운 사용자 메시지로 전송하거나, 별도의 API 엔드포인트로 처리:

```typescript
const handleSuggestionSelect = (value: string) => {
  // Option 1: 일반 메시지로 전송
  sendMessage({ role: 'user', content: value });

  // Option 2: 메타데이터와 함께 전송
  sendMessage({
    role: 'user',
    content: value,
    metadata: { type: 'suggestion_response', suggestionId: '...' }
  });
};
```

---

## Open Questions

1. **선택 후 UI 처리**: 사용자가 선택한 후 제안 버튼을 숨길지, 선택된 항목만 표시할지?
2. **다중 선택 지원**: 여러 옵션을 선택할 수 있는 체크박스 형태가 필요한지?
3. **시간 제한**: 제안에 시간 제한이 필요한지? (예: 30초 내 선택)
4. **스트리밍 중 제안**: 에이전트가 응답을 스트리밍하는 중에도 제안을 표시할지?
5. **커스텀 입력**: "기타" 옵션으로 사용자가 직접 입력할 수 있게 할지?
