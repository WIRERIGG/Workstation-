# WIREDASH Phase 6 — Settings, Vault, App Lock, Reminders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the daily-use note-taking experience by adding a full Settings view (22 panels mirroring Workstation), Vault encryption, App Lock, and a Reminders view.

**Architecture:** All features follow the established ViewState + Message + Update pattern. Settings uses the existing KV store collection for persistence. Vault uses `wiredash-crypto` (XChaCha20-Poly1305 + Argon2id). App Lock adds a gate screen overlay. Reminders extends the existing collection with an update method and a list+form view.

**Tech Stack:** Rust, iced 0.14 (toggler, pick_list, text_input with `.secure()`, stack + opaque for modals), wiredash-core (Settings KV, Vaults, Reminders collections), wiredash-crypto (Encryption, Decryption, KeyUtils)

---

## What Already Exists

### Backend (wiredash-core)
- `Settings` KV store — `get_setting(key)`, `set(key, value)`, `remove(key)`
- `Vaults` — `add()`, `get()`, `list()`, `default()`, `remove()`
- `Reminders` — `add()`, `get()`, `list()`, `remove()` (missing: `update()`)
- `Content` — `update_data()`, `find_by_note_id()` (has `locked` field)

### Crypto (wiredash-crypto)
- `Encryption::encrypt(key, plaintext) → Cipher`
- `Decryption::decrypt(cipher, key) → String`
- `KeyUtils::derive_key(password, salt?) → (key, salt)`
- `KeyUtils::transform(SerializedKey) → (key, salt)`

### Frontend (wiredash-app)
- 23 views in navigation enum, 7 functional (Notes, Notebooks, Tags, Search, Favorites, Archive, Trash)
- Auto-save pattern with 2s timer + dirty flag
- Sidebar with 4 sections + theme toggle
- App config: `config.rs` saves last_view, sidebar state, color scheme

### App dependencies (wiredash-app/Cargo.toml)
- `wiredash-crypto` already in dependencies
- `open = "5"` already available for external URLs
- `iced = "0.14"` with svg, tokio, markdown, highlighter features

---

## NOT Doing

- Server-connected features (login/signup/2FA, sync push/pull, subscription, billing)
- WebAuthn / security key credentials
- OS-level notification daemon for reminders
- Theme marketplace browsing (offline toggle only)
- Full importer (complex file parsing)
- Spell checker language management
- Drag-and-drop, multi-tag filter, sub-notebooks, search highlighting

---

## iced 0.14 API Reference (Phase 6 Widgets)

```rust
// Toggle switch
toggler(is_active)
    .label("Enable feature")
    .on_toggle(Msg::FeatureToggled)

// Dropdown selector
pick_list(
    ["Option A", "Option B", "Option C"],
    Some(selected),
    Msg::OptionChanged,
).placeholder("Select...")

// Password input
text_input("Password", &password)
    .secure(true)
    .on_input(Msg::PasswordChanged)
    .on_submit(Msg::SubmitPassword)

// Number-like input (text_input + manual parsing)
text_input("16", &font_size_str)
    .on_input(Msg::FontSizeChanged)
    .width(80)

// Modal overlay (Stack + opaque + mouse_area)
stack![
    base_content,
    opaque(
        mouse_area(center(opaque(dialog_content)).style(backdrop_style))
            .on_press(Msg::DismissModal)
    )
]
```

---

## Task 1: Shared Infrastructure — Modal Dialog + Toast System

**Files:**
- Create: `wiredash/crates/wiredash-app/src/modal.rs`
- Create: `wiredash/crates/wiredash-app/src/toast.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add `mod modal; mod toast;`

### Step 1: Create modal.rs

```rust
//! Reusable modal dialog overlay using iced Stack + opaque + mouse_area.

use iced::widget::{button, center, column, container, mouse_area, opaque, row, stack, text, text_input, space};
use iced::{Color, Element, Fill, Theme};

/// Wrap `base` content with a modal overlay showing `dialog`.
/// Clicking the backdrop fires `on_blur`.
pub fn modal<'a, Message: Clone + 'a>(
    base: impl Into<Element<'a, Message>>,
    dialog: impl Into<Element<'a, Message>>,
    on_blur: Message,
) -> Element<'a, Message> {
    stack![
        base.into(),
        opaque(
            mouse_area(
                center(
                    opaque(dialog)
                ).style(|_theme: &Theme| {
                    container::Style {
                        background: Some(iced::Background::Color(
                            Color { a: 0.6, ..Color::BLACK },
                        )),
                        ..Default::default()
                    }
                })
            )
            .on_press(on_blur)
        )
    ]
    .into()
}

/// A styled dialog card with title, body content, and action buttons.
pub fn dialog_card<'a, Message: 'a>(
    title: &str,
    body: impl Into<Element<'a, Message>>,
    actions: Vec<Element<'a, Message>>,
) -> Element<'a, Message> {
    let header = text(title).size(18);
    let action_row: Element<'a, Message> = row(actions).spacing(8).into();

    container(
        column![
            header,
            iced::widget::rule::horizontal(1),
            body.into(),
            space::vertical(8),
            action_row,
        ]
        .spacing(12)
        .width(400)
    )
    .padding(20)
    .style(|theme: &Theme| {
        let palette = theme.extended_palette();
        container::Style {
            background: Some(iced::Background::Color(palette.background.base.color)),
            border: iced::Border {
                width: 1.0,
                color: palette.background.strong.color,
                radius: 8.0.into(),
            },
            shadow: iced::Shadow {
                color: Color { a: 0.3, ..Color::BLACK },
                offset: iced::Vector::new(0.0, 4.0),
                blur_radius: 12.0,
            },
            ..Default::default()
        }
    })
    .into()
}
```

### Step 2: Create toast.rs

```rust
//! Toast notification system adapted from iced official toast example.

use iced::widget::{button, column, container, row, text};
use iced::{Color, Element, Theme};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastStatus {
    Success,
    Warning,
    Error,
    Info,
}

