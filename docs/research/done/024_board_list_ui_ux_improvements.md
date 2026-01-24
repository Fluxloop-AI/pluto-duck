---
date: 2026-01-15T00:00:00+09:00
researcher: Claude
topic: "보드 리스트 UI/UX 개선 - 제목 수정, 삭제 아이콘, 높이 일관성"
tags: [research, codebase, board-list, inline-edit, UI, UX]
status: complete
---

# Research: 보드 리스트 UI/UX 개선

## Research Question
보드 리스트에서 다음 세 가지 UI/UX 수정사항 구현 방안:
1. 보드 제목 수정 기능 추가 (더블클릭 시 텍스트 입력 영역으로 전환)
2. 보드 삭제 휴지통 아이콘 vertical middle 정렬
3. 삭제 확인 UI의 높이를 보드 아이템과 동일하게 조정

## Summary

현재 `BoardList.tsx` 컴포넌트는 더블클릭 편집 기능이 없으며, 휴지통 아이콘이 상단 정렬되어 있고, 삭제 확인 UI의 패딩이 보드 아이템과 다릅니다. 같은 코드베이스의 `BoardToolbar.tsx`에 이미 더블클릭 인라인 편집 패턴이 구현되어 있어 이를 참고하여 구현할 수 있습니다.

## Detailed Findings

### 1. 현재 BoardList.tsx 구조

**파일:** `frontend/pluto_duck_frontend/components/boards/BoardList.tsx`

**컴포넌트 Props (lines 7-14):**
```tsx
interface BoardListProps {
  boards: Board[];
  activeId?: string;
  onSelect: (board: Board) => void;
  onDelete?: (board: Board) => void;
  onUpdate?: (boardId: string, data: any) => void;  // 이미 존재하지만 미사용!
  onCreate?: () => void;
}
```

**주목:** `onUpdate` prop이 이미 정의되어 있지만 현재 사용되지 않고 있음 (line 16에서 destructure도 안 됨)

**일반 보드 아이템 구조 (lines 118-154):**
```tsx
<div
  key={board.id}
  className={`
    group relative flex items-start gap-2 rounded-lg px-2.5 py-2.5 text-sm cursor-pointer transition-colors
    ${activeId === board.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}
  `}
  onClick={() => onSelect(board)}
>
  <div className="flex-1 min-w-0">
    <p className={`truncate ${activeId === board.id ? 'font-medium' : 'font-normal'}`}>
      {board.name}
    </p>
    <p className="truncate text-xs text-muted-foreground">
      {formatRelativeTime(board.updated_at)}
    </p>
  </div>

  {onDelete && boards.length > 1 && (
    <button className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center ...">
      <TrashIcon className="h-3 w-3" />
    </button>
  )}
</div>
```

**삭제 확인 UI 구조 (lines 91-115):**
```tsx
<div
  key={board.id}
  className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-sm"
>
  <span className="text-destructive text-xs font-medium truncate">Delete?</span>
  <div className="flex items-center gap-1 shrink-0">
    <button onClick={() => setConfirmingDeleteId(null)} className="px-2 py-1 text-xs ...">
      Cancel
    </button>
    <button onClick={() => { onDelete?.(board); setConfirmingDeleteId(null); }} className="px-2 py-1 text-xs ...">
      Delete
    </button>
  </div>
</div>
```

### 2. 발견된 문제점

#### 문제 1: 더블클릭 편집 기능 없음
- 현재 보드 이름을 클릭하면 보드 선택만 됨 (`onClick={() => onSelect(board)}`)
- `onUpdate` prop은 정의되어 있으나 사용되지 않음
- 더블클릭 이벤트 핸들러가 없음

#### 문제 2: 휴지통 아이콘 상단 정렬
- 보드 아이템의 컨테이너가 `items-start` 사용 (line 121)
- 휴지통 버튼이 컨테이너 상단에 정렬됨
- 보드 이름과 시간 정보가 2줄이므로 아이콘이 위쪽으로 치우쳐 보임

#### 문제 3: 삭제 확인 UI 높이 불일치
- 일반 보드 아이템: `py-2.5` (약 10px 상하 패딩)
- 삭제 확인 UI: `py-2` (약 8px 상하 패딩)
- 2px 차이로 인해 삭제 확인 시 높이가 줄어드는 점프 현상 발생

### 3. 기존 인라인 편집 패턴 (BoardToolbar.tsx)

**파일:** `frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx`

**상태 관리 (lines 34-36):**
```tsx
const [editingTabId, setEditingTabId] = useState<string | null>(null);
const [editingName, setEditingName] = useState('');
const inputRef = useRef<HTMLInputElement>(null);
```

**편집 시작 (lines 46-49):**
```tsx
const handleStartRename = (tab: BoardTab) => {
  setEditingTabId(tab.id);
  setEditingName(tab.name);
};
```

**편집 완료 (lines 51-57):**
```tsx
const handleFinishRename = () => {
  if (editingTabId && editingName.trim()) {
    onRenameTab(editingTabId, editingName.trim());
  }
  setEditingTabId(null);
  setEditingName('');
};
```

**키보드 핸들러 (lines 59-66):**
```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter') {
    handleFinishRename();
  } else if (e.key === 'Escape') {
    setEditingTabId(null);
    setEditingName('');
  }
};
```

**더블클릭 바인딩 (line 99):**
```tsx
<button
  onClick={() => onSelectTab(tab.id)}
  onDoubleClick={() => handleStartRename(tab)}
  className="truncate max-w-[120px]"
>
  {tab.name}
</button>
```

