# Chat Send Text to Board Implementation Plan

## Overview
채팅창의 "Send to Board" 버튼 클릭 시 어시스턴트 메시지 텍스트를 마크다운 파싱하여 활성 보드에 삽입하는 기능 구현. 보드 미선택 시 보드 선택 모달 표시.

## Current State Analysis

### 기존 구조
- "Send to Board" 버튼이 [AssistantMessageRenderer.tsx:107-110](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx#L107-L110)에 존재
- `onSendToBoard` 콜백 체인이 연결되어 있지만 최종 핸들러 미구현
- Chat과 Board가 sibling 컴포넌트로 직접 통신 불가

### 콜백 체인 (현재)
```
page.tsx
├── BoardsView (activeBoard 보유)
│   └── BoardEditor (Lexical 에디터)
└── MultiTabChatPanel (onSendToBoard 미연결)
    └── ChatPanel
        └── ConversationMessages
            └── AssistantMessageRenderer (버튼 존재)
```

## Desired End State

1. "Send to Board" 버튼 클릭 시:
   - 활성 보드가 있으면 → 해당 보드에 마크다운 파싱된 텍스트 삽입
   - 활성 보드가 없으면 → 보드 선택 모달 표시 후 삽입
2. 텍스트는 마크다운 문법이 Lexical 노드로 변환되어 삽입
3. 삽입 위치는 에디터 끝 (append)

### 검증 방법
- 채팅에서 "Send to Board" 버튼 클릭 → 보드에 텍스트 표시 확인
- 마크다운 문법 (# heading, **bold**, - list 등) 파싱 확인
- 보드 미선택 시 모달 표시 확인

## What We're NOT Doing
- 에셋(Analysis) 임베드 기능 (별도 계획)
- 특정 위치에 삽입 (커서 위치 등)
- 보드 탭 선택 기능 (활성 탭에만 삽입)

## Implementation Approach
Callback Prop 패턴으로 구현. BoardEditor에서 ref API를 노출하고, page.tsx에서 콜백을 연결.

---

## - [x] Phase 1: BoardEditor Ref API

### Overview
BoardEditor에서 외부로 `insertMarkdown` 메서드를 노출하여 프로그래매틱하게 콘텐츠 삽입 가능하게 함.

### Changes Required:

#### 1. BoardEditor에 Ref API 추가
**File**: `frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx`
**Changes**:
- `forwardRef`로 컴포넌트 래핑
- `useImperativeHandle`로 `insertMarkdown(content: string)` 메서드 노출
- 에디터 인스턴스를 ref로 저장하여 외부에서 접근 가능하게 함
- `@lexical/markdown`의 `$convertFromMarkdownString` 사용하여 마크다운 파싱

#### 2. BoardEditorHandle 타입 정의
**File**: `frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx`
**Changes**:
- `BoardEditorHandle` interface 정의 및 export
- `insertMarkdown: (content: string) => void` 메서드 시그니처

#### 3. InsertMarkdownPlugin 생성
**File**: `frontend/pluto_duck_frontend/components/editor/plugins/InsertMarkdownPlugin.tsx`
**Changes**:
- LexicalComposer 내부에서 editor 인스턴스에 접근하는 플러그인
- 외부에서 호출 가능한 insert 함수를 ref로 노출
- `$getRoot().append()` 또는 `$insertNodes`로 노드 삽입

### Success Criteria:

#### Automated Verification:
- [x] `npm run typecheck` 통과
- [x] `npm run lint` 통과

#### Manual Verification:
- [ ] BoardEditor ref가 정상적으로 노출됨
- [ ] 콘솔에서 `boardEditorRef.current?.insertMarkdown('# Test')` 호출 시 동작 확인

---

## - [x] Phase 2: Board Selector Modal

### Overview
보드가 선택되지 않은 상태에서 "Send to Board" 클릭 시 표시될 보드 선택 모달 컴포넌트 생성.

### Changes Required:

#### 1. BoardSelectorModal 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/boards/BoardSelectorModal.tsx`
**Changes**:
- Dialog 기반 모달 컴포넌트
- props: `open`, `onOpenChange`, `boards`, `onSelect`
- 보드 목록을 리스트로 표시
- 보드 선택 시 `onSelect(boardId)` 호출 후 모달 닫기

### Success Criteria:

#### Automated Verification:
- [x] `npm run typecheck` 통과
- [x] `npm run lint` 통과

#### Manual Verification:
- [ ] 모달이 정상적으로 열리고 닫힘
- [ ] 보드 목록이 표시됨
- [ ] 보드 선택 시 콜백 호출됨

---

## - [x] Phase 3: Callback Chain Connection

### Overview
page.tsx에서 BoardsView와 MultiTabChatPanel을 연결하여 "Send to Board" 기능 완성.

### Changes Required:

#### 1. BoardsView에 ref 전달
**File**: `frontend/pluto_duck_frontend/components/boards/BoardsView.tsx`
**Changes**:
- `forwardRef`로 컴포넌트 래핑
- BoardEditor의 ref를 상위로 전달

#### 2. page.tsx에서 콜백 연결
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- `boardEditorRef` 생성 및 BoardsView에 전달
- `pendingSendContent` 상태 추가 (보드 선택 대기 시 저장)
- `boardSelectorOpen` 상태 추가
- `handleSendToBoard` 콜백 구현:
  - activeBoard 있으면 → `boardEditorRef.current?.insertMarkdown(content)`
  - activeBoard 없으면 → `setPendingSendContent(content)`, `setBoardSelectorOpen(true)`
- 보드 선택 완료 시 → `selectBoard` 후 `insertMarkdown` 호출
- `handleSendToBoard`를 MultiTabChatPanel에 전달

#### 3. MultiTabChatPanel에 onSendToBoard 전달
**File**: `frontend/pluto_duck_frontend/components/chat/MultiTabChatPanel.tsx`
**Changes**:
- props에 `onSendToBoard` 추가
- ChatPanel에 전달

### Success Criteria:

#### Automated Verification:
- [x] `npm run typecheck` 통과
- [x] `npm run lint` 통과
- [ ] `npm run build` 성공

#### Manual Verification:
- [ ] 보드 선택 상태에서 "Send to Board" 클릭 → 텍스트가 보드에 삽입됨
- [ ] 보드 미선택 상태에서 "Send to Board" 클릭 → 모달 표시 → 보드 선택 → 텍스트 삽입
- [ ] 마크다운 문법이 올바르게 파싱됨 (heading, bold, list 등)

---

## Testing Strategy

### Unit Tests:
- BoardEditor `insertMarkdown` 메서드 동작 테스트
- 마크다운 파싱 결과 검증

### Manual Testing Steps:
1. 채팅에서 어시스턴트 응답 생성
2. "Send to Board" 버튼 클릭
3. 보드에 텍스트가 삽입되었는지 확인
4. 마크다운 포맷팅 확인 (# → heading, ** → bold 등)
5. 보드 미선택 상태에서 버튼 클릭 → 모달 확인
6. 모달에서 보드 선택 후 텍스트 삽입 확인

## Performance Considerations
- 대용량 텍스트 삽입 시 Lexical 업데이트 배치 처리
- 마크다운 파싱은 동기 작업이므로 매우 긴 텍스트의 경우 UI 블로킹 가능성 (현재 범위에서는 문제 없음)

## References
- [AssistantMessageRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx) - Send to Board 버튼
- [BoardEditor.tsx](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx) - Lexical 에디터
- [BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx) - 보드 뷰 컴포넌트
- [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) - 메인 레이아웃
- [SlashCommandPlugin.tsx](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx) - Lexical 노드 삽입 참고
- [useBoards.ts](frontend/pluto_duck_frontend/hooks/useBoards.ts) - 보드 상태 관리
- [docs/research/027_chat_to_board_send_feature.md](docs/research/027_chat_to_board_send_feature.md) - 리서치 문서
- [@lexical/markdown](https://lexical.dev/docs/concepts/serialization#markdown) - 마크다운 변환 API
