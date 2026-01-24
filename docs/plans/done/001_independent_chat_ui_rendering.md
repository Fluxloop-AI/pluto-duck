# Chat UI 독립적 렌더링 구현 계획

## Overview
Turn 기반 그룹핑 구조를 UI 레이어에서만 Flat Array 구조로 변환하여, User Input, Reasoning, Tool Call, Model Response를 독립적인 UI 요소로 렌더링한다. API 의존성(runId 기반 스트리밍)은 수정하지 않는다.

## Current State Analysis

### 현재 데이터 흐름
```
Backend API → useAgentStream (SSE) → useMultiTabChat (Turn 생성) → ChatPanel (렌더링)
                                            │
                                            ▼
                                      ChatTurn[] (runId로 그룹화)
                                            │
                                            ▼
                                      turns.map(turn => ...)
```

### 현재 렌더링 구조 ([ChatPanel.tsx:202-375](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L202-L375))
- `turns.map()` 내부에서 userMessages, reasoning, tools, assistantMessages를 순차적으로 렌더링
- 모든 요소가 Turn 컨테이너 내에 중첩됨
- 액션 버튼은 마지막 assistant 메시지에만 존재 (Copy, Retry)

### 현재 액션 버튼 현황
| 대상 | 현재 액션 | 요구사항 |
|------|----------|----------|
| User Message | 없음 | 수정, 복사 |
| Assistant Message | 복사, 재생성 (마지막만) | 복사, 좋아요/싫어요, 재생성, 보드로 보내기 |

## Desired End State

### 새로운 데이터 흐름
```
useMultiTabChat
      │
      ├── turns (기존 유지 - 하위 호환성)
      │
      └── renderItems (새로 추가)
              │
              ▼
        ChatRenderItem[] (flat array)
              │
              ▼
        renderItems.map(item => <RenderItem />)
```

### 검증 방법
1. 모든 메시지 타입이 독립적으로 렌더링됨
2. 각 타입별 액션 버튼이 정상 동작
3. 스트리밍 상태가 개별 요소에 정확히 반영됨
4. 기존 API 호출 로직 변경 없음

## What We're NOT Doing
- Backend API 수정
- useAgentStream 훅 수정
- SSE 이벤트 구조 변경
- 기존 `turns` 데이터 구조 제거 (하위 호환성 유지)

## Implementation Approach
UI 레이어에서만 변환 레이어를 추가하여 `turns` → `renderItems` 변환을 수행한다. 기존 코드와 병행하여 점진적 마이그레이션이 가능하도록 한다.

---

## - [x] Phase 1: 타입 정의 및 변환 레이어

### Overview
`ChatRenderItem` union type과 `flattenTurnsToRenderItems()` 유틸리티 함수를 정의한다.

### Changes Required:

#### 1. ChatRenderItem 타입 정의
**File**: `frontend/pluto_duck_frontend/types/chatRenderItem.ts` (신규 생성)

**Changes**:
- `BaseRenderItem` 인터페이스 정의 (id, runId, seq, timestamp, isStreaming)
- `UserMessageItem` 타입 정의 (type: 'user-message', content, mentions)
- `ReasoningItem` 타입 정의 (type: 'reasoning', content, phase)
- `ToolItem` 타입 정의 (type: 'tool', toolName, state, input, output, error)
- `AssistantMessageItem` 타입 정의 (type: 'assistant-message', content, messageId)
- `ChatRenderItem` union type export

#### 2. 변환 유틸리티 함수
**File**: `frontend/pluto_duck_frontend/lib/chatRenderUtils.ts` (신규 생성)

**Changes**:
- `flattenTurnsToRenderItems(turns: ChatTurn[]): ChatRenderItem[]` 함수 구현
- Turn 내부 요소들을 순서대로 flat array로 변환
- 각 아이템에 고유 id, seq, timestamp 부여
- `extractText(content: any): string` 헬퍼 함수

#### 3. useMultiTabChat 훅 확장
**File**: `frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts`

**Changes**:
- `flattenTurnsToRenderItems` import
- `renderItems` computed value 추가 (useMemo로 turns에서 파생)
- return 객체에 `renderItems` 추가

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npx tsc --noEmit`
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npx eslint .` (ESLint not configured for project)

