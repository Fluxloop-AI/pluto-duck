옵션 A 기준으로 보수적인 구현 기획을 작성하겠습니다. 현재 코드 구조를 다시 확인하고 최소한의 변경으로 안전하게 구현하는 방법을 설계하겠습니다.

[2 tools called]

이제 보수적인 멀티 탭 채팅 구현 기획서를 작성하겠습니다.

# 📋 멀티 탭 채팅 구현 기획서 (보수적 접근)

## 🎯 목표

- **최대 3개 탭** 동시 활성화
- 각 탭 = 독립적인 세션 (`conversation_id`)
- **활성 탭만 스트리밍** (비활성 탭은 일시정지)
- 최소한의 코드 변경으로 안정성 확보

---

## 📐 아키텍처 설계

### 1. 데이터 구조

```typescript
// 새로운 타입 정의 (hooks/useMultiTabChat.ts)

interface ChatTab {
  id: string;                    // 탭 고유 ID (UUID)
  sessionId: string | null;      // conversation_id (null = 새 대화)
  title: string;                 // 탭 제목 (첫 메시지 또는 "New Chat")
  createdAt: number;             // 탭 생성 시각 (타임스탬프)
}

interface TabChatState {
  detail: ChatSessionDetail | null;
  loading: boolean;
  isStreaming: boolean;
  status: 'ready' | 'streaming' | 'error';
  reasoningEvents: AgentEventAny[];
}

interface MultiTabChatState {
  tabs: ChatTab[];               // 최대 3개
  activeTabId: string | null;    // 현재 활성 탭
  tabStates: Map<string, TabChatState>;  // 탭별 상태
}
```

### 2. 컴포넌트 구조

```
page.tsx (기존)
├── ConversationList (기존, 수정 X)
├── [중앙 영역] (기존, 수정 X)
└── MultiTabChatPanel (신규)
    ├── TabBar (신규)
    │   ├── Tab × 1~3개
    │   └── NewTabButton
    └── ChatPanel (기존, Props만 수정)
        └── (현재 UI 그대로 유지)
```

---

## 🔧 구현 범위

### Phase 1: 핵심 상태 관리 (1일차)

#### 1.1 `hooks/useMultiTabChat.ts` 생성

**역할:** 멀티 탭 상태 관리 + 기존 `useChatSession` 로직 통합

**주요 기능:**
```typescript
export function useMultiTabChat(options: UseChatSessionOptions) {
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabStatesRef = useRef<Map<string, TabChatState>>(new Map());

  // 탭 추가 (최대 3개 제한)
  const addTab = useCallback(() => {
    if (tabs.length >= 3) {
      alert('최대 3개 탭까지만 열 수 있습니다.');
      return;
    }
    const newTab: ChatTab = {
      id: crypto.randomUUID(),
      sessionId: null,
      title: 'New Chat',
      createdAt: Date.now(),
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  // 탭 닫기
  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      // 활성 탭을 닫으면 이전 탭 활성화
      if (activeTabId === tabId && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      }
      return filtered;
    });
    tabStatesRef.current.delete(tabId);
  }, [activeTabId]);

  // 탭 전환
  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab: tabs.find(t => t.id === activeTabId) || null,
    addTab,
    closeTab,
    switchTab,
    // ... 기존 useChatSession 반환값 (현재 활성 탭 기준)
  };
}
```

**보수적 설계 포인트:**
- ✅ `useState`만 사용 (외부 라이브러리 X)
- ✅ 탭은 메모리만 관리 (localStorage 저장 X, 새로고침 시 초기화)
- ✅ 3개 하드 리미트로 복잡도 차단

#### 1.2 탭별 독립적인 `useChatSession` 인스턴스

**전략:** 각 탭마다 별도 훅 인스턴스 생성 (React의 `key` 활용)

```typescript
// useMultiTabChat 내부
const activeChatSession = useChatSession({
  ...options,
  sessionId: activeTab?.sessionId || null,
  enabled: activeTabId !== null,  // 비활성 탭은 훅 비활성화
});
```

**문제점:** `useChatSession`은 조건부 활성화를 지원하지 않음

