use wiredash_core::collections::content::Content;
use wiredash_core::collections::vaults::Vaults;
use wiredash_core::types::{ContentItem, Vault};
use wiredash_db::Database;

#[test]
fn test_set_content_locked() {
    let db = Database::open_memory().unwrap();
    let content_col = Content::new(&db);

    let mut ci = ContentItem::new();
    ci.data = Some("Secret note content".to_string());
    let ci_id = ci.base.id.clone();
    content_col.add(&ci).unwrap();

    content_col.set_locked(&ci_id, true).unwrap();
    let loaded = content_col.get(&ci_id).unwrap().unwrap();
    assert!(loaded.locked);

    content_col.set_locked(&ci_id, false).unwrap();
    let loaded = content_col.get(&ci_id).unwrap().unwrap();
    assert!(!loaded.locked);
}

#[test]
fn test_list_locked_content() {
    let db = Database::open_memory().unwrap();
    let content_col = Content::new(&db);

    let mut c1 = ContentItem::new();
    c1.data = Some("Public note".to_string());
    content_col.add(&c1).unwrap();

    let mut c2 = ContentItem::new();
    c2.data = Some("Encrypted note".to_string());
    let c2_id = c2.base.id.clone();
    content_col.add(&c2).unwrap();
    content_col.set_locked(&c2_id, true).unwrap();

    let locked = content_col.list_locked().unwrap();
    assert_eq!(locked.len(), 1);
    assert_eq!(locked[0].base.id, c2_id);
}

#[test]
fn test_vault_update_key() {
    let db = Database::open_memory().unwrap();
    let vaults = Vaults::new(&db);

    let mut v = Vault::new("Default");
    v.key = Some("old_key_material".to_string());
    let v_id = v.base.id.clone();
    vaults.add(&v).unwrap();

    vaults.update_key(&v_id, "new_key_material").unwrap();
    let loaded = vaults.get(&v_id).unwrap().unwrap();
    assert_eq!(loaded.key, Some("new_key_material".to_string()));
}
