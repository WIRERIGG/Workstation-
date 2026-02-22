#![allow(dead_code)]
//! App Lock — password gate screen and inactivity timer.

use iced::widget::{button, center, column, container, text, text_input, Space};
use iced::{Element, Fill, Theme, Color};
use wiredash_core::collections::settings::Settings;
use wiredash_crypto::key::KeyUtils;
use wiredash_db::Database;
use base64::Engine;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// Hash a password with a random salt for storage.
pub fn hash_password(password: &str) -> Result<(String, String), String> {
    let (key_bytes, salt_bytes) = KeyUtils::derive_key(password, None)
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok((B64.encode(&key_bytes), B64.encode(&salt_bytes)))
}

/// Verify a password against a stored hash + salt.
pub fn verify_password(password: &str, stored_hash: &str, stored_salt: &str) -> bool {
    let Ok(salt_bytes) = B64.decode(stored_salt) else { return false; };
    let Ok((key_bytes, _)) = KeyUtils::derive_key(password, Some(&salt_bytes)) else { return false; };
    let computed_hash = B64.encode(&key_bytes);
    computed_hash == stored_hash
}

/// Store the app lock password hash in the settings KV store.
pub fn set_app_lock_password(db: &Database, password: &str) -> Result<(), String> {
    let (hash, salt) = hash_password(password)?;
    let settings = Settings::new(db);
    settings.set("app_lock_hash", &serde_json::json!(hash)).map_err(|e: anyhow::Error| e.to_string())?;
    settings.set("app_lock_salt", &serde_json::json!(salt)).map_err(|e: anyhow::Error| e.to_string())?;
    settings.set("app_lock_enabled", &serde_json::json!(true)).map_err(|e: anyhow::Error| e.to_string())?;
    Ok(())
}

/// Check if app lock has a password set.
pub fn has_app_lock_password(db: &Database) -> bool {
    let settings = Settings::new(db);
    settings.get_setting("app_lock_hash").ok().flatten().is_some()
}

/// Attempt to unlock with a password.
pub fn try_unlock(db: &Database, password: &str) -> bool {
    let settings = Settings::new(db);
    let hash = settings.get_setting("app_lock_hash").ok().flatten()
        .and_then(|v| v.as_str().map(String::from));
    let salt = settings.get_setting("app_lock_salt").ok().flatten()
        .and_then(|v| v.as_str().map(String::from));
    match (hash, salt) {
        (Some(h), Some(s)) => verify_password(password, &h, &s),
        _ => false,
    }
}

// ── Gate Screen State ────────────────────────────────────────────────

pub struct AppLockState {
    pub locked: bool,
    pub password_input: String,
    pub error: Option<String>,
    pub last_activity: std::time::Instant,
}

impl AppLockState {
    pub fn new(locked: bool) -> Self {
        Self {
            locked,
            password_input: String::new(),
            error: None,
            last_activity: std::time::Instant::now(),
        }
    }

    pub fn record_activity(&mut self) {
        self.last_activity = std::time::Instant::now();
    }

    /// Check if inactivity timeout has been exceeded.
    pub fn should_lock(&self, timeout_str: &str) -> bool {
        let timeout_secs = match timeout_str {
            "Immediately" => 0,
            "1 min" => 60,
            "5 min" => 300,
            "10 min" => 600,
            "15 min" => 900,
            "30 min" => 1800,
            "45 min" => 2700,
            "1 hour" => 3600,
            "Never" => return false,
            _ => 0,
        };
        if timeout_secs == 0 {
            return false; // "Immediately" means lock on explicit action, not timer
        }
        self.last_activity.elapsed().as_secs() >= timeout_secs
    }
}

#[derive(Debug, Clone)]
pub enum AppLockMessage {
    PasswordInput(String),
    TryUnlock,
}

/// Render the full-screen gate.
pub fn gate_view<'a>(state: &'a AppLockState) -> Element<'a, AppLockMessage> {
    let error_text: Element<'a, AppLockMessage> = if let Some(ref err) = state.error {
        text(err).size(12).color(Color::from_rgb8(0xE0, 0x00, 0x00)).into()
    } else {
        Space::new().height(0).into()
    };

    center(
        container(
            column![
                text("Wiredash").size(28),
                text("Enter your password to unlock.").size(14),
                Space::new().height(8),
                text_input("Password", &state.password_input)
                    .secure(true)
                    .on_input(AppLockMessage::PasswordInput)
                    .on_submit(AppLockMessage::TryUnlock)
                    .width(300),
                error_text,
                Space::new().height(4),
                button(text("Unlock").size(14))
                    .on_press(AppLockMessage::TryUnlock)
                    .padding([8, 24]),
            ]
            .spacing(8)
            .align_x(iced::Center)
            .width(400)
        )
        .padding(32)
        .style(|theme: &Theme| {
            let palette = theme.extended_palette();
            container::Style {
                background: Some(iced::Background::Color(palette.background.base.color)),
                border: iced::Border {
                    width: 1.0,
                    color: palette.background.strong.color,
                    radius: 12.0.into(),
                },
                ..Default::default()
            }
        })
    )
    .width(Fill)
    .height(Fill)
    .into()
}
