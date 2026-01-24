# Chat-to-Board Asset Embed 기능 구현 계획

## Overview
Chat 영역에서 Board로 AssetEmbedNode를 삽입하는 핵심 기능 구현. 테스트를 위한 칩 버튼 3개를 채팅 입력창에 추가하여 다양한 DisplayConfig 조합을 검증.

## Current State Analysis

### 기존 구조
- **Chat→Board 통신**: `onSendToBoard` 콜백 패턴 존재 ([page.tsx:395-420](frontend/pluto_duck_frontend/app/page.tsx#L395-L420))
- **BoardsView**: `insertMarkdown` 메서드만 있음, `insertAssetEmbed` 없음 ([BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx))
- **AssetEmbedNode 삽입**: `$createAssetEmbedNode(analysisId, projectId, config)` 사용 ([SlashCommandPlugin.tsx:158-177](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L158-L177))
- **Chat 입력 영역**: PromptInputTools에 MentionMenu, ModelSelect 존재 ([ChatPanel.tsx:288-307](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L288-L307))

### AssetEmbedConfig 타입 ([AssetEmbedNode.tsx:16-32](frontend/pluto_duck_frontend/components/editor/nodes/AssetEmbedNode.tsx#L16-L32))
```typescript
interface AssetEmbedConfig {
  displayType: 'table' | 'chart';
  tableConfig?: { rowsPerPage: number };
  chartConfig?: {
    type: 'bar' | 'line' | 'pie' | 'area' | 'composed';
    xColumn: string;
    yColumn?: string;
    yColumns?: string[];
    groupByColumn?: string;
    stacked?: boolean;
    showDualAxis?: boolean;
  };
  hideBorder?: boolean;
  hideHeader?: boolean;
}
```

## Desired End State

1. Chat 입력창 위에 테스트용 칩 버튼 3개 표시
2. 각 버튼 클릭 시:
   - 하드코딩된 analysisId + config로 AssetEmbedNode 생성
   - 활성 보드 마지막에 삽입
3. 보드 미선택 시 toast 경고

### 테스트 케이스
| 버튼 | Analysis | DisplayConfig |
|------|----------|---------------|
| Table | `meta_ad_daily_timeseries_with_ma_anomalies` | table, 5 rows |
| Bar | `meta_ad_daily_timeseries_with_ma_anomalies` | bar chart |
| Line | `meta_ad_daily_timeseries_with_ma_anomalies` | line chart |

### 검증 방법
- 테스트 버튼 클릭 → 활성 보드에 AssetEmbedNode 삽입됨
- 삽입된 노드가 정상적으로 데이터 렌더링 (table/chart)
- 보드 미선택 시 경고 메시지

## What We're NOT Doing
- 에이전트 도구 연동 (다음 단계)
- 사용자 제안/승인 플로우
- DisplayConfigModal UI (기본값 사용)
- 보드 ID 직접 지정 (활성 보드만)
- AssetPicker UI (하드코딩 ID 사용)

## Implementation Approach
기존 `onSendToBoard` 패턴을 참고하여 `onEmbedAssetToBoard` 콜백 체인 추가. BoardEditor에 `insertAssetEmbed` 메서드 추가. 테스트 버튼은 PromptInputTools 영역에 배치.

---

## - [x] Phase 1: BoardEditor insertAssetEmbed 메서드 추가

### Overview
BoardEditor와 BoardsView에 AssetEmbedNode를 삽입하는 imperative 메서드 추가.

### Changes Required:

#### 1. BoardEditorHandle에 insertAssetEmbed 추가
**File**: `frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx`
**Changes**:
- `BoardEditorHandle` interface에 `insertAssetEmbed` 메서드 추가
- `useImperativeHandle`에서 메서드 구현
- 내부에서 `editor.update()` 호출하여 `$createAssetEmbedNode` + `$insertNodes` 실행
- 삽입 후 paragraph 노드 추가하여 계속 타이핑 가능하게

#### 2. BoardsViewHandle에 insertAssetEmbed 노출
**File**: `frontend/pluto_duck_frontend/components/boards/BoardsView.tsx`
**Changes**:
- `BoardsViewHandle`에 `insertAssetEmbed` 메서드 추가
- `boardEditorRef.current?.insertAssetEmbed()` 호출로 위임

### Success Criteria:

#### Automated Verification:
- [x] `npm run typecheck` 통과 (pre-existing error in Transcript.tsx unrelated to this change)
- [x] `npm run lint` 통과

#### Manual Verification:
- [ ] 콘솔에서 `boardsViewRef.current.insertAssetEmbed(...)` 호출 시 노드 삽입됨

---

## - [x] Phase 2: Chat→Board 콜백 체인 추가

### Overview
ChatPanel에서 page.tsx까지 `onEmbedAssetToBoard` 콜백 전달.

### Changes Required:

#### 1. page.tsx에 handleEmbedAssetToBoard 핸들러 추가
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- `handleEmbedAssetToBoard(analysisId: string, config: AssetEmbedConfig)` 콜백 구현
- `activeBoard` 없으면 toast 경고 후 리턴
- `boardsViewRef.current?.insertAssetEmbed(analysisId, projectId, config)` 호출

#### 2. MultiTabChatPanel props 추가
**File**: `frontend/pluto_duck_frontend/components/chat/MultiTabChatPanel.tsx`
**Changes**:
- `MultiTabChatPanelProps`에 `onEmbedAssetToBoard?: (analysisId: string, config: AssetEmbedConfig) => void` 추가
- ChatPanel에 콜백 전달

#### 3. ChatPanel props 추가
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`
**Changes**:
- `ChatPanelProps`에 `onEmbedAssetToBoard` 추가
- props destructuring에 추가

### Success Criteria:

#### Automated Verification:
- [x] `npm run typecheck` 통과 (pre-existing error in Transcript.tsx unrelated to this change)
- [x] `npm run lint` 통과

#### Manual Verification:
- [ ] ChatPanel 내부에서 `onEmbedAssetToBoard` 호출 시 page.tsx 핸들러 실행됨

---

## - [x] Phase 3: 테스트 칩 버튼 UI 추가

### Overview
ChatPanel 입력창 영역에 3개의 테스트 버튼 추가. 각 버튼은 하드코딩된 analysisId + config로 asset embed 트리거.

### Changes Required:

#### 1. AssetEmbedTestButtons 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/chat/AssetEmbedTestButtons.tsx`
**Changes**:
- props: `onEmbed: (analysisId: string, config: AssetEmbedConfig) => void`
- 3개의 칩 버튼 렌더링 (Table, Bar, Line)
- 하드코딩된 analysisId: `meta_ad_daily_timeseries_with_ma_anomalies`
- 각 버튼에 다른 config:
  - Table: `{ displayType: 'table', tableConfig: { rowsPerPage: 5 } }`
  - Bar: `{ displayType: 'chart', chartConfig: { type: 'bar', xColumn: 'date', yColumn: 'spend' } }`
  - Line: `{ displayType: 'chart', chartConfig: { type: 'line', xColumn: 'date', yColumn: 'spend' } }`
- 작은 칩 스타일 (h-6, text-xs, variant: outline)

#### 2. ChatPanel에 테스트 버튼 추가
**File**: `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx`
**Changes**:
- PromptInputTools 내부 또는 PromptInput 상단에 AssetEmbedTestButtons 배치
- `onEmbedAssetToBoard` 콜백 연결
- 조건부 렌더링: development 모드에서만 표시 (`process.env.NODE_ENV === 'development'`)

### Success Criteria:

#### Automated Verification:
- [x] `npm run typecheck` 통과
- [x] `npm run lint` 통과
- [x] `npm run build` 성공

#### Manual Verification:
- [ ] 채팅 입력창 위에 테스트 버튼 3개 표시
- [ ] 버튼 클릭 시 활성 보드에 AssetEmbedNode 삽입
- [ ] 보드 미선택 시 toast 경고 표시
- [ ] Production 빌드에서 버튼 숨김

---

## Testing Strategy

### Unit Tests:
- 없음 (UI 테스트 위주)

### Manual Testing Steps:
1. 개발 서버 실행 (`npm run dev`)
2. 프로젝트 선택 및 보드 열기
3. 채팅 패널에서 테스트 버튼 3개 확인 (Table, Bar, Line)
4. "Table" 버튼 클릭 → 보드에 테이블 Asset 삽입 확인
5. "Bar" 버튼 클릭 → 보드에 bar chart Asset 삽입 확인
6. "Line" 버튼 클릭 → 보드에 line chart Asset 삽입 확인
7. 보드 탭 닫기 후 버튼 클릭 → toast 경고 확인
8. `meta_ad_daily_timeseries_with_ma_anomalies` 분석 데이터가 정상 렌더링되는지 확인

## Performance Considerations
- 단순 ref 기반 호출로 성능 영향 없음
- AssetEmbedNode 내부 lazy loading은 기존 로직 유지

## Migration Notes
- 기존 코드에 영향 없음 (새 메서드/콜백 추가만)
- 테스트 버튼은 개발 모드에서만 표시

## Future Work (에이전트 연동 시)
에이전트가 `embed_asset_to_board` 도구를 호출할 때 필요한 파라미터:
```typescript
{
  analysis_id: string;      // 삽입할 Asset ID
  config: {
    display_type: 'table' | 'chart';
    table_config?: { rows_per_page: number };
    chart_config?: {
      type: 'bar' | 'line' | 'pie' | 'area' | 'composed';
      x_column: string;
      y_column?: string;
      y_columns?: string[];
      group_by_column?: string;
      stacked?: boolean;
      show_dual_axis?: boolean;
    };
  };
}
```

## References
- [BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx) - BoardsViewHandle 정의
- [BoardEditor.tsx](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx) - BoardEditorHandle 정의
- [SlashCommandPlugin.tsx:158-177](frontend/pluto_duck_frontend/components/editor/plugins/SlashCommandPlugin.tsx#L158-L177) - AssetEmbedNode 삽입 패턴
- [AssetEmbedNode.tsx:16-32](frontend/pluto_duck_frontend/components/editor/nodes/AssetEmbedNode.tsx#L16-L32) - AssetEmbedConfig 타입
- [ChatPanel.tsx:271-322](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L271-L322) - Chat 입력 영역 구조
- [page.tsx:395-420](frontend/pluto_duck_frontend/app/page.tsx#L395-L420) - onSendToBoard 콜백 패턴
- [assetsApi.ts](frontend/pluto_duck_frontend/lib/assetsApi.ts) - Analysis 타입 및 API
