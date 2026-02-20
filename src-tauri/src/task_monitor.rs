use serde::Serialize;

#[derive(Serialize)]
pub struct ActivityEntry {
    pub timestamp: String,
    pub source: String,
    pub action: String,
    pub details: String,
}

#[derive(Serialize)]
pub struct ProgressSummary {
    pub git_commits_today: usize,
    pub files_changed_today: usize,
    pub active_agents: usize,
    pub conversations_today: usize,
    pub recent_activity: Vec<ActivityEntry>,
}

#[tauri::command]
pub fn monitor_get_activity(
    repo_path: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ActivityEntry>, String> {
    let limit = limit.unwrap_or(20);
    let mut activities = Vec::new();

    // Collect recent git activity if repo path provided
    if let Some(ref path) = repo_path {
        if let Ok(entries) = crate::git::git_log(path.clone(), Some(limit)) {
            for entry in entries {
                activities.push(ActivityEntry {
                    timestamp: entry.time_formatted,
                    source: "git".to_string(),
                    action: "commit".to_string(),
                    details: entry.message,
                });
            }
        }
    }

    // Sort by timestamp descending
    activities.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    activities.truncate(limit);

    Ok(activities)
}

#[tauri::command]
pub fn monitor_get_progress(
    repo_path: Option<String>,
) -> Result<ProgressSummary, String> {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let mut git_commits_today = 0;
    let mut files_changed_today = 0;

    if let Some(ref path) = repo_path {
        // Count today's commits
        if let Ok(entries) = crate::git::git_log(path.clone(), Some(100)) {
            for entry in &entries {
                if entry.time_formatted.starts_with(&today) {
                    git_commits_today += 1;
                }
            }
        }

        // Count changed files
        if let Ok(status) = crate::git::git_status(path.clone()) {
            files_changed_today = status.len();
        }
    }

    // Count today's conversations
    let conversations_today = crate::conversations::conversations_scan(None, Some(50))
        .ok()
        .map(|sessions| {
            sessions
                .iter()
                .filter(|s| s.started_at.starts_with(&today))
                .count()
        })
        .unwrap_or(0);

    let recent_activity = monitor_get_activity(repo_path, Some(10))?;

    Ok(ProgressSummary {
        git_commits_today,
        files_changed_today,
        active_agents: 0, // Updated by frontend
        conversations_today,
        recent_activity,
    })
}
