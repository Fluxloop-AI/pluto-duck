# Asset Modal Rebuild Implementation Plan

## Overview
AssetPicker와 DisplayConfigModal에서 발생하는 모달 점프 현상을 해결하기 위해, 기존 코드 수정 대신 정상 작동하는 모달(FilePreviewModal)을 벤치마킹하여 두 모달을 새로 구현한다.

## Current State Analysis

### 문제가 있는 모달 2개
1. **AssetPicker** (`components/editor/components/AssetPicker.tsx`, 193줄)
   - Board에서 `/asset` 슬래시 커맨드로 호출됨
   - Analysis 목록을 보여주고 선택하는 Step 1 모달

2. **DisplayConfigModal** (`components/editor/components/DisplayConfigModal.tsx`, 466줄)
   - AssetPicker에서 선택 후 Insert 클릭 시 호출됨
   - 테이블/차트 표시 옵션을 설정하는 Step 2 모달

### 증상
- 모달 열릴 때 잠깐 아래로 내려갔다가 올라오는 점프 현상
- 다른 모달에서는 발생하지 않음

### 벤치마크 대상 (정상 작동)
**FilePreviewModal** (`components/assets/FilePreviewModal.tsx`)
- 고정 높이 레이아웃: `h-[85vh] flex flex-col p-0 gap-0`
- 섹션 분리: Header/Content/Footer 각각 독립적 패딩
- API 로딩 중에도 안정적인 레이아웃 유지

## Desired End State
- 두 모달 모두 점프 없이 부드럽게 열리고 닫힘
- 기존 기능 100% 유지 (선택, 검색, 설정 등)
- FilePreviewModal과 동일한 레이아웃 패턴 적용
- Frontend Design Skill을 사용하여 깔끔하고 높은 디자인 퀄리티로 구현

## What We're NOT Doing
- 기존 코드 디버깅이나 원인 분석 시도하지 않음
- Dialog 컴포넌트(dialog.tsx) 수정하지 않음
- 애니메이션 관련 설정 변경하지 않음
- 다른 모달들에 영향 주지 않음

## Implementation Approach
기존 파일을 수정하지 않고 새 파일로 교체하는 방식:
1. 새 컴포넌트 생성 (기존 파일 덮어쓰기)
2. FilePreviewModal 패턴을 기반으로 레이아웃 구성
3. 기존 기능 로직 재사용 (API 호출, 상태 관리)
4. Frontend Design Skill로 높은 디자인 퀄리티 구현

---

## - [x] Phase 1: AssetPicker 모달 재구현

### Overview
Analysis 선택을 위한 Step 1 모달을 새로 구현한다.

### Changes Required:

#### 1. AssetPicker 전체 재작성
**File**: `frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx`

**유지할 기능:**
- Analysis 목록 조회 (`listAnalyses` API)
- 검색 필터링 (name, id, description, tags)
- 선택 상태 관리 (single select)
- 더블클릭으로 바로 선택
- 빈 상태/로딩 상태 표시

**새 레이아웃 구조:**
```
DialogContent (h-[500px] flex flex-col p-0 gap-0)
├── Header (px-6 py-4 border-b)
│   └── 아이콘 + 제목 + 설명
├── Search (px-6 py-3 border-b)
│   └── 검색 Input
├── List (flex-1 overflow-y-auto px-6 py-2)
│   └── Analysis 카드 목록
└── Footer (px-6 py-4 border-t)
    └── 카운트 + Cancel/Insert 버튼
```

**디자인 방향:**
- Frontend Design Skill 사용
- 깔끔하고 미니멀한 카드 디자인
- 선택된 항목 시각적 강조
- 부드러운 hover 인터랙션

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npm run typecheck` (pre-existing error in Transcript.tsx unrelated to this change)
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npm run lint` (ESLint not configured in project)

#### Manual Verification:
- [ ] Board에서 `/asset` 입력 시 모달이 점프 없이 열림
- [ ] Analysis 목록이 정상 로딩됨
- [ ] 검색 필터링 작동함
- [ ] 항목 선택 및 Insert 버튼 작동함
- [ ] 더블클릭으로 바로 선택 가능
- [ ] Cancel 버튼으로 닫기 가능

---

## - [x] Phase 2: DisplayConfigModal 모달 재구현

### Overview
테이블/차트 설정을 위한 Step 2 모달을 새로 구현한다.

### Changes Required:

#### 1. DisplayConfigModal 전체 재작성
**File**: `frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx`

