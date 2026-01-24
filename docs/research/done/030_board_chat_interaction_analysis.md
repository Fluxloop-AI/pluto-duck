---
date: 2026-01-16T00:00:00Z
researcher: Claude
topic: "Board-Chat Interaction Implementation Analysis"
tags: [research, codebase, board, chat, interaction, architecture]
status: complete
---

# Research: Board-Chat Interaction Implementation Analysis

## Research Question

보드와 채팅 간의 상호작용이 현재 어떻게 구현되어 있는지? 보드의 내용을 채팅에서 읽을 수 있는지?

## Summary

현재 구현된 상호작용:
1. **Chat → Board (단방향)**: "Send to Board" 기능으로 채팅 메시지를 보드에 삽입 가능
2. **Chat에서 Asset 멘션**: `@` 문법으로 분석(Analysis), 데이터소스 등을 채팅에서 참조 가능
3. **Board → Chat (미구현)**: 보드 내용을 채팅으로 보내거나 채팅에서 보드 내용을 읽는 기능은 없음

결론: **현재는 단방향(Chat → Board) 통신만 존재**

## Detailed Findings

### 1. Chat → Board: Send to Board 기능

채팅 메시지를 보드에 삽입하는 기능이 구현되어 있음.

**UI 버튼 위치**: `components/chat/renderers/AssistantMessageRenderer.tsx:107-110`
```typescript
<ClipboardPlusIcon ... onClick={() => onSendToBoard?.(item.messageId, item.content)} />
```

**핸들러 체인**:
```
AssistantMessageRenderer.onSendToBoard
  → ChatPanel (line 175)
  → MultiTabChatPanel (line 32)
  → app/page.tsx:handleSendToBoard (line 396-405)
```

**핵심 로직**: `app/page.tsx:396-420`
```typescript
const handleSendToBoard = useCallback((messageId: string, content: string) => {
  if (activeBoard) {
    // 보드가 선택되어 있으면 바로 삽입
    boardsViewRef.current?.insertMarkdown(content);
  } else {
    // 보드가 없으면 선택 모달 표시
    setPendingSendContent(content);
    setBoardSelectorOpen(true);
  }
}, [activeBoard]);
```

**삽입 메서드**: `components/boards/BoardsView.tsx:57-65`
```typescript
export interface BoardsViewHandle {
  insertMarkdown: (content: string) => void;
  insertAssetEmbed: (analysisId: string, projectId: string, config: AssetEmbedConfig) => void;
}
```

### 2. Asset Mention 시스템 (Chat에서 Asset 참조)

채팅에서 `@` 문법으로 프로젝트 자산을 참조할 수 있음.

**Hook**: `hooks/useAssetMentions.ts:20-147`
- Analyses (분석 쿼리)
- Data Sources (데이터 소스)
- Datasets/Files (파일 자산)

**UI 컴포넌트**: `components/chat/MentionMenu.tsx:24-114`
- 검색 가능한 드롭다운 메뉴
- `@` 입력 시 트리거

**Backend로 전달**: `components/chat/ChatPanel.tsx:208-217`
```typescript
// 멘션된 자산 추출 및 컨텍스트 문자열 빌드
const mentionedAssets = extractMentions(prompt);
const context = buildContextString(mentionedAssets);
// appendMessage payload의 contextAssets로 전송
```

### 3. Board → Chat: 미구현

**현재 없는 기능들**:
- 보드 내용을 채팅으로 보내는 버튼/기능
- 채팅에서 보드 내용을 읽어오는 API
- 보드 컨텍스트를 AI 대화에 자동 포함하는 기능

**구조적 이유**:
- Chat과 Board는 같은 페이지에서 형제 컴포넌트로 존재
- 직접적인 Context 공유 없이 Ref 기반 메서드 호출만 사용
- 현재 Ref는 `insertMarkdown`, `insertAssetEmbed`만 노출

