use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Serialize, Deserialize, Clone)]
pub struct PtyOptions {
    pub rows: Option<u16>,
    pub cols: Option<u16>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub shell: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PtyOutput {
    pub id: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
pub struct PtyExit {
    pub id: String,
    pub code: Option<u32>,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    reader_handle: Option<JoinHandle<()>>,
}

pub struct PtyState {
    sessions: HashMap<String, PtySession>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

#[tauri::command]
pub async fn pty_spawn(
    id: String,
    options: PtyOptions,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<PtyState>>>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: options.rows.unwrap_or(24),
        cols: options.cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    // Determine shell
    let shell = options.shell.unwrap_or_else(|| {
        if cfg!(windows) {
            std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        }
    });

    let mut cmd = CommandBuilder::new(&shell);
    if let Some(cwd) = options.cwd {
        cmd.cwd(cwd);
    }
    if let Some(env) = options.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Spawn reader thread that emits events
    let pty_id = id.clone();
    let app_handle = app.clone();
    let reader_handle = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    use base64::Engine;
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app_handle.emit(
                        "pty-output",
                        PtyOutput {
                            id: pty_id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Spawn waiter thread for exit notification
    let exit_id = id.clone();
    let exit_app = app.clone();
    tokio::task::spawn_blocking(move || {
        let status = child.wait();
        let code = status.ok().map(|s| {
            s.exit_code()
        });
        let _ = exit_app.emit(
            "pty-exit",
            PtyExit {
                id: exit_id,
                code,
            },
        );
    });

    let mut pty_state = state.lock().await;
    pty_state.sessions.insert(
        id,
        PtySession {
            writer,
            master: pair.master,
            reader_handle: Some(reader_handle),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn pty_write(
    id: String,
    data: String,
    state: tauri::State<'_, Arc<Mutex<PtyState>>>,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;

    let mut pty_state = state.lock().await;
    let session = pty_state
        .sessions
        .get_mut(&id)
        .ok_or_else(|| format!("PTY session '{}' not found", id))?;

    session
        .writer
        .write_all(&bytes)
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_resize(
    id: String,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, Arc<Mutex<PtyState>>>,
) -> Result<(), String> {
    let pty_state = state.lock().await;
    let session = pty_state
        .sessions
        .get(&id)
        .ok_or_else(|| format!("PTY session '{}' not found", id))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_kill(
    id: String,
    state: tauri::State<'_, Arc<Mutex<PtyState>>>,
) -> Result<(), String> {
    let mut pty_state = state.lock().await;
    if let Some(mut session) = pty_state.sessions.remove(&id) {
        if let Some(handle) = session.reader_handle.take() {
            handle.abort();
        }
        // Dropping the master closes the PTY
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_list(
    state: tauri::State<'_, Arc<Mutex<PtyState>>>,
) -> Result<Vec<String>, String> {
    let pty_state = state.lock().await;
    Ok(pty_state.sessions.keys().cloned().collect())
}