#### Manual Verification:
- [ ] `renderItems`가 `turns`와 동일한 데이터를 flat하게 표현
- [ ] 스트리밍 중에도 정상 동작

---

## - [x] Phase 2: 개별 렌더러 컴포넌트 구현

### Overview
각 ChatRenderItem 타입별로 독립적인 렌더러 컴포넌트를 구현한다. 액션 버튼을 포함한다.

### Changes Required:

#### 1. UserMessageRenderer 컴포넌트
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/UserMessageRenderer.tsx` (신규 생성)

**Changes**:
- `UserMessageItem`을 받아 렌더링하는 컴포넌트
- 기존 user message 스타일 유지 (rounded-2xl bg-primary)
- `@mention` 하이라이팅 지원
- **액션 버튼**: 수정 (PencilIcon), 복사 (CopyIcon)
- hover 시 액션 버튼 표시

#### 2. ReasoningRenderer 컴포넌트
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/ReasoningRenderer.tsx` (신규 생성)

**Changes**:
- `ReasoningItem`을 받아 렌더링하는 컴포넌트
- 기존 `Reasoning` 컴포넌트 재사용
- `phase`에 따른 스트리밍 상태 표시

#### 3. ToolRenderer 컴포넌트
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx` (신규 생성)

**Changes**:
- `ToolItem`을 받아 렌더링하는 컴포넌트
- 기존 `Tool` 컴포넌트 재사용
- `write_todos` 특별 처리 (Queue 컴포넌트)
- state에 따른 아이콘/색상 변경

#### 4. AssistantMessageRenderer 컴포넌트
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx` (신규 생성)

**Changes**:
- `AssistantMessageItem`을 받아 렌더링하는 컴포넌트
- 기존 `Response` 컴포넌트 재사용
- **액션 버튼**:
  - 복사 (CopyIcon)
  - 좋아요 (ThumbsUpIcon)
  - 싫어요 (ThumbsDownIcon)
  - 재생성 (RefreshCcwIcon)
  - 보드로 보내기 (LayoutDashboardIcon 또는 PanelRightIcon)
- hover 시 액션 버튼 표시

#### 5. RenderItem 라우터 컴포넌트
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/RenderItem.tsx` (신규 생성)

**Changes**:
- `ChatRenderItem`을 받아 타입별로 적절한 렌더러로 라우팅
- switch-case로 타입 분기

#### 6. 렌더러 index export
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/index.ts` (신규 생성)

**Changes**:
- 모든 렌더러 컴포넌트 re-export

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npx tsc --noEmit`
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npx eslint .` (ESLint not configured)

#### Manual Verification:
- [ ] 각 렌더러가 독립적으로 정상 표시됨
- [ ] 액션 버튼이 hover 시 표시됨
- [ ] 복사 기능 동작 확인

---

## - [x] Phase 3: ChatPanel 마이그레이션

### Overview
ChatPanel의 `ConversationMessages` 컴포넌트를 `renderItems` 기반으로 변경한다.

### Changes Required:

#### 1. ConversationMessages Props 변경
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**Changes**:
- `ConversationMessagesProps`에 `renderItems: ChatRenderItem[]` 추가
- 기존 `turns` prop 제거 또는 deprecated 처리
- 렌더러 컴포넌트 import

#### 2. 렌더링 로직 변경
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**Changes**:
- `turns.map()` → `renderItems.map()` 변경
- 각 아이템에 `RenderItem` 컴포넌트 사용
- runId 변경 시 간격 조절 (시각적 그룹핑)
- 기존 중첩 렌더링 로직 제거

#### 3. 콜백 함수 전달
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**Changes**:
- `onCopy`, `onRegenerate` 콜백을 RenderItem에 전달
- `onEdit` 콜백 추가 (user message 수정용)
- `onFeedback` 콜백 추가 (좋아요/싫어요)
- `onSendToBoard` 콜백 추가

#### 4. ChatPanel props 업데이트
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**Changes**:
- `ChatPanelProps`에서 `turns` → `renderItems` 변경
- 또는 둘 다 받아서 내부에서 선택 (마이그레이션 용이)

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npx tsc --noEmit`
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npx eslint .` (ESLint not configured)
- [x] Build succeeds: `cd frontend/pluto_duck_frontend && npm run build`

