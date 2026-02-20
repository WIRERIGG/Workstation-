use std::sync::Arc;

use arrow_array::{Array, ArrayRef, RecordBatch, RecordBatchIterator, StringArray};
use arrow_schema::{DataType, Field, Schema};
use chrono::Utc;
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ═══════════════════════════════════════════════════════
// Models
// ═══════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub business_name: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CallLog {
    pub id: String,
    pub contact_id: String,
    pub direction: String, // "inbound" | "outbound"
    pub duration_secs: i64,
    pub summary: String,
    pub sentiment: String, // "positive" | "neutral" | "negative"
    pub action_items: String, // JSON array as string
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Email {
    pub id: String,
    pub contact_id: String,
    pub subject: String,
    pub body: String,
    pub direction: String, // "sent" | "received"
    pub status: String,    // "draft" | "sent" | "read"
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Appointment {
    pub id: String,
    pub contact_id: String,
    pub title: String,
    pub description: String,
    pub start_time: String,
    pub end_time: String,
    pub status: String, // "scheduled" | "completed" | "cancelled"
    pub reminder_sent: String, // "true" | "false" — stored as string for Arrow simplicity
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentMemoryEntry {
    pub id: String,
    pub agent_id: String,
    pub key: String,
    pub value: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BusinessProfile {
    pub id: String,
    pub name: String,
    pub industry: String,
    pub questionnaire_json: String, // full 25-question answers as JSON
    pub created_at: String,
}

// ═══════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════

fn contacts_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, false),
        Field::new("email", DataType::Utf8, true),
        Field::new("phone", DataType::Utf8, true),
        Field::new("business_name", DataType::Utf8, true),
        Field::new("notes", DataType::Utf8, true),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
        // Embedding for semantic search over contact notes
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                384,
            ),
            true,
        ),
    ]))
}

fn call_logs_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("contact_id", DataType::Utf8, true),
        Field::new("direction", DataType::Utf8, false),
        Field::new("duration_secs", DataType::Utf8, false), // stored as string
        Field::new("summary", DataType::Utf8, true),
        Field::new("sentiment", DataType::Utf8, true),
        Field::new("action_items", DataType::Utf8, true),
        Field::new("timestamp", DataType::Utf8, false),
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                384,
            ),
            true,
        ),
    ]))
}

fn emails_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("contact_id", DataType::Utf8, true),
        Field::new("subject", DataType::Utf8, false),
        Field::new("body", DataType::Utf8, false),
        Field::new("direction", DataType::Utf8, false),
        Field::new("status", DataType::Utf8, false),
        Field::new("timestamp", DataType::Utf8, false),
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                384,
            ),
            true,
        ),
    ]))
}

fn appointments_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("contact_id", DataType::Utf8, true),
        Field::new("title", DataType::Utf8, false),
        Field::new("description", DataType::Utf8, true),
        Field::new("start_time", DataType::Utf8, false),
        Field::new("end_time", DataType::Utf8, false),
        Field::new("status", DataType::Utf8, false),
        Field::new("reminder_sent", DataType::Utf8, false),
    ]))
}

fn agent_memory_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("agent_id", DataType::Utf8, false),
        Field::new("key", DataType::Utf8, false),
        Field::new("value", DataType::Utf8, false),
        Field::new("timestamp", DataType::Utf8, false),
        Field::new(
            "embedding",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                384,
            ),
            true,
        ),
    ]))
}

fn business_profile_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, false),
        Field::new("industry", DataType::Utf8, true),
        Field::new("questionnaire_json", DataType::Utf8, true),
        Field::new("created_at", DataType::Utf8, false),
    ]))
}

// ═══════════════════════════════════════════════════════
// Arrow helpers
// ═══════════════════════════════════════════════════════

