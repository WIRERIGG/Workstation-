//! Settings view — 20 panels across 5 groups, mirroring Workstation.

use iced::widget::{
    button, column, container, pick_list, row, rule, scrollable, text, text_input, toggler,
};
use iced::{Center, Element, Fill, Theme};
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
        Self::Account,
        Self::Customization,
        Self::ImportExport,
        Self::Security,
        Self::Other,
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
    Profile,
    Subscription,
    Authentication,
    Sync,
    Circle,
    Inbox,
    Appearance,
    Behaviour,
    Editor,
    DesktopIntegration,
    Notifications,
    Servers,
    BackupExport,
    Importer,
    AppLock,
    Vault,
    Privacy,
    Legal,
    Support,
    About,
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
            Self::Profile
            | Self::Subscription
            | Self::Authentication
            | Self::Sync
            | Self::Circle
            | Self::Inbox => SettingsGroup::Account,

            Self::Appearance
            | Self::Behaviour
            | Self::Editor
            | Self::DesktopIntegration
            | Self::Notifications
            | Self::Servers => SettingsGroup::Customization,

            Self::BackupExport | Self::Importer => SettingsGroup::ImportExport,

            Self::AppLock | Self::Vault | Self::Privacy => SettingsGroup::Security,

            Self::Legal | Self::Support | Self::About => SettingsGroup::Other,
        }
    }

    pub fn for_group(group: SettingsGroup) -> Vec<SettingsPanel> {
        Self::ALL
            .iter()
            .filter(|p| p.group() == group)
            .copied()
            .collect()
    }

    pub fn is_stubbed(&self) -> bool {
        matches!(
            self,
            Self::Profile
                | Self::Subscription
                | Self::Authentication
                | Self::Sync
                | Self::Circle
                | Self::Inbox
                | Self::Importer
        )
    }

    pub const ALL: &'static [SettingsPanel] = &[
        Self::Profile,
        Self::Subscription,
        Self::Authentication,
        Self::Sync,
        Self::Circle,
        Self::Inbox,
        Self::Appearance,
        Self::Behaviour,
        Self::Editor,
        Self::DesktopIntegration,
        Self::Notifications,
        Self::Servers,
        Self::BackupExport,
        Self::Importer,
        Self::AppLock,
        Self::Vault,
        Self::Privacy,
        Self::Legal,
        Self::Support,
        Self::About,
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

    pub fn load_all(&mut self, db: &Database) {
        let settings = Settings::new(db);
        let keys = [
            "theme_scheme",
            "zoom_factor",
            "date_format",
            "time_format",
            "day_format",
            "week_start",
            "trash_cleanup_days",
            "editor_title_format",
            "editor_font_family",
            "editor_font_size",
            "editor_line_height",
            "editor_double_spaced",
            "editor_markdown_shortcuts",
            "editor_font_ligatures",
            "auto_launch",
            "start_minimized",
            "minimize_to_tray",
            "close_to_tray",
            "notifications_enabled",
            "api_server",
            "sync_server",
            "auto_backup",
            "backup_encryption",
            "app_lock_enabled",
            "app_lock_timeout",
            "vault_created",
            "hide_note_title",
            "privacy_mode",
        ];
        for key in keys {
            if let Ok(Some(val)) = settings.get_setting(key) {
                self.cache.insert(key.to_string(), val);
            }
        }
    }

    pub fn get_string(&self, key: &str, default: &str) -> String {
        self.cache
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or(default)
            .to_string()
    }

    pub fn get_bool(&self, key: &str, default: bool) -> bool {
        self.cache
            .get(key)
            .and_then(|v| v.as_bool())
            .unwrap_or(default)
    }

    #[allow(dead_code)]
    pub fn get_f64(&self, key: &str, default: f64) -> f64 {
        self.cache
            .get(key)
            .and_then(|v| v.as_f64())
            .unwrap_or(default)
    }

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

// ── View ─────────────────────────────────────────────────────────────

pub fn settings_view<'a>(
    state: &'a SettingsViewState,
    _theme: &Theme,
) -> Element<'a, SettingsMessage> {
    let sidebar = settings_sidebar(state);
    let panel = settings_panel(state);
    row![
        container(scrollable(sidebar)).width(240).height(Fill),
        rule::vertical(1),
        container(scrollable(panel))
            .width(Fill)
            .height(Fill)
            .padding(24),
    ]
    .into()
}

