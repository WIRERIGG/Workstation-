use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Workspace {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub agent: Option<String>,
    pub status: String,
}

#[derive(Serialize)]
pub struct WorkspaceCreated {
    pub name: String,
    pub path: String,
    pub branch: String,
}

#[tauri::command]
pub fn workspace_list(repo_path: String) -> Result<Vec<Workspace>, String> {
    let repo = Repository::discover(&repo_path).map_err(|e| e.to_string())?;
    let worktrees = repo.worktrees().map_err(|e| e.to_string())?;

    let mut workspaces = Vec::new();

    for name in worktrees.iter() {
        let name = name.unwrap_or("");
        if let Ok(wt) = repo.find_worktree(name) {
            let wt_path = wt.path().to_string_lossy().to_string();

            // Try to get the branch for this worktree
            let branch = if let Ok(wt_repo) = Repository::open(wt.path()) {
                wt_repo
                    .head()
                    .ok()
                    .and_then(|h| h.shorthand().map(|s| s.to_string()))
                    .unwrap_or_else(|| "detached".to_string())
            } else {
                "unknown".to_string()
            };

            let status = if wt.is_locked().is_ok() {
                "locked".to_string()
            } else {
                "active".to_string()
            };

            workspaces.push(Workspace {
                name: name.to_string(),
                path: wt_path,
                branch,
                agent: None,
                status,
            });
        }
    }

    Ok(workspaces)
}

#[tauri::command]
pub fn workspace_create(
    repo_path: String,
    name: String,
    branch: Option<String>,
) -> Result<WorkspaceCreated, String> {
    let repo = Repository::discover(&repo_path).map_err(|e| e.to_string())?;

    let workdir = repo
        .workdir()
        .ok_or("Not a standard repository")?
        .parent()
        .ok_or("Cannot determine parent directory")?;
    let wt_path = workdir.join(&format!("{}-worktree-{}",
        repo.workdir().unwrap().file_name().unwrap().to_string_lossy(),
        &name
    ));

    // Determine branch
    let branch_name = branch.unwrap_or_else(|| format!("workspace/{}", name));

    // Create branch from HEAD if it doesn't exist
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;

    let branch_ref = if repo
        .find_branch(&branch_name, git2::BranchType::Local)
        .is_err()
    {
        repo.branch(&branch_name, &head_commit, false)
            .map_err(|e| e.to_string())?;
        format!("refs/heads/{}", branch_name)
    } else {
        format!("refs/heads/{}", branch_name)
    };

    let reference = repo
        .find_reference(&branch_ref)
        .map_err(|e| e.to_string())?;

    repo.worktree(
        &name,
        &wt_path,
        Some(
            git2::WorktreeAddOptions::new()
                .reference(Some(&reference)),
        ),
    )
    .map_err(|e| e.to_string())?;

    Ok(WorkspaceCreated {
        name,
        path: wt_path.to_string_lossy().to_string(),
        branch: branch_name,
    })
}

