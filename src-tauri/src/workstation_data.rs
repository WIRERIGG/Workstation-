use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

const STORE_KEYS: &[&str] = &[
    "tasks",
    "calendar-events",
    "spreadsheets",
    "comms-messages",
    "call-queue",
    "newsletters",
    "branding",
    "openclaw-settings",
];

fn storage_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let dir = base.join("workstation");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn file_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(format!("{}.json", key)))
}

#[tauri::command]
pub fn ws_data_load(app: tauri::AppHandle, key: String) -> Result<Option<Value>, String> {
    if !STORE_KEYS.contains(&key.as_str()) {
        return Err(format!("Invalid store key: {}", key));
    }
    let path = file_path(&app, &key)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let val: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(val))
}

#[tauri::command]
pub fn ws_data_save(app: tauri::AppHandle, key: String, data: Value) -> Result<(), String> {
    if !STORE_KEYS.contains(&key.as_str()) {
        return Err(format!("Invalid store key: {}", key));
    }
    let path = file_path(&app, &key)?;
    // Atomic write: write to .tmp then rename
    let tmp_path = path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&tmp_path, serialized).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn ws_data_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    if !STORE_KEYS.contains(&key.as_str()) {
        return Err(format!("Invalid store key: {}", key));
    }
    let path = file_path(&app, &key)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn ws_data_load_all(app: tauri::AppHandle) -> Result<HashMap<String, Value>, String> {
    let mut result = HashMap::new();
    for &key in STORE_KEYS {
        let path = file_path(&app, key)?;
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(val) = serde_json::from_str::<Value>(&content) {
                    result.insert(key.to_string(), val);
                }
            }
        }
    }
    Ok(result)
}
