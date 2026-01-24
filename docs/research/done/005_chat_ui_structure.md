---
date: 2026-01-13T00:00:00Z
researcher: Claude
topic: "Chat UI Structure Analysis"
tags: [research, codebase, chat, ui, tabs, components]
status: complete
---

# Research: Chat UI Structure Analysis

## Research Question
채팅 UI의 구조 파악 - 채팅 목록, + 버튼, 히스토리 버튼 등이 어떻게 구성되어 있는지

## Summary
채팅 UI는 **MultiTabChatPanel**을 최상위 컨테이너로 하여 **TabBar**(탭 네비게이션)와 **ChatPanel**(채팅 인터페이스)로 구성됩니다. 상태 관리는 **useMultiTabChat** 훅에서 담당하며, 최대 3개의 탭을 지원합니다.

## Detailed Findings

### Component Hierarchy (컴포넌트 계층 구조)

```
MultiTabChatPanel (최상위 컨테이너)
├── TabBar (탭 바 - 상단)
│   ├── Chat Tabs (채팅 탭들)
│   │   ├── Tab Title (탭 제목)
│   │   └── Close Button (X 버튼)
│   ├── + Button (새 탭 추가)
│   └── History Button (히스토리 - 시계 아이콘)
│       └── Session Popup (세션 목록 팝업)
│
└── ChatPanel (채팅 패널 - 본문)
    ├── Conversation (대화 영역)
    │   └── ConversationMessages (메시지 목록)
    │       ├── User Messages (사용자 메시지)
    │       ├── Assistant Messages (AI 응답)
    │       ├── Reasoning (추론 과정)
    │       └── Tool Events (도구 실행 결과)
    │
    └── Input Area (입력 영역)
        └── PromptInput (입력 폼)
            ├── PromptInputTextarea (텍스트 입력)
            ├── PromptInputFooter
            │   ├── PromptInputTools
            │   │   ├── ModelSelect (모델 선택 - GPT-5 Mini 등)
            │   │   └── MentionMenu (@ 버튼 - 에셋 멘션)
            │   └── PromptInputSubmit (전송 버튼)
```

### 1. MultiTabChatPanel (최상위 컨테이너)

**파일**: `components/chat/MultiTabChatPanel.tsx`

```typescript
interface MultiTabChatPanelProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedDataSource: string;
  backendReady: boolean;
  projectId?: string | null;
  onSessionSelect?: (sessionId: string) => void;
  onTabsChange?: (tabs: ChatTab[], activeTabId: string | null) => void;
  savedTabs?: Array<{ id: string; order: number }>;
  savedActiveTabId?: string;
}
```

- **역할**: 전체 채팅 UI 컨테이너, 탭 관리 로직 포함
- **위치**: `MultiTabChatPanel.tsx:21-180`
- **구조**:
  - `flex flex-col h-full w-full` - 세로 방향 풀 사이즈
  - `border-l border-border` - 왼쪽 경계선
  - TabBar 렌더링 (상단)
  - ChatPanel 렌더링 (탭별로)

### 2. TabBar (탭 바 - 스크린샷 빨간 영역)

**파일**: `components/chat/TabBar.tsx`

```typescript
interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  sessions?: ChatSessionSummary[];
  onLoadSession?: (session: ChatSessionSummary) => void;
  maxTabs?: number;  // 기본값: 3
}
```

#### 2.1 탭 목록 (스크린샷 파란 영역 - 왼쪽)

**위치**: `TabBar.tsx:59-95`

```tsx
{tabs.map(tab => (
  <div
    key={tab.id}
    className={cn(
      'flex items-center justify-center gap-2 px-3 py-1 rounded-t-md text-xs transition-colors cursor-pointer',
      'max-w-[200px] group relative',
      activeTabId === tab.id
        ? 'bg-accent text-accent-foreground'  // 선택된 탭
        : 'hover:bg-accent/50 text-muted-foreground'  // 비선택 탭
    )}
    onClick={() => onTabClick(tab.id)}
  >
    <span className="truncate">{tab.title}</span>
    {/* Close button (X) */}
    <div onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}>
      <XIcon className="h-3 w-3" />
    </div>
  </div>
))}
```