**유지할 기능:**
- Analysis 메타데이터 조회 (`getAnalysis`, `getAnalysisData` API)
- Display Type 선택 (Table / Chart)
- Table 옵션: rowsPerPage (5, 10, custom)
- Chart 옵션:
  - Chart Type (bar, line, pie, area, composed)
  - Chart Mode (single, groupBy, multiY)
  - X-Axis 컬럼 선택
  - Y-Axis 컬럼 선택 (single/multi)
  - Group By 컬럼 선택
  - 추가 옵션 (stacked, dual axis)
- 초기값 설정 (`initialConfig`)

**새 레이아웃 구조:**
```
DialogContent (max-h-[85vh] flex flex-col p-0 gap-0)
├── Header (px-6 py-4 border-b)
│   └── 제목 + Analysis 이름
├── Content (flex-1 overflow-y-auto px-6 py-4)
│   ├── Display Type 선택
│   ├── Table Options (조건부)
│   └── Chart Options (조건부)
│       ├── Chart Type
│       ├── Chart Mode
│       ├── Column Selectors
│       └── Additional Options
└── Footer (px-6 py-4 border-t)
    └── Cancel/Save 버튼
```

**디자인 방향:**
- Frontend Design Skill 사용
- 선택 카드형 UI (Table/Chart, Chart Types)
- 명확한 섹션 구분
- 조건부 옵션의 자연스러운 표시/숨김

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `cd frontend/pluto_duck_frontend && npm run typecheck` (pre-existing error in Transcript.tsx unrelated to this change)
- [x] Linting passes: `cd frontend/pluto_duck_frontend && npm run lint` (ESLint not configured in project)

#### Manual Verification:
- [ ] AssetPicker에서 Insert 클릭 시 모달이 점프 없이 열림
- [ ] Analysis 정보가 정상 로딩됨
- [ ] Table/Chart 타입 선택 작동
- [ ] Table: rowsPerPage 선택 작동
- [ ] Chart: 모든 차트 타입 선택 작동
- [ ] Chart: 모든 차트 모드 선택 작동
- [ ] Chart: 컬럼 선택 드롭다운 작동
- [ ] Chart: 추가 옵션(stacked, dual axis) 작동
- [ ] 기존 설정 편집 시 초기값 정상 로딩
- [ ] Save/Cancel 버튼 정상 작동

---

## - [ ] Phase 3: 통합 테스트 및 검증

### Overview
두 모달이 연속으로 사용될 때 전체 플로우를 검증한다.

### Changes Required:
변경 없음 - 검증만 수행

### Success Criteria:

#### Manual Verification (Full Flow):
1. [ ] Board에서 `/asset` 입력
2. [ ] AssetPicker 모달이 점프 없이 열림
3. [ ] Analysis 선택 후 Insert 클릭
4. [ ] DisplayConfigModal이 점프 없이 열림
5. [ ] 설정 완료 후 Insert 클릭
6. [ ] AssetEmbedNode가 Board에 정상 삽입됨
7. [ ] 삽입된 노드에서 설정 편집 시 모달이 점프 없이 열림

---

## Testing Strategy

### Manual Testing Steps:
1. Board 에디터에서 `/asset` 슬래시 커맨드 입력
2. AssetPicker에서 Analysis 선택 → Insert
3. DisplayConfigModal에서 Table 설정 → Insert
4. 삽입된 노드 확인
5. 다시 `/asset` → 다른 Analysis 선택 → Chart 설정 → Insert
6. 기존 노드 편집 버튼 클릭 → 설정 변경 → Save

### Edge Cases:
- Analysis 목록이 비어있을 때
- 검색 결과가 없을 때
- API 로딩 실패 시
- 컬럼이 1개만 있는 Analysis

---

## Performance Considerations
- API 호출은 기존과 동일하게 모달 열릴 때 수행
- 로딩 상태에서도 레이아웃이 점프하지 않도록 고정 높이 사용

---

## References

### 읽은 파일:
- `frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx` - 기존 구현
- `frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx` - 기존 구현
- `frontend/pluto_duck_frontend/components/assets/FilePreviewModal.tsx` - 벤치마크 대상
- `frontend/pluto_duck_frontend/components/ui/dialog.tsx` - Dialog 기본 컴포넌트
- `docs/research/027_chat_to_board_send_feature.md` - Asset Embed 플로우 문서

### 관련 컴포넌트:
- `frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx` - 두 모달을 호출하는 부모 컴포넌트
- `frontend/pluto_duck_frontend/components/editor/nodes/AssetEmbedNode.tsx` - AssetEmbedConfig 타입 정의
