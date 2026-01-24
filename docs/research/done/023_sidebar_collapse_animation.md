---
date: 2026-01-15T00:00:00+09:00
researcher: Claude
topic: "사이드바 접기/펼기 애니메이션 구현 방안"
tags: [research, codebase, sidebar, animation, transition, UI]
status: complete
---

# Research: 사이드바 접기/펼기 애니메이션 구현 방안

## Research Question
헤더의 사이드패널 접기 버튼 클릭 시 현재 애니메이션이 없어 부드럽지 못한데, 접기/펼기 시 슬라이딩 효과를 추가하려면 현재 코드가 어떻게 구현되어 있고, 어떻게 수정해야 하는지 조사

## Summary
현재 사이드바는 **조건부 렌더링(Conditional Rendering)** 방식으로 구현되어 있어 DOM에서 완전히 제거/추가되므로 CSS 트랜지션이 적용되지 않습니다. 애니메이션을 추가하려면 요소를 항상 DOM에 유지하면서 CSS 속성(width, transform)을 변경하는 방식으로 수정해야 합니다.

## Detailed Findings

### 1. 현재 토글 버튼 구현

**파일:** `frontend/pluto_duck_frontend/app/page.tsx`

**상태 관리 (line 55-56):**
```tsx
const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false);
```

**왼쪽 사이드바 토글 버튼 (lines 379-389):**
```tsx
<button
  onClick={() => setSidebarCollapsed(prev => !prev)}
  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent"
  title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
>
  {sidebarCollapsed ? (
    <PanelLeftOpen className="h-4 w-4" />
  ) : (
    <PanelLeftClose className="h-4 w-4" />
  )}
</button>
```

**오른쪽 채팅 패널 토글 버튼 (lines 406-415):**
```tsx
<button
  onClick={() => setChatPanelCollapsed(prev => !prev)}
  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent"
  title={chatPanelCollapsed ? 'Expand chat panel' : 'Collapse chat panel'}
>
  {chatPanelCollapsed ? (
    <PanelRightOpen className="h-4 w-4" />
  ) : (
    <PanelRightClose className="h-4 w-4" />
  )}
</button>
```

### 2. 현재 사이드바 렌더링 방식 (문제점)

**왼쪽 사이드바 (lines 435-522):**
```tsx
{!sidebarCollapsed && (
  <aside className="hidden w-64 border-r border-muted bg-muted transition-all duration-300 lg:flex lg:flex-col">
    {/* 사이드바 내용 */}
  </aside>
)}
```

**오른쪽 채팅 패널 (lines 540-570):**
```tsx
{!chatPanelCollapsed && (
  <div
    className="hidden lg:flex relative"
    style={{ width: `${chatPanelWidth}px` }}
  >
    <MultiTabChatPanel {...props} />
  </div>
)}
```

**문제점:**
- `{!sidebarCollapsed && (...)}` 조건부 렌더링 사용
- `sidebarCollapsed`가 `true`가 되면 요소가 DOM에서 **완전히 제거됨**
- DOM에서 제거되므로 `transition-all duration-300` 클래스가 있어도 **애니메이션이 동작하지 않음**
- CSS 트랜지션은 요소가 DOM에 존재하고 CSS 속성이 변할 때만 동작함

### 3. 레이아웃 구조

**전체 레이아웃 (line 377, 434):**
```tsx
<div className="relative flex h-screen w-full flex-col bg-white">
  {/* Header */}
  <header className="z-10 flex h-10 shrink-0 items-center bg-muted px-3 pl-[76px] pr-3">
    ...
  </header>

  {/* Main Content Area */}
  <div className="flex flex-1 overflow-hidden bg-muted">
    {/* Left Sidebar - w-64 (256px) */}
    {!sidebarCollapsed && <aside className="w-64">...</aside>}

    {/* Board + Chat Wrapper */}
    <div className="flex flex-1 overflow-hidden">
      {/* Board Area - flex-1 */}
      <div className="flex flex-1 flex-col">...</div>

      {/* Chat Panel - dynamic width */}
      {!chatPanelCollapsed && <div style={{ width: chatPanelWidth }}>...</div>}
    </div>
  </div>
</div>
```