impl ToastStatus {
    pub fn color(&self) -> Color {
        match self {
            Self::Success => Color::from_rgb8(0x28, 0xA7, 0x45),
            Self::Warning => Color::from_rgb8(0xFF, 0xA5, 0x00),
            Self::Error   => Color::from_rgb8(0xE0, 0x00, 0x00),
            Self::Info    => Color::from_rgb8(0x00, 0x7B, 0xFF),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Toast {
    pub title: String,
    pub status: ToastStatus,
}

pub struct ToastManager {
    toasts: Vec<(Toast, Instant)>,
    timeout: Duration,
}

impl ToastManager {
    pub fn new() -> Self {
        Self {
            toasts: Vec::new(),
            timeout: Duration::from_secs(4),
        }
    }

    pub fn push(&mut self, title: impl Into<String>, status: ToastStatus) {
        self.toasts.push((
            Toast { title: title.into(), status },
            Instant::now(),
        ));
    }

    /// Remove expired toasts. Returns true if any were removed (triggers redraw).
    pub fn tick(&mut self) -> bool {
        let before = self.toasts.len();
        self.toasts.retain(|(_, created)| created.elapsed() < self.timeout);
        self.toasts.len() != before
    }

    pub fn dismiss(&mut self, index: usize) {
        if index < self.toasts.len() {
            self.toasts.remove(index);
        }
    }

    pub fn has_toasts(&self) -> bool {
        !self.toasts.is_empty()
    }

    pub fn view<'a, Message: Clone + 'a>(
        &'a self,
        on_dismiss: impl Fn(usize) -> Message + 'a,
    ) -> Element<'a, Message> {
        let toasts: Vec<Element<'a, Message>> = self.toasts.iter().enumerate().map(|(i, (toast, _))| {
            let dismiss_msg = on_dismiss(i);
            container(
                row![
                    text(&toast.title).size(13).color(Color::WHITE),
                    button(text("×").size(13).color(Color::WHITE))
                        .on_press(dismiss_msg)
                        .style(button::text)
                        .padding([2, 6]),
                ]
                .spacing(8)
                .align_y(iced::Center)
            )
            .padding([8, 12])
            .style(move |_theme: &Theme| {
                container::Style {
                    background: Some(iced::Background::Color(toast.status.color())),
                    border: iced::Border {
                        radius: 6.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }
            })
            .into()
        }).collect();

        container(column(toasts).spacing(4))
            .padding(8)
            .into()
    }
}
```

### Step 3: Add mod declarations to main.rs

At the top of `wiredash/crates/wiredash-app/src/main.rs`, after `mod organize_views;` (line 8), add:

```rust
mod modal;
mod toast;
```

### Step 4: Compile check

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo check -p wiredash-app
```

Expected: compiles with possible unused warnings (modal and toast not yet consumed).

### Step 5: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-app/src/modal.rs crates/wiredash-app/src/toast.rs crates/wiredash-app/src/main.rs
git commit -s -m "desktop: add modal dialog and toast notification infrastructure"
```

---

## Task 2: Navigation — Add Settings and Reminders Routes

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/navigation.rs` — add Settings, Reminders variants
- Modify: `wiredash/crates/wiredash-app/src/icons.rs` — add GEAR, BELL icons

### Step 1: Add icons

Append to `wiredash/crates/wiredash-app/src/icons.rs`:

```rust
pub const GEAR: &str = "\u{2699}";       // ⚙
pub const BELL: &str = "\u{1F514}";      // 🔔
```

### Step 2: Add View variants

In `navigation.rs`, update the `View` enum. Add `Reminders` to Workspace (after `Search`) and `Settings` at the end:

```rust
pub enum View {
    // WORKSPACE
    Dashboard, Control, Notes, Notebooks, Tags, Search, Reminders, Tasks, Calendar, AgentChat, Terminal, Files,
    // TOOLS
    Agents, Spreadsheets, Communications, Newsletters, CallQueue,
    // DEVELOPER
    Git, Conversations, Workspaces, CodeSearch, Diagnostics,
    // ORGANIZE
    Favorites, Archive, Trash,
    // SETTINGS (standalone — bottom of sidebar)
    Settings,
}
```

### Step 3: Add match arms

In `title()`:
```rust
Self::Reminders => "Reminders",
Self::Settings => "Settings",
```

In `icon()`:
```rust
Self::Reminders => icons::BELL,
Self::Settings => icons::GEAR,
```

In `description()`:
```rust
Self::Reminders => "Manage reminders and scheduled notifications.",
Self::Settings => "Configure appearance, editor, security, and more.",
```

In `section()`:
```rust
Self::Reminders => Section::Workspace,
Self::Settings => Section::Workspace, // Rendered specially at sidebar bottom
```

Update `ALL` constant to include `Reminders` and `Settings`.

### Step 4: Compile check

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo check -p wiredash-app
```

Expected: compiles with warnings about unmatched patterns in content_view (Settings and Reminders hit the placeholder `view =>` arm).

### Step 5: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-app/src/navigation.rs crates/wiredash-app/src/icons.rs
git commit -s -m "misc: add Settings and Reminders routes to navigation"
```

---

## Task 3: Backend — Add Reminders::update() and Vault Helpers

**Files:**
- Modify: `wiredash/crates/wiredash-core/src/collections/reminders.rs` — add `update()`
- Modify: `wiredash/crates/wiredash-core/src/collections/content.rs` — add `set_locked()`, `list_locked()`
- Modify: `wiredash/crates/wiredash-core/src/collections/vaults.rs` — add `update_key()`
- Create: `wiredash/crates/wiredash-core/tests/reminders_update_test.rs`
- Create: `wiredash/crates/wiredash-core/tests/vault_lock_test.rs`

### Step 1: Add Reminders::update()

Append to `wiredash/crates/wiredash-core/src/collections/reminders.rs`, inside the `impl<'a> Reminders<'a>` block:

```rust
/// Update an existing reminder's fields.
pub fn update(&self, rem: &Reminder) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    let selected_days_json = rem.selected_days.as_ref()
        .map(|d| serde_json::to_string(d).unwrap_or_default());
    self.db.execute(
        "UPDATE reminders SET title = ?1, description = ?2, priority = ?3, \
         date = ?4, mode = ?5, recurringMode = ?6, selectedDays = ?7, \
         localOnly = ?8, disabled = ?9, snoozeUntil = ?10, \
         dateModified = ?11, synced = 0 WHERE id = ?12",
        rusqlite::params![
            rem.title,
            rem.description,
            rem.priority,
            rem.date,
            rem.mode,
            rem.recurring_mode,
            selected_days_json,
            rem.local_only,
            rem.disabled,
            rem.snooze_until,
            now,
            rem.base.id,
        ],
    )?;
    Ok(())
}
```

### Step 2: Add Content::set_locked() and Content::list_locked()

Append to `wiredash/crates/wiredash-core/src/collections/content.rs`, inside the impl block:

```rust
/// Set the locked flag on a content item.
pub fn set_locked(&self, id: &str, locked: bool) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    self.db.execute(
        "UPDATE content SET locked = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
        rusqlite::params![locked as i32, now, id],
    )?;
    Ok(())
}

/// List all locked content items (for vault re-encryption).
pub fn list_locked(&self) -> Result<Vec<ContentItem>, anyhow::Error> {
    let conn = self.db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, type, dateModified, dateCreated, synced, deleted, \
         noteId, data, locked, localOnly, conflicted, sessionId, \
         dateEdited, dateResolved \
         FROM content WHERE locked = 1 AND deleted = 0"
    )?;
    let rows = stmt.query_map([], content_from_row)?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}
```

### Step 3: Add Vaults::update_key()

Append to `wiredash/crates/wiredash-core/src/collections/vaults.rs`, inside the impl block:

```rust
/// Update the encryption key on an existing vault.
pub fn update_key(&self, id: &str, key: &str) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    self.db.execute(
        "UPDATE vaults SET key = ?1, dateModified = ?2, synced = 0 WHERE id = ?3",
        rusqlite::params![key, now, id],
    )?;
    Ok(())
}
```

### Step 4: Write reminders update test

Create `wiredash/crates/wiredash-core/tests/reminders_update_test.rs`:

```rust
use wiredash_core::collections::reminders::Reminders;
use wiredash_core::types::Reminder;
use wiredash_db::Database;

#[test]
fn test_update_reminder() {
    let db = Database::open_memory().unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Original Title", now);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    rem.title = "Updated Title".to_string();
    rem.priority = "loud".to_string();
    rem.mode = "recurring".to_string();
    rem.recurring_mode = Some("daily".to_string());
    rem.disabled = Some(false);
    reminders.update(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.title, "Updated Title");
    assert_eq!(loaded.priority, "loud");
    assert_eq!(loaded.mode, "recurring");
    assert_eq!(loaded.recurring_mode, Some("daily".to_string()));
}

#[test]
fn test_update_reminder_snooze() {
    let db = Database::open_memory().unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Snooze Test", now);
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    let snooze_time = now + 30 * 60 * 1000; // 30 minutes from now
    rem.snooze_until = Some(snooze_time);
    reminders.update(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.snooze_until, Some(snooze_time));
}

#[test]
fn test_update_reminder_selected_days() {
    let db = Database::open_memory().unwrap();
    let reminders = Reminders::new(&db);

    let now = chrono::Utc::now().timestamp_millis();
    let mut rem = Reminder::new("Weekly Standup", now);
    rem.mode = "recurring".to_string();
    rem.recurring_mode = Some("weekly".to_string());
    rem.selected_days = Some(vec![1, 3, 5]); // Mon, Wed, Fri
    let id = rem.base.id.clone();
    reminders.add(&rem).unwrap();

    let loaded = reminders.get(&id).unwrap().unwrap();
    assert_eq!(loaded.selected_days, Some(vec![1, 3, 5]));
}
```

### Step 5: Write vault lock test

Create `wiredash/crates/wiredash-core/tests/vault_lock_test.rs`:

```rust
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
```

### Step 6: Run tests

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo test -p wiredash-core -- reminders_update
cargo test -p wiredash-core -- vault_lock
```

Expected: 6 new tests pass.

### Step 7: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-core/src/collections/reminders.rs crates/wiredash-core/src/collections/content.rs crates/wiredash-core/src/collections/vaults.rs crates/wiredash-core/tests/reminders_update_test.rs crates/wiredash-core/tests/vault_lock_test.rs
git commit -s -m "core: add Reminders::update, Content::set_locked/list_locked, Vaults::update_key"
```

---

## Task 4: Settings View — Framework + Appearance Panel

**Files:**
- Create: `wiredash/crates/wiredash-app/src/settings_view.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add mod, state, wiring

This task creates the settings framework (sidebar + panel routing) and wires the first panel (Appearance) end-to-end.

### Step 1: Create settings_view.rs

```rust
//! Settings view — 22 panels across 5 groups, mirroring Workstation.

use iced::widget::{button, column, container, pick_list, row, rule, scrollable, space, text, text_input, toggler};
use iced::{Element, Fill, Theme, Center};
use std::collections::HashMap;
use wiredash_core::collections::settings::Settings;
use wiredash_db::Database;

// ── Panel & Group enums ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SettingsGroup {
    Account,
    Customization,
    ImportExport,
    Security,
    Other,
}

