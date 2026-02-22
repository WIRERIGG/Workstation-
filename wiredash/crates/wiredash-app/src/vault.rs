#![allow(dead_code)]
//! Vault — encrypt/decrypt note content using wiredash-crypto.

use wiredash_core::collections::content::Content;
use wiredash_core::collections::vaults::Vaults;
use wiredash_core::types::Vault;
use wiredash_crypto::encryption::{Decryption, Encryption};
use wiredash_crypto::types::SerializedKey;
use wiredash_db::Database;

/// Create a new vault with a password-derived encryption key.
pub fn create_vault(db: &Database, password: &str) -> Result<String, String> {
    let key = SerializedKey {
        password: Some(password.to_string()),
        key: None,
        salt: None,
    };
    // Test encryption/decryption roundtrip to validate the key
    let test_cipher = Encryption::encrypt(&key, "vault_test")
        .map_err(|e| format!("Encryption test failed: {e}"))?;
    let test_plain = Decryption::decrypt(&test_cipher, &key)
        .map_err(|e| format!("Decryption test failed: {e}"))?;
    if test_plain != "vault_test" {
        return Err("Roundtrip test failed".into());
    }

    // Store the verification cipher in the vault record
    let cipher_json =
        serde_json::to_string(&test_cipher).map_err(|e| format!("Serialization failed: {e}"))?;

    let mut vault = Vault::new("Default");
    vault.key = Some(cipher_json);
    let vault_id = vault.base.id.clone();
    Vaults::new(db).add(&vault).map_err(|e| e.to_string())?;

    // Mark vault as created in settings
    let settings = wiredash_core::collections::settings::Settings::new(db);
    let _ = settings.set("vault_created", &serde_json::json!(true));

    Ok(vault_id)
}

/// Lock a note's content: encrypt the plaintext and store the cipher.
pub fn lock_note(db: &Database, content_id: &str, password: &str) -> Result<(), String> {
    let content_col = Content::new(db);
    let ci = content_col
        .get(content_id)
        .map_err(|e| e.to_string())?
        .ok_or("Content not found")?;
    if ci.locked {
        return Err("Content is already locked".into());
    }
    let plaintext = ci.data.as_deref().unwrap_or("");
    let key = SerializedKey {
        password: Some(password.to_string()),
        key: None,
        salt: None,
    };
    let cipher =
        Encryption::encrypt(&key, plaintext).map_err(|e| format!("Encryption failed: {e}"))?;
    let cipher_json =
        serde_json::to_string(&cipher).map_err(|e| format!("Serialization failed: {e}"))?;
    content_col
        .update_data(content_id, &cipher_json)
        .map_err(|e| e.to_string())?;
    content_col
        .set_locked(content_id, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Unlock a note's content: decrypt the cipher and return plaintext.
/// Does NOT persist the decryption — caller decides what to do with plaintext.
pub fn unlock_note(db: &Database, content_id: &str, password: &str) -> Result<String, String> {
    let content_col = Content::new(db);
    let ci = content_col
        .get(content_id)
        .map_err(|e| e.to_string())?
        .ok_or("Content not found")?;
    if !ci.locked {
        return Err("Content is not locked".into());
    }
    let cipher_json = ci.data.as_deref().ok_or("No data to decrypt")?;
    let cipher: wiredash_crypto::types::Cipher =
        serde_json::from_str(cipher_json).map_err(|e| format!("Invalid cipher format: {e}"))?;
    let key = SerializedKey {
        password: Some(password.to_string()),
        key: None,
        salt: None,
    };
    Decryption::decrypt(&cipher, &key).map_err(|e| format!("Decryption failed: {e}"))
}

/// Permanently unlock: decrypt and write plaintext back, set locked=false.
pub fn permanently_unlock_note(
    db: &Database,
    content_id: &str,
    password: &str,
) -> Result<(), String> {
    let plaintext = unlock_note(db, content_id, password)?;
    let content_col = Content::new(db);
    content_col
        .update_data(content_id, &plaintext)
        .map_err(|e| e.to_string())?;
    content_col
        .set_locked(content_id, false)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clear vault: permanently unlock all locked notes, then remove the vault.
pub fn clear_vault(db: &Database, password: &str) -> Result<(), String> {
    let content_col = Content::new(db);
    let locked_items = content_col.list_locked().map_err(|e| e.to_string())?;
    for ci in &locked_items {
        permanently_unlock_note(db, &ci.base.id, password)?;
    }
    // Remove the vault record
    let vaults = Vaults::new(db);
    if let Ok(Some(vault)) = vaults.default() {
        let _ = vaults.remove(&vault.base.id);
    }
    let settings = wiredash_core::collections::settings::Settings::new(db);
    let _ = settings.set("vault_created", &serde_json::json!(false));
    Ok(())
}

/// Re-encrypt all locked content with a new password.
pub fn change_vault_password(
    db: &Database,
    old_password: &str,
    new_password: &str,
) -> Result<(), String> {
    let content_col = Content::new(db);
    let locked_items = content_col.list_locked().map_err(|e| e.to_string())?;
    // Decrypt with old, re-encrypt with new
    for ci in &locked_items {
        let plaintext = unlock_note(db, &ci.base.id, old_password)?;
        let new_key = SerializedKey {
            password: Some(new_password.to_string()),
            key: None,
            salt: None,
        };
        let new_cipher = Encryption::encrypt(&new_key, &plaintext)
            .map_err(|e| format!("Re-encryption failed: {e}"))?;
        let cipher_json = serde_json::to_string(&new_cipher)
            .map_err(|e| format!("Serialization failed: {e}"))?;
        content_col
            .update_data(&ci.base.id, &cipher_json)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