### 4. 코드베이스의 기존 애니메이션 패턴

**Tailwind 트랜지션 유틸리티:**
- `transition-all duration-300` - 전체 속성 300ms
- `transition-colors duration-200` - 색상만 200ms
- `transition-transform` - transform만
- `transition-opacity` - opacity만

**Radix UI 애니메이션 (dialog.tsx, dropdown-menu.tsx):**
```tsx
data-[state=open]:animate-in data-[state=closed]:animate-out
data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
```

**Boards/Assets 탭 슬라이더 애니메이션 (page.tsx lines 462-493):**
```tsx
<div
  className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-md bg-primary transition-all duration-200 ease-out ${
    mainView === 'boards' ? 'left-1' : 'left-[50%]'
  }`}
/>
```
- 요소가 항상 DOM에 존재
- `left` 속성 값이 변경됨
- `transition-all duration-200`으로 부드럽게 애니메이션

**커스텀 키프레임 (globals.css):**
```css
@keyframes collapsible-down {
  from { height: 0; opacity: 0; }
  to { height: var(--radix-collapsible-content-height); opacity: 1; }
}

@keyframes collapsible-up {
  from { height: var(--radix-collapsible-content-height); opacity: 1; }
  to { height: 0; opacity: 0; }
}
```

## 애니메이션 추가 구현 방안

### 방안 1: CSS width 트랜지션 (권장)

**원리:** 요소를 항상 DOM에 유지하고, `width`를 `0`과 실제 너비 사이에서 애니메이션

**왼쪽 사이드바 수정:**
```tsx
// Before (조건부 렌더링)
{!sidebarCollapsed && (
  <aside className="w-64">...</aside>
)}

// After (CSS 트랜지션)
<aside
  className={cn(
    "border-r border-muted bg-muted transition-all duration-300 ease-out lg:flex lg:flex-col overflow-hidden",
    sidebarCollapsed ? "w-0" : "w-64"
  )}
>
  <div className="w-64 min-w-64">
    {/* 내부 콘텐츠 - 고정 너비 유지 */}
  </div>
</aside>
```

**장점:**
- 기존 Tailwind 유틸리티 사용으로 간단
- 보드 영역이 자연스럽게 확장/축소됨 (flex-1 덕분)

**단점:**
- `overflow-hidden` 필수
- 내부 콘텐츠에 고정 너비 필요

### 방안 2: CSS transform (translateX) 트랜지션

**원리:** 요소를 화면 밖으로 슬라이드하면서 동시에 margin을 조정

**왼쪽 사이드바 수정:**
```tsx
<aside
  className={cn(
    "w-64 border-r border-muted bg-muted transition-all duration-300 ease-out lg:flex lg:flex-col",
    sidebarCollapsed ? "-ml-64" : "ml-0"  // 또는 -translate-x-full
  )}
>
  ...
</aside>
```

**장점:**
- GPU 가속으로 더 부드러운 애니메이션
- 내부 콘텐츠 레이아웃 변경 없음

**단점:**
- 보드 영역 확장 애니메이션이 함께 필요
- negative margin 사용 시 레이아웃 복잡도 증가

### 방안 3: Framer Motion 사용

**원리:** `AnimatePresence`와 `motion` 컴포넌트로 mount/unmount 애니메이션

```tsx
import { motion, AnimatePresence } from 'framer-motion';

<AnimatePresence>
  {!sidebarCollapsed && (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 256, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="border-r border-muted bg-muted lg:flex lg:flex-col overflow-hidden"
    >
      <div className="w-64">
        {/* 내부 콘텐츠 */}
      </div>
    </motion.aside>
  )}
</AnimatePresence>
```

**장점:**
- 조건부 렌더링 유지 가능 (AnimatePresence가 exit 애니메이션 처리)
- 코드베이스에 이미 Framer Motion 있음 (`shimmer.tsx`에서 사용)

**단점:**
- 번들 크기 증가 (이미 있으므로 미미)
- React 리렌더링 추가 발생

### 방안 4: CSS Grid + 트랜지션

**원리:** CSS Grid의 `grid-template-columns`로 영역 크기 제어

```tsx
<div
  className="grid transition-all duration-300"
  style={{
    gridTemplateColumns: sidebarCollapsed
      ? '0 1fr auto'
      : '256px 1fr auto'
  }}