- **스타일**: `rounded-t-md` (상단 둥근 모서리), `px-3 py-1`
- **활성 탭**: `bg-accent text-accent-foreground`
- **비활성 탭**: `hover:bg-accent/50 text-muted-foreground`
- **닫기 버튼**: hover 시에만 표시 (`opacity-0 group-hover:opacity-100`)

#### 2.2 + 버튼 (새 탭 추가)

**위치**: `TabBar.tsx:97-105`

```tsx
{tabs.length < maxTabs && (
  <button
    onClick={onNewTab}
    className="p-1 hover:bg-accent rounded-md transition-colors"
    title="New tab"
  >
    <PlusIcon className="h-4 w-4" />
  </button>
)}
```

- **조건**: `tabs.length < maxTabs` (최대 3개)일 때만 표시
- **동작**: `onNewTab` → `useMultiTabChat.addTab()` 호출
- **스타일**: `p-1 hover:bg-accent rounded-md`

#### 2.3 History 버튼 (히스토리)

**위치**: `TabBar.tsx:107-153`

```tsx
{onLoadSession && (
  <div className="relative">
    <button
      ref={buttonRef}
      onClick={() => setShowSessionPopup(!showSessionPopup)}
      className="p-1 hover:bg-accent rounded-md transition-colors"
      title="Load conversation"
    >
      <History className="h-4 w-4" />
    </button>

    {showSessionPopup && (
      <div className="absolute top-full left-0 mt-1 w-80 max-h-96 overflow-y-auto
                      bg-popover border border-border rounded-md shadow-lg z-50">
        {sessions.map((session) => (
          <button onClick={() => handleSessionSelect(session)}>
            {session.title || 'Untitled conversation'}
            {session.last_message_preview}
            {new Date(session.updated_at).toLocaleDateString()}
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

- **아이콘**: `History` (lucide-react)
- **팝업**: 클릭 시 세션 목록 표시
- **팝업 스타일**: `w-80 max-h-96 overflow-y-auto bg-popover border rounded-md shadow-lg`
- **외부 클릭 감지**: `useEffect`에서 `mousedown` 이벤트로 팝업 닫기

### 3. ChatPanel (채팅 패널 - 스크린샷 하단 파란 영역)

**파일**: `components/chat/ChatPanel.tsx`

#### 3.1 입력 영역 구조

**위치**: `ChatPanel.tsx:488-534`

```tsx
<div className="shrink-0 border-t border-border pt-4">
  <div className="w-full px-4 pb-4">
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputBody>
        <PromptInputTextarea
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder={activeSession ? 'Continue this conversation...' : 'Ask a question...'}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          {/* Model selector */}
          <PromptInputModelSelect value={selectedModel} onValueChange={onModelChange}>
            <PromptInputModelSelectTrigger className="h-7 text-xs">
              <PromptInputModelSelectValue />
            </PromptInputModelSelectTrigger>
            <PromptInputModelSelectContent>
              {MODELS.map(model => (
                <PromptInputModelSelectItem key={model.id} value={model.id}>
                  {model.name}
                </PromptInputModelSelectItem>
              ))}
            </PromptInputModelSelectContent>
          </PromptInputModelSelect>

          {/* @ Mention Menu */}
          {projectId && (
            <MentionMenu
              projectId={projectId}
              open={mentionOpen}
              onOpenChange={setMentionOpen}
              onSelect={handleMentionSelect}
            />
          )}
        </PromptInputTools>
        <PromptInputSubmit disabled={!input.trim() || isStreaming} className="h-7 w-7" />
      </PromptInputFooter>
    </PromptInput>
  </div>
