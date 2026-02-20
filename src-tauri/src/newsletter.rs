use serde::{Deserialize, Serialize};

use crate::storage::{Contact, Storage};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NewsletterRequest {
    pub segment: String,   // "all" | "recent" | "high-value" | custom filter
    pub subject: String,
    pub template: String,  // template body with {{name}}, {{business}} placeholders
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NewsletterDraft {
    pub subject: String,
    pub recipients: Vec<NewsletterRecipient>,
    pub total: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NewsletterRecipient {
    pub contact_id: String,
    pub name: String,
    pub email: String,
    pub personalized_body: String,
}

/// Generate personalized newsletter drafts for a segment of contacts.
pub async fn generate(
    storage: &Storage,
    req: NewsletterRequest,
) -> anyhow::Result<NewsletterDraft> {
    let all_contacts = storage.list_contacts().await?;

    // Filter by segment
    let contacts: Vec<&Contact> = match req.segment.as_str() {
        "recent" => {
            // Contacts created in last 30 days
            let cutoff = chrono::Utc::now() - chrono::Duration::days(30);
            all_contacts
                .iter()
                .filter(|c| {
                    chrono::DateTime::parse_from_rfc3339(&c.created_at)
                        .map(|dt| dt > cutoff)
                        .unwrap_or(false)
                })
                .collect()
        }
        "all" | _ => all_contacts.iter().collect(),
    };

    let recipients: Vec<NewsletterRecipient> = contacts
        .iter()
        .filter(|c| !c.email.is_empty())
        .map(|c| {
            let body = req
                .template
                .replace("{{name}}", &c.name)
                .replace("{{business}}", &c.business_name);

            NewsletterRecipient {
                contact_id: c.id.clone(),
                name: c.name.clone(),
                email: c.email.clone(),
                personalized_body: body,
            }
        })
        .collect();

    let total = recipients.len();

    Ok(NewsletterDraft {
        subject: req.subject,
        recipients,
        total,
    })
}