impl SettingsGroup {
    pub const ALL: &'static [SettingsGroup] = &[
        Self::Account, Self::Customization, Self::ImportExport, Self::Security, Self::Other,
    ];

    pub fn label(&self) -> &'static str {
        match self {
            Self::Account => "ACCOUNT",
            Self::Customization => "CUSTOMIZATION",
            Self::ImportExport => "IMPORT / EXPORT",
            Self::Security => "SECURITY",
            Self::Other => "OTHER",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SettingsPanel {
    // Account (stubbed)
    Profile, Subscription, Authentication, Sync, Circle, Inbox,
    // Customization
    Appearance, Behaviour, Editor, DesktopIntegration, Notifications, Servers,
    // Import/Export
    BackupExport, Importer,
    // Security
    AppLock, Vault, Privacy,
    // Other
    Legal, Support, About,
}

impl SettingsPanel {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Profile => "Profile",
            Self::Subscription => "Subscription",
            Self::Authentication => "Authentication",
            Self::Sync => "Sync",
            Self::Circle => "Circle",
            Self::Inbox => "Inbox",
            Self::Appearance => "Appearance",
            Self::Behaviour => "Behaviour",
            Self::Editor => "Editor",
            Self::DesktopIntegration => "Desktop Integration",
            Self::Notifications => "Notifications",
            Self::Servers => "Servers",
            Self::BackupExport => "Backup & Export",
            Self::Importer => "Importer",
            Self::AppLock => "App Lock",
            Self::Vault => "Vault",
            Self::Privacy => "Privacy",
            Self::Legal => "Legal",
            Self::Support => "Support",
            Self::About => "About",
        }
    }

    pub fn group(&self) -> SettingsGroup {
        match self {
            Self::Profile | Self::Subscription | Self::Authentication |
            Self::Sync | Self::Circle | Self::Inbox => SettingsGroup::Account,
            Self::Appearance | Self::Behaviour | Self::Editor |
            Self::DesktopIntegration | Self::Notifications | Self::Servers => SettingsGroup::Customization,
            Self::BackupExport | Self::Importer => SettingsGroup::ImportExport,
            Self::AppLock | Self::Vault | Self::Privacy => SettingsGroup::Security,
            Self::Legal | Self::Support | Self::About => SettingsGroup::Other,
        }
    }

    pub fn for_group(group: SettingsGroup) -> Vec<SettingsPanel> {
        Self::ALL.iter().filter(|p| p.group() == group).copied().collect()
    }

    pub fn is_stubbed(&self) -> bool {
        matches!(self,
            Self::Profile | Self::Subscription | Self::Authentication |
            Self::Sync | Self::Circle | Self::Inbox | Self::Importer
        )
    }

    pub const ALL: &'static [SettingsPanel] = &[
        Self::Profile, Self::Subscription, Self::Authentication,
        Self::Sync, Self::Circle, Self::Inbox,
        Self::Appearance, Self::Behaviour, Self::Editor,
        Self::DesktopIntegration, Self::Notifications, Self::Servers,
        Self::BackupExport, Self::Importer,
        Self::AppLock, Self::Vault, Self::Privacy,
        Self::Legal, Self::Support, Self::About,
    ];
}

// ── State ────────────────────────────────────────────────────────────

pub struct SettingsViewState {
    pub active_panel: SettingsPanel,
    pub cache: HashMap<String, serde_json::Value>,
}

impl SettingsViewState {
    pub fn new() -> Self {
        Self {
            active_panel: SettingsPanel::Appearance,
            cache: HashMap::new(),
        }
    }

    /// Load all settings from the KV store into memory cache.
    pub fn load_all(&mut self, db: &Database) {
        let settings = Settings::new(db);
        let keys = [
            "theme_scheme", "zoom_factor",
            "date_format", "time_format", "day_format", "week_start", "trash_cleanup_days",
            "editor_title_format", "editor_font_family", "editor_font_size",
            "editor_line_height", "editor_double_spaced", "editor_markdown_shortcuts",
            "editor_font_ligatures",
            "auto_launch", "start_minimized", "minimize_to_tray", "close_to_tray",
            "notifications_enabled",
            "api_server", "sync_server",
            "auto_backup", "backup_encryption",
            "app_lock_enabled", "app_lock_timeout", "app_lock_hash", "app_lock_salt",
            "vault_created",
            "hide_note_title", "privacy_mode",
        ];
        for key in keys {
            if let Ok(Some(val)) = settings.get_setting(key) {
                self.cache.insert(key.to_string(), val);
            }
        }
    }

    /// Get a cached string setting, returning default if not set.
    pub fn get_string(&self, key: &str, default: &str) -> String {
        self.cache.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or(default)
            .to_string()
    }

    /// Get a cached bool setting, returning default if not set.
    pub fn get_bool(&self, key: &str, default: bool) -> bool {
        self.cache.get(key)
            .and_then(|v| v.as_bool())
            .unwrap_or(default)
    }

    /// Get a cached f64 setting, returning default if not set.
    pub fn get_f64(&self, key: &str, default: f64) -> f64 {
        self.cache.get(key)
            .and_then(|v| v.as_f64())
            .unwrap_or(default)
    }

    /// Write a setting to both cache and DB.
    pub fn set_value(&mut self, db: &Database, key: &str, value: serde_json::Value) {
        let settings = Settings::new(db);
        if let Err(e) = settings.set(key, &value) {
            tracing::error!("Failed to save setting {key}: {e}");
        }
        self.cache.insert(key.to_string(), value);
    }

    pub fn update(&mut self, msg: SettingsMessage, db: &Database) -> bool {
        match msg {
            SettingsMessage::SelectPanel(panel) => {
                self.active_panel = panel;
                true
            }
            SettingsMessage::SetValue(key, value) => {
                self.set_value(db, &key, value);
                true
            }
            SettingsMessage::OpenExternal(url) => {
                let _ = open::that(&url);
                false
            }
        }
    }
}

// ── Messages ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum SettingsMessage {
    SelectPanel(SettingsPanel),
    SetValue(String, serde_json::Value),
    OpenExternal(String),
}

// ── View functions ───────────────────────────────────────────────────

pub fn settings_view<'a>(state: &'a SettingsViewState, _theme: &Theme) -> Element<'a, SettingsMessage> {
    let sidebar = settings_sidebar(state);
    let panel = settings_panel(state);

    row![
        container(scrollable(sidebar)).width(240).height(Fill),
        rule::vertical(1),
        container(scrollable(panel)).width(Fill).height(Fill).padding(24),
    ]
    .into()
}

fn settings_sidebar<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let mut items: Vec<Element<'a, SettingsMessage>> = Vec::new();

    items.push(
        container(text("Settings").size(18))
            .padding([16, 16, 8, 16])
            .into(),
    );

    for group in SettingsGroup::ALL {
        items.push(
            container(text(group.label()).size(10).color(iced::Color::from_rgb8(0x99, 0x99, 0x99)))
                .padding(iced::Padding::ZERO.top(12).right(16).bottom(4).left(16))
                .into(),
        );

        for panel in SettingsPanel::for_group(*group) {
            let is_selected = panel == state.active_panel;
            let label = if panel.is_stubbed() {
                text(format!("  {}  (soon)", panel.label())).size(13).color(iced::Color::from_rgb8(0xAA, 0xAA, 0xAA))
            } else {
                text(format!("  {}", panel.label())).size(13)
            };
            let btn = button(label)
                .on_press(SettingsMessage::SelectPanel(panel))
                .padding([6, 12])
                .width(Fill)
                .style(move |theme: &Theme, status| {
                    let mut style = button::text(theme, status);
                    if is_selected {
                        style.background = Some(iced::Background::Color(
                            iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.1),
                        ));
                    }
                    style
                });
            items.push(btn.into());
        }
    }

    column(items).spacing(1).into()
}

fn settings_panel<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    if state.active_panel.is_stubbed() {
        return container(
            column![
                text(state.active_panel.label()).size(22),
                rule::horizontal(1),
                space::vertical(16),
                text("Requires account — coming in a future phase.").size(14),
            ]
            .spacing(8)
        ).into();
    }

    match state.active_panel {
        SettingsPanel::Appearance => panel_appearance(state),
        SettingsPanel::Behaviour => panel_behaviour(state),
        SettingsPanel::Editor => panel_editor(state),
        SettingsPanel::DesktopIntegration => panel_desktop(state),
        SettingsPanel::Notifications => panel_notifications(state),
        SettingsPanel::Servers => panel_servers(state),
        SettingsPanel::BackupExport => panel_backup_export(state),
        SettingsPanel::AppLock => panel_app_lock(state),
        SettingsPanel::Vault => panel_vault(state),
        SettingsPanel::Privacy => panel_privacy(state),
        SettingsPanel::Legal => panel_legal(state),
        SettingsPanel::Support => panel_support(state),
        SettingsPanel::About => panel_about(state),
        _ => text("Panel not implemented").into(),
    }
}

// ── Helper: settings row (label left, control right) ─────────────────

fn setting_row<'a>(
    label: &str,
    description: &str,
    control: Element<'a, SettingsMessage>,
) -> Element<'a, SettingsMessage> {
    row![
        column![
            text(label).size(14),
            text(description).size(11).color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
        ]
        .spacing(2)
        .width(Fill),
        control,
    ]
    .spacing(16)
    .align_y(Center)
    .padding([8, 0])
    .into()
}

