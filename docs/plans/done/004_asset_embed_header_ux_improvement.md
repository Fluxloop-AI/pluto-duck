# Asset Embed 헤더 UX 개선 구현 계획

## Overview
AssetEmbedComponent의 헤더 UX를 개선하여 항상 표시되도록 하고, 더보기 메뉴를 통해 삭제/복제/숨기기 기능을 통합한다.

## Current State Analysis
- 헤더가 호버/선택 시에만 표시됨 → 오브젝트 높이가 변해서 사용성 저하
- **핵심 문제**: `showUI ? 'opacity-100' : 'opacity-0 h-0 py-0'` 조건으로 인해 호버할 때마다 height가 변동
- 설정 버튼: `Settings` 아이콘 (톱니바퀴)
- 삭제 버튼: `X` 아이콘으로 직접 노출
- 추가 메뉴 없음

**관련 파일:**
- [AssetEmbedComponent.tsx](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx) - 메인 컴포넌트
- [AssetEmbedNode.tsx](frontend/pluto_duck_frontend/components/editor/nodes/AssetEmbedNode.tsx) - config 타입 정의

## Desired End State
1. 헤더가 항상 표시됨 (호버 없이도)
2. 설정 아이콘: `Table2` (lucide)
3. X 버튼 → `Ellipsis` (더보기) 버튼으로 교체
4. 더보기 메뉴:
   - 삭제
   - 복제
   - 외곽선 숨기기 (토글)
   - 헤더 숨기기 (토글)

## What We're NOT Doing
- Config 모달 UI 변경
- 차트/테이블 뷰 자체의 변경
- 새로운 저장 로직 추가 (기존 config update 로직 활용)

## Implementation Approach
기존 AssetEmbedConfig 타입을 확장하여 `hideBorder`, `hideHeader` 옵션을 추가하고, 헤더 렌더링 로직과 더보기 드롭다운 메뉴를 구현한다.

---

## - [x] Phase 1: Config 타입 확장

### Overview
AssetEmbedConfig에 새로운 display 옵션 추가

### Changes Required:

#### 1. AssetEmbedNode.tsx
**File**: `frontend/pluto_duck_frontend/components/editor/nodes/AssetEmbedNode.tsx`

`AssetEmbedConfig` 인터페이스에 다음 속성 추가:
- `hideBorder?: boolean` - 외곽선 숨김 여부
- `hideHeader?: boolean` - 헤더 숨김 여부

### Success Criteria:
- [x] TypeScript 컴파일 에러 없음
- [x] 기존 config와 호환성 유지 (optional 필드)

---

## - [x] Phase 2: 헤더 항상 표시 + 아이콘 변경

### Overview
헤더를 항상 표시하도록 변경하고 아이콘을 교체

### Changes Required:

#### 1. AssetEmbedComponent.tsx - import 변경
**File**: `frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx`

import 문 변경:
- `Settings` → `Table2`
- `X` → `Ellipsis`
- `DropdownMenu` 관련 컴포넌트 추가 import

#### 2. AssetEmbedComponent.tsx - 헤더 visibility 로직 (핵심 수정)
**File**: `frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx`

**호버 기반 height 변동 완전 제거:**

현재 문제 코드 (line 542-545):
```jsx
className={`... ${
  showUI ? 'opacity-100 border-border/40' : 'opacity-0 h-0 py-0 border-transparent overflow-hidden'
}`}
```

수정 방향:
- `h-0 py-0` 조건 **완전 제거** → 헤더 height 항상 고정
- `showUI` 변수 자체를 헤더 표시 조건으로 사용하지 않음
- `config.hideHeader`가 true일 때만 헤더 숨김 (사용자 명시적 선택)

#### 3. AssetEmbedComponent.tsx - 아이콘 교체
- Settings 버튼의 `<Settings />` → `<Table2 />`
- title 속성 "Settings" 유지

### Success Criteria:
- [x] **헤더가 호버 없이도 항상 표시됨**
- [x] **호버 시 컴포넌트 height가 변하지 않음** (핵심!)
- [x] `hideHeader: true`일 때만 헤더 숨김
- [x] Table2 아이콘으로 설정 버튼 표시

---

## - [x] Phase 3: 더보기 드롭다운 메뉴 구현

### Overview
X 버튼을 더보기(Ellipsis) 버튼으로 교체하고 드롭다운 메뉴 구현

### Changes Required:

#### 1. AssetEmbedComponent.tsx - 더보기 메뉴 구현
**File**: `frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx`