### 4. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  app/page.tsx (WorkspacePage)                               │
│  - boardsViewRef: BoardsViewHandle                          │
│  - handleSendToBoard: (messageId, content) => void          │
└─────────────────────────────────────────────────────────────┘
         │                                    │
         │ ref 전달                           │ callback 전달
         ▼                                    ▼
┌─────────────────────┐           ┌─────────────────────────┐
│ BoardsView          │           │ MultiTabChatPanel        │
│ - insertMarkdown()  │◄──────────│ - onSendToBoard prop     │
│ - insertAssetEmbed()│  호출     │                          │
└─────────────────────┘           └─────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────────┐           ┌─────────────────────────┐
│ BoardEditor         │           │ ChatPanel                │
│ (Lexical Editor)    │           │ - AssistantMessage       │
│                     │           │ - "Send to Board" 버튼    │
└─────────────────────┘           └─────────────────────────┘
```

### 5. 데이터 흐름

**Chat → Board 삽입 흐름**:
```
1. 사용자가 "Send to Board" 버튼 클릭
2. onSendToBoard(messageId, content) 호출
3. page.tsx에서 activeBoard 확인
4. boardsViewRef.current.insertMarkdown(content) 호출
5. InsertMarkdownPlugin이 Lexical 에디터에 내용 추가
6. 에디터 onChange로 자동 저장 트리거
```

**Asset Mention 흐름**:
```
1. 사용자가 채팅에서 "@" 입력
2. MentionMenu 드롭다운 표시
3. useAssetMentions로 자산 목록 로드
4. 선택한 자산이 프롬프트에 포함
5. ChatPanel에서 contextAssets로 추출
6. Backend API로 컨텍스트와 함께 전송
```

## Code References

### Chat → Board 구현
- `app/page.tsx:396-420` - handleSendToBoard, handleBoardSelect
- `components/boards/BoardsView.tsx:17-20` - BoardsViewHandle interface
- `components/boards/BoardsView.tsx:57-65` - useImperativeHandle
- `components/chat/renderers/AssistantMessageRenderer.tsx:61-63, 107-110` - Send to Board 버튼

### Asset Mention 구현
- `hooks/useAssetMentions.ts:20-147` - 멘션 가능 자산 로드
- `components/chat/MentionMenu.tsx:24-114` - 멘션 UI
- `components/chat/ChatPanel.tsx:208-217` - 컨텍스트 빌드

### Board Editor 구현
- `components/editor/BoardEditor.tsx:67-68` - insertMarkdownRef, insertAssetEmbedRef
- `components/editor/plugins/InsertMarkdownPlugin.tsx:17-51` - 마크다운 삽입 로직
- `components/editor/plugins/InsertAssetEmbedPlugin.tsx:17-31` - 자산 임베드 삽입

### API 레이어
- `lib/boardsApi.ts:91-105` - updateBoard (보드 저장)
- `lib/chatApi.ts:80-86` - AppendMessagePayload (채팅 메시지 전송)

## Architecture Insights

1. **Ref 기반 통신**: Context 대신 React Ref를 사용해 컴포넌트 간 메서드 호출
2. **단방향 설계**: 현재 Chat → Board만 구현, 역방향은 의도적 미구현으로 보임
3. **느슨한 결합**: Board와 Chat이 직접 상태를 공유하지 않음
4. **Asset 멘션**: 보드 콘텐츠 직접 참조 대신 Asset(분석 결과) 단위로 참조

## Open Questions

1. **Board → Chat 기능 필요성**: 보드 내용을 AI와 논의하는 기능이 필요한가?
   - 가능한 구현: 보드 내용을 컨텍스트로 포함하는 "Ask AI about this" 버튼
   - 또는: 현재 보드 내용을 자동으로 채팅 컨텍스트에 포함

2. **실시간 동기화**: 보드 변경 시 채팅에 알림/반영이 필요한가?

3. **Asset Embed 확장**: 현재 InsertAssetEmbedPlugin이 있으나, 채팅에서 직접 분석 결과를 보드에 임베드하는 UI는 별도 구현 필요