fn section_header<'a>(title: &str) -> Element<'a, SettingsMessage> {
    column![
        space::vertical(8),
        text(title).size(11).color(iced::Color::from_rgb8(0x99, 0x99, 0x99)),
        rule::horizontal(1),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Appearance ────────────────────────────────────────────────

fn panel_appearance<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let scheme = state.get_string("theme_scheme", "Auto");
    let zoom = state.get_f64("zoom_factor", 1.0);

    column![
        text("Appearance").size(22),
        rule::horizontal(1),
        section_header("General"),
        setting_row(
            "Color Scheme",
            "Choose between light, dark, or system theme.",
            pick_list(
                ["Light", "Dark", "Auto"],
                Some(scheme.as_str()),
                |v: &str| SettingsMessage::SetValue("theme_scheme".into(), serde_json::json!(v)),
            ).into(),
        ),
        setting_row(
            "Zoom Factor",
            "Adjust the UI zoom level (0.5–3.0).",
            text_input("1.0", &format!("{:.1}", zoom))
                .on_input(move |s| {
                    let val = s.parse::<f64>().unwrap_or(1.0).clamp(0.5, 3.0);
                    SettingsMessage::SetValue("zoom_factor".into(), serde_json::json!(val))
                })
                .width(80)
                .into(),
        ),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Behaviour ─────────────────────────────────────────────────

fn panel_behaviour<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let date_fmt = state.get_string("date_format", "DD/MM/YYYY");
    let time_fmt = state.get_string("time_format", "12h");
    let day_fmt = state.get_string("day_format", "Short");
    let week_start = state.get_string("week_start", "Sunday");
    let trash_days = state.get_string("trash_cleanup_days", "7");

    column![
        text("Behaviour").size(22),
        rule::horizontal(1),
        section_header("Date and Time"),
        setting_row(
            "Date Format",
            "How dates are displayed throughout the app.",
            pick_list(
                ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD.MM.YYYY"],
                Some(date_fmt.as_str()),
                |v: &str| SettingsMessage::SetValue("date_format".into(), serde_json::json!(v)),
            ).into(),
        ),
        setting_row(
            "Time Format",
            "12-hour or 24-hour clock.",
            pick_list(
                ["12h", "24h"],
                Some(time_fmt.as_str()),
                |v: &str| SettingsMessage::SetValue("time_format".into(), serde_json::json!(v)),
            ).into(),
        ),
        setting_row(
            "Day Format",
            "Short (Mon) or Long (Monday).",
            pick_list(
                ["Short", "Long"],
                Some(day_fmt.as_str()),
                |v: &str| SettingsMessage::SetValue("day_format".into(), serde_json::json!(v)),
            ).into(),
        ),
        setting_row(
            "Week Starts On",
            "First day of the week.",
            pick_list(
                ["Sunday", "Monday"],
                Some(week_start.as_str()),
                |v: &str| SettingsMessage::SetValue("week_start".into(), serde_json::json!(v)),
            ).into(),
        ),
        section_header("Trash"),
        setting_row(
            "Clear Trash After",
            "Automatically delete trashed notes after this period.",
            pick_list(
                ["Daily", "7 days", "30 days", "365 days", "Never"],
                Some(trash_days.as_str()),
                |v: &str| SettingsMessage::SetValue("trash_cleanup_days".into(), serde_json::json!(v)),
            ).into(),
        ),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Editor ────────────────────────────────────────────────────

fn panel_editor<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let title_fmt = state.get_string("editor_title_format", "");
    let font_family = state.get_string("editor_font_family", "System");
    let font_size = state.get_f64("editor_font_size", 16.0);
    let line_height = state.get_f64("editor_line_height", 1.5);
    let double_spaced = state.get_bool("editor_double_spaced", false);
    let md_shortcuts = state.get_bool("editor_markdown_shortcuts", true);
    let ligatures = state.get_bool("editor_font_ligatures", false);

    column![
        text("Editor").size(22),
        rule::horizontal(1),
        section_header("Editor"),
        setting_row(
            "Title Format",
            "Template for auto-generated note titles.",
            text_input("e.g. Note - {date}", &title_fmt)
                .on_input(|s| SettingsMessage::SetValue("editor_title_format".into(), serde_json::json!(s)))
                .width(200)
                .into(),
        ),
        setting_row(
            "Default Font Family",
            "Font used in the editor.",
            pick_list(
                ["System", "Serif", "Monospace"],
                Some(font_family.as_str()),
                |v: &str| SettingsMessage::SetValue("editor_font_family".into(), serde_json::json!(v)),
            ).into(),
        ),
        setting_row(
            "Default Font Size",
            "Font size in pixels (8–120).",
            text_input("16", &format!("{}", font_size as u32))
                .on_input(|s| {
                    let val = s.parse::<f64>().unwrap_or(16.0).clamp(8.0, 120.0);
                    SettingsMessage::SetValue("editor_font_size".into(), serde_json::json!(val))
                })
                .width(80)
                .into(),
        ),
        setting_row(
            "Line Height",
            "Spacing between lines.",
            text_input("1.5", &format!("{:.1}", line_height))
                .on_input(|s| {
                    let val = s.parse::<f64>().unwrap_or(1.5).clamp(1.0, 3.0);
                    SettingsMessage::SetValue("editor_line_height".into(), serde_json::json!(val))
                })
                .width(80)
                .into(),
        ),
        setting_row(
            "Double Spaced Lines",
            "Add extra space between paragraphs.",
            toggler(double_spaced)
                .on_toggle(|v| SettingsMessage::SetValue("editor_double_spaced".into(), serde_json::json!(v)))
                .into(),
        ),
        setting_row(
            "Markdown Shortcuts",
            "Enable markdown shortcuts like # for headings.",
            toggler(md_shortcuts)
                .on_toggle(|v| SettingsMessage::SetValue("editor_markdown_shortcuts".into(), serde_json::json!(v)))
                .into(),
        ),
        setting_row(
            "Font Ligatures",
            "Enable font ligatures for supported fonts.",
            toggler(ligatures)
                .on_toggle(|v| SettingsMessage::SetValue("editor_font_ligatures".into(), serde_json::json!(v)))
                .into(),
        ),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Desktop Integration ───────────────────────────────────────

fn panel_desktop<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let auto_launch = state.get_bool("auto_launch", false);
    let start_min = state.get_bool("start_minimized", false);
    let min_tray = state.get_bool("minimize_to_tray", false);
    let close_tray = state.get_bool("close_to_tray", false);

    let mut items: Vec<Element<'a, SettingsMessage>> = vec![
        text("Desktop Integration").size(22).into(),
        rule::horizontal(1).into(),
        section_header("Desktop Integration"),
        setting_row(
            "Auto Start on System Startup",
            "Launch the app when your computer starts.",
            toggler(auto_launch)
                .on_toggle(|v| SettingsMessage::SetValue("auto_launch".into(), serde_json::json!(v)))
                .into(),
        ),
    ];

    if auto_launch {
        items.push(setting_row(
            "Start Minimized",
            "Start the app minimized to the system tray.",
            toggler(start_min)
                .on_toggle(|v| SettingsMessage::SetValue("start_minimized".into(), serde_json::json!(v)))
                .into(),
        ));
    }

    items.push(setting_row(
        "Minimize to System Tray",
        "Minimize to tray instead of taskbar.",
        toggler(min_tray)
            .on_toggle(|v| SettingsMessage::SetValue("minimize_to_tray".into(), serde_json::json!(v)))
            .into(),
    ));
    items.push(setting_row(
        "Close to System Tray",
        "Close to tray instead of quitting.",
        toggler(close_tray)
            .on_toggle(|v| SettingsMessage::SetValue("close_to_tray".into(), serde_json::json!(v)))
            .into(),
    ));

    column(items).spacing(4).into()
}

// ── Panel: Notifications ─────────────────────────────────────────────

fn panel_notifications<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let notifs = state.get_bool("notifications_enabled", true);

    column![
        text("Notifications").size(22),
        rule::horizontal(1),
        section_header("Notifications"),
        setting_row(
            "Reminder Notifications",
            "Show notifications when reminders are due.",
            toggler(notifs)
                .on_toggle(|v| SettingsMessage::SetValue("notifications_enabled".into(), serde_json::json!(v)))
                .into(),
        ),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Servers ───────────────────────────────────────────────────

fn panel_servers<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let api = state.get_string("api_server", "");
    let sync = state.get_string("sync_server", "");

    column![
        text("Servers").size(22),
        rule::horizontal(1),
        section_header("Servers Configuration"),
        setting_row(
            "API Server URL",
            "Custom API server endpoint.",
            text_input("https://api.notesnook.com", &api)
                .on_input(|s| SettingsMessage::SetValue("api_server".into(), serde_json::json!(s)))
                .width(300)
                .into(),
        ),
        setting_row(
            "Sync Server URL",
            "Custom sync server endpoint.",
            text_input("https://sync.notesnook.com", &sync)
                .on_input(|s| SettingsMessage::SetValue("sync_server".into(), serde_json::json!(s)))
                .width(300)
                .into(),
        ),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Backup & Export ───────────────────────────────────────────

fn panel_backup_export<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let auto_backup = state.get_string("auto_backup", "Never");
    let backup_enc = state.get_bool("backup_encryption", false);

    column![
        text("Backup & Export").size(22),
        rule::horizontal(1),
        section_header("Backups"),
        setting_row(
            "Automatic Backups",
            "Schedule automatic backups of your data.",
            pick_list(
                ["Never", "Daily", "Weekly", "Monthly"],
                Some(auto_backup.as_str()),
                |v: &str| SettingsMessage::SetValue("auto_backup".into(), serde_json::json!(v)),
            ).into(),
        ),
        setting_row(
            "Backup Encryption",
            "Encrypt backup files with your password.",
            toggler(backup_enc)
                .on_toggle(|v| SettingsMessage::SetValue("backup_encryption".into(), serde_json::json!(v)))
                .into(),
        ),
        section_header("Export"),
        text("Export functionality will be available in a future update.").size(13),
    ]
    .spacing(4)
    .into()
}

// ── Panel: App Lock (placeholder — full impl in Task 6) ──────────────

fn panel_app_lock<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let enabled = state.get_bool("app_lock_enabled", false);
    let timeout = state.get_string("app_lock_timeout", "Immediately");

    column![
        text("App Lock").size(22),
        rule::horizontal(1),
        section_header("App Lock"),
        setting_row(
            "Enable App Lock",
            "Require a password to open the app.",
            toggler(enabled)
                .on_toggle(|_v| {
                    // TODO: Task 6 will wire this to a password dialog
                    SettingsMessage::SetValue("app_lock_enabled".into(), serde_json::json!(!enabled))
                })
                .into(),
        ),
        setting_row(
            "Lock App After",
            "Lock the app after this period of inactivity.",
            pick_list(
                ["Immediately", "1 min", "5 min", "10 min", "15 min", "30 min", "45 min", "1 hour", "Never"],
                Some(timeout.as_str()),
                |v: &str| SettingsMessage::SetValue("app_lock_timeout".into(), serde_json::json!(v)),
            ).into(),
        ),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Vault (placeholder — full impl in Task 7) ─────────────────

fn panel_vault<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let vault_created = state.get_bool("vault_created", false);

    let mut items: Vec<Element<'a, SettingsMessage>> = vec![
        text("Vault").size(22).into(),
        rule::horizontal(1).into(),
        section_header("Vault"),
    ];

    if !vault_created {
        items.push(
            text("Create a vault to encrypt sensitive notes with a password.").size(13).into(),
        );
        // TODO: Task 7 will add the "Create Vault" button with password dialog
    } else {
        items.push(text("Vault is active. Your locked notes are encrypted.").size(13).into());
        // TODO: Task 7 will add Change Password, Clear Vault, Delete Vault buttons
    }

    column(items).spacing(4).into()
}

// ── Panel: Privacy ───────────────────────────────────────────────────

fn panel_privacy<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let hide_title = state.get_bool("hide_note_title", false);
    let privacy_mode = state.get_bool("privacy_mode", false);

    column![
        text("Privacy").size(22),
        rule::horizontal(1),
        section_header("General"),
        setting_row(
            "Hide Note Title",
            "Hide note titles in the sidebar list.",
            toggler(hide_title)
                .on_toggle(|v| SettingsMessage::SetValue("hide_note_title".into(), serde_json::json!(v)))
                .into(),
        ),
        setting_row(
            "Privacy Mode",
            "Blur content when the app loses focus.",
            toggler(privacy_mode)
                .on_toggle(|v| SettingsMessage::SetValue("privacy_mode".into(), serde_json::json!(v)))
                .into(),
        ),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Legal ─────────────────────────────────────────────────────

fn panel_legal<'a>(_state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    column![
        text("Legal").size(22),
        rule::horizontal(1),
        section_header("Legal"),
        button(text("Privacy Policy").size(13))
            .on_press(SettingsMessage::OpenExternal("https://notesnook.com/privacy".into()))
            .style(button::secondary)
            .padding([6, 12]),
        button(text("Terms of Service").size(13))
            .on_press(SettingsMessage::OpenExternal("https://notesnook.com/terms".into()))
            .style(button::secondary)
            .padding([6, 12]),
        button(text("License").size(13))
            .on_press(SettingsMessage::OpenExternal("https://github.com/streetwriters/notesnook/blob/master/LICENSE".into()))
            .style(button::secondary)
            .padding([6, 12]),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Support ───────────────────────────────────────────────────

fn panel_support<'a>(_state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    column![
        text("Support").size(22),
        rule::horizontal(1),
        section_header("Help and Support"),
        button(text("Report an Issue").size(13))
            .on_press(SettingsMessage::OpenExternal("https://github.com/streetwriters/notesnook/issues".into()))
            .style(button::secondary)
            .padding([6, 12]),
        button(text("Documentation").size(13))
            .on_press(SettingsMessage::OpenExternal("https://docs.notesnook.com".into()))
            .style(button::secondary)
            .padding([6, 12]),
    ]
    .spacing(4)
    .into()
}

// ── Panel: About ─────────────────────────────────────────────────────

fn panel_about<'a>(_state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    column![
        text("About").size(22),
        rule::horizontal(1),
        section_header("About"),
        text("Wiredash v0.1.0").size(14),
        text("A complete daily-use note-taking application.").size(12),
        space::vertical(8),
        button(text("View Source Code").size(13))
            .on_press(SettingsMessage::OpenExternal("https://github.com/streetwriters/notesnook".into()))
            .style(button::secondary)
            .padding([6, 12]),
        section_header("Community"),
        button(text("Join Discord").size(13))
            .on_press(SettingsMessage::OpenExternal("https://discord.gg/zQBK97EE".into()))
            .style(button::secondary)
            .padding([6, 12]),
    ]
    .spacing(4)
    .into()
}
```

### Step 2: Wire Settings into main.rs

**Add mod declaration** (after line 8 `mod organize_views;`):
```rust
mod settings_view;
```

**Add state field** to `Wiredash` struct (after `trash_state` on line 41):
```rust
settings_state: settings_view::SettingsViewState,
```

**Add message variant** to `Message` enum (after `TrashView` on line 55):
```rust
SettingsView(settings_view::SettingsMessage),
```

**Initialize in `new()`** (after trash_state init, around line 98):
```rust
let mut settings_state = settings_view::SettingsViewState::new();
settings_state.load_all(&db);
```

Add to struct initialization (after `trash_state,`):
```rust
settings_state,
```

**Add update handler** (after `Message::TrashView` handler, around line 193):
```rust
Message::SettingsView(msg) => {
    self.settings_state.update(msg, &self.db);
}
```

**Add content_view match** (before the `view =>` catch-all, around line 456):
```rust
View::Settings => {
    settings_view::settings_view(&self.settings_state, &self.theme_engine.active_iced_theme())
        .map(Message::SettingsView)
}
```

**Add Settings refresh on navigate** (in the Navigate handler match, around line 138):
```rust
View::Settings => self.settings_state.load_all(&self.db),
```

### Step 3: Compile and test

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo check -p wiredash-app
```

