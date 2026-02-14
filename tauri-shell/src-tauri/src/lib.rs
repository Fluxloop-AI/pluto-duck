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
      if let Err(err) = node_server::launch(app) {
        log::error!("node server launch failed: {err:?}");
        eprintln!("node server launch failed: {err:?}");
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

      if let Err(err) = node_server::navigate_window(&window) {
        log::warn!("failed to navigate window to node server: {err:?}");
      }

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
          log::info!("App is exiting - cleaning up node server");
          if let Some(state) = app_handle.try_state::<node_server::ServerState>() {
            if let Ok(mut guard) = state.lock() {
              if let Some(mut child) = guard.take() {
                log::info!("Killing node server process on exit...");
                let _ = child.kill();
                let _ = child.wait();
                log::info!("Node server process killed on exit");
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

mod node_server {
  use std::net::{SocketAddr, TcpStream};
  use std::path::PathBuf;
  use std::process::{Child, Command, Stdio};
  use std::sync::{Arc, Mutex};
  use std::time::{Duration, Instant};

  use anyhow::{Context, Result};
  use log::{error, info, warn};
  use tauri::{App, AppHandle, Manager, WebviewWindow};

  const FRONTEND_HOST: &str = "127.0.0.1";
  const FRONTEND_PORT: u16 = 3100;
  const SERVER_DIST_DEBUG: &str = "../../dist/pluto-duck-frontend-server";
  const SERVER_DIST_RESOURCE: &str = "dist/pluto-duck-frontend-server";

  struct ServerProcess(Arc<Mutex<Option<Child>>>);

  impl Drop for ServerProcess {
    fn drop(&mut self) {
      info!("ServerProcess dropping - killing node server");
      if let Ok(mut guard) = self.0.lock() {
        if let Some(mut child) = guard.take() {
          info!("Killing node server process...");
          let _ = child.kill();
          let _ = child.wait();
          info!("Node server process killed");
        }
      }
    }
  }

  pub type ServerState = Arc<Mutex<Option<Child>>>;

  pub fn launch(app: &mut App) -> Result<()> {
    if cfg!(debug_assertions) {
      info!(
        "debug build detected - skipping node server spawn (beforeDevCommand handles Next dev server)"
      );
      return Ok(());
    }

    let app_handle = app.handle();
    let server_root = server_root(app)?;
    let server_entry = server_root.join("server.js");
    let data_root = resolve_data_root(&app_handle);

    info!(
      "launching node server {:?} with data root {:?}",
      server_entry,
      data_root
    );

    let log_dir = data_root.join("logs");
    std::fs::create_dir_all(&log_dir).context("failed to create log directory")?;
    let stdout_log = std::fs::File::create(log_dir.join("node-server-stdout.log"))
      .context("failed to create stdout log")?;
    let stderr_log = std::fs::File::create(log_dir.join("node-server-stderr.log"))
      .context("failed to create stderr log")?;

    if !server_entry.exists() {
      anyhow::bail!("node server entry not found at {}", server_entry.display());
    }

    let mut command = Command::new("node");
    command
      .current_dir(&server_root)
      .env("PLUTODUCK_DATA_DIR__ROOT", &data_root)
      .env("HOSTNAME", FRONTEND_HOST)
      .env("PORT", FRONTEND_PORT.to_string())
      .arg("server.js")
      .stdout(Stdio::from(stdout_log))
      .stderr(Stdio::from(stderr_log));

    let child = command.spawn().context("failed to spawn node server process")?;
    let state: ServerState = Arc::new(Mutex::new(Some(child)));
    let process_wrapper = ServerProcess(state.clone());

    app.manage(state);
    app.manage(process_wrapper);

    info!(
      "node server process spawned on {} with data root {:?}",
      frontend_url(),
      data_root
    );

    if !wait_for_server(Duration::from_secs(15)) {
      warn!("node server did not become ready within timeout");
    }

    Ok(())
  }

  pub fn navigate_window(window: &WebviewWindow) -> Result<()> {
    if cfg!(debug_assertions) {
      return Ok(());
    }
    let target = frontend_url().parse().context("failed to parse frontend url")?;
    window.navigate(target).context("failed to navigate to frontend url")?;
    Ok(())
  }

  fn server_root(app: &App) -> Result<PathBuf> {
    if cfg!(debug_assertions) {
      let debug_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(SERVER_DIST_DEBUG);
      if !debug_path.exists() {
        anyhow::bail!("node server directory not found at {}", debug_path.display());
      }
      return Ok(debug_path);
    }

    let resource_dir = app
      .path()
      .resource_dir()
      .context("resource directory unavailable")?;

    let primary_resource_path = resource_dir.join(SERVER_DIST_RESOURCE);
    if primary_resource_path.exists() {
      return Ok(primary_resource_path);
    }

    anyhow::bail!(
      "node server directory not found in resources ({})",
      primary_resource_path.display()
    );
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
    let root = base.join("node-server");
    let logs = root.join("logs");
    if let Err(err) = std::fs::create_dir_all(&logs) {
      error!("failed to create node server data directories: {err}");
    }
    root
  }

  fn frontend_url() -> String {
    format!("http://{FRONTEND_HOST}:{FRONTEND_PORT}")
  }

  fn wait_for_server(timeout: Duration) -> bool {
    let address: SocketAddr = match format!("{FRONTEND_HOST}:{FRONTEND_PORT}").parse() {
      Ok(value) => value,
      Err(_) => return false,
    };
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
      if TcpStream::connect_timeout(&address, Duration::from_millis(400)).is_ok() {
        return true;
      }
      std::thread::sleep(Duration::from_millis(200));
    }
    false
  }
}
