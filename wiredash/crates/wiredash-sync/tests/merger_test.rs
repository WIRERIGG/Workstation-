use wiredash_sync::merger::*;
use serde_json::json;

fn make_item(date_modified: i64, deleted: bool) -> serde_json::Value {
    json!({
        "id": "item-1",
        "type": "note",
        "dateModified": date_modified,
        "dateCreated": 1000,
        "synced": false,
        "deleted": deleted,
        "title": "Test"
    })
}

fn make_content(date_modified: i64, date_edited: i64, synced: bool, data: &str) -> serde_json::Value {
    json!({
        "id": "content-1",
        "type": "content",
        "dateModified": date_modified,
        "dateCreated": 1000,
        "synced": synced,
        "deleted": false,
        "data": data,
        "dateEdited": date_edited,
        "locked": false,
        "localOnly": false
    })
}

#[test]
fn test_merge_item_no_local_takes_remote() {
    let remote = make_item(2000, false);
    let result = Merger::merge_item(None, &remote);
    assert!(result.is_some());
}

#[test]
fn test_merge_item_remote_newer_takes_remote() {
    let local = make_item(1000, false);
    let remote = make_item(2000, false);
    let result = Merger::merge_item(Some(&local), &remote);
    assert!(result.is_some());
}

#[test]
fn test_merge_item_local_newer_keeps_local() {
    let local = make_item(3000, false);
    let remote = make_item(2000, false);
    let result = Merger::merge_item(Some(&local), &remote);
    assert!(result.is_none());
}

#[test]
fn test_merge_content_local_not_edited_takes_remote() {
    let local = make_content(1000, 1000, true, "<p>old</p>");
    let remote = make_content(2000, 2000, false, "<p>new</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert_eq!(result, MergeResult::TakeRemote(remote));
}

#[test]
fn test_merge_content_within_threshold_last_write_wins() {
    let now = chrono::Utc::now().timestamp_millis();
    let local = make_content(now, now, false, "<p>local edit</p>");
    let remote = make_content(now + 30_000, now + 30_000, false, "<p>remote edit</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert!(matches!(result, MergeResult::TakeRemote(_)));
}

#[test]
fn test_merge_content_outside_threshold_conflict() {
    let now = chrono::Utc::now().timestamp_millis();
    let local = make_content(now, now, false, "<p>local version</p>");
    let remote = make_content(now + 120_000, now + 120_000, false, "<p>remote version</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert!(matches!(result, MergeResult::Conflict { .. }));
}

#[test]
fn test_merge_content_same_html_no_conflict() {
    let now = chrono::Utc::now().timestamp_millis();
    let local = make_content(now, now, false, "<p>same text</p>");
    let remote = make_content(now + 120_000, now + 120_000, false, "<p>same text</p>");
    let result = Merger::merge_content(Some(&local), &remote, 60_000);
    assert!(matches!(result, MergeResult::TakeRemote(_)));
}
