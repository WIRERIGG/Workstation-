use tauri::State;

use crate::storage::{
    Appointment, BusinessProfile, CallLog, Contact, Email,
};
use crate::AppState;

// ═══════════════════════════════════════════════════════
// AI Engine
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn zeroclaw_process(
    command: String,
    context: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut engine = state.engine.lock().await;
    let resp = engine.process(&command, context);
    serde_json::to_string(&resp).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Onboarding
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn is_first_launch(state: State<'_, AppState>) -> Result<bool, String> {
    let storage = state.storage.lock().await;
    storage.is_first_launch().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_questionnaire(
    name: String,
    industry: String,
    answers_json: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().await;
    storage
        .save_business_profile(BusinessProfile {
            id: String::new(),
            name,
            industry,
            questionnaire_json: answers_json,
            created_at: String::new(),
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_business_profile(
    state: State<'_, AppState>,
) -> Result<Option<BusinessProfile>, String> {
    let storage = state.storage.lock().await;
    storage
        .get_business_profile()
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Contacts
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn add_contact(contact: Contact, state: State<'_, AppState>) -> Result<Contact, String> {
    let storage = state.storage.lock().await;
    storage.add_contact(contact).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_contacts(state: State<'_, AppState>) -> Result<Vec<Contact>, String> {
    let storage = state.storage.lock().await;
    storage.list_contacts().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_contacts(
    query_embedding: Vec<f32>,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<Contact>, String> {
    let storage = state.storage.lock().await;
    storage
        .search_contacts_semantic(query_embedding, limit)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Call Logs
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn add_call_log(log: CallLog, state: State<'_, AppState>) -> Result<CallLog, String> {
    let storage = state.storage.lock().await;
    storage.add_call_log(log).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_call_logs(state: State<'_, AppState>) -> Result<Vec<CallLog>, String> {
    let storage = state.storage.lock().await;
    storage.list_call_logs().await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Emails
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn add_email(email: Email, state: State<'_, AppState>) -> Result<Email, String> {
    let storage = state.storage.lock().await;
    storage.add_email(email).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_emails(state: State<'_, AppState>) -> Result<Vec<Email>, String> {
    let storage = state.storage.lock().await;
    storage.list_emails().await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Appointments
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn create_appointment(
    appointment: Appointment,
    state: State<'_, AppState>,
) -> Result<Appointment, String> {
    let storage = state.storage.lock().await;
    storage
        .create_appointment(appointment)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_appointments(state: State<'_, AppState>) -> Result<Vec<Appointment>, String> {
    let storage = state.storage.lock().await;
    storage
        .list_appointments()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_appointment_status(
    _id: String,
    _status: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    // LanceDB doesn't have in-place updates — would need delete + re-insert
    // or use a separate status tracking table. Stubbed for now.
    Ok(())
}

// ═══════════════════════════════════════════════════════
// Agent Memory
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn get_agent_memory(
    agent_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::AgentMemoryEntry>, String> {
    let storage = state.storage.lock().await;
    storage
        .get_agent_memory(&agent_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_agent_memory(
    agent_id: String,
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let storage = state.storage.lock().await;
    storage
        .set_agent_memory(&agent_id, &key, &value)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Semantic Search
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn semantic_search(
    table: String,
    query_embedding: Vec<f32>,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let storage = state.storage.lock().await;
    storage
        .semantic_search(&table, query_embedding, limit)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Scheduler
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn schedule_auto_followup(
    contact_id: String,
    reason: String,
    delay_hours: i64,
    auto_email: bool,
    state: State<'_, AppState>,
) -> Result<crate::scheduler::FollowUpResult, String> {
    let storage = state.storage.lock().await;
    crate::scheduler::schedule_followup(
        &storage,
        crate::scheduler::FollowUpRequest {
            contact_id,
            reason,
            delay_hours,
            auto_email,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Newsletter
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn generate_newsletter(
    segment: String,
    subject: String,
    template: String,
    state: State<'_, AppState>,
) -> Result<crate::newsletter::NewsletterDraft, String> {
    let storage = state.storage.lock().await;
    crate::newsletter::generate(
        &storage,
        crate::newsletter::NewsletterRequest {
            segment,
            subject,
            template,
        },
    )
    .await
    .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════
// Call Queue
// ═══════════════════════════════════════════════════════

#[tauri::command]
pub async fn queue_calls(
    calls: Vec<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::call_queue::QueuedCall>, String> {
    let mut queue = state.call_queue.lock().await;
    let mut queued = Vec::new();

    for call in calls {
        let contact_id = call["contact_id"].as_str().unwrap_or("").to_string();
        let contact_name = call["contact_name"].as_str().unwrap_or("").to_string();
        let phone = call["phone"].as_str().unwrap_or("").to_string();
        let reason = call["reason"].as_str().unwrap_or("").to_string();
        let priority = call["priority"].as_u64().unwrap_or(5) as u8;

        let q = queue.enqueue(contact_id, contact_name, phone, reason, priority);
        queued.push(q);
    }

    Ok(queued)
}

#[tauri::command]
pub async fn get_call_queue(
    state: State<'_, AppState>,
) -> Result<Vec<crate::call_queue::QueuedCall>, String> {
    let queue = state.call_queue.lock().await;
    Ok(queue.list().to_vec())
}