/// Create a FixedSizeList(Float32, 384) column of null embeddings for `n` rows.
/// Real embeddings would come from a local model; nulls are placeholders.
fn null_embeddings(n: usize) -> ArrayRef {
    use arrow_array::builder::{FixedSizeListBuilder, Float32Builder};
    let mut builder = FixedSizeListBuilder::new(Float32Builder::new(), 384);
    for _ in 0..n {
        // append(false) = null entry
        for _ in 0..384 {
            builder.values().append_value(0.0);
        }
        builder.append(false);
    }
    Arc::new(builder.finish())
}

/// Collect all rows from a LanceDB query stream into RecordBatches.
async fn collect_batches(
    stream: impl futures::Stream<Item = Result<RecordBatch, lancedb::Error>>,
) -> anyhow::Result<Vec<RecordBatch>> {
    let batches: Vec<RecordBatch> = stream.try_collect().await?;
    Ok(batches)
}

/// Read a Utf8 column by index from a batch, returning strings for each row.
fn read_utf8_col(batch: &RecordBatch, col: usize) -> Vec<String> {
    let arr = batch
        .column(col)
        .as_any()
        .downcast_ref::<StringArray>()
        .expect("expected Utf8 column");
    (0..arr.len())
        .map(|i| {
            if arr.is_null(i) {
                String::new()
            } else {
                arr.value(i).to_string()
            }
        })
        .collect()
}

// ═══════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════

pub struct Storage {
    db: Connection,
}

impl Storage {
    pub async fn new(path: &str) -> anyhow::Result<Self> {
        // Ensure the data directory exists
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        let db = lancedb::connect(path).execute().await?;
        let storage = Self { db };
        storage.init_tables().await?;
        Ok(storage)
    }

    /// Create all tables if they don't already exist.
    async fn init_tables(&self) -> anyhow::Result<()> {
        let tables = [
            ("contacts", contacts_schema()),
            ("call_logs", call_logs_schema()),
            ("emails", emails_schema()),
            ("appointments", appointments_schema()),
            ("agent_memory", agent_memory_schema()),
            ("business_profile", business_profile_schema()),
        ];

        let existing = self.db.table_names().execute().await?;

        for (name, schema) in tables {
            if !existing.iter().any(|n| n == name) {
                self.db
                    .create_empty_table(name, schema)
                    .execute()
                    .await?;
                log::info!("Created table: {name}");
            }
        }
        Ok(())
    }

    // ─── Contacts ────────────────────────────────────

