use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type Timestamp = i64;

fn now_ms() -> Timestamp {
    chrono::Utc::now().timestamp_millis()
}

// ---------------------------------------------------------------------------
// BaseItem — common fields for every entity
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BaseItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(rename = "dateCreated")]
    pub date_created: Timestamp,
    #[serde(rename = "dateModified")]
    pub date_modified: Timestamp,
    pub synced: bool,
    pub deleted: bool,
}

impl BaseItem {
    pub fn new(item_type: &str) -> Self {
        let now = now_ms();
        Self {
            id: Uuid::new_v4().to_string(),
            item_type: item_type.to_string(),
            date_created: now,
            date_modified: now,
            synced: false,
            deleted: false,
        }
    }
}

// ---------------------------------------------------------------------------
// TrashMeta — optional trash metadata embedded in Note / Notebook
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TrashMeta {
    #[serde(rename = "dateDeleted")]
    pub date_deleted: Option<Timestamp>,
    #[serde(rename = "itemType")]
    pub item_type: Option<String>,
    #[serde(rename = "deletedBy")]
    pub deleted_by: Option<String>,
}

// ---------------------------------------------------------------------------
// 1. Note
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Note {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(flatten)]
    pub trash: TrashMeta,
    pub title: String,
    pub headline: Option<String>,
    #[serde(rename = "contentId")]
    pub content_id: Option<String>,
    pub pinned: bool,
    pub favorite: bool,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub conflicted: bool,
    pub readonly: bool,
    #[serde(rename = "dateEdited")]
    pub date_edited: Timestamp,
    #[serde(rename = "isGeneratedTitle")]
    pub is_generated_title: Option<bool>,
    pub archived: Option<bool>,
    #[serde(rename = "expiryDate")]
    pub expiry_date: Option<serde_json::Value>,
}

impl Note {
    pub fn new(title: &str) -> Self {
        Self {
            base: BaseItem::new("note"),
            trash: TrashMeta::default(),
            title: title.to_string(),
            headline: None,
            content_id: None,
            pinned: false,
            favorite: false,
            local_only: false,
            conflicted: false,
            readonly: false,
            date_edited: now_ms(),
            is_generated_title: None,
            archived: None,
            expiry_date: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Notebook
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Notebook {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(flatten)]
    pub trash: TrashMeta,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "dateEdited")]
    pub date_edited: Timestamp,
    pub pinned: bool,
}

impl Notebook {
    pub fn new(title: &str) -> Self {
        Self {
            base: BaseItem::new("notebook"),
            trash: TrashMeta::default(),
            title: title.to_string(),
            description: None,
            date_edited: now_ms(),
            pinned: false,
        }
    }
}

// ---------------------------------------------------------------------------
// 3. ContentItem
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentItem {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "noteId")]
    pub note_id: Option<String>,
    pub data: Option<String>,
    pub locked: bool,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub conflicted: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "dateEdited")]
    pub date_edited: Timestamp,
    #[serde(rename = "dateResolved")]
    pub date_resolved: Option<Timestamp>,
}

impl Default for ContentItem {
    fn default() -> Self {
        Self::new()
    }
}

