use wiredash_core::collections::settings::Settings;
use wiredash_db::Database;

#[test]
fn test_settings_roundtrip_bool() {
    let db = Database::open_memory().unwrap();
    let settings = Settings::new(&db);

    settings.set("app_lock_enabled", &serde_json::json!(true)).unwrap();
    let val = settings.get_setting("app_lock_enabled").unwrap().unwrap();
    assert_eq!(val, serde_json::json!(true));
}

#[test]
fn test_settings_roundtrip_string() {
    let db = Database::open_memory().unwrap();
    let settings = Settings::new(&db);

    settings.set("theme_scheme", &serde_json::json!("Dark")).unwrap();
    let val = settings.get_setting("theme_scheme").unwrap().unwrap();
    assert_eq!(val.as_str().unwrap(), "Dark");
}

#[test]
fn test_settings_roundtrip_number() {
    let db = Database::open_memory().unwrap();
    let settings = Settings::new(&db);

    settings.set("zoom_factor", &serde_json::json!(1.5)).unwrap();
    let val = settings.get_setting("zoom_factor").unwrap().unwrap();
    assert!((val.as_f64().unwrap() - 1.5).abs() < f64::EPSILON);
}

#[test]
fn test_settings_overwrite() {
    let db = Database::open_memory().unwrap();
    let settings = Settings::new(&db);

    settings.set("theme_scheme", &serde_json::json!("Light")).unwrap();
    settings.set("theme_scheme", &serde_json::json!("Dark")).unwrap();

    let val = settings.get_setting("theme_scheme").unwrap().unwrap();
    assert_eq!(val.as_str().unwrap(), "Dark");
}

#[test]
fn test_settings_remove() {
    let db = Database::open_memory().unwrap();
    let settings = Settings::new(&db);

    settings.set("temp_key", &serde_json::json!("value")).unwrap();
    settings.remove("temp_key").unwrap();

    let val = settings.get_setting("temp_key").unwrap();
    assert!(val.is_none());
}
