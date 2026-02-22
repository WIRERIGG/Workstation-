# WIREDASH Phase 6 — Daily-Use App Completion (Settings, Vault, App Lock, Reminders)

> **Goal:** Transform WIREDASH from a functional note editor into a complete daily-use note-taking application by adding Settings (22 panels mirroring Workstation), Vault encryption, App Lock, and Reminders.

## Scope

Phase 6 delivers four features that complete the core user experience:

1. **Settings View** — 22 sections across 5 groups, matching the Workstation web app 1:1
2. **Vault + App Lock** — Note encryption via XChaCha20-Poly1305, app-level password gate
3. **Offline Auth** — Local Argon2id password hash for app lock (no server connectivity)
4. **Reminders View** — Reminder list with create/edit/snooze, date picker, recurrence

## Architecture

All features follow the established ViewState + Message + Update pattern from Phases 3-5. Key additions:

- **Settings persistence** — existing `Settings` KV store collection (key → JSON value)
- **Vault encryption** — existing `wiredash-crypto` crate (XChaCha20-Poly1305 AEAD + Argon2id)
- **Modal dialogs** — iced `Stack` + `opaque` + `mouse_area` composition pattern
- **Toast notifications** — adapted from iced official toast example
- **App lock gate** — full-screen overlay that blocks navigation until password verified

## NOT Doing (Deferred)

- Server connectivity (login/signup/2FA, sync, subscription management)
- WebAuthn / security key credentials (hardware, not applicable to desktop)
- Notification daemon / OS-level reminder alerts (just UI for now)
- Theme marketplace browsing (offline theme toggle only)
- Importer (complex file parsing — stub the section)
- Spell checker languages (desktop-specific, requires system integration)
- Billing history, Circle partners, Inbox API keys

---

## Settings View

### Layout

```
row![ category_sidebar(240px) | vertical_rule | settings_content(Fill) ]
```

Matches Workstation's `apps/web/src/dialogs/settings/index.tsx` split-pane layout. Left sidebar lists all 22 sections grouped under 5 headings. Right panel renders the selected section's controls in a scrollable column.

### 5 Groups → 22 Sections

#### Group 1: ACCOUNT (6 sections — all stubbed)

| Section | Status | Stub Message |
|---------|--------|-------------|
| Profile | Stubbed | "Requires account — coming in a future phase" |
| Subscription | Stubbed | "Requires account — coming in a future phase" |
| Authentication | Stubbed | "Requires account — coming in a future phase" |
| Sync | Stubbed | "Requires account — coming in a future phase" |
| Circle | Stubbed | "Requires account — coming in a future phase" |
| Inbox | Stubbed | "Requires account — coming in a future phase" |

#### Group 2: CUSTOMIZATION (6 sections — all wired)

