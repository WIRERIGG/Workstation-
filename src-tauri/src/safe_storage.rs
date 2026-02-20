use keyring::Entry;

const SERVICE_NAME: &str = "com.workstation.desktop";

#[tauri::command]
pub fn safe_storage_encrypt(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn safe_storage_decrypt(key: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn safe_storage_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn safe_storage_is_available() -> bool {
    Entry::new(SERVICE_NAME, "__probe__").is_ok()
}
