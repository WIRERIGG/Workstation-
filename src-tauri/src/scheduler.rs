use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::storage::{Appointment, Storage};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FollowUpRequest {
    pub contact_id: String,
    pub reason: String,
    pub delay_hours: i64,
    pub auto_email: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FollowUpResult {
    pub appointment_id: String,
    pub scheduled_for: String,
    pub email_queued: bool,
}

/// Schedule an automatic follow-up appointment for a contact.
pub async fn schedule_followup(
    storage: &Storage,
    req: FollowUpRequest,
) -> anyhow::Result<FollowUpResult> {
    let start: DateTime<Utc> = Utc::now() + Duration::hours(req.delay_hours);
    let end = start + Duration::minutes(30);

    let apt = storage
        .create_appointment(Appointment {
            id: String::new(),
            contact_id: req.contact_id,
            title: format!("Follow-up: {}", req.reason),
            description: req.reason.clone(),
            start_time: start.to_rfc3339(),
            end_time: end.to_rfc3339(),
            status: "scheduled".into(),
            reminder_sent: "false".into(),
        })
        .await?;

    // In production, this would enqueue an email via the comms pipeline.
    // For now we just flag it.
    let email_queued = req.auto_email;

    Ok(FollowUpResult {
        appointment_id: apt.id,
        scheduled_for: start.to_rfc3339(),
        email_queued,
    })
}

/// Scan appointments and return any that need reminders sent.
pub async fn check_due_reminders(storage: &Storage) -> anyhow::Result<Vec<Appointment>> {
    let all = storage.list_appointments().await?;
    let now = Utc::now();
    let reminder_window = Duration::minutes(30);

    let due: Vec<Appointment> = all
        .into_iter()
        .filter(|apt| {
            if apt.status != "scheduled" || apt.reminder_sent == "true" {
                return false;
            }
            if let Ok(start) = DateTime::parse_from_rfc3339(&apt.start_time) {
                let until_start = start.signed_duration_since(now);
                return until_start > Duration::zero() && until_start <= reminder_window;
            }
            false
        })
        .collect();

    Ok(due)
}