fn settings_sidebar<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let mut items: Vec<Element<'a, SettingsMessage>> = Vec::new();
    items.push(
        container(text("Settings").size(18))
            .padding(iced::Padding::ZERO.top(16).right(16).bottom(8).left(16))
            .into(),
    );

    for group in SettingsGroup::ALL {
        items.push(
            container(
                text(group.label())
                    .size(10)
                    .color(iced::Color::from_rgb8(0x99, 0x99, 0x99)),
            )
            .padding(iced::Padding::ZERO.top(12).right(16).bottom(4).left(16))
            .into(),
        );
        for panel in SettingsPanel::for_group(*group) {
            let is_selected = panel == state.active_panel;
            let label = if panel.is_stubbed() {
                text(format!("  {}  (soon)", panel.label()))
                    .size(13)
                    .color(iced::Color::from_rgb8(0xAA, 0xAA, 0xAA))
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
                iced::widget::Space::new().height(16),
                text("Requires account \u{2014} coming in a future phase.").size(14),
            ]
            .spacing(8),
        )
        .into();
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

// ── Helpers ──────────────────────────────────────────────────────────

fn setting_row<'a>(
    label_text: &str,
    description: &str,
    control: Element<'a, SettingsMessage>,
) -> Element<'a, SettingsMessage> {
    row![
        column![
            text(label_text.to_string()).size(14),
            text(description.to_string())
                .size(11)
                .color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
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
        iced::widget::Space::new().height(8),
        text(title.to_string())
            .size(11)
            .color(iced::Color::from_rgb8(0x99, 0x99, 0x99)),
        rule::horizontal(1),
    ]
    .spacing(4)
    .into()
}

// ── Panel: Appearance ────────────────────────────────────────────────