Expected: compiles. Settings view accessible via sidebar navigation.

### Step 4: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-app/src/settings_view.rs crates/wiredash-app/src/main.rs
git commit -s -m "desktop: add Settings view with 20 panels across 5 groups"
```

---

## Task 5: Settings — Apply Theme Setting to ThemeEngine

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — apply theme_scheme setting on change

### Step 1: React to theme_scheme setting changes

In the `Message::SettingsView(msg)` handler in `main.rs`, after calling `update()`, check if the theme changed:

```rust
Message::SettingsView(msg) => {
    let changed = self.settings_state.update(msg.clone(), &self.db);
    // Apply theme setting immediately
    if let settings_view::SettingsMessage::SetValue(ref key, ref value) = msg {
        if key == "theme_scheme" {
            if let Some(scheme_str) = value.as_str() {
                match scheme_str {
                    "Light" => self.theme_engine.set_scheme(wiredash_theme::ColorScheme::Light),
                    "Dark" => self.theme_engine.set_scheme(wiredash_theme::ColorScheme::Dark),
                    "Auto" => {
                        self.theme_engine.follow_system = true;
                        let system = match dark_light::detect() {
                            dark_light::Mode::Dark => wiredash_theme::ColorScheme::Dark,
                            _ => wiredash_theme::ColorScheme::Light,
                        };
                        self.theme_engine.set_scheme(system);
                    }
                    _ => {}
                }
                self.save_config();
            }
        }
    }
}
```

### Step 2: Compile and verify

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo check -p wiredash-app
```

### Step 3: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-app/src/main.rs
git commit -s -m "desktop: apply theme setting changes to ThemeEngine in real-time"
```

---

## Task 6: App Lock — Password Dialog + Gate Screen

**Files:**
- Create: `wiredash/crates/wiredash-app/src/app_lock.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add lock state, gate screen, inactivity timer
- Modify: `wiredash/crates/wiredash-app/src/settings_view.rs` — wire App Lock panel to password dialog
- Create: `wiredash/crates/wiredash-core/tests/app_lock_test.rs`

### Step 1: Create app_lock.rs

```rust
//! App Lock — password gate screen and inactivity timer.

use iced::widget::{button, center, column, container, space, text, text_input};
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
    settings.set("app_lock_hash", &serde_json::json!(hash)).map_err(|e| e.to_string())?;
    settings.set("app_lock_salt", &serde_json::json!(salt)).map_err(|e| e.to_string())?;
    settings.set("app_lock_enabled", &serde_json::json!(true)).map_err(|e| e.to_string())?;
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
    /// Returns true if the app should lock.
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
        space::vertical(0).into()
    };

    center(
        container(
            column![
                text("Wiredash").size(28),
                text("Enter your password to unlock.").size(14),
                space::vertical(8),
                text_input("Password", &state.password_input)
                    .secure(true)
                    .on_input(AppLockMessage::PasswordInput)
                    .on_submit(AppLockMessage::TryUnlock)
                    .width(300),
                error_text,
                space::vertical(4),
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
```

### Step 2: Wire app lock into main.rs

**Add mod declaration:**
```rust
mod app_lock;
```

**Add state field** to `Wiredash` struct:
```rust
app_lock_state: app_lock::AppLockState,
```

**Add message variant:**
```rust
AppLock(app_lock::AppLockMessage),
InactivityCheck,
```

**Initialize in `new()`:**
```rust
let app_lock_enabled = {
    let settings = wiredash_core::collections::settings::Settings::new(&db);
    settings.get_setting("app_lock_enabled").ok().flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
};
let app_lock_state = app_lock::AppLockState::new(app_lock_enabled);
```

