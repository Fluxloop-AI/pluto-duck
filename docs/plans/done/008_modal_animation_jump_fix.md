# Modal Animation Jump Fix Implementation Plan

## Overview
모달이 열릴 때 아래에서 위로 점프하는 현상을 수정한다. slide 애니메이션을 제거하고, duration과 zoom 값을 조정하여 부드러운 전환 효과를 구현한다.

## Current State Analysis

**문제 파일**: [dialog.tsx:41](frontend/pluto_duck_frontend/components/ui/dialog.tsx#L41)

**현재 애니메이션 클래스:**
- `duration-200` - 200ms 애니메이션 (너무 짧아 끊기는 느낌)
- `zoom-in-95` / `zoom-out-95` - 95%에서 시작 (변화가 눈에 띔)
- `slide-in-from-left-1/2` + `slide-in-from-top-1/2` - 슬라이드 효과 (점프 원인)
- `fade-in-0` / `fade-out-0` - 페이드 효과 (유지)

**문제 현상:**
슬라이드 애니메이션이 `translate-x/y` 센터링과 함께 작동하면서, 모달이 제자리가 아닌 위치에서 시작해 이동하는 "점프" 현상 발생.

## Desired End State

- 모달이 화면 중앙에서 fade + 미세한 zoom으로 자연스럽게 나타남
- 점프 현상 완전 제거
- 부드럽고 세련된 전환 애니메이션

## What We're NOT Doing

- X 버튼 하드코딩 문제 수정 (별도 태스크)
- 모달 크기 표준화 (별도 태스크)
- 모달별 개별 애니메이션 커스터마이징

## Implementation Approach

dialog.tsx의 DialogContent 컴포넌트에서 애니메이션 관련 Tailwind 클래스만 수정. 단일 파일 변경으로 모든 Dialog 기반 모달에 일괄 적용.

## - [x] Phase 1: Animation Class Modification

### Overview
slide 애니메이션을 제거하고 duration/zoom 값을 조정하여 점프 현상을 해결한다.

### Changes Required:

#### 1. DialogContent Animation Classes
**File**: [dialog.tsx:41](frontend/pluto_duck_frontend/components/ui/dialog.tsx#L41)

**변경 내용:**

| 항목 | Before | After |
|------|--------|-------|
| Duration | `duration-200` | `duration-300` |
| Zoom In | `zoom-in-95` | `zoom-in-98` |
| Zoom Out | `zoom-out-95` | `zoom-out-98` |
| Slide In | `slide-in-from-left-1/2 slide-in-from-top-1/2` | (제거) |
| Slide Out | `slide-out-to-left-1/2 slide-out-to-top-1/2` | (제거) |

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `cd frontend/pluto_duck_frontend && npm run typecheck`
- [ ] Linting passes: `cd frontend/pluto_duck_frontend && npm run lint`

#### Manual Verification:
- [ ] AssetPicker 모달 열 때 점프 현상 없음
- [ ] 모달이 화면 중앙에서 부드럽게 fade-in + 미세 zoom
- [ ] 모달 닫힐 때도 부드럽게 fade-out
- [ ] 다른 모달들 (Settings, DataSources 등)도 동일하게 개선됨

---

## Testing Strategy

### Manual Testing Steps:
1. **AssetPicker 모달**: 보드에서 `/asset` 또는 asset 추가 버튼 클릭 → 점프 없이 부드럽게 열리는지 확인
2. **DisplayConfigModal**: AssetPicker에서 Insert 클릭 → 두 번째 모달도 점프 없이 부드럽게 열리는지 확인
3. 각 모달 닫기 → 부드럽게 닫히는지 확인
4. Settings 모달 테스트 → 동일하게 부드러운지 확인
5. DataSources 모달 테스트 → 동일하게 부드러운지 확인
6. 빠르게 열고 닫기 반복 → 애니메이션 안정성 확인

## Performance Considerations

- duration 100ms 증가 (200ms → 300ms)는 체감상 큰 차이 없음
- 애니메이션 복잡도 감소 (slide 제거)로 오히려 성능 향상 기대

## References
- [docs/research/025_modal_implementation_analysis.md](docs/research/025_modal_implementation_analysis.md) - 모달 분석 리서치
- [dialog.tsx](frontend/pluto_duck_frontend/components/ui/dialog.tsx) - 수정 대상 파일
- [AssetPicker.tsx](frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx) - Asset 선택 모달 (1번째)
- [DisplayConfigModal.tsx](frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx) - Display Config 모달 (2번째)
- [BoardEditor.tsx](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx) - 두 모달을 사용하는 부모 컴포넌트
