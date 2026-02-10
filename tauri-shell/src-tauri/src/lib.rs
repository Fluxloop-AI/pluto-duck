use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let trimmed = url.trim();
  if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
    return Err("Only http(s) URLs are allowed".to_string());
  }

  #[cfg(target_os = "macos")]
  let status = std::process::Command::new("open")
    .arg(trimmed)
    .status()
    .map_err(|err| format!("Failed to launch browser: {err}"))?;

  #[cfg(target_os = "windows")]
  let status = std::process::Command::new("cmd")
    .args(["/C", "start", "", trimmed])
    .status()
    .map_err(|err| format!("Failed to launch browser: {err}"))?;

  #[cfg(all(unix, not(target_os = "macos")))]
  let status = std::process::Command::new("xdg-open")
    .arg(trimmed)
    .status()
    .map_err(|err| format!("Failed to launch browser: {err}"))?;

  if status.success() {
    Ok(())
  } else {
    Err(format!("Browser command failed with status: {status}"))
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      if let Err(err) = backend::launch(app) {
        log::error!("backend launch failed: {err:?}");
        eprintln!("backend launch failed: {err:?}");
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      
      // Get or create main window
      let window = if let Some(existing) = app.get_webview_window("main") {
        existing
      } else {
        let mut window_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
          .title("Pluto Duck")
          .inner_size(1400.0, 900.0)
          .resizable(true);

        #[cfg(target_os = "macos")]
        {
          window_builder = window_builder
            .hidden_title(true)
            .title_bar_style(TitleBarStyle::Overlay);
        }

        window_builder.build()?
      };

      // Apply macOS native titlebar customizations
      #[cfg(target_os = "macos")]
      {
        use cocoa::appkit::{NSColor, NSWindow, NSWindowTitleVisibility};
        use cocoa::base::{id, nil, NO, YES};

        if let Ok(ns_window) = window.ns_window() {
          let ns_window = ns_window as id;
          unsafe {
            ns_window.setTitlebarAppearsTransparent_(YES);
            ns_window.setOpaque_(NO);
            ns_window.setBackgroundColor_(NSColor::clearColor(nil));
            ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
          }
        }

        // Ensure the system knows our desired titlebar height without per-resize tweaking
        #[allow(unused_must_use)]
        {
          apply_titlebar_accessory(&window, 40.0);
          // apply_unified_toolbar(&window);  // 방법 2: Toolbar 제거로 separator 해결 시도
        }
      }

      // Suppress unused variable warning on non-macOS
      let _ = &window;

      // Handle window close event (hide instead of quit) for all windows
      for (_, window) in app.webview_windows() {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Hide window instead of closing the app
            api.prevent_close();
            let _ = window_clone.hide();
          }
        });
      }
      
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![open_external_url])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      match event {
        tauri::RunEvent::Ready => {
          log::info!("App is ready");
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { has_visible_windows, .. } => {
          log::info!("App reopen event - has_visible_windows: {}", has_visible_windows);
          if !has_visible_windows {
            // Show all windows when app is activated from Dock
            for (_, window) in app_handle.webview_windows() {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        }
        tauri::RunEvent::Opened { urls } => {
          if urls.is_empty() {
            return;
          }
          log::info!("App opened with URLs: {:?}", urls);
          if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
            for url in urls {
              let url_string = url.to_string();
              if let Ok(serialized) = serde_json::to_string(&url_string) {
                let script = format!(
                  "window.__plutoAuthCallbackQueue = window.__plutoAuthCallbackQueue || [];window.__plutoAuthCallbackQueue.push({0});window.dispatchEvent(new CustomEvent('pluto-auth-callback', {{ detail: {{ url: {0} }} }}));",
                  serialized
                );
                let _ = window.eval(&script);
              }
            }
          }
        }
        tauri::RunEvent::Exit => {
          log::info!("App is exiting - cleaning up backend");
          if let Some(state) = app_handle.try_state::<backend::BackendState>() {
            if let Ok(mut guard) = state.lock() {
              if let Some(mut child) = guard.take() {
                log::info!("Killing backend process on exit...");
                let _ = child.kill();
                let _ = child.wait();
                log::info!("Backend process killed on exit");
              }
            }
          }
        }
        _ => {}
      }
    });
}

#[cfg(target_os = "macos")]
fn apply_titlebar_accessory(window: &tauri::WebviewWindow, height: f64) {
  use cocoa::appkit::NSView;
  use cocoa::base::{id, nil, YES};
  use cocoa::foundation::{NSPoint, NSRect, NSSize};
  use objc::{class, msg_send, sel, sel_impl};

  if let Ok(ns_window) = window.ns_window() {
    let ns_window = ns_window as id;
    unsafe {
      let accessory: id = msg_send![class!(NSTitlebarAccessoryViewController), new];
      let view: id = NSView::alloc(nil).initWithFrame_(NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(1.0, height),
      ));
      let _: () = msg_send![view, setWantsLayer: YES];
      // Transparent accessory; only height matters for layout
      let _: () = msg_send![view, setAlphaValue: 0.0f64];

      let _: () = msg_send![accessory, setView: view];
      // Add accessory so AppKit derives titlebar height from its view
      let _: () = msg_send![ns_window, addTitlebarAccessoryViewController: accessory];
    }
  }
}

