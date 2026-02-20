use serde::Serialize;
use tauri::Emitter;

#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    pub percent: f64,
    pub total: u64,
    pub transferred: u64,
}

#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;

    let _ = app.emit("update-checking", ());

    match app.updater().map_err(|e| e.to_string())?.check().await {
        Ok(Some(update)) => {
            let info = UpdateInfo {
                version: update.version.clone(),
                date: update.date.map(|d| d.to_string()),
                body: update.body.clone(),
            };
            let _ = app.emit("update-available", &info);
            Ok(Some(info))
        }
        Ok(None) => {
            let _ = app.emit("update-not-available", ());
            Ok(None)
        }
        Err(e) => {
            let _ = app.emit("update-error", e.to_string());
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn download_and_install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(update) = update {
        let app_handle = app.clone();
        update
            .download_and_install(
                move |bytes_downloaded, total_size| {
                    let percent = total_size
                        .map(|t| (bytes_downloaded as f64 / t as f64) * 100.0)
                        .unwrap_or(0.0);
                    let _ = app_handle.emit(
                        "update-download-progress",
                        UpdateProgress {
                            percent,
                            total: total_size.unwrap_or(0),
                            transferred: bytes_downloaded as u64,
                        },
                    );
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;

        let _ = app.emit("update-downloaded", ());
    }

    Ok(())
}