**해결책:** 
- 각 탭을 별도 컴포넌트(`<TabContent key={tabId} />`)로 렌더링
- 비활성 탭은 `display: none`으로 숨김 (언마운트 X)
- **스트림만 선택적 중지** (아래 참조)

---

### Phase 2: 스트림 관리 (1일차 하반기)

#### 2.1 `useAgentStream` 수정

**현재 문제:** 한번 시작하면 run 완료까지 계속 연결

**수정안:**
```typescript
export function useAgentStream({
  runId,
  eventsPath,
  enabled = true,  // ← 새 prop 추가
  ...
}: UseAgentStreamOptions) {
  useEffect(() => {
    if (!runId || !eventsPath || !enabled) {  // ← enabled 체크
      cleanup();
      setStatus('idle');
      return;
    }
    // ... 기존 로직
  }, [runId, eventsPath, enabled]);
}
```

#### 2.2 활성 탭 기반 스트림 제어

```typescript
// useMultiTabChat 내부
<ChatPanel
  {...props}
  streamEnabled={tabId === activeTabId}  // 활성 탭만 true
/>
```

**동작:**
- 탭 A 활성 → A의 스트림 연결, B/C 스트림 종료
- 탭 B로 전환 → B 스트림 재연결, A 종료
- **과거 이벤트는 DB에서 복원** (`fetchChatSession(..., includeEvents=true)`)

**장점:**
- 동시 SSE 연결 = 최대 1개 (브라우저 제약 회피)
- 메모리 사용량 최소화

---

### Phase 3: UI 컴포넌트 (2일차)

#### 3.1 `components/chat/TabBar.tsx` 생성

**디자인:**
```
┌─────────────────────────────────────────┐
│ [Tab 1: 분석 요청 ×] [Tab 2: New Ch... ×] [+] │
└─────────────────────────────────────────┘
```

**코드:**
```typescript
interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1 bg-background">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabClick(tab.id)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-t-md text-sm transition-colors',
            'max-w-[200px] group',
            activeTabId === tab.id
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          )}
        >
          <span className="truncate">{tab.title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-destructive"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </button>
      ))}
      
      {tabs.length < 3 && (
        <button
          onClick={onNewTab}
          className="p-1.5 hover:bg-accent rounded-md"
          title="새 탭"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
```

**보수적 설계:**
- ✅ 드래그 앤 드롭 없음 (복잡도 증가)
- ✅ 탭 순서 고정 (추가된 순서)
- ✅ 애니메이션 최소화

#### 3.2 `components/chat/MultiTabChatPanel.tsx` 생성

**역할:** TabBar + ChatPanel 조합

```typescript
export function MultiTabChatPanel() {
  const { tabs, activeTabId, activeTab, addTab, closeTab, switchTab, ... } = useMultiTabChat({
    selectedModel,
    selectedDataSource,
    backendReady,
  });

  return (
    <div className="flex flex-col h-full w-[500px] border-l border-border bg-background">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={switchTab}
        onTabClose={closeTab}
        onNewTab={addTab}
      />
      
      {tabs.map(tab => (
        <div
          key={tab.id}
          style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <ChatPanel
            {...getChatPanelProps(tab.id)}  // 탭별 상태 전달
          />
        </div>
      ))}
      
      {tabs.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <button onClick={addTab} className="flex items-center gap-2">
            <PlusIcon className="h-5 w-5" />
            새 대화 시작
          </button>
        </div>
      )}
    </div>
  );
}
```

**핵심:**
- `display: none`으로 숨김 (언마운트 X → 상태 유지)
- 각 탭이 독립적인 ChatPanel 인스턴스

---

### Phase 4: 세션 연동 (2일차 하반기)

#### 4.1 왼쪽 ConversationList 클릭 시 동작

**요구사항:**
- 세션 클릭 → 해당 세션을 새 탭에서 열기
- 이미 열려 있는 세션이면 해당 탭으로 전환