#[cfg(target_os = "macos")]
fn apply_unified_toolbar(window: &tauri::WebviewWindow) {
  use cocoa::base::{id, nil, NO, YES, BOOL};
  use cocoa::foundation::NSString;
  use objc::{class, msg_send, sel, sel_impl};

  if let Ok(ns_window) = window.ns_window() {
    let ns_window = ns_window as id;
    unsafe {
      // Create NSToolbar with an identifier
      let identifier = NSString::alloc(nil).init_str("PlutoDuckToolbar");
      let toolbar: id = msg_send![class!(NSToolbar), alloc];
      let toolbar: id = msg_send![toolbar, initWithIdentifier: identifier];

      // Optional cosmetic adjustments
      let _: () = msg_send![toolbar, setShowsBaselineSeparator: NO];
      // Small size mode (1). Default is 0. This helps lower the baseline.
      let _: () = msg_send![toolbar, setSizeMode: 1u64];

      // Attach toolbar to window
      let _: () = msg_send![ns_window, setToolbar: toolbar];

      // Try to center/compact further by setting toolbar style when available.
      // We avoid hardcoding NSWindowToolbarStyle enums to keep compatibility.
      // If the selector exists, set to UnifiedCompact (commonly = 5) as a best-effort.
      let sel_toolbarStyle = sel!(setToolbarStyle:);
      let responds: BOOL = msg_send![ns_window, respondsToSelector: sel_toolbarStyle];
      if responds == YES {
        let unified_compact: u64 = 8; // NSWindowToolbarStyleUnifiedCompact (best-effort)
        let _: () = msg_send![ns_window, setToolbarStyle: unified_compact];
      }
    }
  }
}

mod backend {
  use std::path::PathBuf;
  use std::process::{Child, Command, Stdio};
  use std::sync::{Arc, Mutex};

  use anyhow::{Context, Result};
  use log::{error, info};
  use tauri::{App, AppHandle, Manager};

  const BACKEND_BINARY_DEBUG: &str = "../../dist/pluto-duck-backend/pluto-duck-backend";
  const BACKEND_RESOURCE_PATH: &str = "_up_/_up_/dist/pluto-duck-backend/pluto-duck-backend";
  const BACKEND_PORT: u16 = 8123;

  struct BackendProcess(Arc<Mutex<Option<Child>>>);

  impl Drop for BackendProcess {
    fn drop(&mut self) {
      info!("BackendProcess dropping - killing backend");
      if let Ok(mut guard) = self.0.lock() {
        if let Some(mut child) = guard.take() {
          info!("Killing backend process...");
          let _ = child.kill();
          let _ = child.wait();
          info!("Backend process killed");
        }
      }
    }
  }

  pub type BackendState = Arc<Mutex<Option<Child>>>;

  pub fn launch(app: &mut App) -> Result<()> {
    let app_handle = app.handle();
    let binary = backend_binary_path(app)?;
    let data_root = resolve_data_root(&app_handle);

    info!(
      "launching backend binary {:?} with data root {:?}",
      binary,
      data_root
    );

    let log_dir = data_root.join("logs");
    std::fs::create_dir_all(&log_dir).context("failed to create log directory")?;
    let stdout_log = std::fs::File::create(log_dir.join("backend-stdout.log"))
      .context("failed to create stdout log")?;
    let stderr_log = std::fs::File::create(log_dir.join("backend-stderr.log"))
      .context("failed to create stderr log")?;

    let mut command = Command::new(&binary);
    if let Some(parent) = binary.parent() {
      command.current_dir(parent);
    }
    command
      .env("PLUTODUCK_DATA_DIR__ROOT", &data_root)
      .args([
        "--port",
        &BACKEND_PORT.to_string(),
        "--data-root",
        data_root.to_string_lossy().as_ref(),
      ])
      .stdout(Stdio::from(stdout_log))
      .stderr(Stdio::from(stderr_log));

    let child = command.spawn().context("failed to spawn backend process")?;
    let state: BackendState = Arc::new(Mutex::new(Some(child)));
    let process_wrapper = BackendProcess(state.clone());

    app.manage(state);
    app.manage(process_wrapper);

    info!(
      "backend process spawned on http://127.0.0.1:{BACKEND_PORT} with data root {:?}",
      data_root
    );
    info!("backend health will be checked by frontend polling");

    Ok(())
  }


  fn backend_binary_path(app: &App) -> Result<PathBuf> {
    let path = if cfg!(debug_assertions) {
      PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BACKEND_BINARY_DEBUG)
    } else {
      app
        .path()
        .resource_dir()
        .context("resource directory unavailable")?
        .join(BACKEND_RESOURCE_PATH)
    };
    if !path.exists() {
      anyhow::bail!("backend binary not found at {}", path.display());
    }
    Ok(path)
  }

  fn resolve_data_root(app: &AppHandle) -> PathBuf {
    let base = if cfg!(debug_assertions) {
      PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.dev-data")
    } else {
      app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("pluto_duck"))
    };
    let root = base.join("backend");
    let logs = root.join("logs");
    if let Err(err) = std::fs::create_dir_all(&logs) {
      error!("failed to create backend data directories: {err}");
    }
    root
  }

}
