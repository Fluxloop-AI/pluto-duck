# Asset Embed via Agent Suggestion Implementation Plan

## Overview
에이전트가 `save_analysis` 도구로 Asset을 생성한 후 "보드에 붙여드릴까요?"라는 제안 메시지를 자동 생성하고, 사용자가 승인하면 DisplayConfigModal을 거쳐 활성 보드에 AssetEmbedNode를 삽입하는 기능 구현.

## Current State Analysis

### 기존 구조
- `save_analysis` 도구가 `analysis_id`를 반환 ([asset.py:101-109](backend/pluto_duck_backend/agent/core/deep/tools/asset.py#L101-L109))
- ToolRenderer가 도구 결과를 렌더링 ([ToolRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx))
- DisplayConfigModal이 Asset 설정 UI 제공 ([DisplayConfigModal.tsx](frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx))
- Chat과 Board 간 통신 브릿지 없음 (sibling 컴포넌트)

### 콜백 체인 (현재)
```
page.tsx
├── BoardsView
│   └── BoardEditor (AssetEmbedContext 내부)
│       └── DisplayConfigModal (embed flow용)
└── MultiTabChatPanel
    └── ChatPanel
        └── ToolRenderer (save_analysis 결과 표시)
```

## Desired End State

1. 에이전트가 `save_analysis` 실행 후 `suggest_board_embed` 도구 호출
2. 프론트엔드에서 "보드에 붙여드릴까요?" 카드 렌더링 (예/아니오 버튼)
3. 사용자가 "예" 클릭 시:
   - DisplayConfigModal 열림 (AssetPicker 스킵)
   - 테이블/차트 설정 후 활성 보드에 AssetEmbedNode 삽입
4. 사용자가 "아니오" 클릭 시 카드 닫힘

### 검증 방법
- 에이전트에게 "이 데이터 분석해줘" 요청 → Asset 생성 후 제안 카드 표시
- "예" 클릭 → DisplayConfigModal 열림 → 설정 후 보드에 Asset 표시
- 활성 보드 없을 때 제안 카드가 비활성화되거나 안내 메시지 표시

## What We're NOT Doing
- 텍스트 메시지 보드 전송 (012에서 구현 완료)
- 보드/탭 선택 UI (활성 보드에만 삽입)
- AssetPicker 단계 (이미 analysis_id 있음)
- 에이전트 프롬프트 자동화 (수동 호출 방식)

## Implementation Approach
새로운 `suggest_board_embed` 도구를 생성하고, 프론트엔드에서 해당 도구를 특별한 UI로 렌더링. page.tsx에서 Chat→Board 브릿지 Context를 제공하여 도구 결과에서 보드 삽입 트리거.

---

## - [ ] Phase 1: Backend - suggest_board_embed Tool

### Overview
에이전트가 호출할 수 있는 새로운 도구 생성. Asset 생성 후 사용자에게 보드 임베드를 제안하는 용도.

### Changes Required:

#### 1. suggest_board_embed 도구 추가
**File**: `backend/pluto_duck_backend/agent/core/deep/tools/asset.py`
**Changes**:
- `suggest_board_embed(analysis_id: str, analysis_name: str)` 함수 추가
- 반환값: `{"type": "board_embed_suggestion", "analysis_id": ..., "analysis_name": ...}`
- 도구 설명에 "save_analysis 후 사용자에게 보드 임베드 제안" 명시

#### 2. 에이전트 프롬프트 업데이트
**File**: `backend/pluto_duck_backend/agent/core/deep/prompts/default_agent_prompt.md`
**Changes**:
- `save_analysis` 성공 후 `suggest_board_embed` 호출 가이드 추가
- "Asset을 생성한 후에는 suggest_board_embed를 호출하여 사용자에게 보드 임베드를 제안하세요"

### Success Criteria:

#### Automated Verification:
- [ ] Backend 서버 정상 시작
- [ ] 도구 목록에 `suggest_board_embed` 포함 확인

#### Manual Verification:
- [ ] 에이전트가 save_analysis 후 suggest_board_embed 호출

---

## - [ ] Phase 2: Frontend - BoardEmbedSuggestion Renderer

### Overview
`suggest_board_embed` 도구 결과를 특별한 UI 카드로 렌더링. "예/아니오" 버튼 포함.

### Changes Required:

#### 1. BoardEmbedSuggestionRenderer 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/BoardEmbedSuggestionRenderer.tsx`
**Changes**:
- props: `analysisId`, `analysisName`, `onAccept`, `onDecline`
- Alert/Card 스타일의 제안 UI
- "📊 '[분석명]'을 보드에 붙여드릴까요?" 텍스트
- "예" 버튼 → `onAccept(analysisId)` 호출
- "아니오" 버튼 → `onDecline()` 호출
- 수락/거절 후 상태 표시 (accepted/declined)

#### 2. ToolRenderer에서 suggest_board_embed 특별 처리
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx`
**Changes**:
- `item.toolName === 'suggest_board_embed'` 조건 추가
- `output.type === 'board_embed_suggestion'` 확인
- BoardEmbedSuggestionRenderer로 렌더링
- `onEmbedToBoard` 콜백을 props로 전달받아 연결

#### 3. RenderItem에 onEmbedToBoard 콜백 체인 추가
**File**: `frontend/pluto_duck_frontend/components/chat/renderers/RenderItem.tsx`
**Changes**:
- `RenderItemProps`에 `onEmbedToBoard?: (analysisId: string) => void` 추가
- ToolRenderer에 콜백 전달

### Success Criteria:

#### Automated Verification:
- [ ] `npm run typecheck` 통과
- [ ] `npm run lint` 통과

#### Manual Verification:
- [ ] suggest_board_embed 도구 결과가 카드 UI로 표시됨
- [ ] 예/아니오 버튼 클릭 가능
- [ ] 버튼 클릭 시 콜백 호출됨

---

## - [ ] Phase 3: Chat-to-Board Bridge Context

### Overview
Chat 컴포넌트에서 Board로 Asset 임베드 요청을 전달하는 Context 생성.

### Changes Required:

#### 1. ChatToBoardContext 생성
**File**: `frontend/pluto_duck_frontend/contexts/ChatToBoardContext.tsx`
**Changes**:
- `ChatToBoardContextType` interface 정의:
  - `embedAssetToBoard: (analysisId: string) => void`
  - `hasActiveBoard: boolean`
- `ChatToBoardContext` 생성 및 `useChatToBoard` hook export

#### 2. page.tsx에서 Context Provider 추가
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- `embedModalState` 상태 추가: `{ open: boolean; analysisId: string | null }`
- `embedAssetToBoard` 콜백 구현:
  - `activeBoard` 없으면 toast 경고 후 리턴
  - `setEmbedModalState({ open: true, analysisId })` 호출
- `ChatToBoardContext.Provider`로 Chat 영역 감싸기
- `hasActiveBoard` 값 전달

#### 3. MultiTabChatPanel에서 Context 사용
**File**: `frontend/pluto_duck_frontend/components/chat/MultiTabChatPanel.tsx`
**Changes**:
- `useChatToBoard()` hook 사용
- `embedAssetToBoard`를 ChatPanel → RenderItem → ToolRenderer로 전달

### Success Criteria:

#### Automated Verification:
- [ ] `npm run typecheck` 통과
- [ ] `npm run lint` 통과

#### Manual Verification:
- [ ] Chat에서 embedAssetToBoard 호출 시 page.tsx의 상태 변경됨
- [ ] hasActiveBoard가 보드 선택 상태 반영함

---

## - [ ] Phase 4: DisplayConfigModal Integration

### Overview
page.tsx에서 DisplayConfigModal을 렌더링하고, 설정 완료 시 활성 보드에 AssetEmbedNode 삽입.

### Changes Required:

#### 1. page.tsx에 DisplayConfigModal 렌더링
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- `embedModalState.open`일 때 DisplayConfigModal 렌더링
- `onSave` 콜백에서:
  - `boardsViewRef.current?.insertAssetEmbed(analysisId, config)` 호출
  - `setEmbedModalState({ open: false, analysisId: null })`
- `onCancel`에서 모달 닫기

#### 2. BoardsView에 insertAssetEmbed 메서드 추가
**File**: `frontend/pluto_duck_frontend/components/boards/BoardsView.tsx`
**Changes**:
- `BoardsViewHandle`에 `insertAssetEmbed` 메서드 추가
- 내부적으로 활성 BoardEditor의 insertAssetEmbed 호출

#### 3. BoardEditor에 insertAssetEmbed 메서드 추가
**File**: `frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx`
**Changes**:
- `BoardEditorHandle`에 `insertAssetEmbed(analysisId: string, config: AssetEmbedConfig)` 추가
- `useImperativeHandle`에서 메서드 노출
- 내부에서 `$createAssetEmbedNode` 및 `$insertNodes` 사용

#### 4. InsertAssetEmbedPlugin 생성
**File**: `frontend/pluto_duck_frontend/components/editor/plugins/InsertAssetEmbedPlugin.tsx`
**Changes**:
- LexicalComposer 내부에서 editor 접근
- `insertAssetEmbed(analysisId, projectId, config)` 메서드 노출
- `$createAssetEmbedNode` 사용하여 노드 생성 및 삽입

### Success Criteria:

#### Automated Verification:
- [ ] `npm run typecheck` 통과
- [ ] `npm run lint` 통과
- [ ] `npm run build` 성공

#### Manual Verification:
- [ ] "예" 버튼 클릭 시 DisplayConfigModal 열림
- [ ] 설정 저장 시 보드에 AssetEmbedNode 표시됨
- [ ] Asset 렌더링 정상 동작 (테이블/차트)

---

## Testing Strategy

### Unit Tests:
- suggest_board_embed 도구 반환값 형식 검증
- BoardEmbedSuggestionRenderer 렌더링 테스트

### Manual Testing Steps:
1. 채팅에서 "이 데이터 분석해서 저장해줘" 요청
2. 에이전트가 save_analysis 실행 확인
3. "보드에 붙여드릴까요?" 카드 표시 확인
4. "예" 클릭 → DisplayConfigModal 열림 확인
5. 테이블/차트 설정 후 저장
6. 활성 보드에 Asset 표시 확인
7. "아니오" 클릭 시 카드 상태 변경 확인
8. 보드 미선택 상태에서 "예" 클릭 시 경고 메시지 확인

## Performance Considerations
- DisplayConfigModal에서 Analysis 데이터 로드 시 기존 캐싱 로직 활용
- 대용량 데이터셋의 경우 AssetEmbedNode 내부 lazy loading 유지

## Migration Notes
- 기존 save_analysis 결과 렌더링에 영향 없음 (새 도구 추가)
- 기존 /asset 슬래시 커맨드 동작 유지

## References
- [docs/research/027_chat_to_board_send_feature.md](docs/research/027_chat_to_board_send_feature.md) - 리서치 문서
- [asset.py:48-116](backend/pluto_duck_backend/agent/core/deep/tools/asset.py#L48-L116) - save_analysis 도구
- [ToolRenderer.tsx](frontend/pluto_duck_frontend/components/chat/renderers/ToolRenderer.tsx) - 도구 렌더링
- [DisplayConfigModal.tsx](frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx) - Asset 설정 모달
- [BoardEditor.tsx](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx) - Lexical 에디터
- [SlashCommandPlugin.tsx:158-177](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L158-L177) - AssetEmbedNode 삽입 참고
- [confirmation.tsx](frontend/pluto_duck_frontend/components/ai-elements/confirmation.tsx) - Confirmation UI 패턴
- [docs/plans/012_chat_send_text_to_board.md](docs/plans/012_chat_send_text_to_board.md) - 텍스트 전송 구현 (참고)
