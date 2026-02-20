use rusqlite::{params_from_iter, types::Value, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize)]
pub struct QueryResult {
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    #[serde(rename = "numAffectedRows")]
    pub num_affected_rows: Option<u64>,
    #[serde(rename = "insertId")]
    pub insert_id: Option<i64>,
}

pub struct DatabaseState {
    connections: HashMap<String, Arc<Mutex<Connection>>>,
}

impl DatabaseState {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }
}

fn sqlite_val_to_json(val: &Value) -> serde_json::Value {
    match val {
        Value::Null => serde_json::Value::Null,
        Value::Integer(i) => serde_json::json!(i),
        Value::Real(f) => serde_json::json!(f),
        Value::Text(s) => serde_json::json!(s),
        Value::Blob(b) => {
            use base64::Engine;
            serde_json::json!(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

#[tauri::command]
pub async fn db_open(
    name: String,
    key: Option<String>,
    state: tauri::State<'_, Arc<Mutex<DatabaseState>>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Manager;

    // Close any existing connection for this name first (Vite HMR can re-init)
    {
        let mut db_state = state.lock().await;
        if db_state.connections.remove(&name).is_some() {
            log::info!("[db_open] Closed previous connection for '{}'", name);
        }
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let db_path = data_dir.join(format!("{}.sql", name));
    log::info!("[db_open] Opening database '{}' at {:?}", name, db_path);

    // Run blocking SQLite open on a blocking thread to avoid starving Tokio
    let conn = tokio::task::spawn_blocking(move || {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(30))
            .map_err(|e| e.to_string())?;

        if let Some(ref encryption_key) = key {
            conn.execute_batch(&format!("PRAGMA key = '{}';", encryption_key))
                .map_err(|e| e.to_string())?;
        }

        Ok::<Connection, String>(conn)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: String| e)?;

    let mut db_state = state.lock().await;
    db_state
        .connections
        .insert(name, Arc::new(Mutex::new(conn)));
    Ok(())
}

#[tauri::command]
pub async fn db_exec(
    name: String,
    sql: String,
    parameters: Option<Vec<serde_json::Value>>,
    state: tauri::State<'_, Arc<Mutex<DatabaseState>>>,
) -> Result<QueryResult, String> {
    // Get connection Arc, release state lock immediately
    let conn_arc = {
        let db_state = state.lock().await;
        db_state
            .connections
            .get(&name)
            .ok_or_else(|| format!("Database '{}' not open", name))?
            .clone()
    };

    let params: Vec<Value> = parameters
        .unwrap_or_default()
        .into_iter()
        .map(json_to_sqlite_val)
        .collect();

    let db_name = name.clone();
    let sql_owned = sql.clone();

    // Run ALL blocking SQLite operations on a dedicated blocking thread
    // to avoid starving the Tokio async runtime.
    tokio::task::spawn_blocking(move || {
        let conn = conn_arc.blocking_lock();
        let trimmed = sql_owned.trim();
        let upper = trimmed.to_uppercase();

        log::info!("[db_exec {}] {}", db_name, &trimmed[..trimmed.len().min(200)]);

        // SQLCipher: PRAGMA key/rekey must run via execute_batch
        if upper.starts_with("PRAGMA KEY")
            || upper.starts_with("PRAGMA REKEY")
            || upper.starts_with("PRAGMA CIPHER")
        {
            conn.execute_batch(trimmed).map_err(|e| e.to_string())?;
            return Ok(QueryResult {
                rows: vec![],
                num_affected_rows: None,
                insert_id: None,
            });
        }

        let is_select = upper.starts_with("SELECT")
            || upper.starts_with("PRAGMA")
            || upper.starts_with("WITH");

        if is_select {
            let mut stmt = conn.prepare(trimmed).map_err(|e| {
                log::error!("[db_exec {} FAIL] {} => {}", db_name, &trimmed[..trimmed.len().min(200)], e);
                e.to_string()
            })?;
            let col_count = stmt.column_count();
            let col_names: Vec<String> = (0..col_count)
                .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
                .collect();

            let rows: Vec<HashMap<String, serde_json::Value>> = stmt
                .query_map(params_from_iter(params.iter()), |row| {
                    let mut map = HashMap::new();
                    for (i, col_name) in col_names.iter().enumerate() {
                        let val: Value = row.get(i)?;
                        map.insert(col_name.clone(), sqlite_val_to_json(&val));
                    }
                    Ok(map)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            Ok(QueryResult {
                rows,
                num_affected_rows: None,
                insert_id: None,
            })
        } else {
            let changes = conn
                .execute(trimmed, params_from_iter(params.iter()))
                .map_err(|e| {
                    log::error!("[db_exec {} FAIL] {} => {}", db_name, &trimmed[..trimmed.len().min(200)], e);
                    e.to_string()
                })?;
            let last_id = conn.last_insert_rowid();

            Ok(QueryResult {
                rows: Vec::new(),
                num_affected_rows: Some(changes as u64),
                insert_id: if last_id > 0 { Some(last_id) } else { None },
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_close(
    name: String,
    state: tauri::State<'_, Arc<Mutex<DatabaseState>>>,
) -> Result<(), String> {
    let mut db_state = state.lock().await;
    db_state.connections.remove(&name);
    Ok(())
}

#[tauri::command]
pub async fn db_delete(
    name: String,
    state: tauri::State<'_, Arc<Mutex<DatabaseState>>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Manager;

    // Close first if open
    let mut db_state = state.lock().await;
    db_state.connections.remove(&name);
    drop(db_state);

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db_path = data_dir.join(format!("{}.sql", name));

    if db_path.exists() {
        std::fs::remove_file(&db_path).map_err(|e| e.to_string())?;
    }
    // Also remove WAL and SHM files
    let wal_path = PathBuf::from(format!("{}-wal", db_path.display()));
    let shm_path = PathBuf::from(format!("{}-shm", db_path.display()));
    let _ = std::fs::remove_file(wal_path);
    let _ = std::fs::remove_file(shm_path);

    Ok(())
}

fn json_to_sqlite_val(val: serde_json::Value) -> Value {
    match val {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Integer(b as i64),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                Value::Null
            }
        }
        serde_json::Value::String(s) => Value::Text(s),
        other => Value::Text(other.to_string()),
    }
}
