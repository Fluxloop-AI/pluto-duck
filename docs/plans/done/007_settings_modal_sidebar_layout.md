# Settings Modal Sidebar Layout Implementation Plan

## Overview
현재 단일 패널 스크롤 방식의 Settings 모달을 Notion 스타일의 좌측 sidebar 네비게이션 + 우측 콘텐츠 패널 레이아웃으로 개선한다. 추가로 모달 열림 시 위치 점프 현상(애니메이션 버그)도 수정한다.

## Current State Analysis

### 현재 SettingsModal 구조
- **파일**: `components/chat/SettingsModal.tsx` (752줄)
- **레이아웃**: 단일 패널, 세로 스크롤 (`max-h-[65vh]`)
- **크기**: `max-w-[500px]`
- **섹션**: Provider → API Key → Model → Local Models → Updates → Danger Zone

### 모달 애니메이션 문제
- **파일**: `components/ui/dialog.tsx:41`
- **문제**: `slide-in-from-top-[48%]` → `top-[50%]` 이동으로 2% 점프 발생
- **원인**: shadcn/ui 기본 템플릿의 의도적 값이지만 부자연스러움

## Desired End State

### 레이아웃
```
┌────────────────────────────────────────────────────────────────┐
│  Settings                                                   X  │
├──────────────────┬─────────────────────────────────────────────┤
│  Profile         │                                             │
│  Preferences     │  [선택된 메뉴의 콘텐츠]                      │
│  Notifications   │                                             │
│  ─────────────── │                                             │
│  Models          │                                             │
│  Updates         │                                             │
│  Data            │                                             │
│                  │                                             │
│                  │                                             │
│                  ├─────────────────────────────────────────────┤
│                  │                              [Cancel] [Save] │
└──────────────────┴─────────────────────────────────────────────┘
          200px                      ~500px
```

### 메뉴 구조
| 메뉴 | 내용 |
|------|------|
| Profile | Placeholder (추후 구현) |
| Preferences | Placeholder (추후 구현) |
| Notifications | Placeholder (추후 구현) |
| **Models** | API 섹션 (Provider, API Key) + Local Models 섹션 |
| **Updates** | Auto Updates 섹션 |
| **Data** | Danger Zone (Reset Database) |

### 검증 방법
1. Settings 버튼 클릭 시 모달이 점프 없이 부드럽게 열림
2. 좌측 sidebar에서 메뉴 클릭 시 우측 콘텐츠가 전환됨
3. Models → Save 시 정상 저장
4. Data → Reset Database 기능 정상 동작

## What We're NOT Doing
- Profile, Preferences, Notifications의 실제 기능 구현 (placeholder만)
- duration이나 zoom 애니메이션 수정 (점프 현상만 수정)
- 모바일 반응형 레이아웃 (macOS 앱 전용)
- X 버튼 hideCloseButton prop 추가 (이번 범위 외)

## Implementation Approach
1. dialog.tsx 애니메이션 수정 (48% → 50%)
2. SettingsModal을 sidebar + content 레이아웃으로 재구조화
3. 각 섹션을 독립 컴포넌트로 분리
4. 메뉴 상태 관리 및 전환 로직 구현

---

## - [x] Phase 1: 모달 애니메이션 수정

### Overview
모달 열림/닫힘 시 위치 점프 현상 해결

### Changes Required:

#### 1. dialog.tsx 애니메이션 값 수정
**File**: `components/ui/dialog.tsx`
**Changes**:
- `slide-in-from-top-[48%]` → `slide-in-from-top-1/2` (50%)
- `slide-out-to-top-[48%]` → `slide-out-to-top-1/2` (50%)

line 41의 클래스에서 48%를 1/2(50%)로 변경하여 최종 위치와 시작 위치를 일치시킴

### Success Criteria:

#### Manual Verification:
- [ ] Settings 모달 열 때 위치 점프 없이 제자리에서 fade-in + zoom-in
- [ ] 모달 닫을 때도 동일하게 부드럽게 닫힘
- [ ] 다른 모달들(CreateProject, ImportCSV 등)도 동일하게 개선됨

---

## - [x] Phase 2: SettingsModal 레이아웃 재구조화

### Overview
단일 패널을 sidebar + content 2-column 레이아웃으로 변경

### Changes Required:

#### 1. 모달 크기 및 기본 레이아웃 변경
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- DialogContent의 max-width를 500px에서 750px으로 변경
- 내부 레이아웃을 `flex` 기반 2-column으로 변경:
  - 좌측 sidebar (w-[200px], border-r)
  - 우측 content area (flex-1)
- DialogHeader를 모달 상단 전체에 배치 (타이틀만, description 제거)
- DialogFooter를 content area 하단에 배치

#### 2. 메뉴 상태 관리 추가
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- 메뉴 타입 정의: `'profile' | 'preferences' | 'notifications' | 'models' | 'updates' | 'data'`
- 현재 선택된 메뉴를 관리하는 state 추가 (기본값: 'models')
- 메뉴 아이템 설정 배열 정의 (아이콘, 라벨, id)

#### 3. Sidebar 네비게이션 구현
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- 메뉴 아이템 렌더링 (BoardList 패턴 참고)
- 활성 메뉴 스타일링 (`bg-accent text-accent-foreground`)
- 메뉴 그룹 구분선 (Placeholder 메뉴들 / 실제 메뉴들)
- 아이콘: User(Profile), Settings(Preferences), Bell(Notifications), Cpu(Models), Download(Updates), Database(Data)

