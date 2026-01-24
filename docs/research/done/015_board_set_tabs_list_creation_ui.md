---
date: 2026-01-14T00:00:00Z
researcher: Claude
topic: "Board/Set Tabs, Board List, and Board Creation UI Analysis"
tags: [research, codebase, ui, board, sidebar, tabs, user-flow]
status: complete
---

# Research: Board/Set Tabs, Board List, and Board Creation UI Analysis

## Research Question
보드/셋 탭과 보드 리스트, 신규 보드 생성 버튼 등의 UI와 유저 플로우, 인터랙션을 분석하여 자연스러운 수정을 위한 기초 자료를 제공합니다.

## Summary

현재 보드 관련 UI는 크게 4개의 주요 컴포넌트로 구성되어 있습니다:

1. **사이드바 View Tabs** (Boards/Assets 전환): `page.tsx:458-483`
2. **BoardList**: 사이드바에 보드 목록 표시 및 선택
3. **BoardToolbar**: 보드 내부 페이지(탭) 관리
4. **CreateBoardModal**: 신규 보드 생성 다이얼로그

현재 UI의 주요 특징:
- Boards/Assets 토글 탭이 사이드바 상단에 위치
- 보드 리스트는 수직 목록 형태로 표시 (상대 시간 표시)
- 신규 보드 생성은 헤더의 SquarePen 아이콘으로 트리거
- 보드 삭제는 hover 시 나타나는 TrashIcon으로 처리

## Detailed Findings

### 1. 사이드바 구조 (page.tsx)

```
┌─────────────────────────────────────┐
│  [ProjectSelector] [+New Board]     │  <- 헤더 영역
├─────────────────────────────────────┤
│  [Boards] [Assets]                  │  <- View Tabs (토글)
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ Board Name 1            ●       ││  <- 활성 보드
│  │ 5m ago                          ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ Board Name 2            [🗑]    ││  <- hover 시 삭제 버튼
│  │ 2h ago                          ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  [Settings]                         │  <- 하단 고정
└─────────────────────────────────────┘
```

**View Tabs 구현** (`page.tsx:458-490`) - ✅ 개선 완료:
```tsx
<div className="relative mb-3 flex rounded-lg bg-card p-1">
  {/* Sliding indicator */}
  <div
    className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md bg-primary transition-all duration-200 ease-out ${
      mainView === 'boards' ? 'left-1' : 'left-[50%]'
    }`}
  />
  <button onClick={() => setMainView('boards')}
    className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-200 ${
      mainView === 'boards'
        ? 'text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`}>
    <Layers className="h-3.5 w-3.5" />
    Boards
  </button>
  <button onClick={() => setMainView('assets')} ...>
    <Package className="h-3.5 w-3.5" />
    Assets
  </button>
</div>
```

**구현된 개선 사항:**
- ✅ 아이콘 변경: `LayoutDashboard` → `Layers`
- ✅ 테두리 제거: `border border-border` 삭제
- ✅ 패딩 증가: `py-1.5` (6px) → `py-2` (8px)
- ✅ 슬라이딩 애니메이션: absolute 인디케이터 + `transition-all duration-200 ease-out`

### 2. BoardList 컴포넌트 (BoardList.tsx)

**위치**: `frontend/pluto_duck_frontend/components/boards/BoardList.tsx`

**Props 인터페이스**:
```tsx
interface BoardListProps {
  boards: Board[];
  activeId?: string;
  onSelect: (board: Board) => void;
  onDelete?: (board: Board) => void;
  onUpdate?: (boardId: string, data: any) => void;
  onCreate?: () => void;
}
```

**현재 인터랙션 패턴**:
- 클릭: 보드 선택 (`onSelect`)
- Hover: 삭제 버튼 표시 (opacity 0 → 100)
- 삭제: `confirm()` 다이얼로그 후 삭제

**빈 상태 처리** (`BoardList.tsx:30-37`):
```tsx
if (boards.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <p className="text-sm">No boards yet</p>
      <p className="text-xs mt-1">Create one to get started</p>
    </div>
  );
}
```

**상대 시간 표시** (`BoardList.tsx:39-58`):
- "Just now", "Xm ago", "Xh ago", "Xd ago" 형식
- 1분 간격으로 자동 업데이트 (tick state)
- 7일 이상: 절대 날짜로 표시

### 3. 신규 보드 생성 버튼 (page.tsx:445-452)

**현재 위치**: ProjectSelector 옆 헤더 영역

```tsx
<button
  type="button"
  onClick={() => setShowCreateBoardModal(true)}
  className="flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-primary/10 transition"
  title="New board"
>
  <SquarePen className="h-4 w-4" />
</button>
```

**CreateBoardModal** (`modals/CreateBoardModal.tsx`):
- 보드 이름 (필수)
- 설명 (선택)
- Submit 시 `createBoard(name, description)` 호출

### 4. BoardToolbar - 보드 내부 탭 (BoardToolbar.tsx)

**용도**: 하나의 보드 안에서 여러 페이지(탭) 관리

```
[Page 1] [Page 2] [+]
```

**인터랙션**:
- 클릭: 탭 선택
- 더블클릭: 이름 변경 모드
- MoreHorizontal 드롭다운: Rename, Delete 옵션
- Plus 버튼: 새 탭 추가

### 5. 데이터 흐름 (useBoards.ts)

```
page.tsx
  └── useBoards({ projectId })
        ├── boards: Board[]
        ├── activeBoard: Board | null
        ├── createBoard(name, description)
        ├── deleteBoard(boardId)
        └── selectBoard(board)
              └── fetchBoardDetail(board.id) → setActiveBoard()
