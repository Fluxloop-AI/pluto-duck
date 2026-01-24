---
date: 2026-01-13T13:30:00+09:00
researcher: Claude
topic: "UI 프레임 구조 및 Roundedness 분석"
tags: [research, codebase, ui, layout, css, roundedness]
status: complete
---

# Research: UI 프레임 구조 및 Roundedness 분석

## Research Question
현재 앱 UI의 사이드 패널, 헤더, 보드, 채팅 인터페이스 프레임 구조 분석. 목표: 보드와 채팅이 하나의 rounded 컨테이너에 포함되도록 변경.

## Summary

현재 레이아웃에서 **보드와 채팅 패널은 별도의 형제(sibling) 요소**로 존재하며, 공통 컨테이너로 감싸져 있지 않습니다. 디자인 목표(10px roundedness, muted grey background)를 달성하려면 이 두 요소를 감싸는 새로운 wrapper div가 필요합니다.

---

## Detailed Findings

### 1. 전체 레이아웃 구조

**파일:** [page.tsx](frontend/pluto_duck_frontend/app/page.tsx)

현재 레이아웃 계층:

```
<div className="relative flex h-screen w-full flex-col bg-white">     ← 최상위 컨테이너

  <!-- Header (line 378) -->
  <header className="z-10 flex h-10 shrink-0 ...">

  <!-- Main Content Area (line 451) -->
  <div className="flex flex-1 overflow-hidden">

    <!-- Left Sidebar (line 452) -->
    <aside className="hidden w-64 border-r border-muted bg-muted ... lg:flex lg:flex-col">

    <!-- Board Area (line 531) - 현재 별도 div -->
    <div className="relative flex flex-1 flex-col overflow-hidden bg-muted/5">
      <BoardsView ... />
    </div>

    <!-- Chat Panel (line 545) - 현재 별도 div -->
    {!chatPanelCollapsed && (
      <div className="hidden lg:flex relative" style={{ width: `${chatPanelWidth}px` }}>
        <MultiTabChatPanel ... />
      </div>
    )}

  </div>
</div>
```

### 2. 현재 컴포넌트별 스타일링

#### Header (line 378-433)
```tsx
className="z-10 flex h-10 shrink-0 items-center border-b border-muted bg-muted px-3 pl-[76px] pr-3"
```
- 고정 높이: `h-10` (40px)
- 배경: `bg-muted` (연한 회색)
- 하단 테두리: `border-b border-muted`
- 왼쪽 패딩 76px (Tauri 윈도우 컨트롤 공간)

#### Left Sidebar (line 452-529)
```tsx
className="hidden w-64 border-r border-muted bg-muted transition-all duration-300 lg:flex lg:flex-col"
```
- 고정 너비: `w-64` (256px)
- 배경: `bg-muted`
- 오른쪽 테두리: `border-r border-muted`
- 반응형: `hidden lg:flex` (lg 이상에서만 표시)

#### Board Container (line 531-543)
```tsx
className="relative flex flex-1 flex-col overflow-hidden bg-muted/5"
```
- 배경: `bg-muted/5` (매우 연한 회색, 5% opacity)
- **Roundedness: 없음**
- Flex-1으로 남은 공간 차지

#### Chat Panel Container (line 545-575)
```tsx
className="hidden lg:flex relative"
style={{ width: `${chatPanelWidth}px` }}
```
- 동적 너비: 기본 500px, 최소 300px, 최대 800px
- **Roundedness: 없음**
- 내부 MultiTabChatPanel에서 `border-l border-border` 적용

### 3. 현재 Roundedness 설정

#### globals.css (line 33)
```css
--radius: 0.5rem;  /* 8px */
```

#### tailwind.config.js (line 11-14)
```js
borderRadius: {
  lg: "var(--radius)",           // 8px
  md: "calc(var(--radius) - 2px)", // 6px
  sm: "calc(var(--radius) - 4px)", // 4px
}
```

#### 현재 roundedness가 적용된 요소들
| 요소 | 파일:라인 | 클래스 |
|------|-----------|--------|
| Board 탭 | BoardToolbar.tsx:78 | `rounded-t-md` |
| Sidebar 아이템 | BoardList.tsx:66 | `rounded-lg` |
| 채팅 탭 | TabBar.tsx:63 | `rounded-t-md` |
| 메시지 버블 | ChatPanel.tsx:213 | `rounded-2xl` |
| 헤더 버튼 | page.tsx:423 | `rounded-md` |

**핵심 문제:** Board와 Chat의 메인 컨테이너에는 roundedness가 적용되어 있지 않음.

### 4. 채팅 패널 토글 로직

