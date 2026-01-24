# Modal Slide Animation Jump Fix Implementation Plan

## Overview

AssetPicker와 DisplayConfigModal에서 관찰되는 모달 등장 시 아래에서 위로 점프하는 애니메이션 버그를 수정한다. 근본 원인은 `dialog.tsx`의 slide 애니메이션 클래스가 센터링 transform과 충돌하여 발생하는 것으로, slide 애니메이션을 제거하고 부드러운 fade+zoom으로 대체한다.

## Current State Analysis

### 영향받는 모달
| 모달 | 파일 | 용도 |
|------|------|------|
| AssetPicker | `components/editor/components/AssetPicker.tsx` | 보드에서 에셋 선택 (1단계) |
| DisplayConfigModal | `components/editor/components/DisplayConfigModal.tsx` | Insert 후 설정 (2단계) |

### 버그 원인
**파일**: `components/ui/dialog.tsx:41`

현재 애니메이션 클래스:
```
duration-200
data-[state=open]:zoom-in-95
data-[state=open]:slide-in-from-left-1/2
data-[state=open]:slide-in-from-top-1/2
data-[state=closed]:zoom-out-95
data-[state=closed]:slide-out-to-left-1/2
data-[state=closed]:slide-out-to-top-1/2
```

문제점:
1. **Transform 충돌**: `slide-in-from-*` 클래스가 센터링용 `translate-x-[-50%] translate-y-[-50%]`과 충돌
2. **시작 위치 오류**: 애니메이션 시작 시 모달이 의도하지 않은 위치에서 출발
3. **짧은 duration**: 200ms로 인해 끊기는 느낌
4. **과한 zoom**: 95% → 100% 변화가 시각적으로 거슬림

## Desired End State

- 모달이 제자리(화면 중앙)에서 부드럽게 fade-in + 미세한 zoom으로 등장
- 점프/튀어오르는 현상 완전 제거
- 자연스럽고 세련된 애니메이션 (300ms)
- 모든 Dialog 기반 모달에 일관되게 적용

### 검증 방법
1. 보드 에디터에서 `/asset` 명령 실행 → AssetPicker 모달 등장 시 점프 없음
2. AssetPicker에서 에셋 선택 후 Insert 클릭 → DisplayConfigModal 등장 시 점프 없음
3. 모달 닫힐 때도 부드러운 애니메이션 (fade-out + zoom)

## What We're NOT Doing

- 모달 크기 표준화 (별도 이슈)
- nested modal의 X버튼 중복 문제 (별도 이슈)
- 모달별 커스텀 애니메이션 (공통 Dialog로 통일)

## Implementation Approach

`dialog.tsx`의 `DialogContent` 컴포넌트에서 slide 애니메이션 클래스를 제거하고, duration과 zoom 값을 조정한다. 단일 파일 수정으로 모든 Dialog 기반 모달에 일괄 적용된다.

---

## - [x] Phase 1: Remove Slide Animation and Adjust Parameters

### Overview
DialogContent의 애니메이션 클래스를 수정하여 slide를 제거하고 부드러운 fade+zoom 애니메이션으로 변경한다.

### Changes Required:

#### 1. DialogContent Animation Classes
**File**: `frontend/pluto_duck_frontend/components/ui/dialog.tsx`

**Line 41의 className 수정:**

현재:
```
duration-200 ... zoom-in-95 ... slide-in-from-left-1/2 slide-in-from-top-1/2 ... zoom-out-95 ... slide-out-to-left-1/2 slide-out-to-top-1/2
```

변경:
```
duration-300 ... zoom-in-98 ... zoom-out-98
```

**상세 변경 사항:**
1. `duration-200` → `duration-300` (부드러운 전환)
2. `zoom-in-95` → `zoom-in-98` (미세한 확대만)
3. `zoom-out-95` → `zoom-out-98` (미세한 축소만)
4. `slide-in-from-left-1/2` 제거 (점프 원인)
5. `slide-in-from-top-1/2` 제거 (점프 원인)
6. `slide-out-to-left-1/2` 제거
7. `slide-out-to-top-1/2` 제거

### Success Criteria:

#### Manual Verification:
- [ ] 보드 에디터에서 `/asset` 입력 후 AssetPicker 모달이 점프 없이 부드럽게 등장
- [ ] AssetPicker에서 에셋 선택 후 Insert 클릭 시 DisplayConfigModal이 점프 없이 등장
- [ ] 모달 닫힐 때 부드러운 fade-out + 미세한 축소 애니메이션
- [ ] SettingsModal, DataSourcesModal 등 다른 모달도 동일하게 개선됨
- [ ] 애니메이션이 자연스럽고 끊기지 않음 (300ms duration)

#### Automated Verification:
- [ ] 빌드 성공: `npm run build`
- [ ] 타입 체크 통과: `npm run typecheck` (해당 시)

---

## Testing Strategy

### Manual Testing Steps:
1. 개발 서버 실행 (`npm run dev`)
2. 프로젝트 선택 후 보드 에디터 진입
3. 에디터에서 `/` 입력 후 "Asset" 선택
4. AssetPicker 모달 등장 애니메이션 확인 - 점프 없이 중앙에서 fade-in
5. 에셋 하나 선택 후 "Insert" 버튼 클릭
6. DisplayConfigModal 등장 애니메이션 확인 - 점프 없이 중앙에서 fade-in
7. "Cancel" 클릭하여 닫기 애니메이션 확인 - 부드러운 fade-out
8. Settings 모달 등 다른 모달도 동일한 애니메이션인지 확인

### Browser Testing:
- Chrome, Safari에서 애니메이션 동작 확인
- 다양한 화면 크기에서 모달 위치 및 애니메이션 확인

## Performance Considerations

- 애니메이션 duration 증가 (200ms → 300ms)로 인한 체감 속도 약간 감소
- 단, 300ms는 Material Design 권장 값으로 자연스러운 느낌 제공
- CSS transform 기반으로 GPU 가속, 성능 영향 없음

## References

- `frontend/pluto_duck_frontend/components/ui/dialog.tsx:32-54` - DialogContent 컴포넌트
- `frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx` - 1단계 에셋 선택 모달
- `frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx` - 2단계 설정 모달
- `frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx:247-276` - 두 모달의 사용처
- `docs/research/025_modal_implementation_analysis.md` - 기존 모달 분석 문서
- Radix UI Dialog 문서: https://www.radix-ui.com/primitives/docs/components/dialog
- Tailwind CSS Animate: https://github.com/jamiebuilds/tailwindcss-animate
