use ignore::WalkBuilder;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub extension: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct FsWatchEvent {
    pub kind: String,
    pub paths: Vec<String>,
}

pub struct WatcherState {
    watchers: HashMap<String, RecommendedWatcher>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: HashMap::new(),
        }
    }
}

#[tauri::command]
pub fn fs_list_dir(
    path: String,
    show_hidden: Option<bool>,
    respect_gitignore: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let show_hidden = show_hidden.unwrap_or(false);
    let respect_gitignore = respect_gitignore.unwrap_or(true);
    let dir = Path::new(&path);

    if !dir.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !dir.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries = Vec::new();

    let walker = WalkBuilder::new(dir)
        .max_depth(Some(1))
        .hidden(!show_hidden)
        .git_ignore(respect_gitignore)
        .build();

    for result in walker {
        let entry = result.map_err(|e| e.to_string())?;
        let entry_path = entry.path();

        // Skip the root directory itself
        if entry_path == dir {
            continue;
        }

        let metadata = entry_path.metadata().map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| {
                        chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default()
                    })
            });

        entries.push(FileEntry {
            name: entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: entry_path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
            is_symlink: metadata.is_symlink(),
            size: metadata.len(),
            modified,
            extension: entry_path
                .extension()
                .map(|e| e.to_string_lossy().to_string()),
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn fs_read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_file_binary(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
pub fn fs_file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub async fn fs_watch_start(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<WatcherState>>>,
) -> Result<(), String> {
    let mut watcher_state = state.lock().await;

    if watcher_state.watchers.contains_key(&path) {
        return Ok(()); // Already watching
    }

    let app_handle = app.clone();
    let watch_path = path.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let kind = match event.kind {
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "remove",
                    EventKind::Access(_) => "access",
                    _ => "other",
                };
                let paths: Vec<String> = event
                    .paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                let _ = app_handle.emit(
                    "fs-watch",
                    FsWatchEvent {
                        kind: kind.to_string(),
                        paths,
                    },
                );
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&watch_path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    watcher_state.watchers.insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub async fn fs_watch_stop(
    path: String,
    state: tauri::State<'_, Arc<Mutex<WatcherState>>>,
) -> Result<(), String> {
    let mut watcher_state = state.lock().await;
    watcher_state.watchers.remove(&path);
    Ok(())
}

#[derive(Serialize)]
pub struct FuzzyResult {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct FileInfo {
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: String,
    pub git_status: Option<String>,
    pub last_commit_message: Option<String>,
    pub last_commit_time: Option<i64>,
}

#[tauri::command]
pub fn fs_fuzzy_search(path: String, query: String, limit: Option<usize>) -> Result<Vec<FuzzyResult>, String> {
    let limit = limit.unwrap_or(50);
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    let walker = WalkBuilder::new(&path)
        .hidden(true)
        .git_ignore(true)
        .max_depth(Some(10))
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let entry_path = entry.path();
        let name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if name.to_lowercase().contains(&query_lower) {
            let metadata = entry_path.metadata().ok();
            results.push(FuzzyResult {
                path: entry_path.to_string_lossy().to_string(),
                name,
                is_dir: metadata.map(|m| m.is_dir()).unwrap_or(false),
            });
            if results.len() >= limit {
                break;
            }
        }
    }

    // Sort: exact prefix matches first, then by length
    results.sort_by(|a, b| {
        let a_starts = a.name.to_lowercase().starts_with(&query_lower);
        let b_starts = b.name.to_lowercase().starts_with(&query_lower);
        b_starts.cmp(&a_starts).then(a.name.len().cmp(&b.name.len()))
    });

    Ok(results)
}

#[tauri::command]
pub fn fs_file_info(path: String) -> Result<FileInfo, String> {
    let file_path = Path::new(&path);
    let metadata = file_path.metadata().map_err(|e| e.to_string())?;

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .and_then(|d| {
                    chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                        .map(|dt| dt.to_rfc3339())
                })
        });

    let permissions = if metadata.permissions().readonly() {
        "readonly".to_string()
    } else {
        "read-write".to_string()
    };

    // Try git info
    let (git_status, last_commit_message, last_commit_time) =
        if let Ok(repo) = git2::Repository::discover(file_path.parent().unwrap_or(file_path)) {
            let workdir = repo.workdir().unwrap_or(repo.path());
            let rel_path = file_path
                .strip_prefix(workdir)
                .unwrap_or(file_path);

            // Git status
            let status = repo
                .status_file(rel_path)
                .ok()
                .map(|s| {
                    if s.is_wt_new() || s.is_index_new() { "new" }
                    else if s.is_wt_modified() || s.is_index_modified() { "modified" }
                    else if s.is_wt_deleted() || s.is_index_deleted() { "deleted" }
                    else if s.is_ignored() { "ignored" }
                    else { "clean" }
                })
                .map(|s| s.to_string());

            // Last commit for file
            let (msg, time) = (|| -> Option<(String, i64)> {
                let mut revwalk = repo.revwalk().ok()?;
                revwalk.push_head().ok()?;
                revwalk.set_sorting(git2::Sort::TIME).ok()?;

                for oid in revwalk.take(500) {
                    let oid = oid.ok()?;
                    let commit = repo.find_commit(oid).ok()?;
                    let tree = commit.tree().ok()?;
                    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

                    let diff = repo
                        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
                        .ok()?;

                    for delta in diff.deltas() {
                        let dp = delta.new_file().path().or_else(|| delta.old_file().path());
                        if dp == Some(rel_path) {
                            return Some((
                                commit.message().unwrap_or("").to_string(),
                                commit.time().seconds(),
                            ));
                        }
                    }
                }
                None
            })()
            .map(|(m, t)| (Some(m), Some(t)))
            .unwrap_or((None, None));

            (status, msg, time)
        } else {
            (None, None, None)
        };

    Ok(FileInfo {
        size: metadata.len(),
        modified,
        permissions,
        git_status,
        last_commit_message,
        last_commit_time,
    })
}