**구현:**
```typescript
const handleSelectSession = useCallback((session: ChatSessionSummary) => {
  // 1. 이미 열려 있는 탭 찾기
  const existingTab = tabs.find(t => t.sessionId === session.id);
  if (existingTab) {
    switchTab(existingTab.id);
    return;
  }

  // 2. 3개 제한 체크
  if (tabs.length >= 3) {
    // 가장 오래된 탭 닫기 (또는 사용자 선택)
    const oldestTab = tabs[0];
    closeTab(oldestTab.id);
  }

  // 3. 새 탭 추가
  const newTab: ChatTab = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    title: session.title || 'Untitled',
    createdAt: Date.now(),
  };
  setTabs(prev => [...prev, newTab]);
  setActiveTabId(newTab.id);
}, [tabs, switchTab, closeTab]);
```

#### 4.2 "New Conversation" 클릭 시

```typescript
const handleNewConversation = useCallback(() => {
  addTab();  // sessionId = null인 빈 탭 추가
}, [addTab]);
```

---

### Phase 5: 메모리 관리 (3일차)

#### 5.1 이벤트 제한

```typescript
// useAgentStream.ts 수정
const MAX_EVENTS = 150;

setEvents(prev => {
  const updated = [...prev, parsed];
  return updated.length > MAX_EVENTS 
    ? updated.slice(-MAX_EVENTS) 
    : updated;
});
```

#### 5.2 탭 제목 자동 업데이트

```typescript
// 첫 메시지 전송 후 탭 제목 변경
useEffect(() => {
  if (detail?.messages.length > 0 && activeTab?.title === 'New Chat') {
    const firstUserMsg = detail.messages.find(m => m.role === 'user');
    if (firstUserMsg && typeof firstUserMsg.content?.text === 'string') {
      const title = firstUserMsg.content.text.slice(0, 30);
      setTabs(prev => prev.map(t => 
        t.id === activeTabId ? { ...t, title } : t
      ));
    }
  }
}, [detail, activeTab, activeTabId]);
```

---

## 🚨 안전장치

### 1. 탭 개수 제한
```typescript
const MAX_TABS = 3;

if (tabs.length >= MAX_TABS) {
  // UI에서 "+" 버튼 비활성화
  // 또는 alert 표시
}
```

### 2. 스트림 중복 방지
```typescript
// 한 탭에서만 스트림 활성화
const streamEnabled = tab.id === activeTabId && !!activeRunId;
```

### 3. 탭 닫기 확인 (옵션)
```typescript
const closeTab = (tabId: string) => {
  const tab = tabs.find(t => t.id === tabId);
  if (tab && tabStates.get(tabId)?.isStreaming) {
    if (!confirm('응답 생성 중입니다. 탭을 닫으시겠습니까?')) {
      return;
    }
  }
  // ... 닫기 로직
};
```

### 4. 백엔드 run 정리
```python
# backend/pluto_duck_backend/agent/core/orchestrator.py

async def _execute_run(self, run: AgentRun) -> None:
    try:
        # ... 기존 로직
    finally:
        # 완료 후 10분 뒤 메모리에서 제거
        async def cleanup():
            await asyncio.sleep(600)
            self._runs.pop(run.run_id, None)
        
        asyncio.create_task(cleanup())
```

---

## 📊 데이터 흐름

### 새 대화 시작
```
[+] 버튼 클릭
  ↓
addTab() → 새 Tab 생성 (sessionId=null, title="New Chat")
  ↓
사용자 메시지 입력
  ↓
createConversation() → 백엔드에서 conversation_id 생성
  ↓
탭 업데이트 (sessionId 설정, title 변경)
  ↓
스트림 시작 (run_id 수신)
```

### 기존 세션 열기
```
ConversationList에서 세션 클릭
  ↓
handleSelectSession(session)
  ↓
새 탭 추가 (sessionId = session.id)
  ↓
fetchChatSession(sessionId, includeEvents=true) → DB에서 이력 로드
  ↓
UI 렌더링 (과거 메시지 표시)
```

### 탭 전환
```
Tab B 클릭
  ↓
switchTab(tabB.id)
  ↓
Tab A 스트림 종료 (EventSource.close())
  ↓
Tab B 스트림 시작 (run_id 있으면)
  ↓
Tab B UI 표시 (display: flex)
Tab A UI 숨김 (display: none)
```

---

## 🧪 테스트 시나리오