#### Manual Verification:
- [ ] 채팅 메시지가 정상 표시됨
- [ ] 스트리밍이 정상 동작함
- [ ] 액션 버튼이 모든 메시지에서 동작함

---

## - [ ] Phase 4: 액션 기능 구현

### Overview
수정, 좋아요/싫어요, 보드로 보내기 기능을 구현한다.

### Changes Required:

#### 1. 메시지 수정 기능
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`

**Changes**:
- `editingMessageId` state 추가
- 수정 모드 UI (인라인 textarea)
- 수정 완료 시 새 메시지로 대화 재시작 로직

#### 2. 피드백 기능 (좋아요/싫어요)
**File**: `frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts`

**Changes**:
- `handleFeedback(messageId: string, type: 'like' | 'dislike')` 함수 추가
- 피드백 상태를 로컬에 저장 (또는 API 연동 준비)

#### 3. 보드로 보내기 기능
**File**: `frontend/pluto_duck_frontend/components/chat/SendToBoardModal.tsx` (신규 생성)

**Changes**:
- 보드 선택 모달 컴포넌트
- 프로젝트 내 보드 목록 표시
- 새 보드 생성 옵션
- 선택한 보드의 활성 탭에 콘텐츠 추가

**File**: `frontend/pluto_duck_frontend/lib/lexicalUtils.ts` (신규 생성)

**Changes**:
- `markdownToLexicalJson(markdown: string): string` 함수
- Response 마크다운을 Lexical JSON으로 변환

#### 4. 보드로 보내기 통합
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx`

**Changes**:
- `SendToBoardModal` 연동
- 보드로 보내기 버튼 클릭 시 모달 열기

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npx tsc --noEmit`
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npx eslint .` (ESLint not configured)
- [x] Build succeeds: `cd frontend/pluto_duck_frontend && npm run build`

#### Manual Verification:
- [ ] 메시지 복사가 동작함
- [ ] 메시지 수정 후 대화가 재시작됨 (UI buttons in place, logic not fully implemented)
- [ ] 좋아요/싫어요 상태가 표시됨
- [ ] 보드로 보내기 시 선택한 보드에 콘텐츠 추가됨 (UI buttons in place, modal not implemented)

#### Implementation Notes:
- Feedback functionality (like/dislike) is implemented and stored locally with toggle behavior
- Copy functionality is implemented in all renderers
- Edit message and Send to Board have action buttons but require additional modal/logic work

---

## Testing Strategy

### Unit Tests:
- `flattenTurnsToRenderItems` 함수 테스트 (다양한 turn 구조)
- 각 렌더러 컴포넌트 스냅샷 테스트

### Integration Tests:
- ChatPanel에서 메시지 렌더링 테스트
- 액션 버튼 클릭 이벤트 테스트

### Manual Testing Steps:
1. 새 대화 시작 후 메시지 입력
2. 스트리밍 중 UI 확인
3. 각 액션 버튼 클릭 테스트
4. 보드로 보내기 후 보드에서 콘텐츠 확인

## Performance Considerations
- `flattenTurnsToRenderItems`는 `useMemo`로 메모이제이션
- 개별 렌더러는 `memo`로 불필요한 리렌더링 방지
- 대량 메시지 시 virtualization 고려 (추후)

## Migration Notes
- 기존 `turns` 데이터 구조는 유지하여 하위 호환성 보장
- ChatPanel 외부에서 `turns`를 사용하는 곳이 있다면 점진적 마이그레이션

## References
- [009_independent_chat_ui_rendering.md](docs/research/009_independent_chat_ui_rendering.md) - 리서치 문서
- [ChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx) - 현재 렌더링 구조
- [useMultiTabChat.ts](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts) - Turn 생성 로직
- [boardsApi.ts](frontend/pluto_duck_frontend/lib/boardsApi.ts) - 보드 API
- [actions.tsx](frontend/pluto_duck_frontend/components/ai-elements/actions.tsx) - 액션 버튼 컴포넌트
