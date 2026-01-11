# Board Re-architecture: Notion-like Lexical Editor

## 1. 개요 및 배경
현재 그리드(Grid) 기반의 보드 시스템을 **Notion 스타일의 문서형 에디터**로 전면 개편합니다.
사용자는 텍스트 흐름 속에 차트, 이미지, 테이블 등의 "블록"을 자유롭게 배치하고 순서를 변경하며 리포트를 작성할 수 있습니다.

### ⚠️ 개발 전략: Clean Slate (전면 재구축)
**기존 그리드 기반 보드 소스(`BoardCanvas`, `ItemCard` 등)는 유지보수하거나 재활용하지 않고 완전히 제거(Delete)합니다.**
새로운 Lexical 기반 에디터는 백지 상태에서 새로 구축하며, 기존 코드는 레거시로 간주하여 폐기합니다.

## 2. 기술 스택 선정: Lexical
여러 에디터 라이브러리(Lexical, TipTap, BlockNote, Plate)를 검토한 결과, **Lexical**을 최종 선정했습니다.

### 선정 이유
1.  **Tauri 호환성**: Slate(Yoopta) 사용 시 발생했던 Tauri WebView 포커스/이벤트 이슈가 Lexical에서는 발생하지 않음이 검증되었습니다.
2.  **단일 스택 유지**: 이미 `MarkdownItem` 구현을 위해 Lexical을 도입했습니다. 메인 캔버스까지 Lexical로 통일하여 번들 사이즈를 최적화하고 유지보수 복잡도를 낮춥니다.
3.  **React 친화적**: `DecoratorNode`를 통해 기존 React 컴포넌트(차트, 이미지 업로더 등)를 에디터 내부에 "살아있는 위젯"으로 삽입하기 가장 용이합니다.

## 3. 아키텍처 변경

### 3.1. 데이터 모델 (Frontend)
- **기존**: `BoardItem` 배열 (x, y 좌표, w, h 크기 포함) -> **폐기**
- **변경**: Lexical Editor State (JSON)
    - 문서 전체가 하나의 JSON 트리 구조로 관리됩니다.
    - 차트나 이미지는 텍스트 노드 사이의 `DecoratorNode`로 존재합니다.

### 3.2. 데이터 모델 (Backend)
- **기존**: `board_items` 테이블의 레코드들 -> **폐기 예정**
- **변경**: `boards` 테이블에 `content` (JSONB/TEXT) 컬럼 추가.
    - 기존 `board_items` 테이블은 마이그레이션 참고용으로만 잠시 두되, 최종적으로는 사용하지 않습니다.

## 4. 상세 구현 계획

### Phase 0: Legacy Removal (선행 작업)
새로운 구현을 방해하지 않도록 기존 소스를 과감하게 정리합니다.
- [ ] **기존 컴포넌트 삭제**:
    - `components/boards/BoardCanvas.tsx`
    - `components/boards/ItemCard.tsx`
    - `components/boards/items/*.tsx` (MarkdownItem 제외, 재활용 가능한 로직만 추출 후 삭제)
- [ ] **관련 훅 및 API 정리**: `useBoardItems` 등 그리드 전용 훅 정리.

### Phase 1: 기본 에디터 구축 (Foundation)
- [ ] **`components/editor` 디렉토리 구조 생성**
- [ ] **`BoardEditor.tsx` 신규 구현**
    - LexicalComposer 기반의 전체 페이지 에디터.
    - Title Plugin (보드 제목).
    - History Plugin (Undo/Redo).
    - Markdown Shortcut Plugin.
- [ ] **`BoardsView.tsx` 전면 수정**
    - 기존 캔버스 로직 제거 후 `BoardEditor` 연결.

### Phase 2: 커스텀 노드 구현 (Custom Nodes)
각 기능 블록을 Lexical의 `DecoratorNode`로 구현합니다.

- [ ] **`ChartNode`**
    - 속성: `queryId`, `chartType`, `config`
    - 뷰: API로 데이터 fetch 후 렌더링.
- [ ] **`ImageNode`**
    - 속성: `src`, `alt`, `width`, `height`
    - 뷰: 이미지 표시 및 리사이즈 핸들.
- [ ] **`TableNode`** (Optional for MVP)
    - 속성: `queryId` (데이터 테이블용)
    - 뷰: TanStack Table 등 연동.

### Phase 3: UX 강화 (Notion-like Features)
- [ ] **Slash Command Plugin (`/`)**
    - `/` 입력 시 팝업 메뉴 표시.
    - Text, H1~H3, Bullet List, **Chart**, **Image** 선택 가능.
- [ ] **Draggable Block Plugin**
    - 블록 좌측에 마우스 오버 시 `⋮⋮` 핸들 표시.
    - 핸들을 드래그하여 블록 순서 변경.
    - 클릭 시 블록 옵션 메뉴 (삭제, 복제 등) 표시.
- [ ] **Component Picker**
    - `/chart` 선택 시 "어떤 쿼리를 연결할까요?" 모달 팝업.

### Phase 4: 저장 및 데이터 연결
- [ ] **Auto Save**
    - `OnChangePlugin` + Debounce를 이용한 자동 저장 구현.
    - Backend API: `PATCH /boards/{id}` 엔드포인트에 `content` 필드 업데이트.

## 5. 예상 결과물
- 사용자는 빈 캔버스에서 글을 쓰다가 `/chart`를 입력하여 차트를 삽입합니다.
- 차트 아래에 다시 텍스트로 분석 내용을 작성합니다.
- 차트와 텍스트를 드래그하여 순서를 바꿉니다.
- 이 모든 과정이 자연스러운 하나의 문서 흐름으로 동작합니다.