**상태 변수 (line 56):**
```tsx
const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false);
```

**토글 버튼 (line 422-432):**
```tsx
<button
  onClick={() => setChatPanelCollapsed(prev => !prev)}
  className="flex h-7 w-7 items-center justify-center rounded-md ..."
>
  {chatPanelCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
</button>
```

**조건부 렌더링 (line 545):**
```tsx
{!chatPanelCollapsed && (
  <div className="hidden lg:flex relative" ...>
```

### 5. 리사이즈 핸들

**리사이즈 핸들 (line 551-559):**
```tsx
<div
  onMouseDown={handleMouseDown}
  className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/50 transition-colors z-10 group"
  style={{ left: '-1px' }}
>
```

---

## 디자인 목표 달성을 위한 변경 사항

### 목표
1. Board + Chat을 하나의 div로 감싸기
2. 해당 wrapper에 `rounded-[10px]` 적용
3. 배경색을 muted light grey로 설정
4. Chat이 닫혀도 Board만 있을 때 rounded 유지

### 제안하는 구조 변경

**현재 구조:**
```
<div className="flex flex-1 overflow-hidden">
  <aside> Sidebar </aside>
  <div> Board </div>           ← 형제
  <div> Chat </div>            ← 형제
</div>
```

**변경 후 구조:**
```
<div className="flex flex-1 overflow-hidden">
  <aside> Sidebar </aside>

  <!-- 새로운 Wrapper -->
  <div className="flex flex-1 overflow-hidden rounded-[10px] bg-muted m-2">
    <div> Board </div>
    <div> Chat </div>
  </div>
</div>
```

### 수정해야 할 파일

| 파일 | 라인 | 변경 내용 |
|------|------|----------|
| [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) | 531-575 | Board와 Chat을 wrapper div로 감싸기 |
| [MultiTabChatPanel.tsx](frontend/pluto_duck_frontend/components/chat/MultiTabChatPanel.tsx) | 117 | `border-l` 제거 또는 유지 결정 |
| [globals.css](frontend/pluto_duck_frontend/app/globals.css) | - | 필요시 새 CSS 변수 추가 |

---

## Code References

### Main Layout
- [page.tsx:377](frontend/pluto_duck_frontend/app/page.tsx#L377) - 최상위 컨테이너
- [page.tsx:451](frontend/pluto_duck_frontend/app/page.tsx#L451) - 메인 컨텐츠 영역
- [page.tsx:531-543](frontend/pluto_duck_frontend/app/page.tsx#L531-L543) - Board 컨테이너
- [page.tsx:545-575](frontend/pluto_duck_frontend/app/page.tsx#L545-L575) - Chat 패널 컨테이너

### Sidebar
- [page.tsx:452-529](frontend/pluto_duck_frontend/app/page.tsx#L452-L529) - Left Sidebar

### Board Components
- [BoardsView.tsx:195](frontend/pluto_duck_frontend/components/boards/BoardsView.tsx#L195) - Board 뷰 컨테이너
- [BoardEditor.tsx:192](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx#L192) - Editor 컨테이너
- [BoardToolbar.tsx:71](frontend/pluto_duck_frontend/components/boards/BoardToolbar.tsx#L71) - Toolbar

### Chat Components
- [MultiTabChatPanel.tsx:117](frontend/pluto_duck_frontend/components/chat/MultiTabChatPanel.tsx#L117) - Chat 패널 메인 컨테이너
- [TabBar.tsx:58](frontend/pluto_duck_frontend/components/chat/TabBar.tsx#L58) - 탭 바
- [ChatPanel.tsx:470](frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx#L470) - 개별 채팅 패널

### Styling
- [globals.css:33](frontend/pluto_duck_frontend/app/globals.css#L33) - `--radius` 변수
- [tailwind.config.js:11-14](frontend/pluto_duck_frontend/tailwind.config.js#L11-L14) - borderRadius 설정

---

## Architecture Insights

1. **3-Column Layout**: Sidebar | Board | Chat 구조로 flexbox 기반
2. **반응형 디자인**: `hidden lg:flex`로 데스크톱에서만 sidebar/chat 표시
3. **동적 리사이징**: Chat 패널 너비 마우스 드래그로 조절 (300-800px)
4. **토글 상태**: `chatPanelCollapsed` state로 채팅 패널 표시/숨김
5. **CSS 변수 시스템**: Tailwind + CSS custom properties로 일관된 테마

---

## Open Questions

1. Wrapper div 추가 시 리사이즈 핸들 위치 조정 필요 여부?
2. 모바일 뷰에서 rounded 컨테이너 처리 방법?
3. 새 컨테이너의 margin/padding 값 조정 필요 여부?
