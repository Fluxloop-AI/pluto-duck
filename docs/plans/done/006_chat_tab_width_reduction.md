# Chat Tab Width Reduction Implementation Plan

## Overview
채팅창 상단 탭바의 탭 너비가 너무 넓어서 제목이 길게 표시되는 문제를 해결하기 위해 탭의 최대 너비를 200px에서 150px로 줄입니다.

## Current State Analysis
- **현재 탭 최대 너비**: `max-w-[200px]` (TabBar.tsx:64)
- **제목 생성 방식**: 첫 메시지에서 30자를 잘라서 사용
- **문제점**: 탭이 너무 넓어서 여러 탭이 열렸을 때 공간을 많이 차지함

## Desired End State
- 탭 최대 너비가 150px로 줄어들어 더 컴팩트한 UI 제공
- 제목이 길 경우 자연스럽게 truncate 처리됨
- 기존 기능(탭 클릭, 닫기, 호버 효과 등)은 그대로 유지

## What We're NOT Doing
- 제목 생성 로직(30자 제한) 변경하지 않음
- 탭 디자인/스타일 전체 리디자인하지 않음
- 탭바의 다른 요소(+버튼, 히스토리 버튼) 변경하지 않음

## Implementation Approach
TabBar 컴포넌트에서 탭의 max-width CSS 클래스만 변경하는 단순한 수정입니다.

## - [x] Phase 1: Tab Width Adjustment

### Overview
TabBar 컴포넌트의 탭 최대 너비를 200px에서 150px로 변경합니다.

### Changes Required:

#### 1. TabBar Component
**File**: `frontend/pluto_duck_frontend/components/chat/TabBar.tsx`
**Changes**: Line 64의 `max-w-[200px]`를 `max-w-[150px]`로 변경

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 타입 체크 통과
- [ ] 빌드 성공

#### Manual Verification:
- [ ] 탭이 더 좁게 표시됨
- [ ] 긴 제목이 truncate(...) 처리됨
- [ ] 여러 탭 열었을 때 가로 공간을 덜 차지함
- [ ] 탭 클릭, 닫기 버튼 등 기존 기능 정상 동작

---

## Testing Strategy

### Manual Testing Steps:
1. 앱 실행 후 새 채팅 탭 생성
2. 긴 질문 입력하여 긴 제목 생성
3. 탭 너비가 150px 이하로 제한되는지 확인
4. 여러 탭 열어서 가로 스크롤/공간 확인
5. 탭 클릭, 닫기 버튼 동작 확인

## Performance Considerations
- 성능에 영향 없음 (CSS 클래스 값만 변경)

## References
- `frontend/pluto_duck_frontend/components/chat/TabBar.tsx` - 탭바 컴포넌트
- `frontend/pluto_duck_frontend/hooks/useMultiTabChat.ts` - 탭 상태 관리 훅
