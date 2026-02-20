use serde::Serialize;
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Clone, Serialize)]
pub struct WindowState {
    pub maximized: bool,
    pub fullscreen: bool,
}

#[tauri::command]
pub fn window_maximize(window: WebviewWindow) -> Result<(), String> {
    window.maximize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_restore(window: WebviewWindow) -> Result<(), String> {
    window.unmaximize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_maximized(window: WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_is_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_set_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_set_always_on_top(window: WebviewWindow, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top).map_err(|e| e.to_string())
}

/// Register window state change listeners and emit events to the frontend.
pub fn setup_window_listeners(app: &tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        let w = window.clone();
        window.on_window_event(move |event| {
            let state = WindowState {
                maximized: w.is_maximized().unwrap_or(false),
                fullscreen: w.is_fullscreen().unwrap_or(false),
            };
            match event {
                tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    let _ = w.emit("window-state-changed", &state);
                }
                _ => {}
            }
        });
    }
}