**Add update handler:**
```rust
Message::AppLock(msg) => {
    match msg {
        app_lock::AppLockMessage::PasswordInput(s) => {
            self.app_lock_state.password_input = s;
        }
        app_lock::AppLockMessage::TryUnlock => {
            if app_lock::try_unlock(&self.db, &self.app_lock_state.password_input) {
                self.app_lock_state.locked = false;
                self.app_lock_state.password_input.clear();
                self.app_lock_state.error = None;
                self.app_lock_state.record_activity();
            } else {
                self.app_lock_state.error = Some("Incorrect password.".into());
            }
        }
    }
}
Message::InactivityCheck => {
    if !self.app_lock_state.locked {
        let timeout = self.settings_state.get_string("app_lock_timeout", "Immediately");
        let enabled = self.settings_state.get_bool("app_lock_enabled", false);
        if enabled && self.app_lock_state.should_lock(&timeout) {
            self.app_lock_state.locked = true;
        }
    }
}
```

**Record activity on user interactions** — at the top of `update()`, before the match:
```rust
// Record user activity for inactivity timer
if !matches!(message, Message::AutoSaveTick | Message::InactivityCheck) {
    self.app_lock_state.record_activity();
}
```

**Add inactivity check subscription** — in `subscription()`:
```rust
fn subscription(&self) -> Subscription<Message> {
    let keyboard_sub = keyboard::listen().map(Message::KeyboardEvent);
    let mut subs = vec![keyboard_sub];
    if self.save_pending {
        subs.push(
            iced::time::every(std::time::Duration::from_secs(2))
                .map(|_| Message::AutoSaveTick)
        );
    }
    if self.settings_state.get_bool("app_lock_enabled", false) && !self.app_lock_state.locked {
        subs.push(
            iced::time::every(std::time::Duration::from_secs(10))
                .map(|_| Message::InactivityCheck)
        );
    }
    Subscription::batch(subs)
}
```

**Gate the view** — in `view()`, wrap the content:
```rust
fn view(&self) -> Element<'_, Message> {
    if self.app_lock_state.locked {
        return app_lock::gate_view(&self.app_lock_state).map(Message::AppLock);
    }
    // ... existing view code
}
```

### Step 3: Write test

Create `wiredash/crates/wiredash-core/tests/app_lock_test.rs`:

```rust
// Test hash + verify roundtrip (uses wiredash-crypto directly)
#[test]
fn test_app_lock_hash_verify() {
    // This test lives in wiredash-app, but we test the crypto primitives here
    use wiredash_crypto::key::KeyUtils;
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;

    let password = "my_secure_password";
    let (key, salt) = KeyUtils::derive_key(password, None).unwrap();
    let hash = engine.encode(&key);
    let salt_b64 = engine.encode(&salt);

    // Re-derive with same salt should produce same key
    let (key2, _) = KeyUtils::derive_key(password, Some(&salt)).unwrap();
    let hash2 = engine.encode(&key2);
    assert_eq!(hash, hash2);

    // Wrong password should produce different hash
    let (key3, _) = KeyUtils::derive_key("wrong_password", Some(&salt)).unwrap();
    let hash3 = engine.encode(&key3);
    assert_ne!(hash, hash3);
}
```

### Step 4: Run tests

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo test -p wiredash-core -- app_lock
cargo check -p wiredash-app
```

### Step 5: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-app/src/app_lock.rs crates/wiredash-app/src/main.rs crates/wiredash-core/tests/app_lock_test.rs
git commit -s -m "desktop: add App Lock with password gate screen and inactivity timer"
```

---

## Task 7: Vault — Encrypt/Decrypt Note Content

**Files:**
- Create: `wiredash/crates/wiredash-app/src/vault.rs`
- Modify: `wiredash/crates/wiredash-app/src/settings_view.rs` — wire Vault panel buttons
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add vault state, message routing
- Create: `wiredash/crates/wiredash-core/tests/vault_encrypt_test.rs`

### Step 1: Create vault.rs

```rust
//! Vault — encrypt/decrypt note content using wiredash-crypto.

use wiredash_core::collections::content::Content;
use wiredash_core::collections::vaults::Vaults;
use wiredash_core::types::Vault;
use wiredash_crypto::encryption::Encryption;
use wiredash_crypto::decryption::Decryption;
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

    // Store the salt (not the password!) in the vault record
    let cipher_json = serde_json::to_string(&test_cipher)
        .map_err(|e| format!("Serialization failed: {e}"))?;

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
    let ci = content_col.get(content_id)
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
    let cipher = Encryption::encrypt(&key, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;
    let cipher_json = serde_json::to_string(&cipher)
        .map_err(|e| format!("Serialization failed: {e}"))?;
    content_col.update_data(content_id, &cipher_json)
        .map_err(|e| e.to_string())?;
    content_col.set_locked(content_id, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Unlock a note's content: decrypt the cipher and return plaintext.
/// Does NOT persist the decryption — caller decides what to do with plaintext.
pub fn unlock_note(db: &Database, content_id: &str, password: &str) -> Result<String, String> {
    let content_col = Content::new(db);
    let ci = content_col.get(content_id)
        .map_err(|e| e.to_string())?
        .ok_or("Content not found")?;
    if !ci.locked {
        return Err("Content is not locked".into());
    }
    let cipher_json = ci.data.as_deref().ok_or("No data to decrypt")?;
    let cipher: wiredash_crypto::types::Cipher = serde_json::from_str(cipher_json)
        .map_err(|e| format!("Invalid cipher format: {e}"))?;
    let key = SerializedKey {
        password: Some(password.to_string()),
        key: None,
        salt: None,
    };
    Decryption::decrypt(&cipher, &key)
        .map_err(|e| format!("Decryption failed: {e}"))
}

/// Permanently unlock: decrypt and write plaintext back, set locked=false.
pub fn permanently_unlock_note(db: &Database, content_id: &str, password: &str) -> Result<(), String> {
    let plaintext = unlock_note(db, content_id, password)?;
    let content_col = Content::new(db);
    content_col.update_data(content_id, &plaintext)
        .map_err(|e| e.to_string())?;
    content_col.set_locked(content_id, false)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clear vault: permanently unlock all locked notes, then remove the vault.
pub fn clear_vault(db: &Database, password: &str) -> Result<(), String> {
    let content_col = Content::new(db);
    let locked_items = content_col.list_locked()
        .map_err(|e| e.to_string())?;
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
pub fn change_vault_password(db: &Database, old_password: &str, new_password: &str) -> Result<(), String> {
    let content_col = Content::new(db);
    let locked_items = content_col.list_locked()
        .map_err(|e| e.to_string())?;
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
        content_col.update_data(&ci.base.id, &cipher_json)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

### Step 2: Write vault encryption test

Create `wiredash/crates/wiredash-core/tests/vault_encrypt_test.rs`:

```rust
use wiredash_crypto::encryption::Encryption;
use wiredash_crypto::decryption::Decryption;
use wiredash_crypto::types::SerializedKey;

