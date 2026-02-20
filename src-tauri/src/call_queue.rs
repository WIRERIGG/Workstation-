use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QueuedCall {
    pub id: String,
    pub contact_id: String,
    pub contact_name: String,
    pub phone: String,
    pub reason: String,
    pub priority: u8,      // 1 = highest
    pub status: String,    // "queued" | "in_progress" | "completed" | "failed"
    pub queued_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub notes: String,
}

/// In-memory call queue (persisted via Tauri state, could be backed by LanceDB).
pub struct CallQueue {
    calls: Vec<QueuedCall>,
}

impl CallQueue {
    pub fn new() -> Self {
        Self { calls: Vec::new() }
    }

    /// Add a call to the queue.
    pub fn enqueue(
        &mut self,
        contact_id: String,
        contact_name: String,
        phone: String,
        reason: String,
        priority: u8,
    ) -> QueuedCall {
        let call = QueuedCall {
            id: Uuid::new_v4().to_string(),
            contact_id,
            contact_name,
            phone,
            reason,
            priority,
            status: "queued".into(),
            queued_at: Utc::now().to_rfc3339(),
            started_at: None,
            completed_at: None,
            notes: String::new(),
        };
        self.calls.push(call.clone());
        // Sort by priority (lower number = higher priority)
        self.calls.sort_by_key(|c| c.priority);
        call
    }

    /// Get the next call to make (highest priority, status = queued).
    pub fn next(&self) -> Option<&QueuedCall> {
        self.calls.iter().find(|c| c.status == "queued")
    }

    /// Mark a call as started.
    pub fn start_call(&mut self, call_id: &str) -> Option<&QueuedCall> {
        if let Some(call) = self.calls.iter_mut().find(|c| c.id == call_id) {
            call.status = "in_progress".into();
            call.started_at = Some(Utc::now().to_rfc3339());
            return Some(call);
        }
        None
    }

    /// Mark a call as completed.
    pub fn complete_call(&mut self, call_id: &str, notes: String) -> Option<&QueuedCall> {
        if let Some(call) = self.calls.iter_mut().find(|c| c.id == call_id) {
            call.status = "completed".into();
            call.completed_at = Some(Utc::now().to_rfc3339());
            call.notes = notes;
            return Some(call);
        }
        None
    }

    /// Get all calls (for display).
    pub fn list(&self) -> &[QueuedCall] {
        &self.calls
    }

    /// Get queued + in_progress calls.
    pub fn active(&self) -> Vec<&QueuedCall> {
        self.calls
            .iter()
            .filter(|c| c.status == "queued" || c.status == "in_progress")
            .collect()
    }
}