fn panel_appearance<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let scheme = state.get_string("theme_scheme", "Auto");
    let scheme_options: Vec<String> = vec!["Light".into(), "Dark".into(), "Auto".into()];
    let selected_scheme: Option<String> = Some(scheme);

    let scheme_picker: Element<'a, SettingsMessage> = pick_list(
        scheme_options,
        selected_scheme,
        |val: String| SettingsMessage::SetValue("theme_scheme".into(), serde_json::json!(val)),
    )
    .width(140)
    .into();

    let zoom = state.get_string("zoom_factor", "100");
    let zoom_input: Element<'a, SettingsMessage> = text_input("100", &zoom)
        .on_input(|val| {
            SettingsMessage::SetValue("zoom_factor".into(), serde_json::json!(val))
        })
        .width(100)
        .into();

    column![
        text("Appearance").size(22),
        rule::horizontal(1),
        section_header("THEME"),
        setting_row(
            "Color Scheme",
            "Choose between light, dark, or system-following theme.",
            scheme_picker,
        ),
        setting_row(
            "Zoom Factor (%)",
            "Adjust the overall zoom level of the application.",
            zoom_input,
        ),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Behaviour ─────────────────────────────────────────────────

fn panel_behaviour<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let date_fmt = state.get_string("date_format", "DD/MM/YYYY");
    let date_options: Vec<String> = vec![
        "DD/MM/YYYY".into(),
        "MM/DD/YYYY".into(),
        "YYYY-MM-DD".into(),
    ];
    let date_picker: Element<'a, SettingsMessage> = pick_list(
        date_options,
        Some(date_fmt),
        |val: String| SettingsMessage::SetValue("date_format".into(), serde_json::json!(val)),
    )
    .width(160)
    .into();

    let time_fmt = state.get_string("time_format", "12-hour");
    let time_options: Vec<String> = vec!["12-hour".into(), "24-hour".into()];
    let time_picker: Element<'a, SettingsMessage> = pick_list(
        time_options,
        Some(time_fmt),
        |val: String| SettingsMessage::SetValue("time_format".into(), serde_json::json!(val)),
    )
    .width(160)
    .into();

    let day_fmt = state.get_string("day_format", "Full");
    let day_options: Vec<String> = vec!["Full".into(), "Short".into()];
    let day_picker: Element<'a, SettingsMessage> = pick_list(
        day_options,
        Some(day_fmt),
        |val: String| SettingsMessage::SetValue("day_format".into(), serde_json::json!(val)),
    )
    .width(160)
    .into();

    let week_start = state.get_string("week_start", "Monday");
    let week_options: Vec<String> = vec!["Monday".into(), "Sunday".into(), "Saturday".into()];
    let week_picker: Element<'a, SettingsMessage> = pick_list(
        week_options,
        Some(week_start),
        |val: String| SettingsMessage::SetValue("week_start".into(), serde_json::json!(val)),
    )
    .width(160)
    .into();

    let trash_days = state.get_string("trash_cleanup_days", "7 days");
    let trash_options: Vec<String> = vec![
        "Never".into(),
        "1 day".into(),
        "7 days".into(),
        "30 days".into(),
        "365 days".into(),
    ];
    let trash_picker: Element<'a, SettingsMessage> = pick_list(
        trash_options,
        Some(trash_days),
        |val: String| {
            SettingsMessage::SetValue("trash_cleanup_days".into(), serde_json::json!(val))
        },
    )
    .width(160)
    .into();

    column![
        text("Behaviour").size(22),
        rule::horizontal(1),
        section_header("DATE & TIME"),
        setting_row(
            "Date Format",
            "How dates are displayed throughout the app.",
            date_picker,
        ),
        setting_row(
            "Time Format",
            "Choose 12-hour or 24-hour time display.",
            time_picker,
        ),
        setting_row(
            "Day Format",
            "Show full or abbreviated day names.",
            day_picker,
        ),
        setting_row(
            "Week Starts On",
            "First day of the week in calendars.",
            week_picker,
        ),
        section_header("TRASH"),
        setting_row(
            "Auto-cleanup Trash",
            "Permanently delete trashed items after this period.",
            trash_picker,
        ),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Editor ────────────────────────────────────────────────────

fn panel_editor<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let title_fmt = state.get_string("editor_title_format", "Note $date$ $time$");
    let title_input: Element<'a, SettingsMessage> =
        text_input("Note $date$ $time$", &title_fmt)
            .on_input(|val| {
                SettingsMessage::SetValue("editor_title_format".into(), serde_json::json!(val))
            })
            .width(220)
            .into();

    let font_family = state.get_string("editor_font_family", "Default");
    let font_options: Vec<String> = vec![
        "Default".into(),
        "Serif".into(),
        "Monospace".into(),
        "Open Sans".into(),
    ];
    let font_picker: Element<'a, SettingsMessage> = pick_list(
        font_options,
        Some(font_family),
        |val: String| {
            SettingsMessage::SetValue("editor_font_family".into(), serde_json::json!(val))
        },
    )
    .width(160)
    .into();

    let font_size = state.get_string("editor_font_size", "16");
    let size_input: Element<'a, SettingsMessage> = text_input("16", &font_size)
        .on_input(|val| {
            SettingsMessage::SetValue("editor_font_size".into(), serde_json::json!(val))
        })
        .width(80)
        .into();

    let line_height = state.get_string("editor_line_height", "1.5");
    let lh_input: Element<'a, SettingsMessage> = text_input("1.5", &line_height)
        .on_input(|val| {
            SettingsMessage::SetValue("editor_line_height".into(), serde_json::json!(val))
        })
        .width(80)
        .into();

    let double_spaced = state.get_bool("editor_double_spaced", false);
    let dbl_toggle: Element<'a, SettingsMessage> = toggler(double_spaced)
        .on_toggle(|val| {
            SettingsMessage::SetValue("editor_double_spaced".into(), serde_json::json!(val))
        })
        .into();

    let md_shortcuts = state.get_bool("editor_markdown_shortcuts", true);
    let md_toggle: Element<'a, SettingsMessage> = toggler(md_shortcuts)
        .on_toggle(|val| {
            SettingsMessage::SetValue(
                "editor_markdown_shortcuts".into(),
                serde_json::json!(val),
            )
        })
        .into();

    let ligatures = state.get_bool("editor_font_ligatures", true);
    let lig_toggle: Element<'a, SettingsMessage> = toggler(ligatures)
        .on_toggle(|val| {
            SettingsMessage::SetValue("editor_font_ligatures".into(), serde_json::json!(val))
        })
        .into();

    column![
        text("Editor").size(22),
        rule::horizontal(1),
        section_header("TITLE"),
        setting_row(
            "Default Title Format",
            "Template for new note titles. Use $date$ and $time$ as placeholders.",
            title_input,
        ),
        section_header("FONT"),
        setting_row("Font Family", "Typeface used in the editor.", font_picker),
        setting_row(
            "Font Size (px)",
            "Base font size for editor content.",
            size_input,
        ),
        setting_row(
            "Line Height",
            "Spacing between lines of text.",
            lh_input,
        ),
        setting_row(
            "Double Spacing",
            "Add extra vertical space after paragraphs.",
            dbl_toggle,
        ),
        section_header("FEATURES"),
        setting_row(
            "Markdown Shortcuts",
            "Type markdown syntax and have it converted automatically.",
            md_toggle,
        ),
        setting_row(
            "Font Ligatures",
            "Enable programming ligatures (e.g., => becomes a single glyph).",
            lig_toggle,
        ),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Desktop Integration ───────────────────────────────────────

fn panel_desktop<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let auto_launch = state.get_bool("auto_launch", false);
    let auto_toggle: Element<'a, SettingsMessage> = toggler(auto_launch)
        .on_toggle(|val| {
            SettingsMessage::SetValue("auto_launch".into(), serde_json::json!(val))
        })
        .into();

    let minimize_tray = state.get_bool("minimize_to_tray", false);
    let min_tray_toggle: Element<'a, SettingsMessage> = toggler(minimize_tray)
        .on_toggle(|val| {
            SettingsMessage::SetValue("minimize_to_tray".into(), serde_json::json!(val))
        })
        .into();

    let close_tray = state.get_bool("close_to_tray", false);
    let close_tray_toggle: Element<'a, SettingsMessage> = toggler(close_tray)
        .on_toggle(|val| {
            SettingsMessage::SetValue("close_to_tray".into(), serde_json::json!(val))
        })
        .into();

    let mut items: Vec<Element<'a, SettingsMessage>> = vec![
        text("Desktop Integration").size(22).into(),
        rule::horizontal(1).into(),
        section_header("STARTUP"),
        setting_row(
            "Launch on System Start",
            "Automatically start Wiredash when you log in.",
            auto_toggle,
        ),
    ];

    // Show "Start Minimized" only if auto-launch is enabled
    if auto_launch {
        let start_min = state.get_bool("start_minimized", false);
        let start_min_toggle: Element<'a, SettingsMessage> = toggler(start_min)
            .on_toggle(|val| {
                SettingsMessage::SetValue("start_minimized".into(), serde_json::json!(val))
            })
            .into();
        items.push(setting_row(
            "Start Minimized",
            "Open in the background without showing the window.",
            start_min_toggle,
        ));
    }

    items.push(section_header("SYSTEM TRAY"));
    items.push(setting_row(
        "Minimize to Tray",
        "Move to system tray instead of minimizing to taskbar.",
        min_tray_toggle,
    ));
    items.push(setting_row(
        "Close to Tray",
        "Keep running in the system tray when the window is closed.",
        close_tray_toggle,
    ));

    column(items).spacing(4).width(Fill).into()
}

