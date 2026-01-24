# Traffic Lights 위치 조정 Implementation Plan

## Overview
macOS traffic lights (빨강/노랑/초록 버튼)를 현재 기본 위치(상단 고정)에서 헤더 영역 내 수직 중앙으로 이동하여 UI 일관성을 개선한다.

## Current State Analysis

### 현재 구현
- **Tauri 설정**: `TitleBarStyle::Overlay` + `hiddenTitle: true`로 커스텀 타이틀바 구현
- **헤더 높이**: 40px (`h-10`)
- **Traffic lights**: macOS 기본 위치 (상단에 붙어있음, Y ≈ 4-6px)
- **문제점**: Traffic lights가 40px 헤더의 상단에 치우쳐 있어 시각적으로 불균형

```
현재 상태                          목표 상태
┌─────────────────────┐           ┌─────────────────────┐
│● ● ●  (상단 고정)   │           │                     │
│                     │     →     │ ● ● ●  (수직 중앙)  │
│                     │           │                     │
└─────────────────────┘           └─────────────────────┘
     40px 헤더                         40px 헤더
```

### 관련 코드
| 파일 | 라인 | 역할 |
|------|------|------|
| `tauri-shell/src-tauri/src/lib.rs` | 33-37 | Window builder (TitleBarStyle 설정) |
| `tauri-shell/src-tauri/src/lib.rs` | 71-80 | Window event handler (현재 close만 처리) |
| `tauri-shell/src-tauri/src/lib.rs` | 121-144 | `apply_titlebar_accessory()` (높이 40px 설정) |
| `tauri-shell/src-tauri/Cargo.toml` | 31-33 | macOS 전용 cocoa/objc 의존성 |

## Desired End State

- Traffic lights가 40px 헤더 내 **수직 중앙**에 위치 (Y ≈ 12px)
- 창 리사이즈, 풀스크린 전환 후에도 위치 유지
- 기존 기능(창 닫기 숨김 처리 등)에 영향 없음

### 검증 방법
1. 앱 실행 시 traffic lights가 헤더 중앙에 표시됨
2. 창 크기 조절 후에도 위치 유지
3. 풀스크린 진입/해제 후에도 위치 유지

## What We're NOT Doing

- Windows/Linux 타이틀바 처리 (macOS 전용 기능)
- Traffic lights 색상/크기 커스터마이징
- 헤더 높이 변경

## Implementation Approach

리서치 결과 **방법 1: Tauri 네이티브 API**를 사용한다:
- 이미 cocoa/objc crate 사용 중이므로 추가 의존성 불필요
- Tauri 2.x의 `traffic_light_position()` API 활용
- 리사이즈 이벤트 핸들러로 위치 재설정

---

## - [x] Phase 1: Traffic Lights 초기 위치 설정

### Overview
Window builder에 `traffic_light_position` 설정을 추가하여 앱 시작 시 traffic lights 위치를 지정한다.

### Changes Required:

#### 1. lib.rs - Window Builder 수정
**File**: `tauri-shell/src-tauri/src/lib.rs`

**Changes**:
- `tauri::LogicalPosition` import 추가
- Window builder 체인에 `.traffic_light_position()` 호출 추가
- X 좌표: 16.0 (기본값 유지)
- Y 좌표: 12.0 (40px 헤더에서 수직 중앙, traffic light 높이 ~16px 기준)

**위치**: 33-38 라인 (macOS 전용 window_builder 설정 블록)

### Success Criteria:

#### Automated Verification:
- [x] `cd tauri-shell && cargo check` 성공
- [x] `cd tauri-shell && cargo build` 성공

#### Manual Verification:
- [ ] 앱 실행 시 traffic lights가 헤더 중앙 근처에 표시됨
- [ ] 기존 창 기능(드래그, 리사이즈, 닫기) 정상 동작

---

## - [x] Phase 2: 리사이즈 이벤트 핸들러 추가