#[test]
fn test_encrypt_decrypt_roundtrip() {
    let password = "test_vault_password";
    let plaintext = "This is a secret note about my plans.";
    let key = SerializedKey {
        password: Some(password.to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, plaintext).unwrap();
    assert_eq!(cipher.format, "base64");
    assert!(!cipher.cipher.is_empty());

    let decrypted = Decryption::decrypt(&cipher, &key).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_wrong_password_fails() {
    let key = SerializedKey {
        password: Some("correct_password".to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, "secret").unwrap();

    let wrong_key = SerializedKey {
        password: Some("wrong_password".to_string()),
        key: None,
        salt: Some(cipher.salt.clone()),
    };
    let result = Decryption::decrypt(&cipher, &wrong_key);
    assert!(result.is_err());
}

#[test]
fn test_cipher_serialization() {
    let key = SerializedKey {
        password: Some("password123".to_string()),
        key: None,
        salt: None,
    };
    let cipher = Encryption::encrypt(&key, "test data").unwrap();
    let json = serde_json::to_string(&cipher).unwrap();
    let deserialized: wiredash_crypto::types::Cipher = serde_json::from_str(&json).unwrap();
    assert_eq!(cipher, deserialized);

    let decrypted = Decryption::decrypt(&deserialized, &key).unwrap();
    assert_eq!(decrypted, "test data");
}
```

### Step 3: Wire vault.rs into main.rs

**Add mod:**
```rust
mod vault;
```

**Wire Vault panel buttons in settings_view.rs** — Replace the `panel_vault` function to use `SettingsMessage` variants that main.rs handles via vault module. Add new message variants:

In `SettingsMessage`:
```rust
CreateVault(String),           // password
ChangeVaultPassword(String, String), // old, new
ClearVault(String),            // password
DeleteVault,
```

### Step 4: Run tests

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo test -p wiredash-crypto
cargo test -p wiredash-core -- vault_encrypt
cargo check -p wiredash-app
```

### Step 5: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-app/src/vault.rs crates/wiredash-app/src/settings_view.rs crates/wiredash-app/src/main.rs crates/wiredash-core/tests/vault_encrypt_test.rs
git commit -s -m "desktop: add Vault encryption with lock/unlock/clear/re-encrypt"
```

---

## Task 8: Reminders View

**Files:**
- Create: `wiredash/crates/wiredash-app/src/reminders_view.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` — add mod, state, wiring
- Create: `wiredash/crates/wiredash-core/tests/reminders_view_test.rs`

### Step 1: Create reminders_view.rs

```rust
//! Reminders view — list + create/edit form, mirroring Workstation.

use iced::widget::{button, column, container, pick_list, row, rule, scrollable, space, text, text_input, toggler};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::reminders::Reminders;
use wiredash_core::types::Reminder;
use wiredash_db::Database;

pub struct ReminderSummary {
    pub id: String,
    pub title: String,
    pub date: i64,
    pub mode: String,
    pub priority: String,
    pub disabled: bool,
}

pub struct RemindersViewState {
    pub reminder_list: Vec<ReminderSummary>,
    pub selected_index: Option<usize>,
    pub editing: bool,
    // Form fields
    pub form_title: String,
    pub form_date: String,
    pub form_time: String,
    pub form_mode: String,
    pub form_recurring_mode: String,
    pub form_selected_days: Vec<i32>,
    pub form_priority: String,
    pub form_description: String,
    pub form_disabled: bool,
}

impl RemindersViewState {
    pub fn new() -> Self {
        Self {
            reminder_list: Vec::new(),
            selected_index: None,
            editing: false,
            form_title: String::new(),
            form_date: String::new(),
            form_time: String::new(),
            form_mode: "once".into(),
            form_recurring_mode: "daily".into(),
            form_selected_days: Vec::new(),
            form_priority: "silent".into(),
            form_description: String::new(),
            form_disabled: false,
        }
    }

    pub fn refresh(&mut self, db: &Database) {
        let reminders = Reminders::new(db);
        match reminders.list() {
            Ok(list) => {
                self.reminder_list = list.into_iter().map(|r| ReminderSummary {
                    id: r.base.id,
                    title: r.title,
                    date: r.date,
                    mode: r.mode,
                    priority: r.priority,
                    disabled: r.disabled.unwrap_or(false),
                }).collect();
            }
            Err(e) => tracing::error!("Failed to load reminders: {e}"),
        }
    }

    pub fn load_reminder(&mut self, index: usize, db: &Database) {
        self.selected_index = Some(index);
        let Some(summary) = self.reminder_list.get(index) else { return; };
        let reminders = Reminders::new(db);
        let Some(rem) = reminders.get(&summary.id).ok().flatten() else { return; };

        self.editing = true;
        self.form_title = rem.title;
        self.form_description = rem.description.unwrap_or_default();
        self.form_priority = rem.priority;
        self.form_mode = rem.mode;
        self.form_recurring_mode = rem.recurring_mode.unwrap_or("daily".into());
        self.form_selected_days = rem.selected_days.unwrap_or_default();
        self.form_disabled = rem.disabled.unwrap_or(false);

        // Format date/time from timestamp
        let dt = chrono::DateTime::from_timestamp_millis(rem.date)
            .unwrap_or_else(|| chrono::Utc::now());
        self.form_date = dt.format("%Y-%m-%d").to_string();
        self.form_time = dt.format("%H:%M").to_string();
    }

    pub fn create_reminder(&mut self, db: &Database) {
        self.editing = true;
        self.selected_index = None;
        self.form_title = "New Reminder".into();
        self.form_description.clear();
        self.form_priority = "silent".into();
        self.form_mode = "once".into();
        self.form_recurring_mode = "daily".into();
        self.form_selected_days.clear();
        self.form_disabled = false;

        let now = chrono::Utc::now();
        self.form_date = now.format("%Y-%m-%d").to_string();
        self.form_time = now.format("%H:%M").to_string();
    }

    pub fn save_reminder(&mut self, db: &Database) {
        let date_str = format!("{}T{}:00Z", self.form_date, self.form_time);
        let date_ts = chrono::DateTime::parse_from_rfc3339(&date_str)
            .map(|dt| dt.timestamp_millis())
            .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis());

        let reminders = Reminders::new(db);

        if let Some(idx) = self.selected_index {
            // Update existing
            if let Some(summary) = self.reminder_list.get(idx) {
                if let Ok(Some(mut rem)) = reminders.get(&summary.id) {
                    rem.title = self.form_title.clone();
                    rem.description = if self.form_description.is_empty() { None } else { Some(self.form_description.clone()) };
                    rem.priority = self.form_priority.clone();
                    rem.date = date_ts;
                    rem.mode = self.form_mode.clone();
                    rem.recurring_mode = if self.form_mode == "recurring" { Some(self.form_recurring_mode.clone()) } else { None };
                    rem.selected_days = if self.form_mode == "recurring" && self.form_recurring_mode == "weekly" {
                        Some(self.form_selected_days.clone())
                    } else { None };
                    rem.disabled = Some(self.form_disabled);
                    let _ = reminders.update(&rem);
                }
            }
        } else {
            // Create new
            let mut rem = Reminder::new(&self.form_title, date_ts);
            rem.description = if self.form_description.is_empty() { None } else { Some(self.form_description.clone()) };
            rem.priority = self.form_priority.clone();
            rem.mode = self.form_mode.clone();
            rem.recurring_mode = if self.form_mode == "recurring" { Some(self.form_recurring_mode.clone()) } else { None };
            rem.selected_days = if self.form_mode == "recurring" && self.form_recurring_mode == "weekly" {
                Some(self.form_selected_days.clone())
            } else { None };
            rem.disabled = Some(self.form_disabled);
            let _ = reminders.add(&rem);
        }

        self.refresh(db);
    }

    pub fn delete_reminder(&mut self, db: &Database) {
        let Some(idx) = self.selected_index else { return; };
        let Some(summary) = self.reminder_list.get(idx) else { return; };
        let _ = Reminders::new(db).remove(&summary.id);
        self.editing = false;
        self.selected_index = None;
        self.refresh(db);
    }

    pub fn snooze_reminder(&mut self, db: &Database, minutes: i64) {
        let Some(idx) = self.selected_index else { return; };
        let Some(summary) = self.reminder_list.get(idx) else { return; };
        let reminders = Reminders::new(db);
        if let Ok(Some(mut rem)) = reminders.get(&summary.id) {
            rem.snooze_until = Some(chrono::Utc::now().timestamp_millis() + minutes * 60 * 1000);
            let _ = reminders.update(&rem);
        }
        self.refresh(db);
    }

    pub fn update(&mut self, msg: RemindersMessage, db: &Database) -> bool {
        match msg {
            RemindersMessage::SelectReminder(idx) => { self.load_reminder(idx, db); true }
            RemindersMessage::NewReminder => { self.create_reminder(db); true }
            RemindersMessage::SetTitle(s) => { self.form_title = s; true }
            RemindersMessage::SetDescription(s) => { self.form_description = s; true }
            RemindersMessage::SetDate(s) => { self.form_date = s; true }
            RemindersMessage::SetTime(s) => { self.form_time = s; true }
            RemindersMessage::SetMode(s) => { self.form_mode = s; true }
            RemindersMessage::SetRecurringMode(s) => { self.form_recurring_mode = s; true }
            RemindersMessage::ToggleDay(d) => {
                if self.form_selected_days.contains(&d) {
                    self.form_selected_days.retain(|&x| x != d);
                } else {
                    self.form_selected_days.push(d);
                }
                true
            }
            RemindersMessage::SetPriority(s) => { self.form_priority = s; true }
            RemindersMessage::SaveReminder => { self.save_reminder(db); true }
            RemindersMessage::DeleteReminder => { self.delete_reminder(db); true }
            RemindersMessage::SnoozeReminder(mins) => { self.snooze_reminder(db, mins); true }
            RemindersMessage::ToggleDisabled => { self.form_disabled = !self.form_disabled; true }
        }
    }
}

#[derive(Debug, Clone)]
pub enum RemindersMessage {
    SelectReminder(usize),
    NewReminder,
    SetTitle(String),
    SetDescription(String),
    SetDate(String),
    SetTime(String),
    SetMode(String),
    SetRecurringMode(String),
    ToggleDay(i32),
    SetPriority(String),
    SaveReminder,
    DeleteReminder,
    SnoozeReminder(i64),
    ToggleDisabled,
}

// ── View functions ───────────────────────────────────────────────────

pub fn reminders_view<'a>(state: &'a RemindersViewState, _theme: &Theme) -> Element<'a, RemindersMessage> {
    let list = reminder_list(state);
    let detail = if state.editing {
        reminder_form(state)
    } else {
        container(
            text("Select a reminder or create a new one.").size(14)
        ).padding(24).width(Fill).height(Fill).into()
    };

    row![
        container(scrollable(list)).width(320).height(Fill),
        rule::vertical(1),
        container(scrollable(detail)).width(Fill).height(Fill).padding(24),
    ]
    .into()
}

