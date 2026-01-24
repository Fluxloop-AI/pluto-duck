---
date: 2026-01-16T00:00:00+09:00
researcher: Claude
topic: "Chat to Board Send Feature Implementation Research"
tags: [research, codebase, chat, board, integration, asset-embed]
status: complete
---

# Research: Chat to Board Send Feature Implementation

## Research Question
채팅창 아래 액션 버튼에서 "보드로 보내기" 버튼을 클릭했을 때 해당 채팅의 내용을 보드로 보내는 기능 구현 방법 연구. 두 가지 케이스 지원:
1. **텍스트 보내기**: 일반 채팅 메시지를 보드에 텍스트로 삽입
2. **에셋 임베드**: 에이전트가 만든 Analysis를 보드에 AssetEmbedNode로 삽입

## Summary

1. **"보드로 보내기" 버튼은 이미 UI에 존재**하지만 핸들러가 구현되지 않음
2. **Asset Embed Modal은 2단계 플로우**로 작동: AssetPicker → DisplayConfigModal
3. **Context 기반 패턴**으로 모달 트리거: `AssetEmbedContext.openAssetEmbed()`
4. **Chat과 Board는 sibling 컴포넌트**로 직접 통신 메커니즘이 없음
5. **에이전트의 `save_analysis` 도구**가 Analysis 생성 → `analysis_id`가 tool result에 포함됨
6. **Tool result에서 `analysis_id` 접근 가능**: `toolItem.output?.analysis_id`
7. **구현 방안**: 새로운 Context나 전역 상태를 통해 채팅 → 보드 통신 브릿지 필요

## Detailed Findings

### 1. 현재 "보드로 보내기" 버튼 구조

