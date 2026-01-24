# Chat Onboarding Feature Implementation Plan

## Overview

빈 채팅창에 환영 메시지와 선택지 버튼을 표시하고, 버튼 클릭 시 미리 설정된 프롬프트가 발송되어 대화가 시작되는 온보딩 기능을 구현합니다.

## Current State Analysis

### 현재 구현 상태
- **ChatPanel.tsx**: `renderItems.length === 0`일 때 빈 공간만 표시됨
- **ConversationEmptyState**: 정의되어 있으나 사용되지 않음
- **메시지 발송**: `handleSubmit({ text: string })` 형태로 호출

### 주요 참고 파일
- [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx) - 메인 채팅 패널
- [conversation.tsx](frontend/pluto_duck_frontend/components/ai-elements/conversation.tsx) - ConversationEmptyState 컴포넌트
- [ConnectorGrid.tsx](frontend/pluto_duck_frontend/components/data-sources/ConnectorGrid.tsx) - 카드 스타일 참고

## Desired End State

```
┌─────────────────────────────────────┐
│                                     │
│     Hello!                          │
│     What would you like to do       │
│     with your data today?           │
│                                     │
│     ┌─────────────┐ ┌─────────────┐ │
│     │ [TextSearch]│ │ [Calculator]│ │
│     │ Explore     │ │ Run         │ │
│     │ Data        │ │ Analysis    │ │
│     └─────────────┘ └─────────────┘ │
│     ┌─────────────┐ ┌─────────────┐ │
│     │[ChartSpline]│ │[LayersPlus] │ │
│     │ Generate    │ │ Update      │ │
│     │ Dashboard   │ │ Dashboard   │ │
│     └─────────────┘ └─────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Ask a question...               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 아이콘 매핑 (Lucide React)

| 버튼 | 아이콘 | import |
|------|--------|--------|
| Explore Data | TextSearch | `import { TextSearch } from 'lucide-react'` |
| Run Analysis | Calculator | `import { Calculator } from 'lucide-react'` |
| Generate Dashboard | ChartSpline | `import { ChartSpline } from 'lucide-react'` |
| Update Dashboard | Layers (with plus badge) | `import { Layers } from 'lucide-react'` |

> Note: `LayersPlus`가 lucide에 없을 경우 `Layers` 아이콘 사용

버튼 클릭 시:
1. 온보딩 UI가 fade-out 애니메이션으로 사라짐
2. 미리 설정된 프롬프트가 사용자 메시지로 발송됨
3. 대화가 시작됨

## What We're NOT Doing

- 사용자 이름 개인화 (인증 시스템 없음)
- 프로젝트별 선택지 커스터마이징
- 향상된 키보드 네비게이션 (화살표 키)
- 백엔드 설정으로 프롬프트 관리

## Implementation Approach

새로운 `ChatOnboarding` 컴포넌트를 생성하고, ChatPanel의 ConversationMessages 내부에서 빈 상태일 때 렌더링합니다. motion 라이브러리를 사용하여 fade-out 애니메이션을 구현합니다.

---

## - [x] Phase 1: ChatOnboarding 컴포넌트 생성

### Overview
온보딩 UI를 담당하는 독립적인 컴포넌트를 생성합니다.

### Changes Required:

#### 1. ChatOnboarding 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/chat/ChatOnboarding.tsx` (신규)

**구현 내용**:
- `OnboardingOption` 인터페이스 정의 (id, label, description, prompt, icon: LucideIcon)
- Lucide 아이콘 import: `TextSearch`, `Calculator`, `ChartSpline`, `Layers` (LayersPlus 대체)
- `ONBOARDING_OPTIONS` 상수 배열 정의:
  - Explore Data (TextSearch): "Help me explore my data. Show me an overview of all available tables and suggest interesting insights."
  - Run Analysis (Calculator): "I want to run an analysis on my data. Help me identify patterns and trends."
  - Generate Dashboard (ChartSpline): "Help me create a dashboard. What visualizations would be most useful for my data?"
  - Update Dashboard (Layers): "I need to update my existing dashboard. Show me the current visualizations and suggest improvements."
- `OnboardingCard` 내부 컴포넌트: ConnectorGrid 스타일의 카드 버튼, 아이콘은 `h-6 w-6 text-primary` 스타일 적용
- `ChatOnboarding` 메인 컴포넌트: 2x2 그리드 레이아웃

**Props 인터페이스**:
- `onSelect: (prompt: string) => void` - 선택지 클릭 시 호출
- `isExiting?: boolean` - fade-out 애니메이션 트리거

**스타일링**:
- 컨테이너: `flex h-full flex-col items-center justify-center p-6`
- 제목: `text-xl font-semibold mb-2`
- 설명: `text-muted-foreground mb-6`
- 그리드: `grid grid-cols-2 gap-3 max-w-md`
- 카드: `group flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center transition hover:border-primary/60 hover:bg-accent cursor-pointer`

#### 2. Export 추가
**File**: `frontend/pluto_duck_frontend/components/chat/index.ts`

