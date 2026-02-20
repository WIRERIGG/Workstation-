// Existing ZeroClaw CRM modules
pub mod call_queue;
pub mod commands;
pub mod jwt;
pub mod newsletter;
pub mod scheduler;
pub mod storage;
pub mod zeroclaw_engine;

// Phase 1: Core IPC (Electron → Tauri)
pub mod compression;
pub mod database;
pub mod os_integration;
pub mod safe_storage;
pub mod updater_bridge;
pub mod window_mgmt;
pub mod workstation_data;

// Phase 2: File System + Git
pub mod filesystem;
pub mod git;
pub mod highlighter;

// Phase 3: PTY Terminal
pub mod pty;

// Phase 4: Conversations, Workspaces, Task Monitor
pub mod conversations;
pub mod task_monitor;
pub mod workspaces;

use std::sync::Arc;
use tokio::sync::Mutex;

use call_queue::CallQueue;
use database::DatabaseState;
use filesystem::WatcherState;
use jwt::LicenseInfo;
use pty::PtyState;
use storage::Storage;
use zeroclaw_engine::ZeroClawEngine;

pub struct AppState {
    pub engine: Arc<Mutex<ZeroClawEngine>>,
    pub storage: Arc<Mutex<Storage>>,
    pub call_queue: Arc<Mutex<CallQueue>>,
    pub license: LicenseInfo,
}

pub fn run() {
    env_logger::init();

    let license = jwt::load_license().unwrap_or_default();

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");

    let storage = rt.block_on(async {
        Storage::new("data/zeroclaw.lance")
            .await
            .expect("Failed to initialize LanceDB storage")
    });

    let engine = ZeroClawEngine::new(license.max_daily_tokens);

    let state = AppState {
        engine: Arc::new(Mutex::new(engine)),
        storage: Arc::new(Mutex::new(storage)),
        call_queue: Arc::new(Mutex::new(CallQueue::new())),
        license,
    };

    let db_state = Arc::new(Mutex::new(DatabaseState::new()));
    let watcher_state = Arc::new(Mutex::new(WatcherState::new()));
    let pty_state = Arc::new(Mutex::new(PtyState::new()));

    tauri::Builder::default()
        // Tauri plugins
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_deep_link::init())
        // Managed state
        .manage(state)
        .manage(db_state)
        .manage(watcher_state)
        .manage(pty_state)
        // Window lifecycle hooks + system tray
        .setup(|app| {
            window_mgmt::setup_window_listeners(app);
            setup_system_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── ZeroClaw CRM (existing) ─────────────────────
            commands::zeroclaw_process,
            commands::is_first_launch,
            commands::save_questionnaire,
            commands::get_business_profile,
            commands::add_contact,
            commands::list_contacts,
            commands::search_contacts,
            commands::add_call_log,
            commands::list_call_logs,
            commands::add_email,
            commands::list_emails,
            commands::create_appointment,
            commands::list_appointments,
            commands::update_appointment_status,
            commands::get_agent_memory,
            commands::set_agent_memory,
            commands::semantic_search,
            commands::schedule_auto_followup,
            commands::generate_newsletter,
            commands::queue_calls,
            commands::get_call_queue,
            // ── Phase 1: Core IPC ───────────────────────────
            compression::compress_gzip,
            compression::decompress_gunzip,
            safe_storage::safe_storage_encrypt,
            safe_storage::safe_storage_decrypt,
            safe_storage::safe_storage_delete,
            safe_storage::safe_storage_is_available,
            window_mgmt::window_maximize,
            window_mgmt::window_minimize,
            window_mgmt::window_restore,
            window_mgmt::window_close,
            window_mgmt::window_is_maximized,
            window_mgmt::window_is_fullscreen,
            window_mgmt::window_set_fullscreen,
            window_mgmt::window_set_always_on_top,
            os_integration::set_zoom_factor,
            os_integration::get_zoom_factor,
            os_integration::set_content_protection,
            os_integration::select_directory,
            os_integration::select_file,
            os_integration::save_file,
            os_integration::delete_file,
            os_integration::open_path,
            os_integration::open_url,
            os_integration::resolve_path,
            os_integration::get_app_data_dir,
            os_integration::bring_to_front,
            os_integration::restart_app,
            updater_bridge::check_for_update,
            updater_bridge::download_and_install_update,
            workstation_data::ws_data_load,
            workstation_data::ws_data_save,
            workstation_data::ws_data_remove,
            workstation_data::ws_data_load_all,
            database::db_open,
            database::db_exec,
            database::db_close,
            database::db_delete,
            // ── Phase 2: File System + Git ───────────────────
            filesystem::fs_list_dir,
            filesystem::fs_read_file,
            filesystem::fs_read_file_binary,
            filesystem::fs_get_home_dir,
            filesystem::fs_file_exists,
            filesystem::fs_watch_start,
            filesystem::fs_watch_stop,
            git::git_repo_info,
            git::git_status,
            git::git_diff,
            git::git_log,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_branches,
            git::git_stash_save,
            git::git_stash_pop,
            highlighter::highlight_code,
            highlighter::list_languages,
            highlighter::list_themes,
            // ── Phase 3: PTY Terminal ────────────────────────
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_list,
            // ── Phase 4: Conversations, Workspaces, Monitor ─
            conversations::conversations_scan,
            conversations::conversations_search,
            conversations::conversations_get_session,
            workspaces::workspace_list,
            workspaces::workspace_create,
            workspaces::workspace_delete,
            workspaces::workspace_assign_agent,
            task_monitor::monitor_get_activity,
            task_monitor::monitor_get_progress,
            // ── Sidecar-Inspired Feature Additions ──────
            git::git_checkout_branch,
            git::git_delete_branch,
            git::git_stash_list,
            git::git_stash_drop,
            git::git_stash_apply,
            git::git_show_commit,
            git::git_discard_file,
            git::git_pull,
            git::git_push,
            conversations::conversations_export,
            conversations::conversations_stats,
            workspaces::workspace_status,
            workspaces::workspace_merge_info,
            filesystem::fs_fuzzy_search,
            filesystem::fs_file_info,
        ])
        .run(tauri::generate_context!())
        .expect("Error running Workstation");
}

fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::TrayIconBuilder;
    use tauri::Manager;

    let show = MenuItemBuilder::with_id("show", "Show Workstation").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .tooltip("Workstation")
        .on_menu_event(move |app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
