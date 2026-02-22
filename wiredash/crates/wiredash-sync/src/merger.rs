#[derive(Debug, PartialEq)]
pub enum MergeResult {
    /// Take the remote item (overwrite local).
    TakeRemote(serde_json::Value),
    /// Keep local, store remote as conflicted copy.
    Conflict {
        local: serde_json::Value,
        remote: serde_json::Value,
    },
    /// Skip — keep local as-is.
    Skip,
}

pub struct Merger;

impl Merger {
    /// Generic item merge: last-write-wins on dateModified.
    pub fn merge_item(
        local: Option<&serde_json::Value>,
        remote: &serde_json::Value,
    ) -> Option<serde_json::Value> {
        match local {
            None => Some(remote.clone()),
            Some(local_item) => {
                let local_dm = local_item.get("dateModified")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let remote_dm = remote.get("dateModified")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);

                if remote_dm > local_dm {
                    Some(remote.clone())
                } else {
                    None
                }
            }
        }
    }

    /// Content item merge with conflict detection.
    pub fn merge_content(
        local: Option<&serde_json::Value>,
        remote: &serde_json::Value,
        conflict_threshold_ms: i64,
    ) -> MergeResult {
        let local_item = match local {
            None => return MergeResult::TakeRemote(remote.clone()),
            Some(l) => l,
        };

        // If local has localOnly flag, skip entirely
        let local_only = local_item.get("localOnly")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .unwrap_or(false);
        if local_only {
            return MergeResult::Skip;
        }

        // If either is deleted, fall through to basic merge
        let local_deleted = local_item.get("deleted")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .unwrap_or(false);
        let remote_deleted = remote.get("deleted")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .unwrap_or(false);
        if local_deleted || remote_deleted {
            return match Self::merge_item(Some(local_item), remote) {
                Some(r) => MergeResult::TakeRemote(r),
                None => MergeResult::Skip,
            };
        }

        // Check if data fields exist
        let local_data = local_item.get("data").and_then(|v| v.as_str());
        let remote_data = remote.get("data").and_then(|v| v.as_str());
        if local_data.is_none() || remote_data.is_none() {
            return match Self::merge_item(Some(local_item), remote) {
                Some(r) => MergeResult::TakeRemote(r),
                None => MergeResult::Skip,
            };
        }

        // Check resolved state
        let date_resolved = local_item.get("dateResolved").and_then(|v| v.as_i64());
        let remote_dm = remote.get("dateModified").and_then(|v| v.as_i64()).unwrap_or(0);
        let is_resolved = date_resolved.map(|dr| dr == remote_dm).unwrap_or(false);

        // Check if local was edited (synced = false means local has unsynced changes)
        let is_edited = local_item.get("synced")
            .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
            .map(|synced| !synced)
            .unwrap_or(true);

        if is_edited && !is_resolved {
            let local_de = local_item.get("dateEdited").and_then(|v| v.as_i64()).unwrap_or(0);
            let remote_de = remote.get("dateEdited").and_then(|v| v.as_i64()).unwrap_or(0);
            let time_diff = (remote_de - local_de).abs();

            if time_diff < conflict_threshold_ms || local_data == remote_data {
                // Within threshold or same content → last-write-wins
                let local_dm = local_item.get("dateModified").and_then(|v| v.as_i64()).unwrap_or(0);
                if remote_dm > local_dm {
                    MergeResult::TakeRemote(remote.clone())
                } else {
                    MergeResult::Skip
                }
            } else {
                // Real conflict
                MergeResult::Conflict {
                    local: local_item.clone(),
                    remote: remote.clone(),
                }
            }
        } else if !is_resolved {
            // Local not edited → take remote
            MergeResult::TakeRemote(remote.clone())
        } else {
            // Resolved → skip
            MergeResult::Skip
        }
    }
}