```

**자동 선택 로직** (`useBoards.ts:35-44`):
- 보드 로드 후 첫 번째 보드 자동 선택
- 보드 삭제 후 남은 첫 번째 보드로 전환

## User Flow Analysis

### 현재 사용자 플로우

1. **앱 시작**
   - 기본 프로젝트의 보드 목록 로드
   - 첫 번째 보드 자동 선택

2. **보드 전환**
   - 사이드바에서 보드 클릭 → BoardDetail API 호출 → 메인 영역 업데이트

3. **신규 보드 생성**
   - SquarePen 아이콘 클릭 → 모달 오픈 → 이름 입력 → 생성 → 자동 선택

4. **보드 삭제**
   - 보드 hover → 삭제 아이콘 클릭 → confirm 다이얼로그 → 삭제 → 다른 보드 선택

### UX 개선 포인트

| 현재 상태 | 잠재적 개선점 | 상태 |
|-----------|--------------|------|
| confirm() 다이얼로그 | 커스텀 삭제 확인 모달 | 🔲 |
| 보드 이름만 표시 | 보드 아이콘/썸네일 추가 | 🔲 |
| hover로만 삭제 버튼 | 컨텍스트 메뉴 (우클릭) | 🔲 |
| 단순 리스트 | 드래그 앤 드롭 정렬 | 🔲 |
| ~~탭 스타일 토글~~ | ~~세그먼트 컨트롤 개선~~ | ✅ |
| 빈 상태 텍스트만 | 빈 상태 일러스트레이션 | 🔲 |

## Code References

| File | Lines | Description |
|------|-------|-------------|
| [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) | 436-511 | 사이드바 전체 구조 |
| [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) | 458-483 | Boards/Assets 토글 탭 |
| [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) | 445-452 | 신규 보드 생성 버튼 |
| [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) | 485-492 | BoardList 사용 위치 |
| [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) | 1-103 | 전체 컴포넌트 |
| [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) | 30-37 | 빈 상태 UI |
| [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) | 60-100 | 리스트 아이템 렌더링 |
| [BoardToolbar.tsx](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx) | 1-153 | 보드 내부 탭 관리 |
| [BoardsView.tsx](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx) | 47-219 | 메인 보드 뷰 |
| [CreateBoardModal.tsx](frontend/pluto_duck_frontend/components/boards/modals/CreateBoardModal.tsx) | 1-102 | 보드 생성 모달 |
| [useBoards.ts](frontend/pluto_duck_frontend/hooks/useBoards.ts) | 1-141 | 보드 상태 관리 훅 |

## Architecture Insights

1. **컴포넌트 분리**: BoardList(사이드바)와 BoardToolbar(메인 영역)가 명확히 분리됨
2. **상태 관리**: useBoards 훅이 모든 보드 CRUD와 선택 상태 관리
3. **API 패턴**: 리스트 조회 후 상세 조회(fetchBoardDetail)로 2단계 로딩
4. **자동 저장**: BoardEditor에서 500ms 디바운스로 탭 내용 자동 저장

## Related Components

| 컴포넌트 | 역할 | 유사 패턴 |
|----------|------|-----------|
| TabBar (Chat) | 채팅 탭 관리 | 탭 추가/삭제/선택 |
| ProjectSelector | 프로젝트 전환 | 드롭다운 선택 패턴 |
| ConnectorGrid | 카드 그리드 UI | 카드 스타일 참고 |

## Open Questions

1. **Boards/Assets 탭 위치**: 현재 사이드바 상단 - 다른 위치가 더 자연스러울지?
2. **보드 생성 버튼**: SquarePen 아이콘의 의미가 직관적인지? "+" 버튼이 더 나을지?
3. **삭제 확인**: 브라우저 confirm()이 아닌 커스텀 모달이 필요한지?
4. **보드 정렬**: 현재 생성순 - updated_at 기준 정렬이 더 유용할지?
5. **빈 상태**: 보드가 없을 때 더 풍부한 온보딩 UI가 필요한지?

---

## Implementation Log

### 2026-01-14: View Tabs 슬라이딩 세그먼트 개선

**커밋**: `db32803` - `style(sidebar): improve Boards/Assets toggle with sliding animation`

**변경 사항**:
| 항목 | Before | After |
|------|--------|-------|
| 아이콘 | `LayoutDashboard` | `Layers` |
| 테두리 | `border border-border` | 없음 |
| 패딩 | `py-1.5` (6px) | `py-2` (8px) |
| 활성 표시 | 버튼 배경색 변경 | 슬라이딩 인디케이터 |
| 애니메이션 | 없음 | `transition-all duration-200 ease-out` |

**구현 방식**:
- absolute 포지션의 슬라이딩 인디케이터 추가
- `left-1` / `left-[50%]`로 위치 전환
- 버튼은 `relative z-10`으로 인디케이터 위에 표시