### 1. 기본 동작
- [ ] 새 탭 추가 (0→1→2→3개)
- [ ] 4번째 탭 추가 시 경고 표시
- [ ] 탭 닫기
- [ ] 마지막 탭 닫기 (빈 상태 표시)

### 2. 세션 연동
- [ ] 왼쪽 세션 클릭 → 새 탭 열림
- [ ] 같은 세션 다시 클릭 → 기존 탭 활성화
- [ ] New Conversation 클릭 → 빈 탭 추가

### 3. 스트리밍
- [ ] 탭 A에서 질문 전송 → 스트림 시작
- [ ] 스트리밍 중 탭 B로 전환 → A 스트림 중지
- [ ] 다시 탭 A로 전환 → 완료된 응답 표시 (DB에서 로드)

### 4. 메모리
- [ ] 긴 대화 (100+ 메시지) 후 메모리 사용량 확인
- [ ] 3개 탭 동시 긴 대화 후 성능 측정

### 5. 엣지 케이스
- [ ] 스트리밍 중 탭 닫기
- [ ] 빠른 탭 전환 (연타)
- [ ] 새로고침 후 탭 초기화 확인

---

## 📁 파일 변경 목록

### 신규 파일
```
frontend/pluto_duck_frontend/
  hooks/
    useMultiTabChat.ts          (300줄)
  components/chat/
    TabBar.tsx                  (100줄)
    MultiTabChatPanel.tsx       (200줄)
```

### 수정 파일
```
frontend/pluto_duck_frontend/
  app/page.tsx                  (ChatPanel → MultiTabChatPanel 교체)
  hooks/useAgentStream.ts       (enabled prop 추가, 20줄)
  components/chat/index.ts      (export 추가, 2줄)
```

### 백엔드 (옵션)
```
backend/pluto_duck_backend/
  agent/core/orchestrator.py    (run cleanup 로직, 15줄)
```

**총 변경량:** ~650줄 (신규 600 + 수정 50)

---

## ⏱️ 구현 일정

### Day 1 (6시간)
- **오전 (3h):** `useMultiTabChat` 훅 구현 + 단위 테스트
- **오후 (3h):** `useAgentStream` 수정 + 스트림 제어 로직

### Day 2 (6시간)
- **오전 (3h):** `TabBar`, `MultiTabChatPanel` UI 컴포넌트
- **오후 (3h):** `page.tsx` 통합 + 세션 연동

### Day 3 (4시간)
- **오전 (2h):** 메모리 관리 + 안전장치
- **오후 (2h):** 통합 테스트 + 버그 수정

**총 예상 시간:** 16시간 (2일)

---

## 🎯 성공 기준

1. ✅ 3개 탭 동시 활성화 가능
2. ✅ 탭 전환 시 스트림 자동 정지/재개
3. ✅ 브라우저 SSE 연결 1개 유지
4. ✅ 메모리 사용량 < 100MB (탭당)
5. ✅ 탭 닫기 시 메모리 해제 확인
6. ✅ 새로고침 시 안전하게 초기화

---

## 🔒 리스크 완화

### 리스크 1: 상태 동기화 버그
**완화:** 각 탭을 완전히 독립적으로 관리 (공유 상태 최소화)

### 리스크 2: 스트림 재연결 실패
**완화:** `useAgentStream`에 자동 재연결 로직 이미 존재 (Line 90-95)

### 리스크 3: 메모리 누수
**완화:** 
- 탭 닫기 시 `tabStatesRef.current.delete(tabId)` 명시적 정리
- Chrome DevTools로 메모리 프로파일링

### 리스크 4: UX 혼란
**완화:**
- 명확한 시각적 구분 (활성 탭 강조)
- 최대 3개 제한으로 인지 부하 감소

---

## 📌 제외 사항 (향후 고려)

- ❌ 탭 순서 변경 (드래그 앤 드롭)
- ❌ 탭 상태 localStorage 저장
- ❌ 4개 이상 탭
- ❌ 탭 분할 뷰 (side-by-side)
- ❌ 탭 그룹/폴더
- ❌ WebSocket 멀티플렉싱

---

이 기획서대로 구현하면 **안정적이고 예측 가능한** 멀티 탭 채팅 기능을 제공할 수 있습니다. 구현을 시작할까요?