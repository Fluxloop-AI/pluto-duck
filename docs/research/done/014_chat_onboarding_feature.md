---
date: 2026-01-14T12:30:00Z
researcher: Claude
topic: "Chat Onboarding Feature"
tags: [research, chat, onboarding, ux, welcome-screen]
status: complete
---

# Research: Chat Onboarding Feature

## Research Question

채팅창 온보딩 기능 구현 방법 조사 - 빈 채팅창에 환영 메시지와 선택지 버튼을 표시하고, 버튼 클릭 시 미리 설정된 프롬프트가 발송되어 대화가 시작되는 기능

## Summary

채팅 온보딩은 새로운 메시지 타입이 아닌, **빈 채팅 상태일 때 표시되는 독립적인 UI 컴포넌트**로 구현해야 함. 기존 `ConversationEmptyState` 컴포넌트가 있지만 사용되지 않고 있으며, 온보딩에 맞게 확장하거나 새로운 `ChatOnboarding` 컴포넌트를 만들어야 함.

---

## Feature Description

### 기능 요구사항

```
최초 채팅창 (메시지 없음):
┌─────────────────────────────────────┐
│                                     │
│     Hello! 👋                       │
│     What would you like to do       │
│     with your data today?           │
│                                     │
│     ┌─────────────┐ ┌─────────────┐ │
│     │ 🔍 Explore  │ │ 📊 Run      │ │
│     │ Data        │ │ Analysis    │ │
│     └─────────────┘ └─────────────┘ │
│     ┌─────────────┐ ┌─────────────┐ │
│     │ 📈 Generate │ │ 🔄 Update   │ │
│     │ Dashboard   │ │ Dashboard   │ │
│     └─────────────┘ └─────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Ask a question...               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘

버튼 클릭 시:
→ 미리 설정된 프롬프트가 사용자 메시지로 발송됨
→ 대화가 시작되고 온보딩 UI는 사라짐
```

### 선택지 예시

| 버튼 | 발송되는 프롬프트 |
|------|------------------|
| Explore Data | "Help me explore my data. Show me an overview of all available tables and suggest interesting insights." |
| Run Analysis | "I want to run an analysis on my data. Help me identify patterns and trends." |
| Generate Dashboard | "Help me create a dashboard. What visualizations would be most useful for my data?" |
| Update Dashboard | "I need to update my existing dashboard. Show me the current visualizations and suggest improvements." |

---

## Current State Analysis

### 빈 채팅 상태 렌더링

**파일:** [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx)

현재 `ConversationMessages` 컴포넌트 (Lines 64-135)에서:
- `renderItems.length === 0`이고 `!loading`일 때 아무것도 렌더링하지 않음
- 빈 공간만 표시됨

```typescript
// ChatPanel.tsx Lines 87-125
// renderItems를 순회하며 메시지 렌더링
// 빈 배열이면 아무것도 표시 안됨
```

### 사용되지 않는 ConversationEmptyState