</div>
```

#### 3.2 모델 선택 드롭다운

**위치**: `ChatPanel.tsx:503-514`

- 컴포넌트: `PromptInputModelSelect`
- 모델 목록: `ALL_MODEL_OPTIONS` (from `constants/models`)
- 스타일: `h-7 text-xs` (작은 높이와 폰트)

#### 3.3 @ 멘션 버튼

**파일**: `components/chat/MentionMenu.tsx`

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-7 gap-1 border-none bg-transparent text-xs font-medium
             text-muted-foreground shadow-none transition-colors
             hover:bg-accent hover:text-foreground"
  title="Mention asset"
>
  <AtSignIcon className="h-3 w-3" />
</Button>
```

- 드롭다운 메뉴로 에셋 목록 표시
- 검색 기능 포함
- 선택 시 `@asset-name` 형태로 입력

#### 3.4 전송 버튼

**위치**: `ChatPanel.tsx:526-530`

```tsx
<PromptInputSubmit
  disabled={!input.trim() || isStreaming}
  status={status}
  className="h-7 w-7"
/>
```

- 비활성화 조건: 입력 없음 또는 스트리밍 중
- 상태에 따른 아이콘 변경:
  - `ready`: SendIcon
  - `submitted`: Loader2Icon (spinning)
  - `streaming`: SquareIcon
  - `error`: XIcon

### 4. State Management (useMultiTabChat)

**파일**: `hooks/useMultiTabChat.ts`

#### 4.1 핵심 타입

```typescript
export interface ChatTab {
  id: string;           // 탭 고유 ID
  sessionId: string | null;  // 연결된 세션 ID (없으면 새 채팅)
  title: string;        // 탭 제목
  createdAt: number;    // 생성 시간
}

interface TabChatState {
  detail: ChatSessionDetail | null;  // 세션 상세 정보
  loading: boolean;
  activeRunId: string | null;  // 현재 실행 중인 run ID
}
```

#### 4.2 주요 함수

| 함수 | 설명 | 위치 |
|------|------|------|
| `addTab()` | 새 탭 추가 (최대 3개) | :566-584 |
| `closeTab(tabId)` | 탭 닫기 | :586-604 |
| `switchTab(tabId)` | 탭 전환 | :606-611 |
| `openSessionInTab(session)` | 세션을 탭으로 열기 | :613-639 |
| `handleSubmit(payload)` | 메시지 전송 | :645-804 |
| `restoreTabs(savedTabs)` | 저장된 탭 복원 | :834-884 |

#### 4.3 상수

```typescript
const MAX_TABS = 3;  // 최대 탭 수
const MAX_PREVIEW_LENGTH = 160;  // 미리보기 최대 길이
```

## Code References

| 컴포넌트 | 파일 | 라인 |
|----------|------|------|
| MultiTabChatPanel | `components/chat/MultiTabChatPanel.tsx` | 21-180 |
| TabBar | `components/chat/TabBar.tsx` | 20-156 |
| ChatPanel | `components/chat/ChatPanel.tsx` | 407-537 |
| PromptInput | `components/ai-elements/prompt-input.tsx` | 426-752 |
| MentionMenu | `components/chat/MentionMenu.tsx` | 24-112 |
| useMultiTabChat | `hooks/useMultiTabChat.ts` | 163-913 |

## Architecture Insights

### 1. 탭 관리 패턴
- `useRef`로 탭별 상태 관리 (`tabStatesRef`)
- 프로젝트 변경 시 탭 초기화
- 세션 복원 로직 포함

### 2. 스트리밍 처리
- `useAgentStream` 훅으로 실시간 이벤트 처리
- `isStreaming` 상태로 UI 업데이트 제어
- run 완료 시 세션 detail 새로고침

### 3. 입력 컴포넌트 패턴
- `PromptInput`이 form 역할
- 컴포넌트 합성 패턴 (Header, Body, Footer, Tools)
- 파일 첨부, 음성 입력 등 확장 가능한 구조

## Open Questions

1. 탭 드래그 앤 드롭 재정렬 기능 필요 여부
2. 탭 최대 개수(3개) 조정 필요 여부
3. 히스토리 팝업의 페이지네이션/무한 스크롤 필요 여부
