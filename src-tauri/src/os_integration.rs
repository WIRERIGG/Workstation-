use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewWindow};

#[derive(Serialize, Deserialize)]
pub struct NotificationOptions {
    pub title: Option<String>,
    pub body: Option<String>,
    pub tag: Option<String>,
}

#[tauri::command]
pub fn set_zoom_factor(window: WebviewWindow, factor: f64) -> Result<(), String> {
    window
        .set_zoom(factor)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_zoom_factor(window: WebviewWindow) -> Result<f64, String> {
    window
        .scale_factor()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_content_protection(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_content_protected(enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_directory(
    app: tauri::AppHandle,
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(p) = default_path {
        builder = builder.set_directory(p);
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_folder(move |path| {
        let result = path.map(|p| p.to_string());
        let _ = tx.send(result);
    });

    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_file(
    app: tauri::AppHandle,
    title: Option<String>,
    filters: Option<Vec<(String, Vec<String>)>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(f) = filters {
        for (name, extensions) in f {
            let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(name, &exts);
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_file(move |path| {
        let result = path.map(|p| p.to_string());
        let _ = tx.send(result);
    });

    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_file(path: String, data: String) -> Result<(), String> {
    let parent = std::path::Path::new(&path).parent();
    if let Some(dir) = parent {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resolve_path(file_path: String) -> Result<String, String> {
    let expanded = if file_path.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            home.join(&file_path[2..]).to_string_lossy().to_string()
        } else {
            file_path
        }
    } else {
        file_path
    };
    Ok(expanded)
}

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bring_to_front(window: WebviewWindow) -> Result<(), String> {
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}