**파일:** [conversation.tsx](frontend/pluto_duck_frontend/components/ai-elements/conversation.tsx#L39-L66)

```typescript
export function ConversationEmptyState({
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-4 text-center">
      {icon}
      <h3 className="mb-1 text-lg font-medium">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
```

- 기본 empty state 컴포넌트로 정의되어 있지만 **어디서도 사용되지 않음**
- 온보딩에 맞게 확장하거나 새로운 컴포넌트로 대체 가능

### 메시지 발송 흐름

```
사용자 입력 또는 버튼 클릭
    ↓
ChatPanel.handleSubmit (ChatPanel.tsx:201-220)
    ↓
useMultiTabChat.handleSubmit (useMultiTabChat.ts:657-816)
    ↓
[새 대화] createConversation API 호출 (chatApi.ts:60-71)
    ↓
POST /api/v1/chat/sessions
    ↓
응답: { id, run_id, events_url }
```

**핵심 포인트:** 온보딩 버튼 클릭 시 동일한 `handleSubmit` 함수를 호출하면 됨

---

## Implementation Approach

### Option A: 새로운 ChatOnboarding 컴포넌트 (권장)

**새 파일:** `frontend/pluto_duck_frontend/components/chat/ChatOnboarding.tsx`

```typescript
interface OnboardingOption {
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
}

const ONBOARDING_OPTIONS: OnboardingOption[] = [
  {
    id: 'explore',
    label: 'Explore Data',
    description: 'Browse tables and discover insights',
    prompt: 'Help me explore my data...',
    icon: SearchIcon,
  },
  // ... more options
];

interface ChatOnboardingProps {
  onSelect: (prompt: string) => void;
}

export function ChatOnboarding({ onSelect }: ChatOnboardingProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <h2 className="text-xl font-semibold mb-2">Hello! 👋</h2>
      <p className="text-muted-foreground mb-6">
        What would you like to do with your data today?
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        {ONBOARDING_OPTIONS.map((option) => (
          <OnboardingCard
            key={option.id}
            option={option}
            onClick={() => onSelect(option.prompt)}
          />
        ))}
      </div>
    </div>
  );
}
```

### Option B: ConversationEmptyState 확장

기존 컴포넌트에 children prop 추가하여 커스텀 콘텐츠 렌더링

```typescript
export function ConversationEmptyState({
  title,
  description,
  icon,
  children,  // 추가
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div className="...">
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
      {children}  {/* 온보딩 버튼들 */}
    </div>
  );
}
```

---

## Design Decisions

### UI 스타일: 카드 형태 버튼

```
┌──────────────────┐
│ 🔍               │
│ Explore Data     │
│ Browse tables... │
└──────────────────┘
```

- 아이콘 + 레이블 + 설명 조합
- 2x2 그리드 레이아웃
- hover 시 배경색 변경
- 클릭 시 scale 효과

### 프롬프트 관리: Frontend Hardcoding

- 컴포넌트 내부 상수로 정의
- 빠른 구현, 수정 시 코드 배포 필요
- 향후 백엔드 설정으로 이동 가능

### 표시 조건

온보딩 컴포넌트는 다음 조건에서만 표시:
1. `renderItems.length === 0` (메시지 없음)
2. `!loading` (로딩 중 아님)
3. `!isStreaming` (스트리밍 중 아님)

---

## Code References

### 수정 대상 파일

| 파일 | 위치 | 수정 내용 |
|------|------|----------|
| [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L87) | Lines 87 근처 | 빈 상태 체크 후 온보딩 렌더링 |
| [conversation.tsx](frontend/pluto_duck_frontend/components/ai-elements/conversation.tsx#L39-L66) | Lines 39-66 | 기존 empty state 참고 |
| [index.ts](frontend/pluto_duck_frontend/components/chat/index.ts) | export | 새 컴포넌트 export 추가 |

### 참고 컴포넌트

| 컴포넌트 | 파일 | 활용 방안 |
|---------|------|----------|
| Suggestion | [suggestion.tsx](frontend/pluto_duck_frontend/components/ai-elements/suggestion.tsx#L31-L56) | 버튼 스타일 참고 (pill 형태) |
| Button | [button.tsx](frontend/pluto_duck_frontend/components/ui/button.tsx#L7-L58) | 기본 버튼 컴포넌트 |
| Card | [card.tsx](frontend/pluto_duck_frontend/components/ui/card.tsx#L5-L88) | 카드 컨테이너 스타일 |

### 메시지 발송 관련

| 함수 | 파일 | 역할 |
|------|------|------|
| handleSubmit | [ChatPanel.tsx:201-220](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L201-L220) | UI에서 submit 처리 |
| handleSubmit | [useMultiTabChat.ts:657-816](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts#L657-L816) | 실제 메시지 발송 로직 |
| createConversation | [chatApi.ts:60-71](frontend/pluto_duck_frontend/lib/chatApi.ts#L60-L71) | 새 대화 생성 API |

---

## Open Questions

1. **사용자 이름 개인화**: 환영 메시지에 "Hello, {username}!" 형태로 개인화할 것인지?
2. **선택지 커스터마이징**: 프로젝트별로 다른 선택지를 보여줄 필요가 있는지?
3. **애니메이션**: 온보딩에서 대화로 전환 시 fade-out 등 애니메이션 효과가 필요한지?
4. **접근성**: 키보드 네비게이션 지원 범위

---

## Related Research

- [013_chat_suggestion_choice_ui_components.md](docs/research/013_chat_suggestion_choice_ui_components.md) - 채팅 내 제안/선택지 UI 컴포넌트 조사