#### 4. Content Area 구현
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- 선택된 메뉴에 따라 해당 콘텐츠 렌더링
- Placeholder 메뉴들은 "Coming soon" 메시지 표시
- 기존 섹션 코드를 각 메뉴별로 분기

### Success Criteria:

#### Manual Verification:
- [ ] 모달 열리면 좌측에 메뉴 목록, 우측에 콘텐츠 표시
- [ ] 메뉴 클릭 시 우측 콘텐츠 전환
- [ ] Placeholder 메뉴 선택 시 "Coming soon" 표시
- [ ] 모달 크기 700-800px 범위 확인

---

## - [x] Phase 3: Models 섹션 구현

### Overview
기존 Provider, API Key, Default Model, Local Models를 Models 메뉴 콘텐츠로 통합

### Changes Required:

#### 1. Models 콘텐츠 섹션 구현
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- 기존 Provider/API Key/Default Model 코드를 "API" 서브섹션으로 그룹화
- 기존 Local Models 코드를 "Local Models" 서브섹션으로 그룹화
- 서브섹션 헤더 스타일링 추가 (text-sm font-semibold + 구분선)
- Save/Cancel 버튼은 Models 메뉴에서만 표시

### Success Criteria:

#### Manual Verification:
- [ ] Models 메뉴 선택 시 API 섹션과 Local Models 섹션 표시
- [ ] API Key 입력 및 저장 기능 정상 동작
- [ ] Local Model 다운로드/삭제 기능 정상 동작

---

## - [x] Phase 4: Updates 및 Data 섹션 구현

### Overview
Updates와 Data(Danger Zone) 메뉴 콘텐츠 분리

### Changes Required:

#### 1. Updates 콘텐츠
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- 기존 Auto Updates 섹션 코드를 Updates 메뉴 콘텐츠로 이동
- border-t 구분선 제거 (이제 독립 페이지)
- Save/Cancel 버튼 불필요 (토글만 있음)

#### 2. Data 콘텐츠
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- 기존 Danger Zone 섹션 코드를 Data 메뉴 콘텐츠로 이동
- "Data Management" 제목 추가
- 경고 아이콘 및 설명 유지
- Save/Cancel 버튼 불필요 (Reset 버튼만)

### Success Criteria:

#### Manual Verification:
- [ ] Updates 메뉴에서 Auto Download 토글 정상 동작
- [ ] Updates 메뉴에서 Check for updates 버튼 정상 동작
- [ ] Data 메뉴에서 Reset Database 버튼 및 확인 다이얼로그 정상 동작

---

## - [x] Phase 5: Placeholder 메뉴 구현

### Overview
Profile, Preferences, Notifications placeholder UI 구현

### Changes Required:

#### 1. Placeholder 콘텐츠 컴포넌트
**File**: `components/chat/SettingsModal.tsx`
**Changes**:
- 각 placeholder 메뉴에 대해 간단한 "Coming soon" UI 표시
- 아이콘 + 메뉴명 + "This feature is coming soon." 메시지
- 일관된 스타일로 구현 (muted 색상, 중앙 정렬)

### Success Criteria:

#### Manual Verification:
- [ ] Profile 메뉴 클릭 시 placeholder 표시
- [ ] Preferences 메뉴 클릭 시 placeholder 표시
- [ ] Notifications 메뉴 클릭 시 placeholder 표시

---

## Testing Strategy

### Manual Testing Steps:
1. Settings 버튼 클릭 → 모달이 점프 없이 부드럽게 열림
2. 좌측 메뉴에서 각 항목 클릭 → 우측 콘텐츠 전환 확인
3. Models 메뉴에서:
   - API Key 입력 후 Save → 저장 성공 메시지 확인
   - Local Model 다운로드 시작 → 백그라운드 다운로드 진행
   - Local Model 삭제 → 확인 다이얼로그 후 삭제
4. Updates 메뉴에서:
   - Auto Download 토글 ON/OFF
   - Check 버튼 클릭
5. Data 메뉴에서:
   - Reset Database 클릭 → 확인 다이얼로그 표시
   - Cancel로 취소, 또는 확인 후 리셋 진행

### Edge Cases:
- 모달 열린 상태에서 다른 메뉴로 전환 후 다시 돌아왔을 때 상태 유지
- API Key 저장 실패 시 에러 메시지 표시
- Local Model 다운로드 중 메뉴 전환 시 진행 상태 유지

---

## Performance Considerations
- 메뉴 전환 시 불필요한 API 호출 방지 (초기 로드 시 1회만)
- Local Model 다운로드 상태 폴링은 기존 로직 유지

---

## References
- [dialog.tsx](components/ui/dialog.tsx) - 애니메이션 클래스 위치
- [SettingsModal.tsx](components/chat/SettingsModal.tsx) - 현재 구현
- [BoardList.tsx](components/boards/BoardList.tsx) - 사이드바 네비게이션 패턴
- [page.tsx](app/page.tsx) - 메인 사이드바 레이아웃 패턴
- [025_modal_implementation_analysis.md](docs/research/025_modal_implementation_analysis.md) - 모달 애니메이션 분석
