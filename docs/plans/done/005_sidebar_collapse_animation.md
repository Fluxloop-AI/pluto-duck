# Sidebar Collapse Animation Implementation Plan

## Overview
왼쪽 사이드바 접기/펼기 시 부드러운 슬라이딩 애니메이션(300ms)을 추가하고, 상태를 localStorage에 저장하며, 키보드 단축키(Cmd+B)를 지원한다.

## Current State Analysis

### 현재 구현 방식
- **파일:** `frontend/pluto_duck_frontend/app/page.tsx`
- **상태:** `useState(false)`로 `sidebarCollapsed` 관리 (line 55)
- **렌더링:** 조건부 렌더링 `{!sidebarCollapsed && <aside>...}` (line 435)
- **문제점:** DOM에서 완전히 제거되므로 CSS 트랜지션 불가능

### 기존 코드베이스 패턴
- **localStorage:** `pluto-duck-{feature}` 네이밍, `String(boolean)` 저장, SSR 안전 체크
- **키보드 단축키:** 글로벌 핸들러 없음 (컴포넌트별 개별 처리)
- **애니메이션:** Tailwind `transition-all duration-300` 패턴 사용

## Desired End State

1. 사이드바 토글 시 300ms 슬라이딩 애니메이션 적용
2. 접힘 상태가 페이지 새로고침 후에도 유지됨
3. `Cmd+B` (macOS) / `Ctrl+B` (Windows)로 토글 가능
4. 보드 영역이 사이드바 애니메이션과 동시에 부드럽게 확장/축소

### 검증 방법
- 토글 버튼 클릭 시 사이드바가 슬라이딩하며 접히고/펼쳐짐
- 새로고침 후 이전 상태 유지 확인
- 키보드 단축키로 토글 동작 확인

## What We're NOT Doing

- 오른쪽 채팅 패널 애니메이션 (on/off 느낌 유지)
- 모바일 사이드바 처리 (현재 `hidden lg:flex`로 숨김 상태 유지)
- 사이드바 너비 리사이즈 기능

## Implementation Approach

**CSS width 트랜지션 방식 채택:**
- 요소를 항상 DOM에 유지
- `width`를 `w-64`와 `w-0` 사이에서 애니메이션
- `overflow-hidden`으로 내부 콘텐츠 클리핑
- 내부에 고정 너비 wrapper 추가하여 콘텐츠 레이아웃 유지

---

## - [x] Phase 1: Left Sidebar Animation

### Overview
조건부 렌더링을 CSS width 트랜지션으로 변경하여 슬라이딩 애니메이션 구현

### Changes Required:

#### 1. 사이드바 렌더링 방식 변경
**File:** `frontend/pluto_duck_frontend/app/page.tsx`

**변경 내용:**
- 조건부 렌더링 `{!sidebarCollapsed && <aside>...}` 제거
- `<aside>`를 항상 렌더링하고 `className`으로 width 제어
- `sidebarCollapsed` 상태에 따라 `w-0` 또는 `w-64` 적용
- `overflow-hidden` 추가하여 접힐 때 내부 콘텐츠 클리핑
- 내부에 `w-64 min-w-64` wrapper 추가하여 콘텐츠 너비 고정
- 접힐 때 `border-r-0` 적용하여 border 제거

**적용 위치:** lines 435-522 (사이드바 전체)

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] 토글 버튼 클릭 시 사이드바가 300ms 동안 부드럽게 슬라이딩
- [ ] 접힐 때 내부 콘텐츠가 잘리며 사라짐 (깨지지 않음)
- [ ] 펼칠 때 내부 콘텐츠가 자연스럽게 나타남
- [ ] 보드 영역이 동시에 확장/축소됨

---

## - [x] Phase 2: localStorage Persistence

### Overview
사이드바 접힘 상태를 localStorage에 저장하여 새로고침 후에도 유지

### Changes Required:

#### 1. 상태 초기화 및 저장 로직 추가
**File:** `frontend/pluto_duck_frontend/app/page.tsx`

**변경 내용:**
- localStorage 키 상수 정의: `pluto-duck-sidebar-collapsed`
- `useEffect`로 컴포넌트 마운트 시 localStorage에서 초기값 로드
- SSR 안전을 위해 `typeof window !== 'undefined'` 체크
- 상태 변경 시 localStorage에 저장하는 핸들러 함수 작성
- 토글 버튼의 `onClick`에서 해당 핸들러 호출

**적용 위치:**
- line 55 근처 (상태 선언부)
- lines 379-389 (토글 버튼)

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] 사이드바를 접은 후 새로고침하면 접힌 상태 유지
- [ ] 사이드바를 펼친 후 새로고침하면 펼친 상태 유지
- [ ] 브라우저 개발자 도구에서 `pluto-duck-sidebar-collapsed` 키 확인 가능

---

## - [x] Phase 3: Keyboard Shortcut

### Overview
`Cmd+B` (macOS) / `Ctrl+B` (Windows) 단축키로 사이드바 토글 지원

### Changes Required:

#### 1. 글로벌 키보드 이벤트 핸들러 추가
**File:** `frontend/pluto_duck_frontend/app/page.tsx`

**변경 내용:**
- `useEffect`로 document에 `keydown` 이벤트 리스너 등록
- `metaKey` (macOS Cmd) 또는 `ctrlKey` (Windows Ctrl) + `b` 키 조합 감지
- 텍스트 입력 중일 때는 단축키 비활성화 (activeElement 체크)
- cleanup 함수로 이벤트 리스너 제거

**적용 위치:** line 55 근처 (다른 useEffect들과 함께)

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] `Cmd+B` (Mac) 또는 `Ctrl+B` (Windows)로 사이드바 토글 동작
- [ ] 텍스트 입력 필드에서 단축키가 기본 동작 (볼드 등) 유지
- [ ] 에디터 외부에서 단축키 정상 작동

---

## Testing Strategy

### Unit Tests:
- 이 변경은 UI 상호작용 위주이므로 별도 유닛 테스트 불필요

### Integration Tests:
- 기존 e2e 테스트가 있다면 사이드바 토글 시나리오 확인

### Manual Testing Steps:
1. 앱 실행 후 좌측 사이드바 토글 버튼 클릭
2. 애니메이션이 300ms 동안 부드럽게 동작하는지 확인
3. 접힌 상태에서 새로고침 후 상태 유지 확인
4. `Cmd+B` 단축키로 토글 동작 확인
5. 에디터 내에서 텍스트 선택 후 `Cmd+B` 시 볼드 동작 확인 (단축키 충돌 없음)

## Performance Considerations

- CSS 트랜지션은 GPU 가속 가능하여 성능 영향 미미
- localStorage 접근은 동기적이나 boolean 값 저장으로 무시 가능한 수준
- 키보드 이벤트 리스너는 document 레벨이나 조건 체크로 빠르게 반환

## Migration Notes

- 기존 사용자의 사이드바 상태가 저장되어 있지 않으므로 기본값 `false` (펼침)로 시작
- 별도 마이그레이션 불필요

## References

### Files Read During Planning
- `frontend/pluto_duck_frontend/app/page.tsx` - 현재 사이드바 구현
- `frontend/pluto_duck_frontend/hooks/useAutoUpdate.ts` - localStorage 패턴
- `frontend/pluto_duck_frontend/components/ai-elements/prompt-input.tsx` - 키보드 이벤트 패턴
- `frontend/pluto_duck_frontend/components/editor/components/ImageComponent.tsx` - Lexical 키보드 명령
- `docs/research/023_sidebar_collapse_animation.md` - 애니메이션 구현 방안 리서치

### External Resources
- Tailwind CSS Transition Utilities
- React useEffect cleanup pattern
