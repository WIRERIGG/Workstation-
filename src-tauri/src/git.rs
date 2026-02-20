use git2::{
    DiffOptions, ErrorCode, Repository, Signature, Sort, StatusOptions, StatusShow,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Serialize)]
pub struct GitBranch {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: Option<usize>,
    pub behind: Option<usize>,
}

#[derive(Serialize)]
pub struct GitLogEntry {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub time_formatted: String,
}

#[derive(Serialize)]
pub struct GitDiffFile {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub patch: Option<String>,
}

#[derive(Serialize)]
pub struct GitRepoInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub path: String,
    pub remote_url: Option<String>,
}

fn status_to_string(status: git2::Status) -> &'static str {
    if status.is_index_new() || status.is_wt_new() {
        "new"
    } else if status.is_index_modified() || status.is_wt_modified() {
        "modified"
    } else if status.is_index_deleted() || status.is_wt_deleted() {
        "deleted"
    } else if status.is_index_renamed() || status.is_wt_renamed() {
        "renamed"
    } else if status.is_index_typechange() || status.is_wt_typechange() {
        "typechange"
    } else if status.is_conflicted() {
        "conflicted"
    } else {
        "unknown"
    }
}

#[tauri::command]
pub fn git_repo_info(path: String) -> Result<GitRepoInfo, String> {
    match Repository::discover(&path) {
        Ok(repo) => {
            let branch = repo
                .head()
                .ok()
                .and_then(|h| h.shorthand().map(|s| s.to_string()));

            let remote_url = repo
                .find_remote("origin")
                .ok()
                .and_then(|r| r.url().map(|u| u.to_string()));

            let repo_path = repo
                .workdir()
                .unwrap_or(repo.path())
                .to_string_lossy()
                .to_string();

            Ok(GitRepoInfo {
                is_repo: true,
                branch,
                path: repo_path,
                remote_url,
            })
        }
        Err(_) => Ok(GitRepoInfo {
            is_repo: false,
            branch: None,
            path,
            remote_url: None,
        }),
    }
}

#[tauri::command]
pub fn git_status(path: String) -> Result<Vec<GitStatusEntry>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show(StatusShow::IndexAndWorkdir);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();

        let staged = s.is_index_new()
            || s.is_index_modified()
            || s.is_index_deleted()
            || s.is_index_renamed()
            || s.is_index_typechange();

        entries.push(GitStatusEntry {
            path,
            status: status_to_string(s).to_string(),
            staged,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub fn git_diff(path: String, staged: Option<bool>) -> Result<Vec<GitDiffFile>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let staged = staged.unwrap_or(false);

    let mut opts = DiffOptions::new();

    let diff = if staged {
        let head_tree = repo
            .head()
            .and_then(|h| h.peel_to_tree())
            .ok();
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
    }
    .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    let stats = diff.stats().map_err(|e| e.to_string())?;
    let _ = stats; // stats is for the whole diff

    for (idx, delta) in diff.deltas().enumerate() {
        let file_path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Modified => "modified",
            git2::Delta::Renamed => "renamed",
            git2::Delta::Copied => "copied",
            _ => "unknown",
        }
        .to_string();

        // Get patch for this file
        let patch = git2::Patch::from_diff(&diff, idx)
            .ok()
            .flatten()
            .and_then(|mut p| {
                p.to_buf().ok().map(|b| b.as_str().unwrap_or("").to_string())
            });

        let (additions, deletions) = git2::Patch::from_diff(&diff, idx)
            .ok()
            .flatten()
            .map(|p| {
                let (_, adds, dels) = p.line_stats().unwrap_or((0, 0, 0));
                (adds, dels)
            })
            .unwrap_or((0, 0));

        files.push(GitDiffFile {
            path: file_path,
            status,
            additions,
            deletions,
            patch,
        });
    }

    Ok(files)
}

