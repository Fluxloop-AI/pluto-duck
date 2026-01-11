# Chat Asset Mention System Specification

## 1. 개요 (Overview)

현재 Pluto Duck의 채팅 패널은 단순한 데이터 소스 멘션(`@`) 기능만 제공하며, 이는 최신화된 Asset 구조(Analyses, Sources, Files)를 반영하지 못하고 있다.
본 문서는 사용자가 채팅 중 다양한 자산을 직관적으로 참조(`@`)하고, 에이전트가 이를 명확히 인식하여 활용할 수 있도록 **"컨텍스트 주입(Context Injection)"** 기반의 멘션 시스템을 설계한다.

## 2. 목표 (Goals)

1.  **통합 멘션**: Analyses(Queries), Data Sources(DB), Files(Dataset) 등 모든 자산을 `@` 하나로 호출 가능하게 한다.
2.  **컨텍스트 주입**: 에이전트가 모호한 이름 대신 명확한 ID와 Type을 인지하도록, 전송 시 메타데이터를 함께 보낸다.
3.  **UX 일관성**: Board 에디터와 Chat 입력창 간의 자산 참조 경험을 통일한다.

## 3. 데이터 구조 (Data Structure)

### 3.1 통합 멘션 모델
프론트엔드에서 관리할 멘션 아이템의 표준 인터페이스이다.

```typescript
type AssetType = 'analysis' | 'source' | 'file';

interface MentionItem {
  id: string;          // 고유 식별자 (UUID or Name or Path)
  type: AssetType;     // 자산 유형
  name: string;        // 표시 이름 (Display Name)
  icon?: ReactNode;    // 아이콘
  metadata?: any;      // 추가 정보 (Schema, SQL 등)
}

interface MentionGroup {
  label: string;       // 그룹명 (Analyses, Sources, Files)
  items: MentionItem[];
}
```

### 3.2 `useAssetMentions` Hook
흩어져 있는 API 리소스를 하나로 통합하여 제공하는 커스텀 훅.

```typescript
// hooks/useAssetMentions.ts
export function useAssetMentions(projectId: string) {
  // 각 리소스 hook에서 데이터 fetch
  const { data: analyses } = useAnalyses(projectId);
  const { data: sources } = useSources(projectId);
  const { data: files } = useFiles(projectId);

  return useMemo(() => [
    {
      label: 'Analyses',
      items: analyses?.map(a => ({ type: 'analysis', id: a.id, name: a.name }))
    },
    {
      label: 'Data Sources',
      items: sources?.map(s => ({ type: 'source', id: s.name, name: s.name }))
    },
    {
      label: 'Files',
      items: files?.map(f => ({ type: 'file', id: f.path, name: f.name }))
    }
  ], [analyses, sources, files]);
}
```

## 4. UI/UX 설계

### 4.1 멘션 트리거 및 메뉴
- **Trigger**: `@` 키 입력 또는 입력창 하단 `@` 아이콘 클릭
- **Menu Structure**:
    - **Search Bar**: 상단 검색창 (필터링)
    - **Section 1: Analyses**: 저장된 분석 (Table/Chart 아이콘)
    - **Section 2: Data Sources**: 연결된 DB (Database 아이콘)
    - **Section 3: Files**: 업로드된 파일 (File 아이콘)

### 4.2 입력창 표시 (Visual Feedback)
- 멘션 선택 시, 입력창에는 텍스트로 `@Name`이 삽입된다.
- (Advanced) 가능하다면 `Chip`이나 하이라이트 된 텍스트로 표시하여 일반 텍스트와 구분감을 준다.

## 5. 컨텍스트 주입 프로토콜 (Context Injection Protocol)

사용자에게는 보이지 않지만, 에이전트에게는 명확한 정보를 전달하기 위한 규약이다.

### 5.1 전송 흐름
1.  사용자가 멘션 선택: `activeMentions` 상태에 선택된 아이템(`{id, type, name}`) 추가
2.  메시지 전송(`handleSubmit`):
    - 사용자 입력 텍스트: `지난달 매출 분석해줘 @Revenue`
    - `activeMentions`를 기반으로 **Context Block** 생성
    - 실제 전송 메시지(Payload) 구성

### 5.2 Context Block 포맷
에이전트가 해석하기 쉬운 XML-like 태그 또는 구조화된 텍스트를 메시지 끝에 붙인다.

```text
(User Visible Message)
지난달 매출 분석해줘 @Revenue

(Actual Prompt to Agent)
지난달 매출 분석해줘 @Revenue

<context_assets>
- Asset: Revenue (Type: analysis, ID: 1234-5678)
</context_assets>
```

### 5.3 에이전트 인식 (Prompt Engineering)
시스템 프롬프트(`default_agent_prompt.md`)에 해당 컨텍스트 처리 지침을 추가한다.

```markdown
**Context Awareness**
If the user message contains a `<context_assets>` block, prioritize using the provided IDs.
- Type 'analysis' → Use `get_analysis(id)`
- Type 'source' → Use `list_source_tables(source_name)`
- Type 'file' → Use `read_file(path)`
```

## 6. 구현 계획 (Implementation Plan)

### Phase 1: Frontend Core (Hooks & State)
- [x] `useAssetMentions` 훅 구현 (API 연동)
- [x] `ChatPanel` 상태 관리에 `selectedMentions` 추가

### Phase 2: UI Overhaul
- [x] `PromptInput` 컴포넌트 내 Dropdown 메뉴를 3단 구조로 개편 (`MentionMenu`)
- [x] `@` 버튼 클릭 시 메뉴 팝업 로직 구현

### Phase 3: Protocol & Agent
- [x] `handleSubmit`에서 Context Block 생성 로직 추가
- [x] `default_agent_prompt.md` 업데이트 (컨텍스트 인식 지침)
- [x] 레거시 코드(`dataSources`, `allTables` props) 제거

## 7. 기대 효과
- **정확성**: 이름 충돌이나 모호함 없이 정확한 자산을 에이전트가 식별
- **확장성**: 향후 새로운 자산 타입이 추가되어도 쉽게 확장 가능
- **사용성**: 사용자는 복잡한 ID를 알 필요 없이 이름(`@`)만으로 소통 가능