**입력 필드 (lines 86-94):**
```tsx
{editingTabId === tab.id ? (
  <input
    ref={inputRef}
    type="text"
    value={editingName}
    onChange={(e) => setEditingName(e.target.value)}
    onBlur={handleFinishRename}
    onKeyDown={handleKeyDown}
    className="w-20 bg-transparent text-sm outline-none"
  />
) : (
  // Normal display
)}
```

### 4. useBoards 훅의 updateBoard 함수

**파일:** `frontend/pluto_duck_frontend/hooks/useBoards.ts`

**updateBoard 함수 (lines 73-88):**
```tsx
const updateBoard = useCallback(async (
  boardId: string,
  updates: { name?: string; description?: string; settings?: Record<string, any> }
) => {
  try {
    const updated = await updateBoardApi(boardId, updates);
    setBoards(prev => prev.map(b => b.id === boardId ? updated : b));
    if (activeBoard?.id === boardId) {
      setActiveBoard(updated);
    }
    return updated;
  } catch (err) {
    console.error('Failed to update board:', err);
    throw err;
  }
}, [activeBoard]);
```

이 함수가 BoardList로 전달되어 `onUpdate`로 사용될 수 있음.

### 5. API 지원 확인

**파일:** `frontend/pluto_duck_frontend/lib/boardsApi.ts`

**updateBoard API (lines 91-105):**
```tsx
export async function updateBoard(boardId: string, data: {
  name?: string;
  description?: string;
  settings?: Record<string, any>;
}): Promise<Board> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/${boardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  // ...
}
```

API는 이미 보드 이름 업데이트를 지원함.

## 구현 방안

### 수정 1: 더블클릭 보드 이름 편집

**BoardList.tsx 수정:**

1. props에서 `onUpdate` destructure 추가:
```tsx
export function BoardList({ boards, activeId, onSelect, onDelete, onUpdate }: BoardListProps) {
```

2. 상태 추가:
```tsx
const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
const [editingName, setEditingName] = useState('');
const inputRef = useRef<HTMLInputElement>(null);
```

3. 핸들러 추가:
```tsx
const handleStartRename = (board: Board) => {
  setEditingBoardId(board.id);
  setEditingName(board.name);
};

const handleFinishRename = () => {
  if (editingBoardId && editingName.trim() && onUpdate) {
    onUpdate(editingBoardId, { name: editingName.trim() });
  }
  setEditingBoardId(null);
  setEditingName('');
};

const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter') {
    handleFinishRename();
  } else if (e.key === 'Escape') {
    setEditingBoardId(null);
    setEditingName('');
  }
};
```

4. 보드 이름 부분 수정:
```tsx
{editingBoardId === board.id ? (
  <input
    ref={inputRef}
    type="text"
    value={editingName}
    onChange={(e) => setEditingName(e.target.value)}
    onBlur={handleFinishRename}
    onKeyDown={handleKeyDown}
    onClick={(e) => e.stopPropagation()}
    className="w-full bg-transparent outline-none truncate"
    autoFocus
  />
) : (
  <p
    className={`truncate ${activeId === board.id ? 'font-medium' : 'font-normal'}`}
    onDoubleClick={(e) => {
      e.stopPropagation();
      handleStartRename(board);
    }}
  >
    {board.name}
  </p>
)}
```

### 수정 2: 휴지통 아이콘 세로 중앙 정렬

**현재 (line 121):**
```tsx
className={`group relative flex items-start gap-2 ...`}
```

**수정:**
```tsx
className={`group relative flex items-center gap-2 ...`}
```

**보드 정보 영역 조정:**
이름과 시간 정보가 포함된 div는 그대로 두고, 전체 컨테이너만 `items-center`로 변경하면 휴지통 아이콘이 세로 중앙에 위치하게 됨.

### 수정 3: 삭제 확인 UI 높이 일치

**현재 (line 95):**
```tsx
className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-sm"
```

**수정:**
```tsx
className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 px-2.5 py-2.5 text-sm"
```

`py-2` → `py-2.5`로 변경하여 일반 보드 아이템과 동일한 높이 유지.

## Code References

- [BoardList.tsx:16](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L16) - 컴포넌트 props (onUpdate 미사용)
- [BoardList.tsx:91-115](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L91-L115) - 삭제 확인 UI (py-2 사용)
- [BoardList.tsx:118-154](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L118-L154) - 일반 보드 아이템 (py-2.5 사용)
- [BoardList.tsx:121](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L121) - items-start 클래스 (수정 필요)
- [BoardList.tsx:131-133](frontend/pluto_duck_frontend/components/boards/BoardList.tsx#L131-L133) - 보드 이름 표시 (더블클릭 추가 필요)
- [BoardToolbar.tsx:34-66](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx#L34-L66) - 인라인 편집 패턴 참고
- [BoardToolbar.tsx:99](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx#L99) - onDoubleClick 사용 예시
- [useBoards.ts:73-88](frontend/pluto_duck_frontend/hooks/useBoards.ts#L73-L88) - updateBoard 함수

## Architecture Insights

1. **인라인 편집 패턴**: 코드베이스에 이미 `BoardToolbar.tsx`에서 동일한 패턴 사용 중
2. **API 준비 완료**: `updateBoard` API와 훅 함수가 이미 구현되어 있음
3. **Props 구조**: `onUpdate` prop이 이미 정의되어 있어 추가 인터페이스 변경 불필요
4. **디자인 일관성**: Tailwind CSS의 spacing scale 사용 (`py-2.5` = 10px)

## Open Questions

1. 편집 중 다른 보드를 클릭하면 현재 편집을 저장할지 취소할지?
2. 보드 이름이 비어있을 때의 처리 (원래 이름 유지 vs 에러 표시)?
3. 보드 이름 최대 길이 제한이 필요한지?