#[tauri::command]
pub fn git_log(path: String, limit: Option<usize>) -> Result<Vec<GitLogEntry>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(Sort::TIME).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();

    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let id = oid.to_string();
        let short_id = id[..7.min(id.len())].to_string();

        let time = commit.time();
        let time_formatted = chrono::DateTime::from_timestamp(time.seconds(), 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();

        entries.push(GitLogEntry {
            id,
            short_id,
            message: commit.message().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            email: commit.author().email().unwrap_or("").to_string(),
            time: time.seconds(),
            time_formatted,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;

    for file in &files {
        index.add_path(std::path::Path::new(file)).map_err(|e| e.to_string())?;
    }

    index.write().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;

    repo.reset_default(Some(head_commit.as_object()), files.iter().map(|f| std::path::Path::new(f)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Workstation", "workstation@local"))
        .map_err(|e| e.to_string())?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit().map_err(|e| e.to_string())?),
        Err(ref e) if e.code() == ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.to_string()),
    };

    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;

    Ok(oid.to_string())
}

#[tauri::command]
pub fn git_branches(path: String) -> Result<Vec<GitBranch>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let branches = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for branch in branches {
        let (branch, _) = branch.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|e| e.to_string())?;
        let name = name.unwrap_or("").to_string();
        let is_head = branch.is_head();
        let upstream = branch.upstream().ok().and_then(|u| {
            u.name().ok().flatten().map(|n| n.to_string())
        });

        // Calculate ahead/behind
        let (ahead, behind) = if let (Ok(local_oid), Ok(upstream_branch)) = (
            branch.get().target().ok_or(()),
            branch.upstream(),
        ) {
            if let Some(remote_oid) = upstream_branch.get().target() {
                repo.graph_ahead_behind(local_oid, remote_oid)
                    .unwrap_or((0, 0))
            } else {
                (0, 0)
            }
        } else {
            (0, 0)
        };

        result.push(GitBranch {
            name,
            is_head,
            upstream,
            ahead: if ahead > 0 { Some(ahead) } else { None },
            behind: if behind > 0 { Some(behind) } else { None },
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn git_stash_save(path: String, message: Option<String>) -> Result<(), String> {
    let mut repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| Signature::now("Workstation", "workstation@local"))
        .map_err(|e| e.to_string())?;

    let msg = message.as_deref().unwrap_or("Workstation stash");
    repo.stash_save(&sig, msg, None)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_stash_pop(path: String) -> Result<(), String> {
    let mut repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    repo.stash_pop(0, None).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
    pub time: i64,
}

#[derive(Serialize)]
pub struct GitCommitDetail {
    pub id: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub files: Vec<GitDiffFile>,
}

#[derive(Serialize)]
pub struct GitPullResult {
    pub ahead: usize,
    pub behind: usize,
    pub conflicts: Vec<String>,
}

#[tauri::command]
pub fn git_checkout_branch(path: String, branch: String, create: Option<bool>) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let create = create.unwrap_or(false);

    if create {
        let head = repo.head().map_err(|e| e.to_string())?;
        let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;
        repo.branch(&branch, &head_commit, false)
            .map_err(|e| e.to_string())?;
    }

    let refname = format!("refs/heads/{}", branch);
    repo.set_head(&refname).map_err(|e| e.to_string())?;
    repo.checkout_head(Some(
        git2::build::CheckoutBuilder::new()
            .safe()
            .force(),
    ))
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_delete_branch(path: String, branch: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;

    // Refuse to delete HEAD branch
    if let Ok(head) = repo.head() {
        if let Some(name) = head.shorthand() {
            if name == branch {
                return Err("Cannot delete the currently checked out branch".to_string());
            }
        }
    }

    let mut branch_ref = repo
        .find_branch(&branch, git2::BranchType::Local)
        .map_err(|e| e.to_string())?;
    branch_ref.delete().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn git_stash_list(path: String) -> Result<Vec<GitStashEntry>, String> {
    let mut repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut stashes = Vec::new();

    repo.stash_foreach(|index, message, _oid| {
        stashes.push(GitStashEntry {
            index,
            message: message.to_string(),
            time: 0, // stash_foreach doesn't give commit time directly
        });
        true
    })
    .map_err(|e| e.to_string())?;

    // Enrich with time from stash commits
    for stash in &mut stashes {
        if let Ok(mut revwalk) = repo.revwalk() {
            if revwalk.push_ref(&format!("refs/stash@{{{}}}", stash.index)).is_ok() {
                // fallback: just use 0
            }
        }
    }

    Ok(stashes)
}

#[tauri::command]
pub fn git_stash_drop(path: String, index: usize) -> Result<(), String> {
    let mut repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    repo.stash_drop(index).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_stash_apply(path: String, index: usize) -> Result<(), String> {
    let mut repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    repo.stash_apply(index, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_show_commit(path: String, commit_id: String) -> Result<GitCommitDetail, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

    let tree = commit.tree().map_err(|e| e.to_string())?;
    let parent_tree = commit
        .parent(0)
        .ok()
        .and_then(|p| p.tree().ok());

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    for (idx, delta) in diff.deltas().enumerate() {
        let file_path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Modified => "modified",
            git2::Delta::Renamed => "renamed",
            git2::Delta::Copied => "copied",
            _ => "unknown",
        }
        .to_string();

        let patch = git2::Patch::from_diff(&diff, idx)
            .ok()
            .flatten()
            .and_then(|mut p| {
                p.to_buf().ok().map(|b| b.as_str().unwrap_or("").to_string())
            });

        let (additions, deletions) = git2::Patch::from_diff(&diff, idx)
            .ok()
            .flatten()
            .map(|p| {
                let (_, adds, dels) = p.line_stats().unwrap_or((0, 0, 0));
                (adds, dels)
            })
            .unwrap_or((0, 0));

        files.push(GitDiffFile {
            path: file_path,
            status,
            additions,
            deletions,
            patch,
        });
    }

    let author_name = commit.author().name().unwrap_or("").to_string();
    let author_email = commit.author().email().unwrap_or("").to_string();
    let message = commit.message().unwrap_or("").to_string();
    let time = commit.time().seconds();

    Ok(GitCommitDetail {
        id: commit_id,
        message,
        author: author_name,
        email: author_email,
        time,
        files,
    })
}

#[tauri::command]
pub fn git_discard_file(path: String, file_path: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    repo.checkout_head(Some(
        git2::build::CheckoutBuilder::new()
            .force()
            .path(&file_path),
    ))
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_pull(path: String) -> Result<GitPullResult, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;

    // Find remote
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;

    // Get current branch name
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch_name = head
        .shorthand()
        .ok_or("Detached HEAD")?
        .to_string();

    // Fetch
    remote
        .fetch(&[&branch_name], None, None)
        .map_err(|e| e.to_string())?;

    // Get fetch head
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;

    // Merge analysis
    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;

    let mut conflicts = Vec::new();

    if analysis.is_up_to_date() {
        // Nothing to do
    } else if analysis.is_fast_forward() {
        // Fast-forward
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo.find_reference(&refname).map_err(|e| e.to_string())?;
        reference
            .set_target(fetch_commit.id(), "fast-forward")
            .map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .map_err(|e| e.to_string())?;
    } else if analysis.is_normal() {
        // Normal merge
        let fetch_commit_obj = repo
            .find_commit(fetch_commit.id())
            .map_err(|e| e.to_string())?;
        repo.merge(&[&fetch_commit], None, None)
            .map_err(|e| e.to_string())?;

        // Check for conflicts
        let index = repo.index().map_err(|e| e.to_string())?;
        if index.has_conflicts() {
            for conflict in index.conflicts().map_err(|e| e.to_string())? {
                if let Ok(conflict) = conflict {
                    if let Some(our) = conflict.our {
                        let p = String::from_utf8_lossy(&our.path).to_string();
                        conflicts.push(p);
                    }
                }
            }
        } else {
            // Auto-commit the merge
            let sig = repo
                .signature()
                .or_else(|_| Signature::now("Workstation", "workstation@local"))
                .map_err(|e| e.to_string())?;
            let mut index = repo.index().map_err(|e| e.to_string())?;
            let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
            let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
            let head_commit = repo
                .head()
                .and_then(|h| h.peel_to_commit())
                .map_err(|e| e.to_string())?;

            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                &format!("Merge branch '{}' from origin", branch_name),
                &tree,
                &[&head_commit, &fetch_commit_obj],
            )
            .map_err(|e| e.to_string())?;
            repo.cleanup_state().map_err(|e| e.to_string())?;
        }
    }

    // Calculate ahead/behind after merge
    let local_oid = repo
        .head()
        .and_then(|h| h.target().ok_or(git2::Error::from_str("no target")))
        .map_err(|e| e.to_string())?;
    let upstream_ref = format!("refs/remotes/origin/{}", branch_name);
    let (ahead, behind) = if let Ok(remote_ref) = repo.find_reference(&upstream_ref) {
        if let Some(remote_oid) = remote_ref.target() {
            repo.graph_ahead_behind(local_oid, remote_oid)
                .unwrap_or((0, 0))
        } else {
            (0, 0)
        }
    } else {
        (0, 0)
    };

    Ok(GitPullResult {
        ahead,
        behind,
        conflicts,
    })
}

#[tauri::command]
pub fn git_push(path: String, force_with_lease: Option<bool>) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch_name = head
        .shorthand()
        .ok_or("Detached HEAD")?
        .to_string();

    let refspec = if force_with_lease.unwrap_or(false) {
        format!("+refs/heads/{}:refs/heads/{}", branch_name, branch_name)
    } else {
        format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name)
    };

    remote
        .push(&[&refspec], None)
        .map_err(|e| e.to_string())?;

    Ok(())
}