기존 X 버튼을 DropdownMenu로 교체:
- Trigger: Ellipsis 아이콘 버튼
- Menu Items:
  1. **삭제** - `Trash2` 아이콘, 기존 `handleDelete` 호출, 빨간색 텍스트
  2. **복제** - `Copy` 아이콘, 새 `handleDuplicate` 함수 호출
  3. Separator
  4. **외곽선 숨기기** - `Square` 아이콘, 체크박스 형태 토글
  5. **헤더 숨기기** - `PanelTop` 아이콘, 체크박스 형태 토글

#### 2. AssetEmbedComponent.tsx - handleDuplicate 함수 추가
복제 핸들러 구현:
- `$getNodeByKey`로 현재 노드 가져오기
- 노드의 `analysisId`, `projectId`, `config` 복사
- `$createAssetEmbedNode`로 새 노드 생성
- 현재 노드 뒤에 삽입 (`insertAfter`)

#### 3. AssetEmbedComponent.tsx - 토글 핸들러 추가
`handleToggleConfig` 함수:
- `hideBorder` 또는 `hideHeader` 토글
- 기존 `handleConfigUpdate` 활용

### Success Criteria:
- [x] Ellipsis 버튼 클릭 시 드롭다운 메뉴 표시
- [x] 삭제 클릭 시 노드 삭제
- [x] 복제 클릭 시 동일한 asset embed가 바로 아래에 생성
- [x] 외곽선/헤더 숨기기 토글 동작

---

## - [x] Phase 4: 외곽선/헤더 숨김 스타일 적용

### Overview
config 값에 따라 외곽선과 헤더 숨김 스타일 적용

### Changes Required:

#### 1. AssetEmbedComponent.tsx - 컨테이너 border 조건부 스타일
**File**: `frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx`

컨테이너 div의 border 클래스:
- `config.hideBorder`가 true면 `border-transparent` 적용
- 선택 상태(`isSelected`)일 때는 여전히 파란색 border 표시 (UX를 위해)

#### 2. AssetEmbedComponent.tsx - 헤더 조건부 렌더링
헤더 div:
- `config.hideHeader`가 true면 렌더링하지 않음 (height 변경 OK - 사용자 명시적 선택)
- 단, 호버 또는 선택 시에는 일시적으로 표시 (재설정 가능하도록)

**중요**: 호버 기반 height 변동 vs 사용자 설정 구분
| 상황 | Height 변동 | 허용 여부 |
|------|-------------|-----------|
| 호버 시 show/hide | 매번 변동 | ❌ 제거 |
| 메뉴에서 "헤더 숨기기" 선택 | 1회성 변동 | ✅ 허용 |

### Success Criteria:
- [x] `hideBorder: true` 시 외곽선 숨김
- [x] `hideHeader: true` 시 헤더 숨김
- [x] 선택 상태에서는 여전히 시각적 피드백 제공

---

## Testing Strategy

### Manual Testing Steps:
1. Asset Embed 컴포넌트가 있는 보드/문서 열기
2. 헤더가 항상 표시되는지 확인
3. **호버 in/out 반복 시 컴포넌트 height가 변하지 않는지 확인** (핵심!)
4. Table2 아이콘 표시 확인
4. Ellipsis 버튼 클릭 → 드롭다운 메뉴 표시 확인
5. 삭제 메뉴 클릭 → 노드 삭제 확인
6. 복제 메뉴 클릭 → 동일 노드 복제 확인
7. 외곽선 숨기기 토글 → 외곽선 on/off 확인
8. 헤더 숨기기 토글 → 헤더 on/off 확인
9. 페이지 새로고침 후 설정 유지 확인

### Edge Cases:
- 이미 `hideHeader: true`인 상태에서 다시 설정 변경 가능한지
- 복제된 노드가 독립적으로 동작하는지
- 로딩/에러 상태에서도 더보기 메뉴 동작하는지

---

## References
- [AssetEmbedComponent.tsx](frontend/pluto_duck_frontend/components/editor/components/AssetEmbedComponent.tsx) - 현재 구현
- [dropdown-menu.tsx](frontend/pluto_duck_frontend/components/ui/dropdown-menu.tsx) - DropdownMenu 컴포넌트
- [docs/research/022_board_asset_hover_header_logic.md](docs/research/022_board_asset_hover_header_logic.md) - 리서치 문서
- Lucide React Icons: `Table2`, `Ellipsis`, `Trash2`, `Copy`, `Square`, `PanelTop`