// ── Panel: Notifications ─────────────────────────────────────────────

fn panel_notifications<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let notifs = state.get_bool("notifications_enabled", true);
    let notif_toggle: Element<'a, SettingsMessage> = toggler(notifs)
        .on_toggle(|val| {
            SettingsMessage::SetValue("notifications_enabled".into(), serde_json::json!(val))
        })
        .into();

    column![
        text("Notifications").size(22),
        rule::horizontal(1),
        section_header("REMINDERS"),
        setting_row(
            "Reminder Notifications",
            "Show desktop notifications when reminders are due.",
            notif_toggle,
        ),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Servers ───────────────────────────────────────────────────

fn panel_servers<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let api_url = state.get_string("api_server", "https://api.notesnook.com");
    let api_input: Element<'a, SettingsMessage> =
        text_input("https://api.notesnook.com", &api_url)
            .on_input(|val| {
                SettingsMessage::SetValue("api_server".into(), serde_json::json!(val))
            })
            .width(300)
            .into();

    let sync_url = state.get_string("sync_server", "https://sync.notesnook.com");
    let sync_input: Element<'a, SettingsMessage> =
        text_input("https://sync.notesnook.com", &sync_url)
            .on_input(|val| {
                SettingsMessage::SetValue("sync_server".into(), serde_json::json!(val))
            })
            .width(300)
            .into();

    column![
        text("Servers").size(22),
        rule::horizontal(1),
        section_header("ENDPOINTS"),
        setting_row(
            "API Server URL",
            "Base URL for the API server. Change only for self-hosted instances.",
            api_input,
        ),
        setting_row(
            "Sync Server URL",
            "WebSocket URL for real-time sync. Change only for self-hosted instances.",
            sync_input,
        ),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Backup & Export ───────────────────────────────────────────

fn panel_backup_export<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let auto_backup = state.get_string("auto_backup", "Off");
    let backup_options: Vec<String> = vec![
        "Off".into(),
        "Daily".into(),
        "Weekly".into(),
        "Monthly".into(),
    ];
    let backup_picker: Element<'a, SettingsMessage> = pick_list(
        backup_options,
        Some(auto_backup),
        |val: String| SettingsMessage::SetValue("auto_backup".into(), serde_json::json!(val)),
    )
    .width(160)
    .into();

    let backup_enc = state.get_bool("backup_encryption", false);
    let enc_toggle: Element<'a, SettingsMessage> = toggler(backup_enc)
        .on_toggle(|val| {
            SettingsMessage::SetValue("backup_encryption".into(), serde_json::json!(val))
        })
        .into();

    column![
        text("Backup & Export").size(22),
        rule::horizontal(1),
        section_header("AUTOMATIC BACKUPS"),
        setting_row(
            "Backup Frequency",
            "Automatically create backups at the chosen interval.",
            backup_picker,
        ),
        setting_row(
            "Encrypt Backups",
            "Protect backup files with your account password.",
            enc_toggle,
        ),
        section_header("EXPORT"),
        text("Export notes as HTML, Markdown, or plain text. Full export is available from the Notes view context menu.")
            .size(12)
            .color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: App Lock ──────────────────────────────────────────────────

fn panel_app_lock<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let lock_enabled = state.get_bool("app_lock_enabled", false);
    let lock_toggle: Element<'a, SettingsMessage> = toggler(lock_enabled)
        .on_toggle(|val| {
            SettingsMessage::SetValue("app_lock_enabled".into(), serde_json::json!(val))
        })
        .into();

    let timeout = state.get_string("app_lock_timeout", "Immediately");
    let timeout_options: Vec<String> = vec![
        "Immediately".into(),
        "1 minute".into(),
        "5 minutes".into(),
        "15 minutes".into(),
        "1 hour".into(),
    ];
    let timeout_picker: Element<'a, SettingsMessage> = pick_list(
        timeout_options,
        Some(timeout),
        |val: String| {
            SettingsMessage::SetValue("app_lock_timeout".into(), serde_json::json!(val))
        },
    )
    .width(160)
    .into();

    column![
        text("App Lock").size(22),
        rule::horizontal(1),
        section_header("LOCK SETTINGS"),
        setting_row(
            "Enable App Lock",
            "Require a password to open the application.",
            lock_toggle,
        ),
        setting_row(
            "Lock After",
            "How long to wait before locking after losing focus.",
            timeout_picker,
        ),
        iced::widget::Space::new().height(8),
        text("Full app lock with password dialog will be available in Task 6.")
            .size(12)
            .color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Vault ─────────────────────────────────────────────────────

fn panel_vault<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let vault_created = state.get_bool("vault_created", false);

    let status_text = if vault_created {
        "Vault is active. Locked notes are encrypted with your vault password."
    } else {
        "No vault has been created yet. Create a vault to encrypt individual notes with a separate password."
    };

    column![
        text("Vault").size(22),
        rule::horizontal(1),
        section_header("STATUS"),
        text(status_text).size(14),
        iced::widget::Space::new().height(8),
        text("Full vault management (create, change password, clear) will be available in Task 7.")
            .size(12)
            .color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Privacy ───────────────────────────────────────────────────

fn panel_privacy<'a>(state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let hide_title = state.get_bool("hide_note_title", false);
    let hide_toggle: Element<'a, SettingsMessage> = toggler(hide_title)
        .on_toggle(|val| {
            SettingsMessage::SetValue("hide_note_title".into(), serde_json::json!(val))
        })
        .into();

    let privacy_mode = state.get_bool("privacy_mode", false);
    let privacy_toggle: Element<'a, SettingsMessage> = toggler(privacy_mode)
        .on_toggle(|val| {
            SettingsMessage::SetValue("privacy_mode".into(), serde_json::json!(val))
        })
        .into();

    column![
        text("Privacy").size(22),
        rule::horizontal(1),
        section_header("DISPLAY"),
        setting_row(
            "Hide Note Title in List",
            "Show only the first line of content instead of the title.",
            hide_toggle,
        ),
        setting_row(
            "Privacy Mode",
            "Blur note content until hovered. Useful in public spaces.",
            privacy_toggle,
        ),
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Legal ─────────────────────────────────────────────────────

fn panel_legal<'a>(_state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let tos_btn: Element<'a, SettingsMessage> = button(text("Terms of Service").size(13))
        .on_press(SettingsMessage::OpenExternal(
            "https://notesnook.com/terms".into(),
        ))
        .style(button::text)
        .into();

    let privacy_btn: Element<'a, SettingsMessage> = button(text("Privacy Policy").size(13))
        .on_press(SettingsMessage::OpenExternal(
            "https://notesnook.com/privacy".into(),
        ))
        .style(button::text)
        .into();

    let license_btn: Element<'a, SettingsMessage> =
        button(text("Open Source Licenses").size(13))
            .on_press(SettingsMessage::OpenExternal(
                "https://github.com/streetwriters/notesnook/blob/master/LICENSE".into(),
            ))
            .style(button::text)
            .into();

    column![
        text("Legal").size(22),
        rule::horizontal(1),
        iced::widget::Space::new().height(8),
        tos_btn,
        privacy_btn,
        license_btn,
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: Support ───────────────────────────────────────────────────

fn panel_support<'a>(_state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let docs_btn: Element<'a, SettingsMessage> = button(text("Documentation").size(13))
        .on_press(SettingsMessage::OpenExternal(
            "https://docs.notesnook.com".into(),
        ))
        .style(button::text)
        .into();

    let issue_btn: Element<'a, SettingsMessage> =
        button(text("Report an Issue on GitHub").size(13))
            .on_press(SettingsMessage::OpenExternal(
                "https://github.com/streetwriters/notesnook/issues".into(),
            ))
            .style(button::text)
            .into();

    column![
        text("Support").size(22),
        rule::horizontal(1),
        iced::widget::Space::new().height(8),
        docs_btn,
        issue_btn,
    ]
    .spacing(4)
    .width(Fill)
    .into()
}

// ── Panel: About ─────────────────────────────────────────────────────

fn panel_about<'a>(_state: &'a SettingsViewState) -> Element<'a, SettingsMessage> {
    let gh_btn: Element<'a, SettingsMessage> = button(text("GitHub Repository").size(13))
        .on_press(SettingsMessage::OpenExternal(
            "https://github.com/streetwriters/notesnook".into(),
        ))
        .style(button::text)
        .into();

    let website_btn: Element<'a, SettingsMessage> = button(text("Website").size(13))
        .on_press(SettingsMessage::OpenExternal(
            "https://notesnook.com".into(),
        ))
        .style(button::text)
        .into();

    column![
        text("About").size(22),
        rule::horizontal(1),
        iced::widget::Space::new().height(8),
        text("Wiredash").size(18),
        text("Version 0.1.0 (Phase 6)").size(13).color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
        text("A personal encrypted workstation built on Notesnook core.").size(13),
        iced::widget::Space::new().height(8),
        gh_btn,
        website_btn,
    ]
    .spacing(4)
    .width(Fill)
    .into()
}
