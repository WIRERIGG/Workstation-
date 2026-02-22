use std::sync::Arc;
use arrow_schema::{DataType, Field, Schema};

// ---------------------------------------------------------------------------
// Helper: build a schema from (name, DataType, nullable) triples
// ---------------------------------------------------------------------------
fn schema_from(fields: &[(&str, DataType, bool)]) -> Arc<Schema> {
    Arc::new(Schema::new(
        fields
            .iter()
            .map(|(name, dt, nullable)| Field::new(*name, dt.clone(), *nullable))
            .collect::<Vec<_>>(),
    ))
}

// ---------------------------------------------------------------------------
// Common "base" columns shared by most entity tables
// ---------------------------------------------------------------------------
fn base_fields() -> Vec<(&'static str, DataType, bool)> {
    vec![
        ("id", DataType::Utf8, false),
        ("type", DataType::Utf8, true),
        ("dateModified", DataType::Int64, true),
        ("dateCreated", DataType::Int64, true),
        ("synced", DataType::Int32, true),
        ("deleted", DataType::Int32, true),
    ]
}

/// Extend base fields with extra columns.
fn entity_schema(extra: &[(&'static str, DataType, bool)]) -> Arc<Schema> {
    let mut fields = base_fields();
    fields.extend_from_slice(extra);
    schema_from(&fields)
}

// ===== 1. notes =====
pub fn notes_schema() -> Arc<Schema> {
    entity_schema(&[
        ("dateDeleted", DataType::Int64, true),
        ("itemType", DataType::Utf8, true),
        ("deletedBy", DataType::Utf8, true),
        ("title", DataType::Utf8, true),
        ("headline", DataType::Utf8, true),
        ("contentId", DataType::Utf8, true),
        ("pinned", DataType::Int32, true),
        ("favorite", DataType::Int32, true),
        ("localOnly", DataType::Int32, true),
        ("conflicted", DataType::Int32, true),
        ("readonly", DataType::Int32, true),
        ("dateEdited", DataType::Int64, true),
        ("isGeneratedTitle", DataType::Int32, true),
        ("archived", DataType::Int32, true),
        ("expiryDate", DataType::Utf8, true),
    ])
}

// ===== 2. notebooks =====
pub fn notebooks_schema() -> Arc<Schema> {
    entity_schema(&[
        ("dateDeleted", DataType::Int64, true),
        ("itemType", DataType::Utf8, true),
        ("deletedBy", DataType::Utf8, true),
        ("title", DataType::Utf8, true),
        ("description", DataType::Utf8, true),
        ("dateEdited", DataType::Int64, true),
        ("pinned", DataType::Int32, true),
    ])
}

// ===== 3. content =====
pub fn content_schema() -> Arc<Schema> {
    entity_schema(&[
        ("noteId", DataType::Utf8, true),
        ("data", DataType::Utf8, true),
        ("locked", DataType::Int32, true),
        ("localOnly", DataType::Int32, true),
        ("conflicted", DataType::Utf8, true),
        ("sessionId", DataType::Utf8, true),
        ("dateEdited", DataType::Int64, true),
        ("dateResolved", DataType::Int64, true),
    ])
}

// ===== 4. tags =====
pub fn tags_schema() -> Arc<Schema> {
    entity_schema(&[
        ("title", DataType::Utf8, true),
    ])
}

// ===== 5. colors =====
pub fn colors_schema() -> Arc<Schema> {
    entity_schema(&[
        ("title", DataType::Utf8, true),
        ("colorCode", DataType::Utf8, true),
    ])
}

// ===== 6. attachments =====
pub fn attachments_schema() -> Arc<Schema> {
    entity_schema(&[
        ("iv", DataType::Utf8, true),
        ("salt", DataType::Utf8, true),
        ("size", DataType::Int64, true),
        ("alg", DataType::Utf8, true),
        ("key", DataType::Utf8, true),
        ("chunkSize", DataType::Int64, true),
        ("hash", DataType::Utf8, true),
        ("hashType", DataType::Utf8, true),
        ("mimeType", DataType::Utf8, true),
        ("filename", DataType::Utf8, true),
        ("dateDeleted", DataType::Int64, true),
        ("dateUploaded", DataType::Int64, true),
        ("failed", DataType::Utf8, true),
    ])
}

// ===== 7. relations =====
pub fn relations_schema() -> Arc<Schema> {
    entity_schema(&[
        ("fromType", DataType::Utf8, true),
        ("fromId", DataType::Utf8, true),
        ("toType", DataType::Utf8, true),
        ("toId", DataType::Utf8, true),
    ])
}

// ===== 8. reminders =====
pub fn reminders_schema() -> Arc<Schema> {
    entity_schema(&[
        ("title", DataType::Utf8, true),
        ("description", DataType::Utf8, true),
        ("priority", DataType::Utf8, true),
        ("date", DataType::Int64, true),
        ("mode", DataType::Utf8, true),
        ("recurringMode", DataType::Utf8, true),
        ("selectedDays", DataType::Utf8, true),
        ("localOnly", DataType::Int32, true),
        ("disabled", DataType::Int32, true),
        ("snoozeUntil", DataType::Int64, true),
    ])
}

// ===== 9. vaults =====
pub fn vaults_schema() -> Arc<Schema> {
    entity_schema(&[
        ("title", DataType::Utf8, true),
        ("key", DataType::Utf8, true),
    ])
}

// ===== 10. shortcuts =====
pub fn shortcuts_schema() -> Arc<Schema> {
    entity_schema(&[
        ("sortIndex", DataType::Int64, true),
        ("itemId", DataType::Utf8, true),
        ("itemType", DataType::Utf8, true),
    ])
}

// ===== 11. monographs =====
pub fn monographs_schema() -> Arc<Schema> {
    entity_schema(&[
        ("datePublished", DataType::Int64, true),
        ("title", DataType::Utf8, true),
        ("selfDestruct", DataType::Int32, true),
        ("password", DataType::Utf8, true),
    ])
}

// ===== 12. settings =====
pub fn settings_schema() -> Arc<Schema> {
    entity_schema(&[
        ("key", DataType::Utf8, true),
        ("value", DataType::Utf8, true),
    ])
}

// ===== 13. notehistory =====
pub fn notehistory_schema() -> Arc<Schema> {
    entity_schema(&[
        ("noteId", DataType::Utf8, true),
        ("sessionContentId", DataType::Utf8, true),
        ("localOnly", DataType::Int32, true),
        ("locked", DataType::Int32, true),
    ])
}

// ===== 14. sessioncontent =====
pub fn sessioncontent_schema() -> Arc<Schema> {
    entity_schema(&[
        ("data", DataType::Utf8, true),
        ("contentType", DataType::Utf8, true),
        ("locked", DataType::Int32, true),
        ("compressed", DataType::Int32, true),
        ("localOnly", DataType::Int32, true),
        ("title", DataType::Utf8, true),
    ])
}

// ===== 15. kv =====
pub fn kv_schema() -> Arc<Schema> {
    schema_from(&[
        ("key", DataType::Utf8, false),
        ("value", DataType::Utf8, true),
        ("dateModified", DataType::Int64, true),
    ])
}

// ===== 16. config =====
pub fn config_schema() -> Arc<Schema> {
    schema_from(&[
        ("name", DataType::Utf8, false),
        ("value", DataType::Utf8, true),
        ("dateModified", DataType::Int64, true),
    ])
}

// ---------------------------------------------------------------------------
// Aggregate: all schemas keyed by table name
// ---------------------------------------------------------------------------
pub fn all_schemas() -> Vec<(&'static str, Arc<Schema>)> {
    vec![
        ("notes", notes_schema()),
        ("notebooks", notebooks_schema()),
        ("content", content_schema()),
        ("tags", tags_schema()),
        ("colors", colors_schema()),
        ("attachments", attachments_schema()),
        ("relations", relations_schema()),
        ("reminders", reminders_schema()),
        ("vaults", vaults_schema()),
        ("shortcuts", shortcuts_schema()),
        ("monographs", monographs_schema()),
        ("settings", settings_schema()),
        ("notehistory", notehistory_schema()),
        ("sessioncontent", sessioncontent_schema()),
        ("kv", kv_schema()),
        ("config", config_schema()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_schemas_returns_16_tables() {
        let schemas = all_schemas();
        assert_eq!(schemas.len(), 16);
    }

    #[test]
    fn notes_schema_has_id_not_null() {
        let schema = notes_schema();
        let id_field = schema.field_with_name("id").unwrap();
        assert!(!id_field.is_nullable());
    }

    #[test]
    fn kv_schema_has_three_fields() {
        let schema = kv_schema();
        assert_eq!(schema.fields().len(), 3);
        assert_eq!(schema.field(0).name(), "key");
        assert!(!schema.field(0).is_nullable());
    }
}