    pub async fn add_contact(&self, contact: Contact) -> anyhow::Result<Contact> {
        let mut c = contact;
        if c.id.is_empty() {
            c.id = Uuid::new_v4().to_string();
        }
        let now = Utc::now().to_rfc3339();
        if c.created_at.is_empty() {
            c.created_at = now.clone();
        }
        c.updated_at = now;

        let schema = contacts_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![c.id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![c.name.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![c.email.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![c.phone.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![c.business_name.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![c.notes.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![c.created_at.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![c.updated_at.as_str()])) as ArrayRef,
                null_embeddings(1),
            ],
        )?;

        let table = self.db.open_table("contacts").execute().await?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(c)
    }

    pub async fn list_contacts(&self) -> anyhow::Result<Vec<Contact>> {
        let table = self.db.open_table("contacts").execute().await?;
        let stream = table.query().execute().await?;
        let batches = collect_batches(stream).await?;

        let mut contacts = Vec::new();
        for batch in &batches {
            let ids = read_utf8_col(batch, 0);
            let names = read_utf8_col(batch, 1);
            let emails = read_utf8_col(batch, 2);
            let phones = read_utf8_col(batch, 3);
            let biz = read_utf8_col(batch, 4);
            let notes = read_utf8_col(batch, 5);
            let created = read_utf8_col(batch, 6);
            let updated = read_utf8_col(batch, 7);

            for i in 0..batch.num_rows() {
                contacts.push(Contact {
                    id: ids[i].clone(),
                    name: names[i].clone(),
                    email: emails[i].clone(),
                    phone: phones[i].clone(),
                    business_name: biz[i].clone(),
                    notes: notes[i].clone(),
                    created_at: created[i].clone(),
                    updated_at: updated[i].clone(),
                });
            }
        }
        Ok(contacts)
    }

    pub async fn search_contacts_semantic(
        &self,
        query_embedding: Vec<f32>,
        limit: usize,
    ) -> anyhow::Result<Vec<Contact>> {
        let table = self.db.open_table("contacts").execute().await?;
        let stream = table
            .vector_search(query_embedding)?
            .limit(limit)
            .execute()
            .await?;
        let batches = collect_batches(stream).await?;

        let mut contacts = Vec::new();
        for batch in &batches {
            let ids = read_utf8_col(batch, 0);
            let names = read_utf8_col(batch, 1);
            let emails = read_utf8_col(batch, 2);
            let phones = read_utf8_col(batch, 3);
            let biz = read_utf8_col(batch, 4);
            let notes = read_utf8_col(batch, 5);
            let created = read_utf8_col(batch, 6);
            let updated = read_utf8_col(batch, 7);

            for i in 0..batch.num_rows() {
                contacts.push(Contact {
                    id: ids[i].clone(),
                    name: names[i].clone(),
                    email: emails[i].clone(),
                    phone: phones[i].clone(),
                    business_name: biz[i].clone(),
                    notes: notes[i].clone(),
                    created_at: created[i].clone(),
                    updated_at: updated[i].clone(),
                });
            }
        }
        Ok(contacts)
    }

    // ─── Call Logs ───────────────────────────────────

    pub async fn add_call_log(&self, log: CallLog) -> anyhow::Result<CallLog> {
        let mut cl = log;
        if cl.id.is_empty() {
            cl.id = Uuid::new_v4().to_string();
        }
        if cl.timestamp.is_empty() {
            cl.timestamp = Utc::now().to_rfc3339();
        }

        let schema = call_logs_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![cl.id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![cl.contact_id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![cl.direction.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![cl.duration_secs.to_string().as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![cl.summary.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![cl.sentiment.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![cl.action_items.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![cl.timestamp.as_str()])) as ArrayRef,
                null_embeddings(1),
            ],
        )?;

        let table = self.db.open_table("call_logs").execute().await?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(cl)
    }

    pub async fn list_call_logs(&self) -> anyhow::Result<Vec<CallLog>> {
        let table = self.db.open_table("call_logs").execute().await?;
        let stream = table.query().execute().await?;
        let batches = collect_batches(stream).await?;

        let mut logs = Vec::new();
        for batch in &batches {
            let ids = read_utf8_col(batch, 0);
            let contacts = read_utf8_col(batch, 1);
            let dirs = read_utf8_col(batch, 2);
            let durations = read_utf8_col(batch, 3);
            let summaries = read_utf8_col(batch, 4);
            let sentiments = read_utf8_col(batch, 5);
            let actions = read_utf8_col(batch, 6);
            let timestamps = read_utf8_col(batch, 7);

            for i in 0..batch.num_rows() {
                logs.push(CallLog {
                    id: ids[i].clone(),
                    contact_id: contacts[i].clone(),
                    direction: dirs[i].clone(),
                    duration_secs: durations[i].parse().unwrap_or(0),
                    summary: summaries[i].clone(),
                    sentiment: sentiments[i].clone(),
                    action_items: actions[i].clone(),
                    timestamp: timestamps[i].clone(),
                });
            }
        }
        Ok(logs)
    }

    // ─── Emails ──────────────────────────────────────

    pub async fn add_email(&self, email: Email) -> anyhow::Result<Email> {
        let mut e = email;
        if e.id.is_empty() {
            e.id = Uuid::new_v4().to_string();
        }
        if e.timestamp.is_empty() {
            e.timestamp = Utc::now().to_rfc3339();
        }

        let schema = emails_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![e.id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![e.contact_id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![e.subject.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![e.body.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![e.direction.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![e.status.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![e.timestamp.as_str()])) as ArrayRef,
                null_embeddings(1),
            ],
        )?;

        let table = self.db.open_table("emails").execute().await?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(e)
    }

    pub async fn list_emails(&self) -> anyhow::Result<Vec<Email>> {
        let table = self.db.open_table("emails").execute().await?;
        let stream = table.query().execute().await?;
        let batches = collect_batches(stream).await?;

        let mut emails = Vec::new();
        for batch in &batches {
            let ids = read_utf8_col(batch, 0);
            let contacts = read_utf8_col(batch, 1);
            let subjects = read_utf8_col(batch, 2);
            let bodies = read_utf8_col(batch, 3);
            let dirs = read_utf8_col(batch, 4);
            let statuses = read_utf8_col(batch, 5);
            let timestamps = read_utf8_col(batch, 6);

            for i in 0..batch.num_rows() {
                emails.push(Email {
                    id: ids[i].clone(),
                    contact_id: contacts[i].clone(),
                    subject: subjects[i].clone(),
                    body: bodies[i].clone(),
                    direction: dirs[i].clone(),
                    status: statuses[i].clone(),
                    timestamp: timestamps[i].clone(),
                });
            }
        }
        Ok(emails)
    }

    // ─── Appointments ────────────────────────────────

    pub async fn create_appointment(&self, apt: Appointment) -> anyhow::Result<Appointment> {
        let mut a = apt;
        if a.id.is_empty() {
            a.id = Uuid::new_v4().to_string();
        }
        if a.status.is_empty() {
            a.status = "scheduled".into();
        }

        let schema = appointments_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![a.id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![a.contact_id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![a.title.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![a.description.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![a.start_time.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![a.end_time.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![a.status.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![a.reminder_sent.as_str()])) as ArrayRef,
            ],
        )?;

        let table = self.db.open_table("appointments").execute().await?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(a)
    }

    pub async fn list_appointments(&self) -> anyhow::Result<Vec<Appointment>> {
        let table = self.db.open_table("appointments").execute().await?;
        let stream = table.query().execute().await?;
        let batches = collect_batches(stream).await?;

        let mut apts = Vec::new();
        for batch in &batches {
            let ids = read_utf8_col(batch, 0);
            let contacts = read_utf8_col(batch, 1);
            let titles = read_utf8_col(batch, 2);
            let descs = read_utf8_col(batch, 3);
            let starts = read_utf8_col(batch, 4);
            let ends = read_utf8_col(batch, 5);
            let statuses = read_utf8_col(batch, 6);
            let reminders = read_utf8_col(batch, 7);

            for i in 0..batch.num_rows() {
                apts.push(Appointment {
                    id: ids[i].clone(),
                    contact_id: contacts[i].clone(),
                    title: titles[i].clone(),
                    description: descs[i].clone(),
                    start_time: starts[i].clone(),
                    end_time: ends[i].clone(),
                    status: statuses[i].clone(),
                    reminder_sent: reminders[i].clone(),
                });
            }
        }
        Ok(apts)
    }

    // ─── Agent Memory ────────────────────────────────

    pub async fn set_agent_memory(
        &self,
        agent_id: &str,
        key: &str,
        value: &str,
    ) -> anyhow::Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let schema = agent_memory_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![agent_id])) as ArrayRef,
                Arc::new(StringArray::from(vec![key])) as ArrayRef,
                Arc::new(StringArray::from(vec![value])) as ArrayRef,
                Arc::new(StringArray::from(vec![now.as_str()])) as ArrayRef,
                null_embeddings(1),
            ],
        )?;

        let table = self.db.open_table("agent_memory").execute().await?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(())
    }

    pub async fn get_agent_memory(
        &self,
        agent_id: &str,
    ) -> anyhow::Result<Vec<AgentMemoryEntry>> {
        let table = self.db.open_table("agent_memory").execute().await?;
        let stream = table
            .query()
            .only_if(format!("agent_id = '{agent_id}'"))
            .execute()
            .await?;
        let batches = collect_batches(stream).await?;

        let mut entries = Vec::new();
        for batch in &batches {
            let ids = read_utf8_col(batch, 0);
            let agents = read_utf8_col(batch, 1);
            let keys = read_utf8_col(batch, 2);
            let values = read_utf8_col(batch, 3);
            let timestamps = read_utf8_col(batch, 4);

            for i in 0..batch.num_rows() {
                entries.push(AgentMemoryEntry {
                    id: ids[i].clone(),
                    agent_id: agents[i].clone(),
                    key: keys[i].clone(),
                    value: values[i].clone(),
                    timestamp: timestamps[i].clone(),
                });
            }
        }
        Ok(entries)
    }

    /// Semantic search across all tables with embeddings.
    pub async fn semantic_search(
        &self,
        table_name: &str,
        query_embedding: Vec<f32>,
        limit: usize,
    ) -> anyhow::Result<Vec<serde_json::Value>> {
        let table = self.db.open_table(table_name).execute().await?;
        let stream = table
            .vector_search(query_embedding)?
            .limit(limit)
            .execute()
            .await?;
        let batches = collect_batches(stream).await?;

        // Return raw column data as JSON objects
        let mut results = Vec::new();
        for batch in &batches {
            let schema = batch.schema();
            for row in 0..batch.num_rows() {
                let mut obj = serde_json::Map::new();
                for (col_idx, field) in schema.fields().iter().enumerate() {
                    if field.name() == "embedding" {
                        continue; // skip embedding column in results
                    }
                    if let Some(arr) = batch.column(col_idx).as_any().downcast_ref::<StringArray>()
                    {
                        let val = if arr.is_null(row) {
                            serde_json::Value::Null
                        } else {
                            serde_json::Value::String(arr.value(row).to_string())
                        };
                        obj.insert(field.name().clone(), val);
                    }
                }
                results.push(serde_json::Value::Object(obj));
            }
        }
        Ok(results)
    }

    // ─── Business Profile ────────────────────────────

    pub async fn save_business_profile(&self, profile: BusinessProfile) -> anyhow::Result<()> {
        let mut p = profile;
        if p.id.is_empty() {
            p.id = "primary".into(); // single profile per install
        }
        if p.created_at.is_empty() {
            p.created_at = Utc::now().to_rfc3339();
        }

        let schema = business_profile_schema();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![p.id.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![p.name.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![p.industry.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![p.questionnaire_json.as_str()])) as ArrayRef,
                Arc::new(StringArray::from(vec![p.created_at.as_str()])) as ArrayRef,
            ],
        )?;

        let table = self.db.open_table("business_profile").execute().await?;
        let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
        table.add(reader).execute().await?;
        Ok(())
    }

    pub async fn get_business_profile(&self) -> anyhow::Result<Option<BusinessProfile>> {
        let table = self.db.open_table("business_profile").execute().await?;
        let stream = table.query().limit(1).execute().await?;
        let batches = collect_batches(stream).await?;

        if batches.is_empty() || batches[0].num_rows() == 0 {
            return Ok(None);
        }

        let batch = &batches[0];
        let ids = read_utf8_col(batch, 0);
        let names = read_utf8_col(batch, 1);
        let industries = read_utf8_col(batch, 2);
        let questionnaires = read_utf8_col(batch, 3);
        let created = read_utf8_col(batch, 4);

        Ok(Some(BusinessProfile {
            id: ids[0].clone(),
            name: names[0].clone(),
            industry: industries[0].clone(),
            questionnaire_json: questionnaires[0].clone(),
            created_at: created[0].clone(),
        }))
    }

    /// Check if this is the first launch (no business profile saved yet).
    pub async fn is_first_launch(&self) -> anyhow::Result<bool> {
        Ok(self.get_business_profile().await?.is_none())
    }
}