impl ContentItem {
    pub fn new() -> Self {
        Self {
            base: BaseItem::new("content"),
            note_id: None,
            data: None,
            locked: false,
            local_only: false,
            conflicted: None,
            session_id: None,
            date_edited: now_ms(),
            date_resolved: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 4. Tag
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tag {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
}

impl Tag {
    pub fn new(title: &str) -> Self {
        Self {
            base: BaseItem::new("tag"),
            title: title.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 5. Color
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Color {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    #[serde(rename = "colorCode")]
    pub color_code: String,
}

impl Color {
    pub fn new(title: &str, color_code: &str) -> Self {
        Self {
            base: BaseItem::new("color"),
            title: title.to_string(),
            color_code: color_code.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 6. Attachment
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Attachment {
    #[serde(flatten)]
    pub base: BaseItem,
    pub iv: String,
    pub salt: String,
    pub size: i64,
    pub alg: String,
    pub key: String,
    #[serde(rename = "chunkSize")]
    pub chunk_size: i64,
    pub hash: String,
    #[serde(rename = "hashType")]
    pub hash_type: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub filename: String,
    #[serde(rename = "dateDeleted")]
    pub date_deleted: Option<Timestamp>,
    #[serde(rename = "dateUploaded")]
    pub date_uploaded: Option<Timestamp>,
    pub failed: Option<String>,
}

impl Attachment {
    pub fn new(hash: &str, mime_type: &str, filename: &str, size: i64) -> Self {
        Self {
            base: BaseItem::new("attachment"),
            iv: String::new(),
            salt: String::new(),
            size,
            alg: "xcha-stream".to_string(),
            key: String::new(),
            chunk_size: 512 * 1024,
            hash: hash.to_string(),
            hash_type: "xxh64".to_string(),
            mime_type: mime_type.to_string(),
            filename: filename.to_string(),
            date_deleted: None,
            date_uploaded: None,
            failed: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 7. Relation
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Relation {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "fromType")]
    pub from_type: String,
    #[serde(rename = "fromId")]
    pub from_id: String,
    #[serde(rename = "toType")]
    pub to_type: String,
    #[serde(rename = "toId")]
    pub to_id: String,
}

impl Relation {
    pub fn new(from_type: &str, from_id: &str, to_type: &str, to_id: &str) -> Self {
        Self {
            base: BaseItem::new("relation"),
            from_type: from_type.to_string(),
            from_id: from_id.to_string(),
            to_type: to_type.to_string(),
            to_id: to_id.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 8. Reminder
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Reminder {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    pub description: Option<String>,
    pub priority: String,
    pub date: Timestamp,
    pub mode: String,
    #[serde(rename = "recurringMode")]
    pub recurring_mode: Option<String>,
    #[serde(rename = "selectedDays")]
    pub selected_days: Option<Vec<i32>>,
    #[serde(rename = "localOnly")]
    pub local_only: Option<bool>,
    pub disabled: Option<bool>,
    #[serde(rename = "snoozeUntil")]
    pub snooze_until: Option<Timestamp>,
}

impl Reminder {
    pub fn new(title: &str, date: Timestamp) -> Self {
        Self {
            base: BaseItem::new("reminder"),
            title: title.to_string(),
            description: None,
            priority: "silent".to_string(),
            date,
            mode: "once".to_string(),
            recurring_mode: None,
            selected_days: None,
            local_only: None,
            disabled: None,
            snooze_until: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 9. Vault
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Vault {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    pub key: Option<String>,
}

impl Vault {
    pub fn new(title: &str) -> Self {
        Self {
            base: BaseItem::new("vault"),
            title: title.to_string(),
            key: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 10. Shortcut
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Shortcut {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "sortIndex")]
    pub sort_index: i32,
    #[serde(rename = "itemId")]
    pub item_id: String,
    #[serde(rename = "itemType")]
    pub item_type: String,
}

impl Shortcut {
    pub fn new(item_id: &str, item_type: &str, sort_index: i32) -> Self {
        Self {
            base: BaseItem::new("shortcut"),
            sort_index,
            item_id: item_id.to_string(),
            item_type: item_type.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// 11. Monograph
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Monograph {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "datePublished")]
    pub date_published: Timestamp,
    pub title: String,
    #[serde(rename = "selfDestruct")]
    pub self_destruct: bool,
    pub password: Option<String>,
}

impl Monograph {
    pub fn new(title: &str) -> Self {
        Self {
            base: BaseItem::new("monograph"),
            date_published: now_ms(),
            title: title.to_string(),
            self_destruct: false,
            password: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 12. SettingItem
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SettingItem {
    #[serde(flatten)]
    pub base: BaseItem,
    pub key: String,
    pub value: Option<serde_json::Value>,
}

impl SettingItem {
    pub fn new(key: &str) -> Self {
        Self {
            base: BaseItem::new("settingitem"),
            key: key.to_string(),
            value: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 13. HistorySession
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistorySession {
    #[serde(flatten)]
    pub base: BaseItem,
    #[serde(rename = "noteId")]
    pub note_id: String,
    #[serde(rename = "sessionContentId")]
    pub session_content_id: String,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub locked: Option<bool>,
}

impl HistorySession {
    pub fn new(note_id: &str, session_content_id: &str) -> Self {
        Self {
            base: BaseItem::new("session"),
            note_id: note_id.to_string(),
            session_content_id: session_content_id.to_string(),
            local_only: false,
            locked: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 14. SessionContentItem
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionContentItem {
    #[serde(flatten)]
    pub base: BaseItem,
    pub data: Option<String>,
    #[serde(rename = "contentType")]
    pub content_type: Option<String>,
    pub locked: bool,
    pub compressed: bool,
    #[serde(rename = "localOnly")]
    pub local_only: bool,
    pub title: Option<String>,
}

impl Default for SessionContentItem {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionContentItem {
    pub fn new() -> Self {
        Self {
            base: BaseItem::new("sessioncontent"),
            data: None,
            content_type: None,
            locked: false,
            compressed: false,
            local_only: false,
            title: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 15. TaskItem
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskItem {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub assignee: Option<String>,
    #[serde(rename = "dueDate")]
    pub due_date: Option<Timestamp>,
    pub labels: Option<Vec<String>>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
}

impl TaskItem {
    pub fn new(title: &str) -> Self {
        Self {
            base: BaseItem::new("task"),
            title: title.to_string(),
            description: None,
            status: "open".to_string(),
            priority: "medium".to_string(),
            assignee: None,
            due_date: None,
            labels: None,
            parent_id: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 16. CalendarEvent
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalendarEvent {
    #[serde(flatten)]
    pub base: BaseItem,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "startDate")]
    pub start_date: Timestamp,
    #[serde(rename = "endDate")]
    pub end_date: Timestamp,
    #[serde(rename = "allDay")]
    pub all_day: bool,
    pub color: Option<String>,
    pub recurrence: Option<serde_json::Value>,
    pub source: Option<String>,
}

impl CalendarEvent {
    pub fn new(title: &str, start_date: Timestamp, end_date: Timestamp) -> Self {
        Self {
            base: BaseItem::new("calendar_event"),
            title: title.to_string(),
            description: None,
            start_date,
            end_date,
            all_day: false,
            color: None,
            recurrence: None,
            source: None,
        }
    }
}

// ---------------------------------------------------------------------------
// 17. Agent
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Agent {
    #[serde(flatten)]
    pub base: BaseItem,
    pub name: String,
    pub role: String,
    pub status: String,
    pub model: Option<String>,
    #[serde(rename = "systemPrompt")]
    pub system_prompt: Option<String>,
    pub capabilities: Option<Vec<String>>,
    #[serde(rename = "lastActive")]
    pub last_active: Option<Timestamp>,
}

impl Agent {
    pub fn new(name: &str, role: &str) -> Self {
        Self {
            base: BaseItem::new("agent"),
            name: name.to_string(),
            role: role.to_string(),
            status: "idle".to_string(),
            model: None,
            system_prompt: None,
            capabilities: None,
            last_active: None,
        }
    }
}

// ---------------------------------------------------------------------------
// SortBy / SortDirection — for filtered queries
// ---------------------------------------------------------------------------

/// Sort field for note/notebook queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SortBy {
    DateModified,
    DateCreated,
    Title,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SortDirection {
    Asc,
    Desc,
}

impl SortBy {
    pub fn column(&self) -> &'static str {
        match self {
            Self::DateModified => "dateModified",
            Self::DateCreated => "dateCreated",
            Self::Title => "title",
        }
    }
}

impl SortDirection {
    pub fn sql(&self) -> &'static str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }
}
