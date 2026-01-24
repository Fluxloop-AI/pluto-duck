# Sidebar Assets Menu Migration Implementation Plan

## Overview
사이드바 상단의 Boards/Assets 스위치 UI를 제거하고, Assets를 하단 Footer 영역(Settings 버튼 위)에 별도 버튼으로 이동. BoardList는 항상 표시되도록 변경.

## Current State Analysis

**현재 구조:**
```
┌─────────────────────────────┐
│ Header                      │
│ ProjectSelector + New Board │
├─────────────────────────────┤
│ Content (flex-1, scroll)    │
│ [Boards] [Assets] ← 스위치   │
│ BoardList / placeholder     │
├─────────────────────────────┤
│ Footer                      │
│ ⚙️ Settings                 │
└─────────────────────────────┘
```

**주요 파일:** [page.tsx](frontend/pluto_duck_frontend/app/page.tsx)
- Line 557-589: Boards/Assets 스위치 UI (제거 대상)
- Line 591-605: 조건부 콘텐츠 렌더링 (수정 대상)
- Line 608-617: Footer의 Settings 버튼 (Assets 버튼 추가 위치)

**기존 동작:**
- `mainView` state (`'boards' | 'assets'`)로 메인 패널 뷰 전환
- 스위치 클릭 시 `setMainView()` 호출
- 메인 패널에서 `BoardsView` 또는 `AssetListView` 조건부 렌더링

## Desired End State

**변경 후 구조:**
```
┌─────────────────────────────┐
│ Header                      │
│ ProjectSelector + New Board │
├─────────────────────────────┤
│ Content (flex-1, scroll)    │
│ BoardList (항상 표시)        │
├─────────────────────────────┤
│ Footer                      │
│ 📦 Assets  ← 새로 추가      │
│ ⚙️ Settings                 │
└─────────────────────────────┘
```

**검증 방법:**
1. 사이드바에서 Boards/Assets 스위치가 제거됨
2. BoardList가 항상 표시됨
3. Footer에 Assets 버튼이 Settings 위에 추가됨
4. Assets 버튼 클릭 시 메인 패널이 AssetListView로 전환됨
5. 기존 `assetInitialTab` 로직이 정상 동작함 (DataSourcesModal 등에서 호출 시)

## What We're NOT Doing

- `mainView` state 로직 변경 (기존 유지)
- 메인 패널의 조건부 렌더링 로직 변경 (기존 유지)
- Assets 버튼의 active 상태 표시 (불필요)
- 다른 컴포넌트에서의 `setMainView('assets')` 호출 로직 변경

## Implementation Approach

단일 파일(`page.tsx`)만 수정하는 간단한 UI 재배치 작업. 스위치 UI 제거 → BoardList 항상 표시 → Assets 버튼 추가 순서로 진행.

---

## - [x] Phase 1: Switch UI 제거 및 BoardList 항상 표시

### Overview
Boards/Assets 스위치 UI를 제거하고, BoardList가 항상 렌더링되도록 조건부 로직 수정.

### Changes Required:

#### 1. Switch UI 제거
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Lines**: 557-589
**Changes**:
- `{/* View Tabs */}` 주석부터 스위치 버튼들을 포함하는 전체 `<div className="relative mb-3 flex rounded-lg bg-card p-1">` 블록 삭제

#### 2. BoardList 조건부 렌더링 제거
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Lines**: 591-605
**Changes**:
- `{mainView === 'boards' && (` 조건 제거, BoardList가 항상 렌더링되도록 변경
- Assets 선택 시 표시되던 placeholder 텍스트 (`{mainView === 'assets' && ...}`) 블록 삭제

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npm run typecheck`
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npm run lint`
- [x] Build succeeds: `cd frontend/pluto_duck_frontend && npm run build`

#### Manual Verification:
- [ ] 사이드바에서 Boards/Assets 스위치가 사라짐
- [ ] BoardList가 항상 표시됨

---

## - [x] Phase 2: Assets 버튼 추가

### Overview
Footer 영역의 Settings 버튼 위에 Assets 버튼 추가.

### Changes Required:

#### 1. Assets 버튼 추가
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Lines**: 608 (Settings 버튼 위)
**Changes**:
- Settings 버튼과 동일한 스타일의 Assets 버튼 추가
- `Package` 아이콘 사용 (이미 import 되어 있음)
- `onClick={() => setMainView('assets')}` 핸들러 설정

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npm run typecheck`
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npm run lint`
- [x] Build succeeds: `cd frontend/pluto_duck_frontend && npm run build`

#### Manual Verification:
- [ ] Footer에 Assets 버튼이 Settings 위에 표시됨
- [ ] Assets 버튼 클릭 시 메인 패널이 AssetListView로 전환됨
- [ ] BoardList 항목 클릭 시 메인 패널이 BoardsView로 전환됨
- [ ] DataSourcesModal의 "Navigate to Assets" 기능이 정상 동작함

---

## Testing Strategy

### Manual Testing Steps:
1. 앱 실행 후 사이드바 확인 - 스위치 UI가 없어야 함
2. BoardList가 항상 표시되는지 확인
3. Assets 버튼 클릭 → 메인 패널이 AssetListView로 전환되는지 확인
4. BoardList에서 보드 선택 → 메인 패널이 BoardsView로 전환되는지 확인
5. DataSourcesModal에서 "Navigate to Assets" 클릭 → AssetListView의 datasources 탭으로 이동하는지 확인

## Performance Considerations
- 변경 없음 (UI 재배치만 수행)

## Migration Notes
- 해당 없음 (데이터 변경 없음)

## References
- [031_sidebar_structure_menu_migration.md](docs/research/031_sidebar_structure_menu_migration.md) - 사이드바 구조 분석 리서치
- [page.tsx:529-619](frontend/pluto_duck_frontend/app/page.tsx#L529-L619) - 사이드바 전체 구조
- [page.tsx:557-589](frontend/pluto_duck_frontend/app/page.tsx#L557-L589) - Boards/Assets 스위치 UI
- [page.tsx:608-617](frontend/pluto_duck_frontend/app/page.tsx#L608-L617) - Settings 버튼