>
  <aside className="overflow-hidden">...</aside>
  <main>...</main>
  <div>{/* chat panel */}</div>
</div>
```

**장점:**
- 전체 레이아웃이 동시에 부드럽게 변화
- 세 영역 모두 동기화된 애니메이션

**단점:**
- 레이아웃 구조 변경 필요

## 추천 구현 순서

### 1단계: 왼쪽 사이드바 애니메이션 (방안 1 적용)

**수정 위치:** `page.tsx` line 435-522

```tsx
// 변경 전
{!sidebarCollapsed && (
  <aside className="hidden w-64 border-r border-muted bg-muted transition-all duration-300 lg:flex lg:flex-col">
    ...
  </aside>
)}

// 변경 후
<aside
  className={cn(
    "hidden border-r border-muted bg-muted transition-all duration-300 ease-out lg:flex lg:flex-col overflow-hidden",
    sidebarCollapsed ? "w-0 border-r-0" : "w-64"
  )}
>
  <div className="w-64 min-w-64 flex flex-col h-full">
    {/* 기존 사이드바 내용 유지 */}
  </div>
</aside>
```

### 2단계: 오른쪽 채팅 패널 애니메이션

**수정 위치:** `page.tsx` line 540-570

```tsx
// 변경 전
{!chatPanelCollapsed && (
  <div className="hidden lg:flex relative" style={{ width: `${chatPanelWidth}px` }}>
    ...
  </div>
)}

// 변경 후
<div
  className={cn(
    "hidden lg:flex relative transition-all duration-300 ease-out overflow-hidden",
    chatPanelCollapsed ? "w-0" : ""
  )}
  style={{ width: chatPanelCollapsed ? 0 : `${chatPanelWidth}px` }}
>
  <div style={{ width: `${chatPanelWidth}px`, minWidth: `${chatPanelWidth}px` }}>
    {/* 리사이즈 핸들 + MultiTabChatPanel */}
  </div>
</div>
```

### 3단계: 보드 영역 연동

보드 영역은 `flex-1`이므로 사이드바/채팅 패널 너비 변화에 따라 자동으로 확장/축소됩니다. 추가 수정 불필요.

## Code References

- `frontend/pluto_duck_frontend/app/page.tsx:55` - 사이드바 상태 변수 선언
- `frontend/pluto_duck_frontend/app/page.tsx:379-389` - 왼쪽 사이드바 토글 버튼
- `frontend/pluto_duck_frontend/app/page.tsx:406-415` - 오른쪽 채팅 패널 토글 버튼
- `frontend/pluto_duck_frontend/app/page.tsx:435-522` - 왼쪽 사이드바 컴포넌트
- `frontend/pluto_duck_frontend/app/page.tsx:540-570` - 오른쪽 채팅 패널 컴포넌트
- `frontend/pluto_duck_frontend/app/page.tsx:462-493` - 탭 슬라이더 애니메이션 예시
- `frontend/pluto_duck_frontend/app/globals.css` - 커스텀 키프레임 정의
- `frontend/pluto_duck_frontend/components/ai-elements/shimmer.tsx` - Framer Motion 사용 예시

## Architecture Insights

1. **현재 레이아웃**: Flexbox 기반, 가로 방향 (`flex-row`)
2. **보드 영역**: `flex-1`로 남은 공간 자동 채움
3. **애니메이션 패턴**: Tailwind 유틸리티 + Radix UI 조합 주로 사용
4. **조건부 렌더링의 한계**: DOM 제거 시 트랜지션 불가

## Open Questions

1. 사이드바 접힘 상태를 localStorage에 저장하여 새로고침 후에도 유지할지?
2. 모바일에서의 사이드바 동작 (현재 `hidden lg:flex`로 모바일에서 숨김)
3. 키보드 단축키 (예: `Cmd+B`)로 토글 지원할지?