**Appearance** (mirrors `appearance-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Color Scheme | Dropdown (Light/Dark/Auto) | `theme_scheme` | Auto |
| Zoom Factor | Number Input (0.5-3.0, step 0.1) | `zoom_factor` | 1.0 |

**Behaviour** (mirrors `behaviour-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Date Format | Dropdown (dynamic list with preview) | `date_format` | "DD/MM/YYYY" |
| Time Format | Dropdown (12h/24h) | `time_format` | "12h" |
| Day Format | Dropdown (Short/Long) | `day_format` | "Short" |
| Week Start | Dropdown (Sunday/Monday) | `week_start` | "Sunday" |
| Clear Trash Interval | Dropdown (Daily/7d/30d/365d/Never) | `trash_cleanup_days` | 7 |

**Editor** (mirrors `editor-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Title Format | Text Input | `editor_title_format` | "" |
| Default Font Family | Dropdown (font list) | `editor_font_family` | "System" |
| Default Font Size | Number Input (8-120) | `editor_font_size` | 16 |
| Line Height | Number Input | `editor_line_height` | 1.5 |
| Double Spaced Lines | Toggle | `editor_double_spaced` | false |
| Markdown Shortcuts | Toggle | `editor_markdown_shortcuts` | true |
| Font Ligatures | Toggle | `editor_font_ligatures` | false |

**Desktop Integration** (mirrors `desktop-integration-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Auto Start on System Startup | Toggle | `auto_launch` | false |
| Start Minimized | Toggle (hidden if auto-start off) | `start_minimized` | false |
| Minimize to System Tray | Toggle | `minimize_to_tray` | false |
| Close to System Tray | Toggle | `close_to_tray` | false |

**Notifications** (mirrors `notifications-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Reminder Notifications | Toggle | `notifications_enabled` | true |

**Servers** (mirrors `servers-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| API Server URL | Text Input | `api_server` | "" |
| Sync Server URL | Text Input | `sync_server` | "" |

#### Group 3: IMPORT/EXPORT (2 sections)

**Backup & Export** (mirrors `backup-export-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Backup Now | Dropdown Button (Partial/Full) | — | action |
| Restore Backup | Button | — | action |
| Automatic Backups | Dropdown (Never/Daily/Weekly/Monthly) | `auto_backup` | "Never" |
| Backup Encryption | Toggle | `backup_encryption` | false |
| Export All Notes | Dropdown Button (Text/Markdown/MD+Frontmatter/HTML) | — | action |

**Importer** — Stubbed ("Coming in a future phase")

#### Group 4: SECURITY (3 sections — all wired)

**App Lock** (mirrors `app-lock-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Enable App Lock | Toggle (opens password dialog) | `app_lock_enabled` | false |
| Lock App After | Dropdown (Immediately/1/5/10/15/30/45min/1h/Never) | `app_lock_timeout` | "Immediately" |
| Change Password | Button (opens password dialog) | — | action |

**Vault** (mirrors `vault-settings.tsx`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Create Vault | Button (opens password dialog) | `vault_created` | false |
| Change Vault Password | Button (hidden if no vault) | — | action |
| Clear Vault | Button (hidden if no vault) | — | action |
| Delete Vault | Button (hidden if no vault) | — | action |

**Privacy** (mirrors `privacy-settings.ts`)
| Control | Type | Settings Key | Default |
|---------|------|-------------|---------|
| Hide Note Title | Toggle | `hide_note_title` | false |
| Privacy Mode | Toggle | `privacy_mode` | false |

#### Group 5: OTHER (3 sections — all wired)

**Legal** (mirrors `other-settings.ts`)
| Control | Type | Action |
|---------|------|--------|
| Privacy Policy | Button | Opens external URL |
| Terms of Service | Button | Opens external URL |
| License | Button | Opens external URL |

**Support** (mirrors `other-settings.ts`)
| Control | Type | Action |
|---------|------|--------|
| Report an Issue | Button | Opens external URL |
| Email Support | Button | Copy email / open mailto |
| Documentation | Button | Opens external URL |
| Debug Logs | 2 Buttons | Download / Clear |

**About** (mirrors `other-settings.ts`)
| Control | Type | Action |
|---------|------|--------|
| Version | Display + Copy Button | Shows current version |
| View Source Code | Button | Opens external URL |
| Check Roadmap | Button | Opens external URL |

### Settings State

```rust
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

pub enum SettingsGroup {
    Account, Customization, ImportExport, Security, Other,
}

pub struct SettingsViewState {
    pub active_panel: SettingsPanel,
    pub cache: HashMap<String, serde_json::Value>,
    // Transient input state
    pub vault_password: String,
    pub vault_confirm: String,
    pub app_lock_password: String,
    pub app_lock_confirm: String,
    pub show_password_dialog: Option<PasswordDialogPurpose>,
}

pub enum PasswordDialogPurpose {
    CreateVault,
    ChangeVaultPassword,
    ClearVault,
    DeleteVault,
    EnableAppLock,
    ChangeAppLockPassword,
}
```

### Settings Message

```rust
pub enum SettingsMessage {
    SelectPanel(SettingsPanel),
    SetValue(String, serde_json::Value),  // key, value → writes to KV immediately
    // Password dialog
    ShowPasswordDialog(PasswordDialogPurpose),
    PasswordInput(String),
    PasswordConfirmInput(String),
    SubmitPassword,
    CancelPassword,
    // Actions
    BackupNow(BackupMode),
    RestoreBackup,
    ExportAll(ExportFormat),
    OpenExternal(String),     // URL
    CopyToClipboard(String),  // text
    ClearDebugLogs,
    DownloadDebugLogs,
}
```

---

## Vault + App Lock

### Vault Implementation

**Create Vault flow:**
1. User clicks "Create Vault" → password dialog opens
2. User enters password + confirmation
3. Derive encryption key: `Argon2id(password, random_salt) → 256-bit key`
4. Create `SerializedKey { password: None, key: Some(derived), salt: Some(salt) }`
5. Store encrypted key material in `Vaults` collection via `Vault::new("Default")`
6. Set `Settings["vault_created"] = true`

**Lock a note:**
1. User action on a note → "Lock in Vault" → prompt for vault password
2. Verify password against stored vault key (decrypt test)
3. Encrypt `ContentItem.data` using `Encryption::encrypt(key, plaintext)`
4. Set `ContentItem.locked = true`
5. Store encrypted cipher JSON in `ContentItem.data`

**Unlock a note:**
1. User opens a locked note → prompt for vault password
2. Verify password, derive key
3. `Decryption::decrypt(cipher, key)` → plaintext
4. Display in editor (content remains encrypted in DB)

**Change Vault Password:**
1. Prompt for old password → verify
2. Prompt for new password + confirmation
3. Re-derive key with new password
4. Re-encrypt all locked ContentItems with new key
5. Update Vault entry

### App Lock Implementation

**Enable App Lock:**
1. User toggles "Enable App Lock" → password dialog
2. Hash password: `Argon2id(password, random_salt) → hash`
3. Store: `Settings["app_lock_hash"] = base64(hash)`, `Settings["app_lock_salt"] = base64(salt)`
4. Store: `Settings["app_lock_enabled"] = true`

**Lock Gate Screen:**
- `AppLockView` — full-screen overlay with password input
- Shown on app launch when `app_lock_enabled = true`
- Shown after inactivity timeout (based on `app_lock_timeout` setting)
- Blocks all navigation and keyboard shortcuts until password verified
- Verification: `Argon2id(input, stored_salt) == stored_hash`

**Inactivity Timer:**
- Track last user interaction timestamp
- Subscription: check every 10 seconds if timeout exceeded
- On timeout: set `locked = true` in app state → show gate screen

---

## Reminders View

### Layout

```
row![ reminder_list(320px) | vertical_rule | reminder_detail(Fill) ]
```

Mirrors Workstation's reminder system (`apps/web/src/components/reminder/`, `dialogs/add-reminder-dialog.tsx`).

### Reminder List (Left Panel)

Three sections, separated by headers:
1. **Overdue** — date < now, not disabled, not snoozed past now. Red accent.
2. **Today** — date is today. Normal accent.
3. **Upcoming** — date > today. Muted.

Each item shows: title, date/time, mode icon (once/repeat), priority badge.

### Reminder Detail (Right Panel)

When a reminder is selected or "New Reminder" is clicked:

| Control | Type | Field |
|---------|------|-------|
| Title | Text Input | `title` |
| Description | Text Input (multiline) | `description` |
| Date | Date Picker (day + time) | `date` |
| Mode | Dropdown (Once / Repeat) | `mode` |
| Recurring Mode | Dropdown (Daily/Weekly/Monthly) — shown if Repeat | `recurring_mode` |
| Selected Days | Checkbox group (Mon-Sun) — shown if Weekly | `selected_days` |
| Priority | Dropdown (Silent/Vibrate/Urgent) | `priority` |
| Snooze | Dropdown Button (5min/15min/30min/1h) | `snooze_until` |
| Disable | Toggle | `disabled` |
| Delete | Button (error) | action |

### Reminders State

```rust
pub struct RemindersViewState {
    pub reminder_list: Vec<Reminder>,
    pub selected_index: Option<usize>,
    pub editing: bool,
    // Edit form fields
    pub form_title: String,
    pub form_description: String,
    pub form_date: String,      // ISO date string for input
    pub form_time: String,      // HH:MM for input
    pub form_mode: String,      // "once" or "repeat"
    pub form_recurring_mode: Option<String>,
    pub form_selected_days: Vec<i32>,
    pub form_priority: String,
}

pub enum RemindersMessage {
    SelectReminder(usize),
    NewReminder,
    // Form inputs
    SetTitle(String),
    SetDescription(String),
    SetDate(String),
    SetTime(String),
    SetMode(String),
    SetRecurringMode(String),
    ToggleDay(i32),
    SetPriority(String),
    // Actions
    SaveReminder,
    DeleteReminder,
    SnoozeReminder(i64),    // duration in minutes
    ToggleDisabled,
}
```

### Backend Addition

Add `Reminders::update()` method (currently only has add/get/list/remove):

```rust
pub fn update(&self, reminder: &Reminder) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_millis();
    self.db.execute(
        "UPDATE reminders SET title=?1, description=?2, priority=?3, date=?4, mode=?5,
         recurringMode=?6, selectedDays=?7, localOnly=?8, disabled=?9, snoozeUntil=?10,
         dateModified=?11, synced=0
         WHERE id=?12",
        params![...],
    )?;
    Ok(())
}
```

---

## Shared Infrastructure

### Modal Dialog Helper

Reusable `modal()` function following iced's official pattern:

```rust
pub fn modal<'a, Message: Clone + 'a>(
    base: impl Into<Element<'a, Message>>,
    content: impl Into<Element<'a, Message>>,
    on_blur: Message,
) -> Element<'a, Message> {
    stack![
        base.into(),
        opaque(
            mouse_area(center(opaque(content)).style(|_| container::Style {
                background: Some(Color { a: 0.8, ..Color::BLACK }.into()),
                ..Default::default()
            }))
            .on_press(on_blur)
        )
    ].into()
}
```

Used for: password prompts, confirmation dialogs, vault unlock, backup progress.

### Toast Notifications

Adapted from iced official `toast` example (~200 lines):

```rust
pub enum ToastStatus { Success, Warning, Error, Info }

pub struct Toast {
    pub title: String,
    pub body: String,
    pub status: ToastStatus,
}

pub struct ToastManager { toasts: Vec<(Toast, Instant)> }
```

Used for: "Settings saved", "Vault created", "Backup complete", "Reminder saved".

### Password Dialog Widget

Reusable password input dialog with:
- Title text
- Password input (secure)
- Confirm password input (secure, optional)
- Submit + Cancel buttons
- Validation (passwords match, minimum length)

```rust
pub struct PasswordDialog {
    pub title: String,
    pub require_confirm: bool,
    pub password: String,
    pub confirm: String,
    pub error: Option<String>,
}
```

---

## Navigation Changes

Add to `View` enum:
```rust
pub enum View {
    // Workspace (existing + new)
    Dashboard, Control, Notes, Notebooks, Tags, Search,
    Reminders,  // NEW
    Tasks, Calendar, AgentChat, Terminal, Files,
    Settings,   // NEW — goes in a new "Settings" section or bottom of sidebar
    // ... rest unchanged
}
```

Settings could be a gear icon at the bottom of the sidebar (outside sections), matching Workstation's pattern.

---

## Summary

| Feature | New Files | Modified Files | New Tests |
|---------|-----------|---------------|-----------|
| Settings View | `settings_view.rs`, `settings_panels.rs` | `main.rs`, `navigation.rs` | 5-8 (KV read/write, panel rendering) |
| Vault | `vault.rs` (in settings) | `main.rs` | 4-6 (encrypt/decrypt/lock/unlock) |
| App Lock | `app_lock.rs` | `main.rs` | 3-4 (hash/verify/timeout) |
| Reminders | `reminders_view.rs` | `main.rs`, `navigation.rs`, `reminders.rs` (collection) | 4-6 (CRUD, snooze, recurring) |
| Shared | `modal.rs`, `toast.rs`, `password_dialog.rs` | `main.rs` | 2-3 (modal show/hide, toast lifecycle) |
| **Total** | **~8 new files** | **~5 modified** | **~20-25 new tests** |