fn reminder_list<'a>(state: &'a RemindersViewState) -> Element<'a, RemindersMessage> {
    let mut items: Vec<Element<'a, RemindersMessage>> = Vec::new();

    items.push(
        container(
            row![
                text("Reminders").size(18),
                space::horizontal(Fill),
                button(text("+ New").size(12))
                    .on_press(RemindersMessage::NewReminder)
                    .padding([4, 10]),
            ]
            .align_y(Center)
        )
        .padding([12, 16])
        .into(),
    );

    items.push(rule::horizontal(1).into());

    let now = chrono::Utc::now().timestamp_millis();
    let today_start = {
        let today = chrono::Utc::now().date_naive();
        today.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis()
    };
    let tomorrow_start = today_start + 86_400_000;

    // Group: Overdue
    let overdue: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.date < now && !r.disabled)
        .collect();
    if !overdue.is_empty() {
        items.push(
            container(text("OVERDUE").size(10).color(iced::Color::from_rgb8(0xE0, 0x00, 0x00)))
                .padding([8, 16, 4, 16]).into()
        );
        for (i, rem) in &overdue {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    // Group: Today
    let today: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.date >= today_start && r.date < tomorrow_start && !r.disabled)
        .collect();
    if !today.is_empty() {
        items.push(
            container(text("TODAY").size(10).color(iced::Color::from_rgb8(0x00, 0x7B, 0xFF)))
                .padding([8, 16, 4, 16]).into()
        );
        for (i, rem) in &today {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    // Group: Upcoming
    let upcoming: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.date >= tomorrow_start && !r.disabled)
        .collect();
    if !upcoming.is_empty() {
        items.push(
            container(text("UPCOMING").size(10).color(iced::Color::from_rgb8(0x88, 0x88, 0x88)))
                .padding([8, 16, 4, 16]).into()
        );
        for (i, rem) in &upcoming {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    // Group: Disabled
    let disabled: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.disabled)
        .collect();
    if !disabled.is_empty() {
        items.push(
            container(text("DISABLED").size(10).color(iced::Color::from_rgb8(0xAA, 0xAA, 0xAA)))
                .padding([8, 16, 4, 16]).into()
        );
        for (i, rem) in &disabled {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    if state.reminder_list.is_empty() {
        items.push(
            container(text("No reminders yet.").size(13))
                .padding(16).into()
        );
    }

    column(items).spacing(1).into()
}

fn reminder_list_item<'a>(
    index: usize,
    rem: &ReminderSummary,
    selected: bool,
) -> Element<'a, RemindersMessage> {
    let dt = chrono::DateTime::from_timestamp_millis(rem.date)
        .map(|d| d.format("%b %d, %H:%M").to_string())
        .unwrap_or_else(|| "Unknown".into());

    let mode_icon = if rem.mode == "recurring" { "↻" } else { "○" };
    let label = column![
        text(&rem.title).size(13),
        text(format!("{mode_icon}  {dt}")).size(11).color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
    ].spacing(2);

    button(label)
        .on_press(RemindersMessage::SelectReminder(index))
        .padding([8, 16])
        .width(Fill)
        .style(move |theme: &Theme, status| {
            let mut style = button::text(theme, status);
            if selected {
                style.background = Some(iced::Background::Color(
                    iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.1),
                ));
            }
            style
        })
        .into()
}

fn reminder_form<'a>(state: &'a RemindersViewState) -> Element<'a, RemindersMessage> {
    let is_recurring = state.form_mode == "recurring";
    let is_weekly = state.form_recurring_mode == "weekly";

    let mut items: Vec<Element<'a, RemindersMessage>> = vec![
        text("Reminder").size(22).into(),
        rule::horizontal(1).into(),
        text_input("Title", &state.form_title)
            .on_input(RemindersMessage::SetTitle)
            .size(16)
            .into(),
        text_input("Description (optional)", &state.form_description)
            .on_input(RemindersMessage::SetDescription)
            .into(),
        row![
            column![
                text("Date").size(11),
                text_input("YYYY-MM-DD", &state.form_date)
                    .on_input(RemindersMessage::SetDate)
                    .width(140),
            ].spacing(4),
            column![
                text("Time").size(11),
                text_input("HH:MM", &state.form_time)
                    .on_input(RemindersMessage::SetTime)
                    .width(100),
            ].spacing(4),
        ].spacing(16).into(),
        row![
            text("Mode").size(13),
            pick_list(
                ["once", "recurring"],
                Some(state.form_mode.as_str()),
                |v: &str| RemindersMessage::SetMode(v.to_string()),
            ),
        ].spacing(8).align_y(Center).into(),
    ];

    if is_recurring {
        items.push(
            row![
                text("Repeat").size(13),
                pick_list(
                    ["daily", "weekly", "monthly"],
                    Some(state.form_recurring_mode.as_str()),
                    |v: &str| RemindersMessage::SetRecurringMode(v.to_string()),
                ),
            ].spacing(8).align_y(Center).into()
        );

        if is_weekly {
            let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            let day_buttons: Vec<Element<'a, RemindersMessage>> = days.iter().enumerate().map(|(i, label)| {
                let day_num = (i + 1) as i32;
                let selected = state.form_selected_days.contains(&day_num);
                button(text(*label).size(11))
                    .on_press(RemindersMessage::ToggleDay(day_num))
                    .padding([4, 8])
                    .style(move |theme: &Theme, status| {
                        let mut style = button::secondary(theme, status);
                        if selected {
                            style.background = Some(iced::Background::Color(
                                iced::Color::from_rgb8(0xE0, 0x00, 0x00),
                            ));
                            style.text_color = iced::Color::WHITE;
                        }
                        style
                    })
                    .into()
            }).collect();
            items.push(row(day_buttons).spacing(4).into());
        }
    }

    items.push(
        row![
            text("Priority").size(13),
            pick_list(
                ["silent", "vibrate", "urgent"],
                Some(state.form_priority.as_str()),
                |v: &str| RemindersMessage::SetPriority(v.to_string()),
            ),
        ].spacing(8).align_y(Center).into()
    );

    items.push(
        row![
            text("Disabled").size(13),
            toggler(state.form_disabled)
                .on_toggle(|_| RemindersMessage::ToggleDisabled),
        ].spacing(8).align_y(Center).into()
    );

    items.push(space::vertical(8).into());

    // Action buttons
    items.push(
        row![
            button(text("Save").size(13))
                .on_press(RemindersMessage::SaveReminder)
                .padding([6, 16]),
            button(text("Snooze 15min").size(12))
                .on_press(RemindersMessage::SnoozeReminder(15))
                .style(button::secondary)
                .padding([6, 12]),
            button(text("Snooze 1h").size(12))
                .on_press(RemindersMessage::SnoozeReminder(60))
                .style(button::secondary)
                .padding([6, 12]),
            space::horizontal(Fill),
            button(text("Delete").size(12))
                .on_press(RemindersMessage::DeleteReminder)
                .style(button::danger)
                .padding([6, 12]),
        ].spacing(8).into()
    );

    column(items).spacing(8).into()
}
```

### Step 2: Wire into main.rs

**Add mod:**
```rust
mod reminders_view;
```

**Add state field:**
```rust
reminders_state: reminders_view::RemindersViewState,
```

**Add message variant:**
```rust
RemindersView(reminders_view::RemindersMessage),
```

**Initialize:**
```rust
let mut reminders_state = reminders_view::RemindersViewState::new();
reminders_state.refresh(&db);
```

**Add update handler:**
```rust
Message::RemindersView(msg) => {
    self.reminders_state.update(msg, &self.db);
}
```

**Add content_view match:**
```rust
View::Reminders => {
    reminders_view::reminders_view(&self.reminders_state, &self.theme_engine.active_iced_theme())
        .map(Message::RemindersView)
}
```

**Add navigation refresh:**
```rust
View::Reminders => self.reminders_state.refresh(&self.db),
```

### Step 3: Compile

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo check -p wiredash-app
```

### Step 4: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-app/src/reminders_view.rs crates/wiredash-app/src/main.rs
git commit -s -m "desktop: add Reminders view with list, form, snooze, and recurrence"
```

---

## Task 9: Integration Tests

**Files:**
- Create: `wiredash/crates/wiredash-core/tests/settings_kv_extended_test.rs`
- Run all existing + new tests

### Step 1: Write settings KV extended tests

Create `wiredash/crates/wiredash-core/tests/settings_kv_extended_test.rs`:

```rust
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
```

### Step 2: Run all tests

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo test --workspace
```

Expected: All existing 49+ tests plus ~15 new tests pass.

### Step 3: Commit

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add crates/wiredash-core/tests/settings_kv_extended_test.rs
git commit -s -m "core: add settings KV, reminders update, vault encryption integration tests"
```

---

## Task 10: Finalize Phase 6

### Step 1: Full workspace check

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
cargo check --workspace
cargo test --workspace
cargo clippy --workspace
cargo build -p wiredash-app
```

### Step 2: Fix clippy warnings

Address all new clippy warnings from Phase 6 code.

### Step 3: Commit fixes

```bash
cd /c/Users/dorwi/WebstormProjects/Workstation-/wiredash
git add -A
git commit -s -m "misc: fix Phase 6 clippy warnings and finalization"
```

---

## Verification

After all tasks:
1. `cargo test --workspace` — all tests pass (65+ expected)
2. `cargo build -p wiredash-app` — binary builds
3. Run the app and verify:
   - **Settings:** Navigate to Settings → sidebar shows 22 panels across 5 groups → Appearance panel: toggle Light/Dark/Auto → theme changes immediately → Editor panel: change font size → value persists across restarts
   - **Stubbed panels:** Click Profile/Subscription/etc → shows "Requires account" message
   - **App Lock:** Settings → App Lock → Enable → password dialog → set password → close app → reopen → gate screen appears → enter password → unlocks
   - **Vault:** Settings → Vault → Create Vault → password dialog → vault created → lock a note → content encrypted in DB → unlock with password → content visible
   - **Reminders:** Navigate to Reminders → New → fill form → Save → appears in list grouped by Overdue/Today/Upcoming → Snooze → date updates → Delete → removed
   - **Keyboard shortcuts:** All existing shortcuts still work (Cmd+S, Cmd+B, Cmd+F)