#[tauri::command]
pub fn workspace_delete(repo_path: String, name: String) -> Result<(), String> {
    let repo = Repository::discover(&repo_path).map_err(|e| e.to_string())?;

    let wt = repo.find_worktree(&name).map_err(|e| e.to_string())?;
    let wt_path = wt.path().to_path_buf();

    // Prune the worktree reference
    wt.prune(Some(
        git2::WorktreePruneOptions::new()
            .valid(true)
            .working_tree(true),
    ))
    .map_err(|e| e.to_string())?;

    // Remove the worktree directory
    if wt_path.exists() {
        std::fs::remove_dir_all(&wt_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn workspace_assign_agent(
    _repo_path: String,
    _name: String,
    agent: String,
) -> Result<(), String> {
    // Agent assignment is tracked in frontend state for now.
    // Future: persist to a .workstation/agents.json in the repo
    log::info!("Assigned agent '{}' to workspace", agent);
    Ok(())
}

#[derive(Serialize)]
pub struct WorkspaceStatus {
    pub name: String,
    pub branch: String,
    pub changed_files: usize,
    pub staged_files: usize,
    pub ahead: usize,
    pub behind: usize,
    pub last_commit_message: String,
    pub last_commit_time: i64,
}

#[derive(Serialize)]
pub struct MergeInfo {
    pub diff_summary: String,
    pub conflicts: Vec<String>,
    pub pr_url: Option<String>,
}

#[tauri::command]
pub fn workspace_status(repo_path: String, name: String) -> Result<WorkspaceStatus, String> {
    let repo = Repository::discover(&repo_path).map_err(|e| e.to_string())?;
    let wt = repo.find_worktree(&name).map_err(|e| e.to_string())?;
    let wt_repo = Repository::open(wt.path()).map_err(|e| e.to_string())?;

    let branch = wt_repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "detached".to_string());

    // Count changed/staged files
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).show(git2::StatusShow::IndexAndWorkdir);
    let statuses = wt_repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut changed_files = 0usize;
    let mut staged_files = 0usize;
    for entry in statuses.iter() {
        let s = entry.status();
        if s.is_wt_modified() || s.is_wt_new() || s.is_wt_deleted() || s.is_wt_renamed() {
            changed_files += 1;
        }
        if s.is_index_modified() || s.is_index_new() || s.is_index_deleted() || s.is_index_renamed() {
            staged_files += 1;
        }
    }

    // Ahead/behind
    let (ahead, behind) = if let Ok(head) = wt_repo.head() {
        if let Some(local_oid) = head.target() {
            let branch_name = head.shorthand().unwrap_or("");
            let upstream_ref = format!("refs/remotes/origin/{}", branch_name);
            if let Ok(remote_ref) = wt_repo.find_reference(&upstream_ref) {
                if let Some(remote_oid) = remote_ref.target() {
                    wt_repo.graph_ahead_behind(local_oid, remote_oid).unwrap_or((0, 0))
                } else { (0, 0) }
            } else { (0, 0) }
        } else { (0, 0) }
    } else { (0, 0) };

    // Last commit
    let (last_commit_message, last_commit_time) = if let Ok(head) = wt_repo.head() {
        if let Ok(commit) = head.peel_to_commit() {
            (commit.message().unwrap_or("").to_string(), commit.time().seconds())
        } else { (String::new(), 0) }
    } else { (String::new(), 0) };

    Ok(WorkspaceStatus {
        name,
        branch,
        changed_files,
        staged_files,
        ahead,
        behind,
        last_commit_message,
        last_commit_time,
    })
}

#[tauri::command]
pub fn workspace_merge_info(repo_path: String, name: String) -> Result<MergeInfo, String> {
    let repo = Repository::discover(&repo_path).map_err(|e| e.to_string())?;
    let wt = repo.find_worktree(&name).map_err(|e| e.to_string())?;
    let wt_repo = Repository::open(wt.path()).map_err(|e| e.to_string())?;

    let wt_head = wt_repo.head().map_err(|e| e.to_string())?;
    let wt_commit = wt_head.peel_to_commit().map_err(|e| e.to_string())?;
    let wt_tree = wt_commit.tree().map_err(|e| e.to_string())?;

    // Get main repo HEAD tree
    let main_head = repo.head().map_err(|e| e.to_string())?;
    let main_commit = main_head.peel_to_commit().map_err(|e| e.to_string())?;
    let main_tree = main_commit.tree().map_err(|e| e.to_string())?;

    let diff = repo
        .diff_tree_to_tree(Some(&main_tree), Some(&wt_tree), None)
        .map_err(|e| e.to_string())?;

    let stats = diff.stats().map_err(|e| e.to_string())?;
    let diff_summary = format!(
        "{} files changed, {} insertions(+), {} deletions(-)",
        stats.files_changed(),
        stats.insertions(),
        stats.deletions()
    );

    // Check for potential conflicts via merge
    let ancestor = repo
        .merge_base(main_commit.id(), wt_commit.id())
        .ok()
        .and_then(|oid| repo.find_commit(oid).ok())
        .and_then(|c| c.tree().ok());

    let mut conflicts = Vec::new();
    if let Some(ancestor_tree) = ancestor {
        let mut merge_idx = repo
            .merge_trees(&ancestor_tree, &main_tree, &wt_tree, None)
            .map_err(|e| e.to_string())?;
        if merge_idx.has_conflicts() {
            for conflict in merge_idx.conflicts().map_err(|e| e.to_string())? {
                if let Ok(conflict) = conflict {
                    if let Some(our) = conflict.our {
                        conflicts.push(String::from_utf8_lossy(&our.path).to_string());
                    }
                }
            }
        }
    }

    Ok(MergeInfo {
        diff_summary,
        conflicts,
        pr_url: None,
    })
}