**버튼 위치**: [AssistantMessageRenderer.tsx:107-110](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx#L107-L110)

```tsx
{/* Send to Board */}
<Action onClick={handleSendToBoard} tooltip="Send to board">
  <ClipboardPlusIcon className="size-3" />
</Action>
```

**핸들러 정의**: [AssistantMessageRenderer.tsx:61-63](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx#L61-L63)

```tsx
const handleSendToBoard = () => {
  onSendToBoard?.(item.messageId, item.content);
};
```

**콜백 체인** (연결되어 있지만 최종 핸들러 미구현):
- `MultiTabChatPanel` → `ChatPanel` → `ConversationMessages` → `RenderItem` → `AssistantMessageRenderer`
- Props interface: `onSendToBoard?: (messageId: string, content: string) => void`

**문제점**: `useMultiTabChat` 훅에서 실제 핸들러가 구현되지 않아 버튼 클릭 시 아무 동작 없음

---

### 2. Board /asset 슬래시 커맨드 메커니즘

**슬래시 커맨드 플러그인**: [SlashCommandPlugin.tsx:87-89](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L87-L89)

```tsx
const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', {
  minLength: 0,
});
```

**Asset 옵션 정의**: [SlashCommandPlugin.tsx:158-177](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L158-L177)

```tsx
new SlashMenuOption(
  'Asset',
  <Database size={18} />,
  ['asset', 'analysis', 'data', 'query', 'table', 'chart'],
  (editor) => {
    if (assetEmbedContext) {
      assetEmbedContext.openAssetEmbed((analysisId: string, config: AssetEmbedConfig) => {
        editor.update(() => {
          const assetNode = $createAssetEmbedNode(analysisId, projectId, config);
          const paragraphNode = $createParagraphNode();
          $insertNodes([assetNode, paragraphNode]);
          paragraphNode.select();
        });
      });
    }
  }
)
```

---

### 3. Asset Embed Modal 2단계 플로우

**Context 정의**: [SlashCommandPlugin.tsx:29-34](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L29-L34)

```tsx
export interface AssetEmbedContextType {
  openAssetEmbed: (callback: (analysisId: string, config: AssetEmbedConfig) => void) => void;
}

export const AssetEmbedContext = createContext<AssetEmbedContextType | null>(null);
```

**플로우 상태 관리**: [BoardEditor.tsx:85-96](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx#L85-L96)

```tsx
const [embedFlow, setEmbedFlow] = useState<{
  step: 'picker' | 'config' | null;
  analysisId: string | null;
  callback: ((analysisId: string, config: AssetEmbedConfig) => void) | null;
}>({
  step: null,
  analysisId: null,
  callback: null,
});
```

**단계별 흐름**:

| 단계 | 컴포넌트 | 파일 | 설명 |
|------|----------|------|------|
| 1 | AssetPicker | [AssetPicker.tsx](frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx) | Analysis 선택 |
| 2 | DisplayConfigModal | [DisplayConfigModal.tsx](frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx) | 표시 옵션 설정 |

**Context Provider 위치**: [BoardEditor.tsx:216-217](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx#L216-L217)

```tsx
<AssetEmbedContext.Provider value={{ openAssetEmbed }}>
  <ConfigModalContext.Provider value={{ openConfigModal }}>
    <LexicalComposer initialConfig={initialConfig}>
      {/* Editor content */}
    </LexicalComposer>
  </ConfigModalContext.Provider>
</AssetEmbedContext.Provider>
```

---

### 4. 애플리케이션 레이아웃 구조

**메인 레이아웃**: [app/page.tsx:573-620](frontend/pluto_duck_frontend/app/page.tsx#L573-L620)

```
WorkspacePage
├── Sidebar (BoardList)
└── Main Content Area
    ├── BoardsView (left side)
    │   └── BoardEditor (with Lexical + contexts)
    │       └── SlashCommandPlugin + AssetEmbedContext
    └── MultiTabChatPanel (right side, resizable)
        ├── ChatPanel
        │   └── RenderItem
        │       └── AssistantMessageRenderer
        └── [onSendToBoard callback - NOT CONNECTED]
```

**핵심 문제**: Chat과 Board는 **sibling 컴포넌트**로 직접 통신 메커니즘 없음

---

### 5. Board 콘텐츠 구조 및 삽입 방법

**Board 콘텐츠 저장**: Lexical JSON 형식으로 `board.settings.tabs[].content`에 저장

**노드 삽입 함수**: [SlashCommandPlugin.tsx:163-172](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L163-L172)

```tsx
editor.update(() => {
  const assetNode = $createAssetEmbedNode(analysisId, projectId, config);
  const paragraphNode = $createParagraphNode();
  $insertNodes([assetNode, paragraphNode]);
  paragraphNode.select();
});
```

**지원되는 노드 타입**: [BoardEditor.tsx:65-76](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx#L65-L76)
- HeadingNode, QuoteNode, ListNode, ListItemNode
- CodeNode, CodeHighlightNode
- LinkNode, AutoLinkNode
- ImageNode, AssetEmbedNode

---

### 6. Chat Content vs Board Content 변환

| 구분 | Chat | Board |
|------|------|-------|
| **저장** | 개별 메시지 DB 저장 | Lexical JSON (tab.content) |
| **구조** | 선형 타임스탬프 스트림 | 계층적 노드 트리 |
| **렌더링** | 순차적 메타데이터 표시 | 포맷된 문서 뷰 |
| **편집** | 전송 후 읽기 전용 | 풀 리치텍스트 에디터 |

**변환 로직 (개념)**:
```tsx
// 1. 채팅 메시지 텍스트 추출
const messageContent = assistantMessageItem.content;

// 2. Lexical 노드 생성
editor.update(() => {
  const paragraphNode = $createParagraphNode();
  const textNode = $createTextNode(messageContent);
  paragraphNode.append(textNode);
  $insertNodes([paragraphNode]);
});

// 3. BoardsView에서 저장
handleTabContentChange(JSON.stringify(editorState.toJSON()));
```

---

### 7. 에이전트의 Analysis 생성 플로우

**에이전트 도구 정의**: [asset.py:48-116](backend/pluto_duck_backend/agent/core/deep/tools/asset.py#L48-L116)

에이전트는 8개의 Analysis 관련 도구를 가지고 있음:

| 도구 | 설명 |
|------|------|
| `save_analysis` | **Analysis 생성** - SQL을 Asset으로 저장 |
| `run_analysis` | 저장된 Analysis 실행 |
| `list_analyses` | Analysis 목록 조회 |
| `get_analysis` | 특정 Analysis 상세 조회 |
| `get_lineage` | 의존성 그래프 조회 |
| `get_freshness` | 실행 필요 여부 확인 |
| `delete_analysis` | Analysis 삭제 |
| `list_files` | 파일 에셋 목록 조회 |

**save_analysis 도구 결과 (핵심!)**: [asset.py:101-109](backend/pluto_duck_backend/agent/core/deep/tools/asset.py#L101-L109)

```python
return {
    "status": "success",
    "message": f"✅ '{name}' Asset이 저장되었어요. (ID: {analysis.id})",
    "analysis_id": analysis.id,        # ← 이 ID를 사용하여 보드에 임베드
    "name": analysis.name,
    "materialization": analysis.materialize,
    "result_table": analysis.result_table,
    "hint": f"run_analysis('{analysis.id}')로 실행하거나...",
}
```

---

### 8. Tool Result에서 Analysis ID 접근 방법

**Tool Event 구조**: [chatRenderItem.ts:49-61](frontend/pluto_duck_frontend/types/chatRenderItem.ts#L49-L61)

```typescript
export interface ToolItem extends BaseRenderItem {
  type: 'tool';
  toolName: string;
  state: 'pending' | 'completed' | 'error';
  input?: string;
  output?: any;    // ← 여기에 analysis_id 포함
  error?: string;
}
```

**Analysis ID 접근**:
```typescript
// ToolItem에서 접근
const analysisId = toolItem.output?.analysis_id;

// GroupedToolEvent에서 접근
const analysisId = groupedTool.endEvent?.content?.output?.analysis_id;
```

**Tool Event 처리 흐름**:
```
Tool Output Dict (backend)
  → AgentEvent.content
  → agent_events 테이블 payload JSON
  → Frontend event.content
  → toolItem.output
  → toolItem.output?.analysis_id
```

---

### 9. 채팅 UI의 액션 버튼 시스템

**Suggestion 컴포넌트**: [suggestion.tsx:11-56](frontend/pluto_duck_frontend/components/ai-elements/suggestion.tsx#L11-L56)
- `Suggestions`: 스크롤 가능한 제안 버튼 컨테이너
- `Suggestion`: 개별 클릭 가능한 제안 버튼 (pill 형태)

**Action 컴포넌트**: [actions.tsx:26-65](frontend/pluto_duck_frontend/components/ai-elements/actions.tsx#L26-L65)
- `Actions`: 액션 버튼 컨테이너 (flex, gap-0)
- `Action`: 개별 액션 버튼 (ghost variant, tooltip 지원)

**Confirmation 패턴**: [confirmation.tsx:38-148](frontend/pluto_duck_frontend/components/ai-elements/confirmation.tsx#L38-L148)
- 승인 플로우를 위한 컴포넌트 시스템
- "보드에 붙여드릴까요?" 같은 인라인 제안에 활용 가능

**Queue 컴포넌트** (write_todos 렌더링): [queue.tsx:109-137](frontend/pluto_duck_frontend/components/ai-elements/queue.tsx#L109-L137)
- `QueueItemActions`: 호버 시 나타나는 액션 버튼 컨테이너
- `QueueItemAction`: 개별 액션 버튼

---

### 10. Tool Renderer 구조

**ToolRenderer**: [ToolRenderer.tsx:173-238](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx#L173-L238)

```typescript
export const ToolRenderer = memo(function ToolRenderer({item}: ToolRendererProps) {
  // write_todos 특별 처리 (Queue 컴포넌트 사용)
  if (item.toolName === 'write_todos') {
    // ... Queue 렌더링
  }

  // 일반 도구 렌더링
  return (
    <Tool defaultOpen={false}>
      <ToolHeader state={toolState} toolName={toolName} ... />
      <ToolContent>
        <ToolInput input={item.input} />
        <ToolOutput output={actualOutput} errorText={item.error} />
      </ToolContent>
    </Tool>
  );
});
```

**현재 구조**: Tool result에서 `analysis_id`는 접근 가능하지만, "보드에 붙이기" 버튼은 없음

---

## Code References

### Chat Action Buttons
- [AssistantMessageRenderer.tsx:107-110](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx#L107-L110) - Send to Board 버튼
- [AssistantMessageRenderer.tsx:61-63](frontend/pluto_duck_frontend/components/chat/renderers/AssistantMessageRenderer.tsx#L61-L63) - handleSendToBoard 핸들러
- [actions.tsx:26-65](frontend/pluto_duck_frontend/components/ai-elements/actions.tsx#L26-L65) - Action 컴포넌트 정의

### Agent Analysis Tools
- [asset.py:48-116](backend/pluto_duck_backend/agent/core/deep/tools/asset.py#L48-L116) - save_analysis 도구
- [asset.py:101-109](backend/pluto_duck_backend/agent/core/deep/tools/asset.py#L101-L109) - analysis_id 반환 구조
- [service.py:143-216](backend/pluto_duck_backend/app/services/asset/service.py#L143-L216) - AssetService.create_analysis

### Tool Result Rendering
- [ToolRenderer.tsx:173-238](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx#L173-L238) - Tool 렌더링
- [chatRenderItem.ts:49-61](frontend/pluto_duck_frontend/types/chatRenderItem.ts#L49-L61) - ToolItem 타입
- [useMultiTabChat.ts:44-52](frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts#L44-L52) - GroupedToolEvent

### UI Components for Actions
- [suggestion.tsx:11-56](frontend/pluto_duck_frontend/components/ai-elements/suggestion.tsx#L11-L56) - Suggestion 버튼
- [confirmation.tsx:38-148](frontend/pluto_duck_frontend/components/ai-elements/confirmation.tsx#L38-L148) - Confirmation 패턴
- [queue.tsx:109-137](frontend/pluto_duck_frontend/components/ai-elements/queue.tsx#L109-L137) - Queue 액션 버튼

### Slash Command System
- [SlashCommandPlugin.tsx:87-180](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L87-L180) - 슬래시 커맨드 구현
- [SlashCommandPlugin.tsx:29-34](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L29-L34) - AssetEmbedContext 정의

### Asset Embed Modal
- [BoardEditor.tsx:99-108](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx#L99-L108) - openAssetEmbed 콜백
- [AssetPicker.tsx:1-193](frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx) - Step 1 모달
- [DisplayConfigModal.tsx:1-466](frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx) - Step 2 모달

### Board Content Management
- [BoardEditor.tsx:161-186](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx#L161-L186) - handleOnChange
- [BoardsView.tsx:171-179](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx#L171-L179) - handleTabContentChange
- [AssetEmbedNode.tsx:16-32](frontend/pluto_duck_frontend/components/editor/nodes/AssetEmbedNode.tsx#L16-L32) - AssetEmbedConfig

### Layout Structure
- [app/page.tsx:573-620](frontend/pluto_duck_frontend/app/page.tsx#L573-L620) - 메인 레이아웃

---

## Architecture Insights

### 현재 아키텍처의 한계
1. **컴포넌트 격리**: Chat과 Board가 독립적으로 관리되어 직접 통신 불가
2. **Context 범위**: AssetEmbedContext는 BoardEditor 내부에만 존재
3. **상태 관리 분리**: useMultiTabChat와 useBoards가 별도로 동작

### 권장 구현 패턴

**Option A: 전역 Context 추가**
```tsx
// ChatToBoardContext 생성
interface ChatToBoardContextType {
  sendToBoard: (content: string, targetBoardId?: string) => void;
  openBoardSelector: (content: string) => void;
}

// app/page.tsx에서 Provider 제공
<ChatToBoardContext.Provider value={{ sendToBoard, openBoardSelector }}>
  <BoardsView ... />
  <MultiTabChatPanel ... />
</ChatToBoardContext.Provider>
```

**Option B: 콜백 prop 연결**
```tsx
// app/page.tsx
const handleSendToBoard = useCallback((messageId: string, content: string) => {
  // 1. 보드 선택 모달 열기 또는
  // 2. 활성 보드에 직접 삽입
}, [activeBoard]);

<MultiTabChatPanel onSendToBoard={handleSendToBoard} />
```

**Option C: Custom Event 사용**
```tsx
// Chat에서 이벤트 발생
window.dispatchEvent(new CustomEvent('chat:sendToBoard', {
  detail: { messageId, content }
}));

// BoardEditor에서 이벤트 수신
useEffect(() => {
  window.addEventListener('chat:sendToBoard', handleChatContent);
  return () => window.removeEventListener('chat:sendToBoard', handleChatContent);
}, []);
```

---

## Implementation Recommendations

### 케이스 1: 텍스트 메시지 보내기

**구현 위치**: AssistantMessageRenderer의 기존 "Send to Board" 버튼 활용

```tsx
// 1. app/page.tsx에서 콜백 정의
const handleSendTextToBoard = useCallback((messageId: string, content: string) => {
  // 활성 보드 에디터에 텍스트 삽입
  boardEditorRef.current?.insertText(content);
}, []);

// 2. MultiTabChatPanel에 전달
<MultiTabChatPanel onSendToBoard={handleSendTextToBoard} />
```

### 케이스 2: Analysis(에셋) 보드에 임베드

**구현 방안**: ToolRenderer에 "보드에 붙이기" 버튼 추가

```tsx
// ToolRenderer.tsx 수정
const ToolRenderer = ({ item, onEmbedToBoard }: ToolRendererProps) => {
  const analysisId = item.output?.analysis_id;

  // save_analysis 또는 run_analysis 결과일 때 버튼 표시
  const showEmbedButton = analysisId &&
    ['save_analysis', 'run_analysis'].includes(item.toolName);

  return (
    <Tool>
      <ToolHeader ... />
      {showEmbedButton && (
        <Button onClick={() => onEmbedToBoard(analysisId)}>
          보드에 붙이기
        </Button>
      )}
      <ToolContent>...</ToolContent>
    </Tool>
  );
};
```

**에셋 임베드 플로우**:
```
1. 유저: "이거 분석해줘"
2. 에이전트: save_analysis 실행 → analysis_id 반환
3. ToolRenderer: analysis_id 감지 → "보드에 붙이기" 버튼 표시
4. 유저: 버튼 클릭
5. DisplayConfigModal 열림 (AssetPicker 스킵 - 이미 ID 있음)
6. 유저: 테이블/차트 설정 후 확인
7. 활성 보드에 AssetEmbedNode 삽입
```

### 공통 인프라

**필요한 새 Context**:
```tsx
// ChatToBoardContext.tsx
interface ChatToBoardContextType {
  // 텍스트 삽입
  sendTextToBoard: (content: string) => void;
  // 에셋 임베드 (DisplayConfigModal 열기)
  embedAssetToBoard: (analysisId: string) => void;
}
```

**app/page.tsx 수정**:
```tsx
const [embedModalState, setEmbedModalState] = useState<{
  open: boolean;
  analysisId: string | null;
}>({ open: false, analysisId: null });

const embedAssetToBoard = useCallback((analysisId: string) => {
  setEmbedModalState({ open: true, analysisId });
}, []);

// DisplayConfigModal을 BoardsView 밖에 렌더링
{embedModalState.open && (
  <DisplayConfigModal
    open={true}
    analysisId={embedModalState.analysisId!}
    projectId={projectId}
    onSave={(config) => {
      // 활성 보드에 AssetEmbedNode 삽입
      boardEditorRef.current?.insertAssetEmbed(analysisId, config);
      setEmbedModalState({ open: false, analysisId: null });
    }}
    onCancel={() => setEmbedModalState({ open: false, analysisId: null })}
  />
)}
```

---

## Open Questions

1. **에셋 임베드 트리거**: Tool result에 버튼 vs 에이전트 메시지에 인라인 제안?
2. **보드 선택**: 활성 보드에 바로 삽입 vs 보드/탭 선택 모달?
3. **에이전트 연동**: 에이전트가 "보드에 붙여드릴까요?" 메시지를 자동 생성하게 할지?
4. **BoardEditor ref**: 외부에서 삽입 명령을 내릴 수 있는 ref API 필요
5. **텍스트 포맷**: 마크다운 파싱하여 Lexical 노드로 변환할지?
