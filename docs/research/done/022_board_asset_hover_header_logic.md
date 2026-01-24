---
date: 2026-01-15T00:00:00+09:00
researcher: Claude
topic: "Board Asset Hover Header 표시 로직 분석"
tags: [research, codebase, board, asset, hover, header, lexical]
status: complete
---

# Research: Board Asset Hover Header 표시 로직 분석

## Research Question
보드 내에 asset을 넣었을 때, asset이 삽입되면 header가 호버 시에만 나오는데 그 부분에 대한 로직과 구현 상황을 파악

## Summary

보드 내 삽입된 Asset의 header는 **hover, selection, loading, error 상태** 중 하나일 때만 표시됩니다. 이 로직은 `AssetEmbedComponent.tsx`에서 구현되어 있으며, `isHovered` 상태와 `showUI` 계산값을 통해 제어됩니다.

핵심 구현:
- **상태 관리**: `useState(false)`로 `isHovered` 상태 관리
- **이벤트 핸들러**: `onMouseEnter`/`onMouseLeave`로 호버 상태 토글
- **표시 조건**: `showUI = isHovered || isSelected || isLoading || !!error`
- **CSS 트랜지션**: opacity와 height 조합으로 부드러운 표시/숨김 애니메이션

## Detailed Findings

### 1. 핵심 컴포넌트: AssetEmbedComponent

**파일**: `frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx`

Board 에디터 내에 삽입된 Asset을 렌더링하는 메인 컴포넌트입니다.

#### 1.1 Hover 상태 관리 (Line 208)

```typescript
const [isHovered, setIsHovered] = useState(false);
```

- 컴포넌트 마운트 시 `false`로 초기화
- 마우스가 컴포넌트 영역에 진입/이탈할 때 토글

#### 1.2 UI 표시 조건 계산 (Line 408)

```typescript
const showUI = isHovered || isSelected || isLoading || !!error;
```

Header가 표시되는 4가지 조건:
| 조건 | 설명 |
|------|------|
| `isHovered` | 마우스가 컴포넌트 위에 있을 때 |
| `isSelected` | Lexical 에디터에서 노드가 선택되었을 때 |
| `isLoading` | 데이터 로딩 중일 때 |
| `!!error` | 에러가 발생했을 때 |

#### 1.3 마우스 이벤트 핸들러 (Lines 538-539)

```tsx
<div
  ref={containerRef}
  onMouseEnter={() => setIsHovered(true)}
  onMouseLeave={() => setIsHovered(false)}
>
```

컨테이너 `div`에 직접 마우스 이벤트를 바인딩하여 호버 상태를 관리합니다.

### 2. Header 렌더링 로직

#### 2.1 Header 컨테이너 (Lines 541-593)

```tsx
{/* Header - Only visible on hover/select */}
<div
  className={`flex items-center justify-between px-3 py-1.5 border-b bg-muted/20 transition-all duration-200 ${
    showUI ? 'opacity-100 border-border/40' : 'opacity-0 h-0 py-0 border-transparent overflow-hidden'
  }`}
>
```

**표시 상태 (`showUI === true`):**
- `opacity-100`: 완전 불투명
- `border-border/40`: 하단 border 표시

**숨김 상태 (`showUI === false`):**
- `opacity-0`: 완전 투명
- `h-0`: 높이 0으로 축소
- `py-0`: padding 제거
- `border-transparent`: border 투명
- `overflow-hidden`: 컨텐츠 숨김

#### 2.2 Header 컨텐츠 구성

| 요소 | 위치 | 설명 |
|------|------|------|
| Display Type Icon | 좌측 | 📋(테이블) 또는 📊(차트) |
| Asset Name | 좌측 | analysis.name 또는 analysisId |
| Stale Badge | 좌측 | freshness.is_stale일 때 노란색 배지 표시 |
| Retry Badge | 좌측 | isRetrying일 때 파란색 배지 표시 |
| Refresh Button | 우측 | 데이터 새로고침 버튼 |
| Settings Button | 우측 | 설정 모달 열기 |
| Delete Button | 우측 | Asset 삭제 |

