use std::collections::HashMap;
use std::sync::Arc;

use arrow_array::{Array, Int32Array, Int64Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Schema};

// ---------------------------------------------------------------------------
// Sync bridge: run an async Future on the current tokio runtime
// ---------------------------------------------------------------------------
/// Block on a future from synchronous code. Requires a running tokio runtime.
///
/// Uses `tokio::task::block_in_place` so it is safe to call from within a
/// multi-threaded runtime without risk of deadlock.
pub fn sync_run<F: std::future::Future>(f: F) -> F::Output {
    tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(f)
    })
}

// ---------------------------------------------------------------------------
// RecordBatch rows -> Vec<HashMap<String, serde_json::Value>>
// ---------------------------------------------------------------------------
/// Convert a slice of `RecordBatch`es into a `Vec` of row-maps.
///
/// Each row becomes a `HashMap<column_name, JSON value>`.
/// Supports `Utf8`, `Int32`, and `Int64` column types; other types produce
/// `serde_json::Value::Null`.
pub fn batches_to_maps(batches: &[RecordBatch]) -> Vec<HashMap<String, serde_json::Value>> {
    let mut results = Vec::new();

    for batch in batches {
        let schema = batch.schema();
        let num_rows = batch.num_rows();

        for row_idx in 0..num_rows {
            let mut map = HashMap::new();

            for (col_idx, field) in schema.fields().iter().enumerate() {
                let col = batch.column(col_idx);
                let value = match field.data_type() {
                    DataType::Utf8 => {
                        let arr = col.as_any().downcast_ref::<StringArray>().unwrap();
                        if arr.is_null(row_idx) {
                            serde_json::Value::Null
                        } else {
                            serde_json::Value::String(arr.value(row_idx).to_string())
                        }
                    }
                    DataType::Int32 => {
                        let arr = col.as_any().downcast_ref::<Int32Array>().unwrap();
                        if arr.is_null(row_idx) {
                            serde_json::Value::Null
                        } else {
                            serde_json::json!(arr.value(row_idx))
                        }
                    }
                    DataType::Int64 => {
                        let arr = col.as_any().downcast_ref::<Int64Array>().unwrap();
                        if arr.is_null(row_idx) {
                            serde_json::Value::Null
                        } else {
                            serde_json::json!(arr.value(row_idx))
                        }
                    }
                    _ => serde_json::Value::Null,
                };
                map.insert(field.name().clone(), value);
            }

            results.push(map);
        }
    }

    results
}

// ---------------------------------------------------------------------------
// Vec<HashMap<String, serde_json::Value>> -> RecordBatch
// ---------------------------------------------------------------------------
/// Build a `RecordBatch` from a slice of row-maps.
///
/// The schema dictates column names and types; missing keys become null.
/// Supports `Utf8`, `Int32`, and `Int64`.
pub fn maps_to_batch(
    schema: &Arc<Schema>,
    maps: &[HashMap<String, serde_json::Value>],
) -> Result<RecordBatch, anyhow::Error> {
    let num_rows = maps.len();
    let mut columns: Vec<Arc<dyn arrow_array::Array>> = Vec::with_capacity(schema.fields().len());

    for field in schema.fields() {
        let name = field.name();
        match field.data_type() {
            DataType::Utf8 => {
                let mut builder = arrow_array::builder::StringBuilder::with_capacity(num_rows, 0);
                for row in maps {
                    match row.get(name) {
                        Some(serde_json::Value::String(s)) => builder.append_value(s),
                        Some(serde_json::Value::Null) | None => builder.append_null(),
                        // Coerce non-string JSON values to their string representation
                        Some(other) => builder.append_value(other.to_string()),
                    }
                }
                columns.push(Arc::new(builder.finish()));
            }
            DataType::Int32 => {
                let mut builder =
                    arrow_array::builder::Int32Builder::with_capacity(num_rows);
                for row in maps {
                    match row.get(name) {
                        Some(serde_json::Value::Number(n)) => {
                            builder.append_value(n.as_i64().unwrap_or(0) as i32);
                        }
                        Some(serde_json::Value::Bool(b)) => {
                            builder.append_value(if *b { 1 } else { 0 });
                        }
                        _ => builder.append_null(),
                    }
                }
                columns.push(Arc::new(builder.finish()));
            }
            DataType::Int64 => {
                let mut builder =
                    arrow_array::builder::Int64Builder::with_capacity(num_rows);
                for row in maps {
                    match row.get(name) {
                        Some(serde_json::Value::Number(n)) => {
                            builder.append_value(n.as_i64().unwrap_or(0));
                        }
                        _ => builder.append_null(),
                    }
                }
                columns.push(Arc::new(builder.finish()));
            }
            _ => {
                // Unsupported type — fill with nulls
                let mut builder = arrow_array::builder::StringBuilder::with_capacity(num_rows, 0);
                for _ in 0..num_rows {
                    builder.append_null();
                }
                columns.push(Arc::new(builder.finish()));
            }
        }
    }

    Ok(RecordBatch::try_new(schema.clone(), columns)?)
}

// ---------------------------------------------------------------------------
// SQL string escaping for DataFusion filter expressions
// ---------------------------------------------------------------------------
/// Escape a string for use in DataFusion SQL predicates.
///
/// Wraps the value in single quotes, doubling any embedded single quotes.
/// Example: `O'Brien` becomes `'O''Brien'`.
pub fn escape_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use arrow_schema::Field;

    fn test_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int32, true),
            Field::new("ts", DataType::Int64, true),
        ]))
    }

    #[test]
    fn round_trip_maps_to_batch_and_back() {
        let schema = test_schema();
        let maps = vec![
            HashMap::from([
                ("name".to_string(), serde_json::json!("Alice")),
                ("age".to_string(), serde_json::json!(30)),
                ("ts".to_string(), serde_json::json!(1700000000_i64)),
            ]),
            HashMap::from([
                ("name".to_string(), serde_json::json!("Bob")),
                ("age".to_string(), serde_json::Value::Null),
                ("ts".to_string(), serde_json::json!(1700000001_i64)),
            ]),
        ];

        let batch = maps_to_batch(&schema, &maps).unwrap();
        assert_eq!(batch.num_rows(), 2);

        let recovered = batches_to_maps(&[batch]);
        assert_eq!(recovered.len(), 2);
        assert_eq!(recovered[0]["name"], serde_json::json!("Alice"));
        assert_eq!(recovered[0]["age"], serde_json::json!(30));
        assert_eq!(recovered[1]["name"], serde_json::json!("Bob"));
        assert!(recovered[1]["age"].is_null());
    }

    #[test]
    fn escape_str_handles_quotes() {
        assert_eq!(escape_str("hello"), "'hello'");
        assert_eq!(escape_str("O'Brien"), "'O''Brien'");
        assert_eq!(escape_str("it's a 'test'"), "'it''s a ''test'''");
    }

    #[test]
    fn maps_to_batch_coerces_bool_to_int32() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("flag", DataType::Int32, true),
        ]));
        let maps = vec![
            HashMap::from([("flag".to_string(), serde_json::json!(true))]),
            HashMap::from([("flag".to_string(), serde_json::json!(false))]),
        ];
        let batch = maps_to_batch(&schema, &maps).unwrap();
        let recovered = batches_to_maps(&[batch]);
        assert_eq!(recovered[0]["flag"], serde_json::json!(1));
        assert_eq!(recovered[1]["flag"], serde_json::json!(0));
    }
}
