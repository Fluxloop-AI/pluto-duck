# File Analysis Modal UX Fix Implementation Plan

## Overview
Add Dataset 화면의 File Analysis 모달에서 두 가지 UX 이슈를 수정한다:
1. 아코디언이 기본으로 펼쳐져 있는 문제 → 기본 접힌 상태로 변경
2. 아코디언 펼침 시 스크롤이 안 되는 버그 수정

## Current State Analysis

### 파일 구조
- `DiagnosisResultView.tsx`: File Analysis 결과를 보여주는 컴포넌트
- `AddDatasetModal.tsx`: 부모 모달 컴포넌트 (고정 높이 580px)

### 현재 문제점

**문제 1: 기본 펼침 상태**
```typescript
// DiagnosisResultView.tsx:170
const [expandedIndex, setExpandedIndex] = useState<number>(0);
```
- `0`으로 초기화되어 첫 번째 카드가 기본으로 펼쳐짐
- 사용자가 모달 진입 시 바로 스크롤해야 하는 불편함 발생

**문제 2: 스크롤 버그**
```tsx
// DiagnosisResultView.tsx:237
<div className="flex-1 overflow-y-auto px-8 py-4 space-y-3">
```
- Flexbox 자식 요소에 `min-h-0`이 없음
- CSS Flexbox의 기본 동작: 자식 요소는 `min-height: auto`를 가짐
- 이로 인해 콘텐츠가 늘어나면 부모 높이를 초과해도 스크롤이 활성화되지 않음

## Desired End State

1. File Analysis 모달 진입 시 모든 아코디언이 접힌 상태로 표시
2. 아코디언을 펼쳐도 컨테이너 내에서 정상적으로 스크롤 가능
3. 여러 파일이 있을 때도 스크롤이 부드럽게 동작

## What We're NOT Doing

- 아코디언 애니메이션 추가/변경
- 다중 아코디언 동시 펼침 기능
- 기타 UI 스타일 변경

## Implementation Approach

두 이슈 모두 단순한 코드 변경으로 해결 가능하며, 단일 Phase로 구현한다.

---

## - [x] Phase 1: DiagnosisResultView 수정

### Overview
아코디언 기본 상태를 접힘으로 변경하고, 스크롤 컨테이너에 `min-h-0` 추가

### Changes Required:

#### 1. 아코디언 기본 상태 변경
**File**: `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx`
**Line**: 170

**변경 내용**: `expandedIndex` 초기값을 `0`에서 `-1`로 변경
- `-1`은 어떤 인덱스와도 매칭되지 않아 모든 카드가 접힌 상태가 됨

#### 2. 스크롤 컨테이너 수정
**File**: `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx`
**Line**: 237

**변경 내용**: 스크롤 컨테이너 div에 `min-h-0` 클래스 추가
- Flexbox 자식이 부모 높이 내에서 스크롤되도록 허용

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `npm run typecheck` (frontend 디렉토리에서)
- [x] Linting passes: `npm run lint` (frontend 디렉토리에서)
- [x] Build succeeds: `npm run build` (frontend 디렉토리에서)

#### Manual Verification:
- [ ] Add Dataset 모달에서 파일 업로드 후 Scan 클릭
- [ ] File Analysis 화면 진입 시 모든 아코디언이 접힌 상태인지 확인
- [ ] 아코디언 클릭 시 정상적으로 펼쳐지는지 확인
- [ ] 여러 파일 업로드 시 스크롤이 정상 동작하는지 확인
- [ ] 아코디언을 펼친 상태에서 스크롤이 정상 동작하는지 확인

---

## Testing Strategy

### Manual Testing Steps:
1. Add Dataset 모달 열기
2. 여러 개의 CSV/Parquet 파일 선택 (3개 이상 권장)
3. Scan 버튼 클릭
4. File Analysis 화면에서:
   - 모든 카드가 접힌 상태인지 확인
   - 카드 클릭하여 펼침/접힘 동작 확인
   - 스크롤 동작 확인
   - 카드를 펼친 상태에서 스크롤 동작 확인

## Performance Considerations
없음 - CSS 클래스 추가와 초기값 변경만으로 성능 영향 없음

## Migration Notes
해당 없음

## References
- `frontend/pluto_duck_frontend/components/data-sources/DiagnosisResultView.tsx` - 수정 대상 파일
- `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx` - 부모 모달 컴포넌트
- CSS Flexbox `min-height: 0` 패턴: https://css-tricks.com/flexbox-truncated-text/