### 3. 컨테이너 Border 스타일링 (Lines 530-536)

```tsx
className={`asset-embed-container rounded-md overflow-hidden bg-card transition-all duration-200 ${
  showUI
    ? isSelected
      ? 'border border-blue-500 ring-2 ring-blue-500/30'  // 선택됨: 파란색 border + ring
      : 'border border-border/60'                          // 호버만: 기본 border
    : 'border border-transparent'                          // 기본: 투명 border
}`}
```

| 상태 | 스타일 |
|------|--------|
| 기본 | 투명 border |
| 호버 (선택 안됨) | `border-border/60` |
| 선택됨 | 파란색 border + ring 효과 |

### 4. Selection 상태 관리

**Lexical 훅 사용 (Line 205):**
```typescript
const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
```

**클릭 이벤트 핸들링 (Lines 250-269):**
```typescript
editor.registerCommand(
  CLICK_COMMAND,
  (event: MouseEvent) => {
    if (containerRef.current?.contains(event.target as Node)) {
      if (!event.shiftKey) {
        clearSelection();
      }
      setSelected(true);
      return true;
    }
    return false;
  },
  COMMAND_PRIORITY_LOW
),
```

- 컴포넌트 내부 클릭 시 선택 상태 활성화
- Shift 키 없이 클릭 시 기존 선택 해제 후 현재 노드 선택

### 5. 애니메이션 효과

모든 상태 전환에 `transition-all duration-200` 적용:
- 200ms 동안 부드러운 전환
- opacity, height, padding, border 모두 애니메이션됨

## Code References

- [AssetEmbedComponent.tsx:208](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx#L208) - `isHovered` 상태 선언
- [AssetEmbedComponent.tsx:408](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx#L408) - `showUI` 계산 로직
- [AssetEmbedComponent.tsx:538-539](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx#L538-L539) - 마우스 이벤트 핸들러
- [AssetEmbedComponent.tsx:541-593](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx#L541-L593) - Header 렌더링
- [AssetEmbedComponent.tsx:530-536](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx#L530-L536) - 컨테이너 border 스타일링
- [AssetEmbedComponent.tsx:205](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx#L205) - Lexical selection 훅

## Architecture Insights

### 패턴 분석

1. **상태 기반 UI 제어**
   - React의 `useState`와 CSS 클래스 조합으로 표시/숨김 제어
   - 여러 조건(hover, selection, loading, error)을 OR 연산으로 통합

2. **CSS 기반 애니메이션**
   - JavaScript 애니메이션 대신 CSS `transition` 사용으로 성능 최적화
   - `opacity + height + overflow` 조합으로 완전한 숨김 효과

3. **Lexical 통합**
   - `useLexicalNodeSelection` 훅으로 에디터 선택 상태와 동기화
   - 에디터 명령 시스템을 통한 클릭/삭제 이벤트 처리

4. **일관된 UX 패턴**
   - 다른 컴포넌트(AssetCard, TableCard 등)에서도 동일한 `group-hover:opacity-100` 패턴 사용
   - 프로젝트 전체에서 hover 시 액션 버튼 표시하는 일관된 UX

### 유사 패턴 사용 컴포넌트

| 컴포넌트 | 파일 | 패턴 |
|----------|------|------|
| AssetCard | `components/assets/AssetCard.tsx:93` | `group-hover:opacity-100` |
| FileAssetCard | `components/assets/FileAssetCard.tsx:76` | `group-hover:opacity-100` |
| TableCard | `components/assets/TableCard.tsx:120` | `group-hover:opacity-100` |
| BoardList | `components/boards/BoardList.tsx:148` | `group-hover:opacity-100` |
| BoardToolbar | `components/boards/BoardToolbar.tsx:112` | `group-hover:opacity-100` |

## Open Questions

1. **접근성(a11y)**: 키보드 포커스 시에도 header가 표시되어야 하는지 검토 필요
2. **터치 디바이스**: hover가 없는 터치 환경에서의 UX 개선 필요 여부
3. **성능**: 많은 Asset이 삽입된 경우 각각의 hover 상태 관리가 성능에 미치는 영향
