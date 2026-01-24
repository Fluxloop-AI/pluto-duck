---
date: 2026-01-13T00:00:00Z
researcher: Claude
topic: "Board UI Improvements - Tab Alignment, Date Display, Auto-save Status"
tags: [research, codebase, ui, board, toolbar]
status: complete
---

# Research: Board UI Improvements

## Research Question
보드 영역 UI 개선:
1. 보드의 탭 그룹 위치를 텍스트 시작하는 위치로 옮기기
2. 날짜 추가
3. "Saved"를 "Auto-saved"로 문구 변경

## Summary
보드 UI 개선을 위해 3개의 주요 파일을 수정해야 합니다:
- **BoardToolbar.tsx**: 탭 그룹의 left padding 추가 (`pl-12`)
- **BoardEditor.tsx**: "Saved" → "Auto-saved" 변경 및 날짜 표시 추가

현재 에디터 콘텐츠 영역은 `pl-12` (48px) 좌측 패딩을 사용하므로, 탭 그룹도 동일한 패딩을 적용하면 정렬됩니다.

## Detailed Findings

### 1. 탭 그룹 위치 (BoardToolbar.tsx)

**현재 구조** (`BoardToolbar.tsx:70-72`):
```tsx
<div className="flex items-center bg-background px-2 pt-2">
  <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
```

**에디터 콘텐츠 영역** (`BoardEditor.tsx:207`):
```tsx
<ContentEditable className="min-h-full outline-none prose dark:prose-invert max-w-none p-8 pl-12" />
```

에디터는 `pl-12` (3rem = 48px)의 좌측 패딩을 사용하고, 전체 컨테이너는 `max-w-4xl mx-auto`로 중앙 정렬됩니다.

**수정 방안**:
BoardToolbar에서 탭 리스트를 `max-w-4xl mx-auto`로 감싸고 `pl-12` 패딩을 적용하면 텍스트 시작 위치와 정렬됩니다.

### 2. 저장 상태 및 날짜 표시 (BoardEditor.tsx)

**현재 코드** (`BoardEditor.tsx:192-199`):
```tsx
<div className="h-full flex flex-col bg-background relative">
  <div className="absolute top-2 right-4 z-10">
    {isSaving ? (
      <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>
    ) : (
      <span className="text-xs text-muted-foreground opacity-50">Saved</span>
    )}
  </div>
```

**수정 방안**:
- "Saved" → "Auto-saved" 변경
- 날짜 표시 추가 (현재 시간 또는 마지막 저장 시간)
- 날짜 포맷: "October 25, 2025 at 8:20 PM" 형식

### 3. 컴포넌트 계층 구조

```
BoardsView.tsx
├── BoardToolbar.tsx (탭 리스트)
└── BoardEditor.tsx (에디터 + 저장 상태)
```

## Code References

| File | Line | Description |
|------|------|-------------|
| `components/boards/BoardToolbar.tsx` | 70-72 | 툴바 외부 컨테이너 (padding 수정 필요) |
| `components/boards/BoardToolbar.tsx` | 73 | 탭 리스트 컨테이너 |
| `components/editor/BoardEditor.tsx` | 192-199 | 저장 상태 표시 영역 |
| `components/editor/BoardEditor.tsx` | 207 | 에디터 콘텐츠 영역 (`pl-12` 패딩) |
| `components/boards/BoardsView.tsx` | 196-204 | BoardToolbar 사용 위치 |

## Architecture Insights

1. **레이아웃 패턴**: 에디터는 `max-w-4xl mx-auto`로 중앙 정렬되고 `pl-12`로 좌측 여백을 줌
2. **저장 메커니즘**: 1초 디바운스로 자동 저장되므로 "Auto-saved"가 더 정확한 표현
3. **날짜 포맷**: 기존에 날짜 표시가 없으므로 새로 추가 필요 (Date.toLocaleString 활용)

## Implementation Plan

### Step 1: BoardToolbar.tsx 수정
탭 그룹을 에디터와 같은 정렬로 맞추기:
```tsx
<div className="flex items-center bg-background pt-2">
  <div className="w-full max-w-4xl mx-auto pl-12">
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
      {/* tabs */}
    </div>
  </div>
</div>
```

### Step 2: BoardEditor.tsx 수정
- "Saved" → "Auto-saved" 변경
- 날짜 표시 추가:
```tsx
<div className="absolute top-2 right-4 z-10 flex items-center gap-3">
  <span className="text-xs text-muted-foreground">
    {new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })}
  </span>
  <span className="text-xs text-muted-foreground opacity-50">
    {isSaving ? 'Saving...' : 'Auto-saved'}
  </span>
</div>
```

## Open Questions

1. 날짜는 현재 시간을 보여줄지, 마지막 저장 시간을 보여줄지 결정 필요
2. 날짜 포맷 로케일 (영어 vs 한국어) 결정 필요