### Overview
macOS AppKit은 창 크기 변경/풀스크린 전환 시 traffic lights를 기본 위치로 리셋한다. 이를 방지하기 위해 이벤트 핸들러를 추가하여 위치를 재설정한다.

### Changes Required:

#### 1. lib.rs - 헬퍼 함수 추가
**File**: `tauri-shell/src-tauri/src/lib.rs`

**Changes**:
- `set_traffic_lights_position()` 헬퍼 함수 추가 (macOS 전용)
- Cocoa API를 사용하여 NSWindow의 traffic light 버튼 위치 직접 조정

#### 2. lib.rs - Window Event Handler 확장
**File**: `tauri-shell/src-tauri/src/lib.rs`

**Changes**:
- 기존 `on_window_event` 핸들러(71-80 라인)에 `Resized`, `Moved` 이벤트 처리 추가
- 해당 이벤트 발생 시 `set_traffic_lights_position()` 호출

### Success Criteria:

#### Automated Verification:
- [x] `cd tauri-shell && cargo check` 성공
- [x] `cd tauri-shell && cargo build` 성공

#### Manual Verification:
- [ ] 창 크기 조절 후 traffic lights 위치 유지
- [ ] 창 이동 후 traffic lights 위치 유지
- [ ] 풀스크린 진입/해제 후 위치 유지 (또는 적절히 조정됨)

---

## - [ ] Phase 3: Y 좌표 미세 조정 및 테스트

### Overview
실제 화면에서 traffic lights 위치를 확인하고 필요시 Y 좌표를 미세 조정한다.

### Changes Required:

#### 1. Y 좌표 조정 (필요시)
**File**: `tauri-shell/src-tauri/src/lib.rs`

**Changes**:
- 초기 설정값 Y=12.0이 시각적으로 중앙이 아닌 경우 조정
- Traffic light 버튼 높이(~16px) 고려하여 `(40 - 16) / 2 = 12` 검증
- 필요시 11.0~13.0 범위에서 조정

### Success Criteria:

#### Manual Verification:
- [ ] Traffic lights가 40px 헤더 내에서 시각적으로 수직 중앙에 위치
- [ ] 다양한 macOS 버전에서 테스트 (가능하다면)

---

## Testing Strategy

### Unit Tests:
- Rust 코드 레벨 테스트는 불필요 (UI 위치 관련)

### Integration Tests:
- macOS에서 빌드 및 실행 테스트

### Manual Testing Steps:
1. `cd tauri-shell && npm run tauri dev` 실행
2. 앱 창의 traffic lights 위치 확인 (수직 중앙 여부)
3. 창 크기 드래그하여 리사이즈 후 위치 확인
4. 창을 화면 내 다른 위치로 이동 후 위치 확인
5. 녹색 버튼 클릭하여 풀스크린 전환 후 위치 확인
6. 풀스크린 해제 후 위치 확인

## Performance Considerations
- 리사이즈 이벤트는 빈번하게 발생할 수 있으나, traffic lights 위치 재설정은 가벼운 작업
- 성능 영향 무시 가능

## Migration Notes
- 기존 사용자에게 영향 없음 (UI 위치만 변경)
- 설정 마이그레이션 불필요

## References
- [docs/research/021_topbar_sidebar_ui_structure.md](docs/research/021_topbar_sidebar_ui_structure.md) - 상단바/사이드바 UI 구조 분석
- [tauri-shell/src-tauri/src/lib.rs](tauri-shell/src-tauri/src/lib.rs) - 현재 Tauri 설정
- [tauri-shell/src-tauri/Cargo.toml](tauri-shell/src-tauri/Cargo.toml) - 의존성 설정
- [Tauri Window Builder API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html) - traffic_light_position 메서드
- [GitHub Issue #14072](https://github.com/tauri-apps/tauri/issues/14072) - unstable feature 버그 (참고용)
