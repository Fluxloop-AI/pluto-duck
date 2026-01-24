# macOS Tauri Titlebar Separator 이슈

## 문제 현상

- **브라우저**: 헤더 아래 border 없음
- **Tauri 앱 (macOS)**: 헤더 바로 아래에 얇은 가로선(separator)이 표시됨

![separator line](../../docs/screen1.png)

---

## 원인 분석

### 1. 현재 Tauri 윈도우 설정

`tauri-shell/src-tauri/src/lib.rs`에서 macOS 커스텀 타이틀바를 구현하고 있습니다:

```rust
// lib.rs:30-35
#[cfg(target_os = "macos")]
{
  window_builder = window_builder
    .hidden_title(true)
    .title_bar_style(TitleBarStyle::Overlay);
}
```

### 2. NSToolbar 사용 이유

macOS에서 커스텀 타이틀바 높이(40px)를 설정하기 위해 두 가지 함수를 사용합니다:

```rust
// lib.rs:55-59
apply_titlebar_accessory(&window, 40.0);  // 타이틀바 높이 조정
apply_unified_toolbar(&window);            // Unified Toolbar 적용
```

### 3. 문제의 근본 원인

`apply_unified_toolbar` 함수에서 NSToolbar를 생성할 때, macOS는 기본적으로 **baseline separator**(toolbar 아래 구분선)를 표시합니다.

```rust
// lib.rs:139-172
fn apply_unified_toolbar(window: &tauri::WebviewWindow) {
  // ...
  unsafe {
    let toolbar: id = msg_send![class!(NSToolbar), alloc];
    let toolbar: id = msg_send![toolbar, initWithIdentifier: identifier];

    // Separator 숨기기 시도 (제대로 작동하지 않음)
    let _: () = msg_send![toolbar, setShowsBaselineSeparator: NO];

    // Toolbar를 윈도우에 연결
    let _: () = msg_send![ns_window, setToolbar: toolbar];
    // ...
  }
}
```

**문제점**: `setShowsBaselineSeparator: NO`가 toolbar를 윈도우에 attach하기 **전에** 호출되어, macOS 일부 버전에서 무시될 수 있습니다.

---

## 해결 방법

### 방법 1: Rust 코드 수정 (separator 숨기기 재시도)

`apply_unified_toolbar` 함수에서 toolbar를 윈도우에 연결한 **후에** separator 설정을 다시 적용합니다.

**수정 위치**: `tauri-shell/src-tauri/src/lib.rs`

```rust
#[cfg(target_os = "macos")]
fn apply_unified_toolbar(window: &tauri::WebviewWindow) {
  use cocoa::base::{id, nil, NO, YES, BOOL};
  use cocoa::foundation::NSString;
  use objc::{class, msg_send, sel, sel_impl};

  if let Ok(ns_window) = window.ns_window() {
    let ns_window = ns_window as id;
    unsafe {
      let identifier = NSString::alloc(nil).init_str("PlutoDuckToolbar");
      let toolbar: id = msg_send![class!(NSToolbar), alloc];
      let toolbar: id = msg_send![toolbar, initWithIdentifier: identifier];

      // 1. Toolbar 기본 설정
      let _: () = msg_send![toolbar, setSizeMode: 1u64];

      // 2. Toolbar를 윈도우에 먼저 연결
      let _: () = msg_send![ns_window, setToolbar: toolbar];

      // 3. 연결 후 separator 숨기기 (순서 변경)
      let _: () = msg_send![toolbar, setShowsBaselineSeparator: NO];

      // 4. Toolbar style 설정
      let sel_toolbarStyle = sel!(setToolbarStyle:);
      let responds: BOOL = msg_send![ns_window, respondsToSelector: sel_toolbarStyle];
      if responds == YES {
        let unified_compact: u64 = 8;
        let _: () = msg_send![ns_window, setToolbarStyle: unified_compact];
      }
    }
  }
}
```

**장점**:
- 기존 레이아웃 유지
- Unified Toolbar의 장점 (윈도우 드래그 영역 등) 유지

**단점**:
- macOS 버전별로 동작이 다를 수 있음
- 일부 macOS 버전에서는 여전히 separator가 보일 수 있음

---

### 방법 2: Toolbar 완전 제거

NSToolbar 사용을 제거하고, `apply_titlebar_accessory`만으로 타이틀바 높이를 조정합니다.

**수정 위치**: `tauri-shell/src-tauri/src/lib.rs`

```rust
// lib.rs:55-59 수정
#[allow(unused_must_use)]
{
  apply_titlebar_accessory(&window, 40.0);
  // apply_unified_toolbar(&window);  // 이 줄 제거 또는 주석 처리
}
```

**장점**:
- Separator 문제 완전 해결
- 코드 단순화

**단점**:
- Unified Toolbar의 일부 기능 (예: toolbar style) 사용 불가
- 타이틀바 높이가 `apply_titlebar_accessory`만으로 충분한지 테스트 필요

---

## 권장 사항

1. **방법 2 먼저 테스트**: Toolbar를 제거하고 앱이 정상 동작하는지 확인
2. 문제 없으면 방법 2 적용
3. Toolbar 기능이 필요하면 방법 1 시도

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `tauri-shell/src-tauri/src/lib.rs` | Tauri 앱 초기화, macOS 윈도우 설정 |
| `frontend/pluto_duck_frontend/app/page.tsx` | 프론트엔드 헤더 컴포넌트 |

---

## 참고 자료

- [Apple Developer - NSToolbar](https://developer.apple.com/documentation/appkit/nstoolbar)
- [Tauri - Window Customization](https://tauri.app/v1/guides/features/window-customization/)
- [macOS Window Titlebar Style](https://developer.apple.com/documentation/appkit/nswindow/titlebarstyle)
