---
date: 2026-01-13T00:00:00Z
researcher: Claude
topic: "Chat UI Styling Analysis - User Input, Reasoning, Tool Call, Model Response"
tags: [research, codebase, chat-ui, styling, tailwind, renderers]
status: complete
---

# Research: Chat UI Styling Analysis

## Research Question
채팅 UI 내에서 User Input, Reasoning, Tool Call, Model Response의 여백, color, font, 간격 등 각종 스타일을 수정하기 위한 관련 코드 조사

## Summary
채팅 UI의 스타일링은 **3개 레이어**로 구성되어 있습니다:
1. **Renderers Layer** - 각 메시지 타입별 래퍼 컴포넌트 (ChatPanel에서 사용)
2. **AI-Elements Layer** - 실제 UI를 구성하는 기본 컴포넌트들
3. **Theme Layer** - CSS 변수와 Tailwind 설정

스타일 수정 시 대부분의 경우 **Renderers**와 **AI-Elements** 파일을 수정하면 됩니다.

---

## Detailed Findings

### 1. User Input (사용자 메시지)

#### 주요 파일
- [UserMessageRenderer.tsx:62-79](frontend/pluto_duck_frontend/components/chat/renderers/UserMessageRenderer.tsx#L62-L79)

#### 현재 스타일
```tsx
// 컨테이너 (오른쪽 정렬)
<div className="group flex justify-end gap-2">

// 메시지 버블
<div className="rounded-2xl bg-primary px-4 py-3 text-primary-foreground max-w-[80%]">
  <p className="text-sm whitespace-pre-wrap">
```

| 속성 | 현재 값 | 설명 |
|------|---------|------|
| 배경색 | `bg-primary` | 다크: `hsl(0 0% 98%)`, 라이트: `hsl(0 0% 9%)` |
| 텍스트 색상 | `text-primary-foreground` | 배경과 대비되는 색상 |
| 모서리 | `rounded-2xl` | 16px border-radius |
| 패딩 | `px-4 py-3` | 좌우 16px, 상하 12px |
| 최대 너비 | `max-w-[80%]` | 부모의 80% |
| 폰트 크기 | `text-sm` | 14px |

#### @Mention 스타일
```tsx
// UserMessageRenderer.tsx:23-25
<span className="text-primary-foreground/60 font-medium">
```

---

### 2. Reasoning (추론 과정)

#### 주요 파일
- [ReasoningRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ReasoningRenderer.tsx)
- [reasoning.tsx](frontend/pluto_duck_frontend/components/ai-elements/reasoning.tsx)

#### 현재 스타일

**컨테이너**
```tsx
// reasoning.tsx - Reasoning 컴포넌트
className="not-prose mb-4"
```

**트리거 버튼 (접기/펼치기)**
```tsx
// ReasoningTrigger
className="flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
```

**콘텐츠 영역**
```tsx
// ReasoningContent
className="mt-4 text-sm text-muted-foreground outline-none"
```

| 속성 | 현재 값 | 설명 |
|------|---------|------|
| 하단 마진 | `mb-4` | 16px |
| 텍스트 색상 | `text-muted-foreground` | 다크: `hsl(0 0% 60%)`, 라이트: `hsl(0 0% 45.1%)` |
| 폰트 크기 | `text-sm` | 14px |
| 아이콘 크기 | `size-4` | 16px (BrainIcon, ChevronDownIcon) |

**애니메이션**
- Chevron: `transition-transform rotate-180/rotate-0`
- 콘텐츠: `slide-in-from-top-2`, `slide-out-to-top-2`

---

### 3. Tool Call (도구 호출)

#### 주요 파일
- [ToolRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx)
- [tool.tsx](frontend/pluto_duck_frontend/components/ai-elements/tool.tsx)

#### 현재 스타일

**메인 컨테이너**
```tsx
// tool.tsx - Tool 컴포넌트
className="not-prose mb-2 w-full rounded-md border text-xs"
```

**헤더**
```tsx
// ToolHeader
className="flex w-full items-center justify-between gap-2 px-2 py-1.5"
```

| 속성 | 현재 값 | 설명 |
|------|---------|------|
| 하단 마진 | `mb-2` | 8px |
| 모서리 | `rounded-md` | `calc(var(--radius) - 2px)` |
| 테두리 | `border` | `hsl(var(--border))` |
| 폰트 크기 | `text-xs` | 12px |
| 헤더 패딩 | `px-2 py-1.5` | 8px / 6px |

**상태별 색상** (tool.tsx의 `getStatusBadge` 함수)

| 상태 | 아이콘 | 색상 |
|------|--------|------|
| pending | CircleIcon | 기본 |
| running | ClockIcon | animate-pulse |
| approval-requested | ClockIcon | `text-yellow-600` |
| output-available | CheckCircleIcon | `text-green-600` |
| output-error | XCircleIcon | `text-red-600` |
| output-denied | XCircleIcon | `text-orange-600` |

**Input/Output 영역**
```tsx
// ToolInput, ToolOutput
className="space-y-1 px-2 pb-2"

// 코드 블록
className="bg-muted/50 rounded max-h-40 overflow-x-auto"

// 에러 텍스트
className="bg-destructive/10 text-destructive p-2"
```

---

### 4. Model Response (AI 응답)

#### 주요 파일
- [AssistantMessageRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx)
- [response.tsx](frontend/pluto_duck_frontend/components/ai-elements/response.tsx)
- `streamdown` 패키지 (마크다운 렌더링)

#### 현재 스타일

**컨테이너**
```tsx
// AssistantMessageRenderer.tsx:66-70
<div className="group flex gap-4">
  <div className="flex-1 space-y-4">
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <Response>{item.content}</Response>
    </div>
```

**Response 컴포넌트**
```tsx
// response.tsx
className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
```

| 속성 | 현재 값 | 설명 |
|------|---------|------|
| 레이아웃 | `flex gap-4` | 16px 갭 |
| 내부 간격 | `space-y-4` | 자식 요소간 16px |
| 타이포그래피 | `prose prose-sm dark:prose-invert` | Tailwind Typography 플러그인 |
| 최대 너비 | `max-w-none` | 제한 없음 |

---

### 5. 전역 레이아웃 (ChatPanel)

#### 주요 파일
- [ChatPanel.tsx:96-115](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L96-L115)

#### 아이템 간격
```tsx
// ConversationMessages의 각 아이템 래퍼
<div className={cn(
  'group pl-[14px] pr-3',
  isLastOfRun ? 'pb-6' : 'pb-2',  // Turn 끝이면 24px, 아니면 8px
  idx === 0 ? 'pt-6' : 'pt-0'     // 첫 아이템만 상단 24px
)}>
```

| 속성 | 조건 | 값 |
|------|------|-----|
| 좌측 패딩 | 항상 | `pl-[14px]` (14px) |
| 우측 패딩 | 항상 | `pr-3` (12px) |
| 상단 패딩 | 첫 아이템 | `pt-6` (24px) |
| 하단 패딩 | Turn 마지막 | `pb-6` (24px) |
| 하단 패딩 | Turn 중간 | `pb-2` (8px) |

---

### 6. Actions (액션 버튼)

#### 주요 파일
- [actions.tsx](frontend/pluto_duck_frontend/components/ai-elements/actions.tsx)

#### 현재 스타일
```tsx
// Actions 컨테이너
className="flex items-center gap-1"

// Action 버튼
className="relative size-9 p-1.5 text-muted-foreground hover:text-foreground"
```

| 속성 | 현재 값 | 설명 |
|------|---------|------|
| 버튼 크기 | `size-9` | 36px |
| 패딩 | `p-1.5` | 6px |
| 기본 색상 | `text-muted-foreground` | 흐린 색상 |
| 호버 색상 | `hover:text-foreground` | 선명한 색상 |
| 아이콘 크기 | `size-3` | 12px |

---

## Theme Configuration

### CSS 변수 ([globals.css](frontend/pluto_duck_frontend/app/globals.css))

#### Light Mode
| 변수 | HSL 값 | 용도 |
|------|--------|------|
| `--background` | `0 0% 100%` | 배경 (흰색) |
| `--foreground` | `0 0% 3.9%` | 기본 텍스트 |
| `--primary` | `0 0% 9%` | 주요 색상 |
| `--muted-foreground` | `0 0% 45.1%` | 음소거 텍스트 |
| `--border` | `0 0% 89.8%` | 테두리 |

#### Dark Mode
| 변수 | HSL 값 | 용도 |
|------|--------|------|
| `--background` | `0 0% 10%` | 배경 |
| `--foreground` | `0 0% 98%` | 기본 텍스트 |
| `--primary` | `0 0% 98%` | 주요 색상 |
| `--muted-foreground` | `0 0% 60%` | 음소거 텍스트 |

---

## Code References

### Renderers (스타일 래퍼)
- [UserMessageRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/UserMessageRenderer.tsx)
- [ReasoningRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ReasoningRenderer.tsx)
- [ToolRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx)
- [AssistantMessageRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx)

### AI-Elements (기본 UI 컴포넌트)
- [response.tsx](frontend/pluto_duck_frontend/components/ai-elements/response.tsx)
- [reasoning.tsx](frontend/pluto_duck_frontend/components/ai-elements/reasoning.tsx)
- [tool.tsx](frontend/pluto_duck_frontend/components/ai-elements/tool.tsx)
- [queue.tsx](frontend/pluto_duck_frontend/components/ai-elements/queue.tsx)
- [actions.tsx](frontend/pluto_duck_frontend/components/ai-elements/actions.tsx)

### Layout & Theme
- [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx)
- [globals.css](frontend/pluto_duck_frontend/app/globals.css)
- [tailwind.config.js](frontend/pluto_duck_frontend/tailwind.config.js)

---

## Architecture Insights

### 스타일 수정 가이드

1. **특정 메시지 타입만 수정** → Renderers 폴더의 해당 컴포넌트
2. **공통 UI 요소 수정** → AI-Elements 폴더의 컴포넌트
3. **전체 테마 수정** → `globals.css`의 CSS 변수
4. **메시지 간 간격 수정** → `ChatPanel.tsx`의 `pb-*`, `pt-*` 클래스

### 컴포넌트 계층 구조
```
ChatPanel
└── ConversationMessages
    └── RenderItem (라우터)
        ├── UserMessageRenderer → 직접 스타일링
        ├── ReasoningRenderer → Reasoning (ai-elements)
        ├── ToolRenderer → Tool, Queue (ai-elements)
        └── AssistantMessageRenderer → Response → Streamdown
```