**변경**: ChatOnboarding export 추가

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && pnpm typecheck`
- [ ] Linting passes: `cd frontend/pluto_duck_frontend && pnpm lint` (ESLint not configured)

#### Manual Verification:
- [ ] 컴포넌트가 정상적으로 import 가능
- [ ] 스토리북 또는 테스트 페이지에서 단독 렌더링 확인

---

## - [x] Phase 2: ChatPanel 통합

### Overview
ChatOnboarding을 ChatPanel에 통합하여 빈 채팅 상태일 때 표시합니다.

### Changes Required:

#### 1. ConversationMessages 수정
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**변경 위치**: ConversationMessages 컴포넌트 내부 (Lines 64-135 근처)

**구현 내용**:
- Props에 `onOnboardingSelect: (prompt: string) => void` 추가
- `renderItems.length === 0 && !loading && !isStreaming` 조건에서 ChatOnboarding 렌더링
- onSelect 호출 시 handleSubmit과 동일한 흐름으로 메시지 발송

#### 2. handleSubmit 연결
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**변경 위치**: ChatPanel 컴포넌트 (Lines 140-280 근처)

**구현 내용**:
- `handleOnboardingSelect` 콜백 함수 생성
- 선택된 프롬프트를 `handleSubmit({ text: prompt })`로 전달
- ConversationMessages에 props로 전달

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && pnpm typecheck`
- [ ] Linting passes: `cd frontend/pluto_duck_frontend && pnpm lint` (ESLint not configured)

#### Manual Verification:
- [ ] 빈 채팅창에서 온보딩 UI가 표시됨
- [ ] 선택지 클릭 시 프롬프트가 발송됨
- [ ] 대화 시작 후 온보딩 UI가 사라짐
- [ ] 새 탭 생성 시 온보딩 UI가 다시 표시됨

---

## - [x] Phase 3: Fade-out 애니메이션 추가

### Overview
온보딩에서 대화로 전환될 때 부드러운 fade-out 애니메이션을 적용합니다.

### Changes Required:

#### 1. 애니메이션 상태 관리
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**변경 위치**: ConversationMessages 또는 ChatPanel 내부

**구현 내용**:
- `isOnboardingExiting` 상태 추가
- 온보딩 선택 시 `isOnboardingExiting = true` 설정
- 애니메이션 완료 후 실제 메시지 발송

#### 2. Motion 애니메이션 적용
**File**: `frontend/pluto_duck_frontend/components/chat/ChatOnboarding.tsx`

**변경 내용**:
- `motion` 라이브러리에서 `AnimatePresence`, `motion` import
- 컨테이너를 `motion.div`로 감싸기
- exit 애니메이션 정의: `opacity: 0`, `y: -20`, `duration: 0.2`
- `AnimatePresence`로 감싸서 exit 애니메이션 활성화

**애니메이션 설정**:
- initial: `{ opacity: 1, y: 0 }`
- exit: `{ opacity: 0, y: -20 }`
- transition: `{ duration: 0.2, ease: "easeOut" }`

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && pnpm typecheck`
- [ ] Linting passes: `cd frontend/pluto_duck_frontend && pnpm lint` (ESLint not configured)

#### Manual Verification:
- [ ] 선택지 클릭 시 부드러운 fade-out 애니메이션 확인
- [ ] 애니메이션 완료 후 메시지가 정상 발송됨
- [ ] 애니메이션 중 입력 영역이 정상 동작함

---

## Testing Strategy

### Unit Tests:
- ChatOnboarding 컴포넌트 렌더링 테스트
- onSelect 콜백 호출 테스트
- 각 선택지별 올바른 프롬프트 전달 테스트

### Integration Tests:
- 빈 채팅 상태 → 온보딩 표시 → 선택 → 메시지 발송 전체 흐름
- 새 탭 생성 시 온보딩 재표시

### Manual Testing Steps:
1. 앱 실행 후 빈 채팅창 확인
2. 온보딩 UI가 중앙에 표시되는지 확인
3. 각 선택지에 마우스 호버 시 스타일 변경 확인
4. Tab 키로 선택지 간 이동 가능한지 확인
5. 선택지 클릭 시 fade-out 후 메시지 발송 확인
6. 대화 진행 후 온보딩이 다시 표시되지 않는지 확인
7. 새 탭 생성 시 온보딩 재표시 확인

## Performance Considerations

- ChatOnboarding 컴포넌트는 빈 상태에서만 렌더링되므로 성능 영향 최소
- motion 애니메이션은 GPU 가속 사용 (transform, opacity)
- ONBOARDING_OPTIONS는 컴포넌트 외부 상수로 정의하여 리렌더링 방지

## Migration Notes

- 기존 ConversationEmptyState 컴포넌트는 그대로 유지 (다른 용도로 사용 가능)
- 신규 컴포넌트이므로 데이터 마이그레이션 불필요

## References

### Files Read During Planning:
- [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx) - 메인 채팅 패널 구조
- [conversation.tsx](frontend/pluto_duck_frontend/components/ai-elements/conversation.tsx) - ConversationEmptyState 컴포넌트
- [ConnectorGrid.tsx](frontend/pluto_duck_frontend/components/data-sources/ConnectorGrid.tsx) - 카드 스타일 참고
- [button.tsx](frontend/pluto_duck_frontend/components/ui/button.tsx) - 버튼 스타일 참고
- [card.tsx](frontend/pluto_duck_frontend/components/ui/card.tsx) - 카드 컴포넌트 참고
- [useMultiTabChat.ts](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts) - handleSubmit 흐름
- [chatRenderItem.ts](frontend/pluto_duck_frontend/types/chatRenderItem.ts) - 렌더 아이템 타입
- [package.json](frontend/pluto_duck_frontend/package.json) - motion 라이브러리 확인

### Research Documents:
- [014_chat_onboarding_feature.md](docs/research/014_chat_onboarding_feature.md) - 기능 요구사항 및 현재 상태 분석

### External Resources:
- [Motion (Framer Motion) Documentation](https://motion.dev/) - 애니메이션 라이브러리
- [Lucide React Icons](https://lucide.dev/) - 아이콘 라이브러리
