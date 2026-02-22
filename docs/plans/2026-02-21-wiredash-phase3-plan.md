# WIREDASH Phase 3 — Shell + Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a running iced 0.14 desktop app with sidebar navigation (4 sections, 21 routes), theme engine (Workstation JSON themes → iced styling), config persistence, and placeholder views — delivering a launchable binary with full shell chrome but no content views yet.

**Architecture:** Two new crates: `wiredash-theme` (theme data model + iced color conversion) and `wiredash-app` (binary, iced Application). The app follows iced's Elm architecture: `Wiredash` struct holds all state, `Message` enum routes all events, `view()` renders sidebar + content. Sidebar is a fixed-width `container` inside a `row` layout. Theme loaded from embedded JSON, converted to `iced::Theme::custom()`. Config persisted to `~/.wiredash/config.json` via `directories` crate.

**Tech Stack:** Rust, iced 0.14 (svg, tokio features), directories, serde, dark-light, open

**Deliverable:** `cargo run -p wiredash-app` opens a themed window with collapsible sidebar, 21 clickable routes, placeholder content area, and persisted settings.

---

## Context for All Tasks

### Existing Crates (Phase 1+2 — complete, 96 tests)

- **`wiredash-crypto`** — XChaCha20-Poly1305, Argon2i/id, password hashing
- **`wiredash-db`** — SQLite+sqlcipher, 16 tables, KV store, FTS5
- **`wiredash-core`** — 14 entity types, 16 collection modules
- **`wiredash-sync`** — Auth, token management, SignalR codec, collector, merger, sync engine

### Workstation Sidebar Structure

4 sections, 21 routes:

| Section | Routes |
|---------|--------|
| **Workspace** (8) | Dashboard, Control, Notes, Tasks, Calendar, Agent Chat, Terminal, Files |
| **Tools** (5) | Agents, Spreadsheets, Communications, Newsletters, Call Queue |
| **Developer** (5) | Git, Conversations, Workspaces, Code Search, Diagnostics |
| **Organize** (3) | Favorites, Archive, Trash |

### Workstation Theme Format

JSON with `scopes.base.{primary,secondary,disabled,selected,error,success}`, each containing 11 color keys: `accent`, `accentForeground`, `paragraph`, `background`, `border`, `heading`, `icon`, `separator`, `placeholder`, `hover`, `backdrop`. Colors are hex strings (`#RRGGBB` or `#RGB`).

### iced 0.14 Key Patterns

```rust
// App builder
iced::application(App::new, App::update, App::view)
    .theme(App::theme)
    .subscription(App::subscription)
    .settings(Settings { window: window::Settings { size, .. }, .. })
    .run()

// Custom theme
Theme::custom("Name".into(), Palette {
    background, text, primary, success, danger
})

// Layout: sidebar + content
row![
    container(sidebar).width(250),
    container(content).width(Fill),
]
```

### Data Directory

`directories::ProjectDirs::from("com", "wiredash", "Wiredash")` → `~/.local/share/wiredash/` (Linux), `~/Library/Application Support/com.wiredash.Wiredash/` (macOS), `C:\Users\<user>\AppData\Roaming\wiredash\Wiredash\` (Windows).

Config file: `config_dir()/config.json`
Database file: `data_dir()/wiredash.db`

---

## Task 1: Scaffold `wiredash-theme` Crate

Theme data model: parse Workstation JSON themes, convert hex colors to `iced::Color`, provide default light/dark themes.

**Files:**
- Create: `wiredash/crates/wiredash-theme/Cargo.toml`
- Create: `wiredash/crates/wiredash-theme/src/lib.rs`
- Create: `wiredash/crates/wiredash-theme/src/colors.rs`
- Create: `wiredash/crates/wiredash-theme/src/defaults.rs`
- Create: `wiredash/crates/wiredash-theme/tests/theme_test.rs`
- Modify: `wiredash/Cargo.toml` (add member)

**Step 1: Create Cargo.toml**

```toml
[package]
name = "wiredash-theme"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
iced = { version = "0.14", features = ["svg"] }

[dev-dependencies]
serde_json = { workspace = true }
```

**Step 2: Implement colors.rs — hex parsing + iced::Color conversion**

```rust
// wiredash-theme/src/colors.rs
use iced::Color;
use serde::{Deserialize, Serialize};

/// Parse a CSS hex color string to iced::Color.
/// Supports: #RGB, #RRGGBB, #RRGGBBAA
pub fn parse_hex(hex: &str) -> Option<Color> {
    let hex = hex.trim_start_matches('#');
    match hex.len() {
        3 => {
            let r = u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()?;
            let g = u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()?;
            let b = u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()?;
            Some(Color::from_rgb8(r, g, b))
        }
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            Some(Color::from_rgb8(r, g, b))
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
            Some(Color::from_rgba8(r, g, b, a as f32 / 255.0))
        }
        _ => None,
    }
}

/// A set of colors for one theme variant (primary, secondary, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorVariant {
    pub accent: String,
    #[serde(rename = "accentForeground")]
    pub accent_foreground: String,
    pub paragraph: String,
    pub background: String,
    pub border: String,
    pub heading: String,
    pub icon: String,
    pub separator: String,
    #[serde(default)]
    pub placeholder: String,
    #[serde(default)]
    pub hover: String,
    #[serde(default)]
    pub backdrop: String,
}

impl ColorVariant {
    pub fn accent_color(&self) -> Color {
        parse_hex(&self.accent).unwrap_or(Color::from_rgb8(0xE0, 0x00, 0x00))
    }
    pub fn accent_fg_color(&self) -> Color {
        parse_hex(&self.accent_foreground).unwrap_or(Color::WHITE)
    }
    pub fn paragraph_color(&self) -> Color {
        parse_hex(&self.paragraph).unwrap_or(Color::from_rgb8(0x50, 0x50, 0x50))
    }
    pub fn background_color(&self) -> Color {
        parse_hex(&self.background).unwrap_or(Color::WHITE)
    }
    pub fn border_color(&self) -> Color {
        parse_hex(&self.border).unwrap_or(Color::from_rgb8(0xE8, 0xE8, 0xE8))
    }
    pub fn heading_color(&self) -> Color {
        parse_hex(&self.heading).unwrap_or(Color::from_rgb8(0x20, 0x20, 0x20))
    }
    pub fn icon_color(&self) -> Color {
        parse_hex(&self.icon).unwrap_or(Color::from_rgb8(0x50, 0x50, 0x50))
    }
    pub fn separator_color(&self) -> Color {
        parse_hex(&self.separator).unwrap_or(Color::from_rgb8(0xE8, 0xE8, 0xE8))
    }
    pub fn hover_color(&self) -> Color {
        parse_hex(&self.hover).unwrap_or(Color::from_rgba8(0, 0, 0, 0.05))
    }
}

/// All 6 variants in a scope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeColors {
    pub primary: ColorVariant,
    #[serde(default)]
    pub secondary: Option<ColorVariant>,
    #[serde(default)]
    pub disabled: Option<ColorVariant>,
    #[serde(default)]
    pub selected: Option<ColorVariant>,
    #[serde(default)]
    pub error: Option<ColorVariant>,
    #[serde(default)]
    pub success: Option<ColorVariant>,
}

/// Theme scopes (matching Workstation JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeScopes {
    pub base: ScopeColors,
    #[serde(rename = "navigationMenu")]
    #[serde(default)]
    pub navigation_menu: Option<ScopeColors>,
    #[serde(default)]
    pub editor: Option<ScopeColors>,
    #[serde(rename = "statusBar")]
    #[serde(default)]
    pub status_bar: Option<ScopeColors>,
    #[serde(rename = "titleBar")]
    #[serde(default)]
    pub title_bar: Option<ScopeColors>,
    #[serde(default)]
    pub dialog: Option<ScopeColors>,
    #[serde(rename = "contextMenu")]
    #[serde(default)]
    pub context_menu: Option<ScopeColors>,
    #[serde(default)]
    pub list: Option<ScopeColors>,
}
```

**Step 3: Implement the ThemeDefinition and iced conversion in lib.rs**

```rust
// wiredash-theme/src/lib.rs
pub mod colors;
pub mod defaults;

use colors::{ColorVariant, ThemeScopes};
use iced::Theme;
use iced::theme::Palette;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorScheme {
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeDefinition {
    pub name: String,
    pub id: String,
    pub version: f32,
    #[serde(rename = "compatibilityVersion")]
    pub compatibility_version: u32,
    #[serde(rename = "colorScheme")]
    pub color_scheme: ColorScheme,
    pub scopes: ThemeScopes,
}

impl ThemeDefinition {
    /// Convert to an iced Theme via custom Palette.
    pub fn to_iced_theme(&self) -> Theme {
        let base = &self.scopes.base.primary;
        let error = self.scopes.base.error.as_ref().unwrap_or(base);
        let success = self.scopes.base.success.as_ref().unwrap_or(base);

        Theme::custom(
            self.name.clone(),
            Palette {
                background: base.background_color(),
                text: base.paragraph_color(),
                primary: base.accent_color(),
                success: success.accent_color(),
                danger: error.accent_color(),
            },
        )
    }

    /// Get the navigation menu colors (falls back to base).
    pub fn nav_colors(&self) -> &ColorVariant {
        self.scopes.navigation_menu
            .as_ref()
            .map(|s| &s.primary)
            .unwrap_or(&self.scopes.base.primary)
    }

    /// Get the base primary variant.
    pub fn base_colors(&self) -> &ColorVariant {
        &self.scopes.base.primary
    }

    /// Get the selected variant (for selected nav items).
    pub fn selected_colors(&self) -> &ColorVariant {
        self.scopes.base.selected
            .as_ref()
            .unwrap_or(&self.scopes.base.primary)
    }
}

/// Active theme state.
pub struct ThemeEngine {
    pub light: ThemeDefinition,
    pub dark: ThemeDefinition,
    pub active_scheme: ColorScheme,
    pub follow_system: bool,
}

impl ThemeEngine {
    pub fn new() -> Self {
        Self {
            light: defaults::default_light(),
            dark: defaults::default_dark(),
            active_scheme: ColorScheme::Light,
            follow_system: false,
        }
    }

    pub fn active_definition(&self) -> &ThemeDefinition {
        match self.active_scheme {
            ColorScheme::Light => &self.light,
            ColorScheme::Dark => &self.dark,
        }
    }

    pub fn active_iced_theme(&self) -> Theme {
        self.active_definition().to_iced_theme()
    }

    pub fn toggle_scheme(&mut self) {
        self.active_scheme = match self.active_scheme {
            ColorScheme::Light => ColorScheme::Dark,
            ColorScheme::Dark => ColorScheme::Light,
        };
    }

    pub fn set_scheme(&mut self, scheme: ColorScheme) {
        self.active_scheme = scheme;
    }
}
```

**Step 4: Implement defaults.rs — embedded light/dark themes**

```rust
// wiredash-theme/src/defaults.rs
use crate::colors::*;
use crate::{ThemeDefinition, ColorScheme};

pub fn default_light() -> ThemeDefinition {
    ThemeDefinition {
        name: "Workstation Light".into(),
        id: "default-light".into(),
        version: 2.1,
        compatibility_version: 1,
        color_scheme: ColorScheme::Light,
        scopes: ThemeScopes {
            base: ScopeColors {
                primary: ColorVariant {
                    accent: "#E00000".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#505050".into(),
                    background: "#ffffff".into(),
                    border: "#E8E8E8".into(),
                    heading: "#202020".into(),
                    icon: "#505050".into(),
                    separator: "#E8E8E8".into(),
                    placeholder: "#a9a9a9".into(),
                    hover: "#f5f5f5".into(),
                    backdrop: "#0000001a".into(),
                },
                secondary: None,
                disabled: Some(ColorVariant {
                    accent: "#a9a9a9".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#a9a9a9".into(),
                    background: "#f5f5f5".into(),
                    border: "#E8E8E8".into(),
                    heading: "#a9a9a9".into(),
                    icon: "#a9a9a9".into(),
                    separator: "#E8E8E8".into(),
                    placeholder: "#d0d0d0".into(),
                    hover: "#eeeeee".into(),
                    backdrop: "#0000000d".into(),
                }),
                selected: Some(ColorVariant {
                    accent: "#E00000".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#E00000".into(),
                    background: "#fce8e8".into(),
                    border: "#E00000".into(),
                    heading: "#E00000".into(),
                    icon: "#E00000".into(),
                    separator: "#E00000".into(),
                    placeholder: "#a9a9a9".into(),
                    hover: "#f5d0d0".into(),
                    backdrop: "#E000001a".into(),
                }),
                error: Some(ColorVariant {
                    accent: "#E53935".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#E53935".into(),
                    background: "#ffebee".into(),
                    border: "#E53935".into(),
                    heading: "#E53935".into(),
                    icon: "#E53935".into(),
                    separator: "#E53935".into(),
                    placeholder: "#a9a9a9".into(),
                    hover: "#ffcdd2".into(),
                    backdrop: "#E539351a".into(),
                }),
                success: Some(ColorVariant {
                    accent: "#43A047".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#43A047".into(),
                    background: "#E8F5E9".into(),
                    border: "#43A047".into(),
                    heading: "#43A047".into(),
                    icon: "#43A047".into(),
                    separator: "#43A047".into(),
                    placeholder: "#a9a9a9".into(),
                    hover: "#C8E6C9".into(),
                    backdrop: "#43A0471a".into(),
                }),
            },
            navigation_menu: Some(ScopeColors {
                primary: ColorVariant {
                    accent: "#E00000".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#505050".into(),
                    background: "#f8f8f8".into(),
                    border: "#E8E8E8".into(),
                    heading: "#202020".into(),
                    icon: "#707070".into(),
                    separator: "#E8E8E8".into(),
                    placeholder: "#a9a9a9".into(),
                    hover: "#eeeeee".into(),
                    backdrop: "#0000001a".into(),
                },
                secondary: None,
                disabled: None,
                selected: None,
                error: None,
                success: None,
            }),
            editor: None,
            status_bar: None,
            title_bar: None,
            dialog: None,
            context_menu: None,
            list: None,
        },
    }
}

pub fn default_dark() -> ThemeDefinition {
    ThemeDefinition {
        name: "Workstation Dark".into(),
        id: "default-dark".into(),
        version: 2.1,
        compatibility_version: 1,
        color_scheme: ColorScheme::Dark,
        scopes: ThemeScopes {
            base: ScopeColors {
                primary: ColorVariant {
                    accent: "#E00000".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#d4d4d4".into(),
                    background: "#1e1e1e".into(),
                    border: "#3e3e3e".into(),
                    heading: "#e0e0e0".into(),
                    icon: "#a0a0a0".into(),
                    separator: "#3e3e3e".into(),
                    placeholder: "#6e6e6e".into(),
                    hover: "#2a2a2a".into(),
                    backdrop: "#ffffff1a".into(),
                },
                secondary: None,
                disabled: Some(ColorVariant {
                    accent: "#6e6e6e".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#6e6e6e".into(),
                    background: "#2a2a2a".into(),
                    border: "#3e3e3e".into(),
                    heading: "#6e6e6e".into(),
                    icon: "#6e6e6e".into(),
                    separator: "#3e3e3e".into(),
                    placeholder: "#4e4e4e".into(),
                    hover: "#333333".into(),
                    backdrop: "#ffffff0d".into(),
                }),
                selected: Some(ColorVariant {
                    accent: "#E00000".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#ff6b6b".into(),
                    background: "#3a1a1a".into(),
                    border: "#E00000".into(),
                    heading: "#ff6b6b".into(),
                    icon: "#ff6b6b".into(),
                    separator: "#E00000".into(),
                    placeholder: "#6e6e6e".into(),
                    hover: "#4a2020".into(),
                    backdrop: "#E000001a".into(),
                }),
                error: Some(ColorVariant {
                    accent: "#EF5350".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#EF5350".into(),
                    background: "#3a1a1a".into(),
                    border: "#EF5350".into(),
                    heading: "#EF5350".into(),
                    icon: "#EF5350".into(),
                    separator: "#EF5350".into(),
                    placeholder: "#6e6e6e".into(),
                    hover: "#4a2020".into(),
                    backdrop: "#EF53501a".into(),
                }),
                success: Some(ColorVariant {
                    accent: "#66BB6A".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#66BB6A".into(),
                    background: "#1a3a1a".into(),
                    border: "#66BB6A".into(),
                    heading: "#66BB6A".into(),
                    icon: "#66BB6A".into(),
                    separator: "#66BB6A".into(),
                    placeholder: "#6e6e6e".into(),
                    hover: "#204a20".into(),
                    backdrop: "#66BB6A1a".into(),
                }),
            },
            navigation_menu: Some(ScopeColors {
                primary: ColorVariant {
                    accent: "#E00000".into(),
                    accent_foreground: "#ffffff".into(),
                    paragraph: "#c0c0c0".into(),
                    background: "#181818".into(),
                    border: "#3e3e3e".into(),
                    heading: "#e0e0e0".into(),
                    icon: "#909090".into(),
                    separator: "#3e3e3e".into(),
                    placeholder: "#6e6e6e".into(),
                    hover: "#252525".into(),
                    backdrop: "#ffffff1a".into(),
                },
                secondary: None,
                disabled: None,
                selected: None,
                error: None,
                success: None,
            }),
            editor: None,
            status_bar: None,
            title_bar: None,
            dialog: None,
            context_menu: None,
            list: None,
        },
    }
}
```

**Step 5: Write tests**

```rust
// tests/theme_test.rs
use wiredash_theme::colors::parse_hex;
use wiredash_theme::defaults;
use wiredash_theme::ColorScheme;

#[test]
fn test_parse_hex_rrggbb() {
    let c = parse_hex("#E00000").unwrap();
    assert!((c.r - 0.878).abs() < 0.01); // 0xE0/255 ≈ 0.878
    assert!((c.g - 0.0).abs() < 0.01);
    assert!((c.b - 0.0).abs() < 0.01);
}

#[test]
fn test_parse_hex_rgb_short() {
    let c = parse_hex("#fff").unwrap();
    assert!((c.r - 1.0).abs() < 0.01);
    assert!((c.g - 1.0).abs() < 0.01);
    assert!((c.b - 1.0).abs() < 0.01);
}

#[test]
fn test_parse_hex_with_alpha() {
    let c = parse_hex("#0000001a").unwrap();
    assert!((c.r - 0.0).abs() < 0.01);
    assert!((c.a - 0.102).abs() < 0.02); // 0x1a/255 ≈ 0.102
}

#[test]
fn test_parse_hex_invalid() {
    assert!(parse_hex("not-a-color").is_none());
    assert!(parse_hex("#GG0000").is_none());
}

#[test]
fn test_default_light_theme() {
    let theme = defaults::default_light();
    assert_eq!(theme.color_scheme, ColorScheme::Light);
    assert_eq!(theme.scopes.base.primary.accent, "#E00000");
    let iced = theme.to_iced_theme();
    // Just verify it doesn't panic
    let _ = format!("{:?}", iced);
}

#[test]
fn test_default_dark_theme() {
    let theme = defaults::default_dark();
    assert_eq!(theme.color_scheme, ColorScheme::Dark);
    assert_eq!(theme.scopes.base.primary.background, "#1e1e1e");
}

#[test]
fn test_theme_from_json_roundtrip() {
    let theme = defaults::default_light();
    let json = serde_json::to_string(&theme).unwrap();
    let parsed: wiredash_theme::ThemeDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.name, "Workstation Light");
    assert_eq!(parsed.scopes.base.primary.accent, "#E00000");
}

#[test]
fn test_nav_colors_fallback() {
    let mut theme = defaults::default_light();
    // With nav scope
    let nav = theme.nav_colors();
    assert_eq!(nav.background, "#f8f8f8");

    // Without nav scope → falls back to base
    theme.scopes.navigation_menu = None;
    let nav = theme.nav_colors();
    assert_eq!(nav.background, "#ffffff");
}

#[test]
fn test_theme_engine() {
    let mut engine = wiredash_theme::ThemeEngine::new();
    assert_eq!(engine.active_definition().color_scheme, ColorScheme::Light);
    engine.toggle_scheme();
    assert_eq!(engine.active_definition().color_scheme, ColorScheme::Dark);
    engine.toggle_scheme();
    assert_eq!(engine.active_definition().color_scheme, ColorScheme::Light);
}
```

**Step 6: Add to workspace**

Add `"crates/wiredash-theme"` to `wiredash/Cargo.toml` members list.

**Step 7: Run tests**

Run: `cd wiredash && cargo test -p wiredash-theme -- --nocapture`
Expected: 9 tests PASS.

**Step 8: Commit**

```bash
git add wiredash/
git commit -s -m "core: add wiredash-theme crate with Workstation theme engine"
```

---

## Task 2: Scaffold `wiredash-app` Binary Crate

Minimal iced application that opens a window with "Wiredash" title.

**Files:**
- Create: `wiredash/crates/wiredash-app/Cargo.toml`
- Create: `wiredash/crates/wiredash-app/src/main.rs`
- Modify: `wiredash/Cargo.toml` (add member)

**Step 1: Create Cargo.toml**

```toml
[package]
name = "wiredash-app"
version.workspace = true
edition.workspace = true
license.workspace = true

[[bin]]
name = "wiredash"
path = "src/main.rs"

[dependencies]
wiredash-core = { path = "../wiredash-core" }
wiredash-db = { path = "../wiredash-db" }
wiredash-crypto = { path = "../wiredash-crypto" }
wiredash-sync = { path = "../wiredash-sync" }
wiredash-theme = { path = "../wiredash-theme" }

iced = { version = "0.14", features = ["svg", "tokio", "multi-window"] }
tokio = { version = "1", features = ["full"] }
serde = { workspace = true }
serde_json = { workspace = true }
directories = "6"
tracing = { workspace = true }
tracing-subscriber = "0.3"
dark-light = "1"
open = "5"
```

**Step 2: Create minimal main.rs**

```rust
// wiredash-app/src/main.rs

use iced::{Element, Task, Theme, Size};
use iced::widget::{container, text};

fn main() -> iced::Result {
    tracing_subscriber::fmt::init();

    iced::application(Wiredash::new, Wiredash::update, Wiredash::view)
        .title("Wiredash")
        .theme(Wiredash::theme)
        .settings(iced::Settings {
            ..Default::default()
        })
        .window_size(Size::new(1200.0, 800.0))
        .centered()
        .run()
}

struct Wiredash {
    placeholder: String,
}

#[derive(Debug, Clone)]
enum Message {}

impl Wiredash {
    fn new() -> (Self, Task<Message>) {
        (
            Self {
                placeholder: "Wiredash is starting...".into(),
            },
            Task::none(),
        )
    }

    fn update(&mut self, _message: Message) -> Task<Message> {
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        container(
            text(&self.placeholder).size(24),
        )
        .center_x(iced::Fill)
        .center_y(iced::Fill)
        .into()
    }

    fn theme(&self) -> Theme {
        Theme::Dark
    }
}
```

**Step 3: Add to workspace**

Add `"crates/wiredash-app"` to `wiredash/Cargo.toml` members list.

**Step 4: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`
Expected: Compiles without errors.

Note: Do NOT run `cargo run` in CI / headless — iced needs a display. Just verify it compiles.

**Step 5: Commit**

```bash
git add wiredash/
git commit -s -m "core: scaffold wiredash-app binary crate with iced 0.14"
```

---

## Task 3: Navigation Types + Route Table

Define the View, Section, and NavRoute types. Hardcode the full route table.

**Files:**
- Create: `wiredash/crates/wiredash-app/src/navigation.rs`
- Create: `wiredash/crates/wiredash-app/src/icons.rs`

**Step 1: Create icons.rs — Unicode icon placeholders**

```rust
// wiredash-app/src/icons.rs
//
// Placeholder icons using Unicode symbols.
// Phase 4+ will replace these with an icon font (Material Design Icons).

pub const DASHBOARD: &str = "⊞";
pub const CONTROL: &str = "◎";
pub const NOTE: &str = "📄";
pub const TASKS: &str = "☑";
pub const CALENDAR: &str = "📅";
pub const CHAT: &str = "💬";
pub const TERMINAL: &str = "▸";
pub const FILE: &str = "📁";
pub const ROBOT: &str = "🤖";
pub const TABLE: &str = "⊞";
pub const MESSAGE: &str = "✉";
pub const NEWSPAPER: &str = "📰";
pub const PHONE: &str = "📞";
pub const GIT: &str = "⑂";
pub const FORUM: &str = "⊡";
pub const WORKSPACES: &str = "▦";
pub const SEARCH: &str = "🔍";
pub const ISSUE: &str = "⚠";
pub const STAR: &str = "☆";
pub const ARCHIVE: &str = "▤";
pub const TRASH: &str = "🗑";
```

**Step 2: Create navigation.rs**

```rust
// wiredash-app/src/navigation.rs
use crate::icons;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Section {
    Workspace,
    Tools,
    Developer,
    Organize,
}

impl Section {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Workspace => "WORKSPACE",
            Self::Tools => "TOOLS",
            Self::Developer => "DEVELOPER",
            Self::Organize => "ORGANIZE",
        }
    }

    pub const ALL: &'static [Section] = &[
        Section::Workspace,
        Section::Tools,
        Section::Developer,
        Section::Organize,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum View {
    // Workspace
    Dashboard,
    Control,
    Notes,
    Tasks,
    Calendar,
    AgentChat,
    Terminal,
    Files,
    // Tools
    Agents,
    Spreadsheets,
    Communications,
    Newsletters,
    CallQueue,
    // Developer
    Git,
    Conversations,
    Workspaces,
    CodeSearch,
    Diagnostics,
    // Organize
    Favorites,
    Archive,
    Trash,
}

impl View {
    pub fn title(&self) -> &'static str {
        match self {
            Self::Dashboard => "Dashboard",
            Self::Control => "Control",
            Self::Notes => "Notes",
            Self::Tasks => "Tasks",
            Self::Calendar => "Calendar",
            Self::AgentChat => "Agent Chat",
            Self::Terminal => "Terminal",
            Self::Files => "Files",
            Self::Agents => "Agents",
            Self::Spreadsheets => "Spreadsheets",
            Self::Communications => "Communications",
            Self::Newsletters => "Newsletters",
            Self::CallQueue => "Call Queue",
            Self::Git => "Git",
            Self::Conversations => "Conversations",
            Self::Workspaces => "Workspaces",
            Self::CodeSearch => "Code Search",
            Self::Diagnostics => "Diagnostics",
            Self::Favorites => "Favorites",
            Self::Archive => "Archive",
            Self::Trash => "Trash",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            Self::Dashboard => icons::DASHBOARD,
            Self::Control => icons::CONTROL,
            Self::Notes => icons::NOTE,
            Self::Tasks => icons::TASKS,
            Self::Calendar => icons::CALENDAR,
            Self::AgentChat => icons::CHAT,
            Self::Terminal => icons::TERMINAL,
            Self::Files => icons::FILE,
            Self::Agents => icons::ROBOT,
            Self::Spreadsheets => icons::TABLE,
            Self::Communications => icons::MESSAGE,
            Self::Newsletters => icons::NEWSPAPER,
            Self::CallQueue => icons::PHONE,
            Self::Git => icons::GIT,
            Self::Conversations => icons::FORUM,
            Self::Workspaces => icons::WORKSPACES,
            Self::CodeSearch => icons::SEARCH,
            Self::Diagnostics => icons::ISSUE,
            Self::Favorites => icons::STAR,
            Self::Archive => icons::ARCHIVE,
            Self::Trash => icons::TRASH,
        }
    }

    pub fn section(&self) -> Section {
        match self {
            Self::Dashboard | Self::Control | Self::Notes | Self::Tasks |
            Self::Calendar | Self::AgentChat | Self::Terminal | Self::Files => Section::Workspace,

            Self::Agents | Self::Spreadsheets | Self::Communications |
            Self::Newsletters | Self::CallQueue => Section::Tools,

            Self::Git | Self::Conversations | Self::Workspaces |
            Self::CodeSearch | Self::Diagnostics => Section::Developer,

            Self::Favorites | Self::Archive | Self::Trash => Section::Organize,
        }
    }

    /// All views in sidebar order.
    pub const ALL: &'static [View] = &[
        // Workspace
        View::Dashboard, View::Control, View::Notes, View::Tasks,
        View::Calendar, View::AgentChat, View::Terminal, View::Files,
        // Tools
        View::Agents, View::Spreadsheets, View::Communications,
        View::Newsletters, View::CallQueue,
        // Developer
        View::Git, View::Conversations, View::Workspaces,
        View::CodeSearch, View::Diagnostics,
        // Organize
        View::Favorites, View::Archive, View::Trash,
    ];

    /// Views for a given section.
    pub fn for_section(section: Section) -> Vec<View> {
        Self::ALL.iter()
            .filter(|v| v.section() == section)
            .copied()
            .collect()
    }
}
```

**Step 3: Wire into main.rs**

Add `mod navigation;` and `mod icons;` to the top of main.rs (or a new lib structure). For now just add the module declarations. The actual wiring happens in Task 4.

**Step 4: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`

**Step 5: Commit**

```bash
git add wiredash/crates/wiredash-app/
git commit -s -m "core: add navigation types with 21 routes in 4 sections"
```

---

## Task 4: App State + Message Routing

Replace the placeholder Wiredash struct with real state, message types, and update logic. Wire in ThemeEngine.

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs`

**Step 1: Update main.rs with full state + messages**

```rust
// wiredash-app/src/main.rs
mod navigation;
mod icons;

use iced::{Element, Task, Theme, Size, Subscription};
use iced::widget::{container, text, column, row, scrollable, button};
use iced::keyboard;
use navigation::{View, Section};
use wiredash_theme::ThemeEngine;

fn main() -> iced::Result {
    tracing_subscriber::fmt::init();

    iced::application(Wiredash::new, Wiredash::update, Wiredash::view)
        .title(Wiredash::title)
        .theme(Wiredash::theme)
        .subscription(Wiredash::subscription)
        .window_size(Size::new(1200.0, 800.0))
        .centered()
        .run()
}

struct Wiredash {
    current_view: View,
    sidebar_collapsed: bool,
    theme_engine: ThemeEngine,
}

#[derive(Debug, Clone)]
enum Message {
    Navigate(View),
    ToggleSidebar,
    ToggleTheme,
    KeyPressed(keyboard::Key, keyboard::Modifiers),
}

impl Wiredash {
    fn new() -> (Self, Task<Message>) {
        (
            Self {
                current_view: View::Dashboard,
                sidebar_collapsed: false,
                theme_engine: ThemeEngine::new(),
            },
            Task::none(),
        )
    }

    fn title(&self) -> String {
        format!("Wiredash — {}", self.current_view.title())
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Navigate(view) => {
                self.current_view = view;
            }
            Message::ToggleSidebar => {
                self.sidebar_collapsed = !self.sidebar_collapsed;
            }
            Message::ToggleTheme => {
                self.theme_engine.toggle_scheme();
            }
            Message::KeyPressed(key, modifiers) => {
                if modifiers.command() {
                    match key.as_ref() {
                        keyboard::Key::Character("b") => {
                            self.sidebar_collapsed = !self.sidebar_collapsed;
                        }
                        _ => {}
                    }
                }
            }
        }
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        let sidebar_width = if self.sidebar_collapsed { 50.0 } else { 240.0 };

        let sidebar = self.sidebar_view();
        let content = self.content_view();

        row![
            container(sidebar)
                .width(sidebar_width)
                .height(iced::Fill),
            container(content)
                .width(iced::Fill)
                .height(iced::Fill),
        ]
        .into()
    }

    fn theme(&self) -> Theme {
        self.theme_engine.active_iced_theme()
    }

    fn subscription(&self) -> Subscription<Message> {
        keyboard::on_key_press(|key, modifiers| {
            Some(Message::KeyPressed(key, modifiers))
        })
    }

    fn sidebar_view(&self) -> Element<'_, Message> {
        let theme_def = self.theme_engine.active_definition();
        let nav_colors = theme_def.nav_colors();

        let mut sidebar_items: Vec<Element<'_, Message>> = Vec::new();

        // Logo header
        if self.sidebar_collapsed {
            sidebar_items.push(
                container(text("W").size(20))
                    .padding(10)
                    .center_x(iced::Fill)
                    .into(),
            );
        } else {
            sidebar_items.push(
                container(text("Wiredash").size(18))
                    .padding([12, 16])
                    .into(),
            );
        }

        // Sections
        for section in Section::ALL {
            // Section header
            if !self.sidebar_collapsed {
                sidebar_items.push(
                    container(
                        text(section.label())
                            .size(10)
                            .color(wiredash_theme::colors::parse_hex(&nav_colors.placeholder)
                                .unwrap_or(iced::Color::from_rgb8(0xa9, 0xa9, 0xa9)))
                    )
                    .padding([12, 16, 4, 16])
                    .into(),
                );
            }

            // Route items
            for view in View::for_section(*section) {
                let is_selected = view == self.current_view;
                let label = if self.sidebar_collapsed {
                    text(view.icon()).size(16)
                } else {
                    text(format!("  {}  {}", view.icon(), view.title())).size(13)
                };

                let btn = button(label)
                    .on_press(Message::Navigate(view))
                    .padding(if self.sidebar_collapsed { [8, 4] } else { [6, 12] })
                    .width(iced::Fill)
                    .style(move |theme: &Theme, status| {
                        let mut style = button::text(theme, status);
                        if is_selected {
                            style.background = Some(iced::Background::Color(
                                iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.1),
                            ));
                            style.text_color = iced::Color::from_rgb8(0xE0, 0x00, 0x00);
                        }
                        if matches!(status, button::Status::Hovered) && !is_selected {
                            style.background = Some(iced::Background::Color(
                                iced::Color::from_rgba8(0, 0, 0, 0.05),
                            ));
                        }
                        style
                    });

                sidebar_items.push(btn.into());
            }
        }

        // Theme toggle button at bottom
        let theme_label = if self.sidebar_collapsed { "◑" } else { "◑ Toggle Theme" };
        sidebar_items.push(
            container(
                button(text(theme_label).size(12))
                    .on_press(Message::ToggleTheme)
                    .padding([6, 12])
                    .width(iced::Fill)
                    .style(button::text),
            )
            .padding([8, 0])
            .into(),
        );

        let sidebar_col = column(sidebar_items).spacing(1);

        container(scrollable(sidebar_col))
            .style(move |theme: &Theme| {
                let palette = theme.extended_palette();
                container::Style {
                    background: Some(iced::Background::Color(palette.background.weak.color)),
                    border: iced::Border {
                        width: 1.0,
                        color: palette.background.strong.color,
                        ..Default::default()
                    },
                    ..Default::default()
                }
            })
            .height(iced::Fill)
            .into()
    }

    fn content_view(&self) -> Element<'_, Message> {
        let view_name = self.current_view.title();

        container(
            column![
                text(view_name).size(28),
                text("This view is not yet implemented.").size(14),
            ]
            .spacing(8)
        )
        .padding(24)
        .width(iced::Fill)
        .height(iced::Fill)
        .into()
    }
}
```

**Step 2: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add wiredash/crates/wiredash-app/
git commit -s -m "core: add app state, message routing, sidebar, and theme integration"
```

---

## Task 5: Config Persistence

Save and load user preferences (active theme, sidebar state, last view) to disk.

**Files:**
- Create: `wiredash/crates/wiredash-app/src/config.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs` (load/save config)

**Step 1: Create config.rs**

```rust
// wiredash-app/src/config.rs
use crate::navigation::View;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use wiredash_theme::ColorScheme;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_view")]
    pub last_view: String,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default = "default_scheme")]
    pub color_scheme: ColorScheme,
    #[serde(default)]
    pub follow_system_theme: bool,
    #[serde(default = "default_window_width")]
    pub window_width: f32,
    #[serde(default = "default_window_height")]
    pub window_height: f32,
}

fn default_view() -> String { "Dashboard".into() }
fn default_scheme() -> ColorScheme { ColorScheme::Light }
fn default_window_width() -> f32 { 1200.0 }
fn default_window_height() -> f32 { 800.0 }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            last_view: default_view(),
            sidebar_collapsed: false,
            color_scheme: default_scheme(),
            follow_system_theme: false,
            window_width: default_window_width(),
            window_height: default_window_height(),
        }
    }
}

impl AppConfig {
    /// Resolve the last_view string to a View enum.
    pub fn resolve_view(&self) -> View {
        View::ALL.iter()
            .find(|v| v.title() == self.last_view)
            .copied()
            .unwrap_or(View::Dashboard)
    }

    /// Get the config directory path.
    pub fn config_dir() -> Option<PathBuf> {
        directories::ProjectDirs::from("com", "wiredash", "Wiredash")
            .map(|dirs| dirs.config_dir().to_path_buf())
    }

    /// Get the data directory path (for database).
    pub fn data_dir() -> Option<PathBuf> {
        directories::ProjectDirs::from("com", "wiredash", "Wiredash")
            .map(|dirs| dirs.data_dir().to_path_buf())
    }

    /// Load config from disk, or return default.
    pub fn load() -> Self {
        let Some(config_dir) = Self::config_dir() else {
            tracing::warn!("Could not determine config directory");
            return Self::default();
        };

        let config_path = config_dir.join("config.json");
        match std::fs::read_to_string(&config_path) {
            Ok(contents) => {
                serde_json::from_str(&contents).unwrap_or_else(|e| {
                    tracing::warn!("Failed to parse config: {e}");
                    Self::default()
                })
            }
            Err(_) => Self::default(),
        }
    }

    /// Save config to disk.
    pub fn save(&self) {
        let Some(config_dir) = Self::config_dir() else {
            return;
        };

        if let Err(e) = std::fs::create_dir_all(&config_dir) {
            tracing::warn!("Failed to create config dir: {e}");
            return;
        }

        let config_path = config_dir.join("config.json");
        match serde_json::to_string_pretty(self) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&config_path, json) {
                    tracing::warn!("Failed to write config: {e}");
                }
            }
            Err(e) => tracing::warn!("Failed to serialize config: {e}"),
        }
    }
}
```

**Step 2: Update main.rs to load/save config**

In `Wiredash::new()`:
```rust
fn new() -> (Self, Task<Message>) {
    let config = config::AppConfig::load();

    let mut theme_engine = ThemeEngine::new();
    theme_engine.set_scheme(config.color_scheme);

    (
        Self {
            current_view: config.resolve_view(),
            sidebar_collapsed: config.sidebar_collapsed,
            theme_engine,
        },
        Task::none(),
    )
}
```

Add `mod config;` to main.rs.

Add a `save_config()` helper method on `Wiredash`:
```rust
fn save_config(&self) {
    let config = config::AppConfig {
        last_view: self.current_view.title().into(),
        sidebar_collapsed: self.sidebar_collapsed,
        color_scheme: self.theme_engine.active_definition().color_scheme,
        follow_system_theme: self.theme_engine.follow_system,
        window_width: 1200.0,
        window_height: 800.0,
    };
    config.save();
}
```

Call `self.save_config()` at the end of `update()` for `Navigate`, `ToggleSidebar`, and `ToggleTheme` messages.

**Step 3: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`

**Step 4: Commit**

```bash
git add wiredash/crates/wiredash-app/
git commit -s -m "core: add config persistence for theme, sidebar, and last view"
```

---

## Task 6: Status Bar

Add a status bar at the bottom showing sync status, view name, and theme toggle.

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs`

**Step 1: Add status_bar_view() method**

```rust
fn status_bar_view(&self) -> Element<'_, Message> {
    let scheme_label = match self.theme_engine.active_definition().color_scheme {
        wiredash_theme::ColorScheme::Light => "Light",
        wiredash_theme::ColorScheme::Dark => "Dark",
    };

    container(
        row![
            text(format!("  {}", self.current_view.title())).size(11),
            iced::widget::horizontal_space(),
            text(format!("Theme: {}  ", scheme_label)).size(11),
        ]
        .align_y(iced::Alignment::Center)
    )
    .style(|theme: &Theme| {
        let palette = theme.extended_palette();
        container::Style {
            background: Some(iced::Background::Color(palette.background.strong.color)),
            ..Default::default()
        }
    })
    .height(24)
    .width(iced::Fill)
    .into()
}
```

**Step 2: Update view() to include status bar**

```rust
fn view(&self) -> Element<'_, Message> {
    let sidebar_width = if self.sidebar_collapsed { 50.0 } else { 240.0 };

    let sidebar = self.sidebar_view();
    let content = self.content_view();
    let status_bar = self.status_bar_view();

    column![
        row![
            container(sidebar)
                .width(sidebar_width)
                .height(iced::Fill),
            container(content)
                .width(iced::Fill)
                .height(iced::Fill),
        ]
        .height(iced::Fill),
        status_bar,
    ]
    .into()
}
```

**Step 3: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`

**Step 4: Commit**

```bash
git add wiredash/crates/wiredash-app/
git commit -s -m "core: add status bar with view name and theme indicator"
```

---

## Task 7: Keyboard Shortcuts

Add Ctrl+1..9 for quick view navigation, Ctrl+B to toggle sidebar, Ctrl+Shift+T to toggle theme.

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs`

**Step 1: Enhance keyboard handling in update()**

```rust
Message::KeyPressed(key, modifiers) => {
    if modifiers.command() {
        match key.as_ref() {
            keyboard::Key::Character("b") => {
                self.sidebar_collapsed = !self.sidebar_collapsed;
                self.save_config();
            }
            // Ctrl+1..9 → navigate to Workspace routes
            keyboard::Key::Character(c) if c.len() == 1 => {
                if let Some(digit) = c.chars().next().and_then(|ch| ch.to_digit(10)) {
                    if digit >= 1 && digit <= 9 {
                        let idx = (digit - 1) as usize;
                        if let Some(view) = View::ALL.get(idx) {
                            self.current_view = *view;
                            self.save_config();
                        }
                    }
                }
                // Ctrl+Shift+T → toggle theme
                if modifiers.shift() && *c == "t" {
                    self.theme_engine.toggle_scheme();
                    self.save_config();
                }
            }
            _ => {}
        }
    }
}
```

**Step 2: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`

**Step 3: Commit**

```bash
git add wiredash/crates/wiredash-app/
git commit -s -m "core: add keyboard shortcuts for navigation and theme toggle"
```

---

## Task 8: System Theme Detection

Use `dark-light` crate to detect system color scheme on startup. If `follow_system_theme` is true, match system preference.

**Files:**
- Modify: `wiredash/crates/wiredash-app/src/main.rs`

**Step 1: Detect system theme in new()**

```rust
fn new() -> (Self, Task<Message>) {
    let config = config::AppConfig::load();

    let mut theme_engine = ThemeEngine::new();

    if config.follow_system_theme {
        let system_scheme = match dark_light::detect() {
            dark_light::Mode::Dark => wiredash_theme::ColorScheme::Dark,
            dark_light::Mode::Light | dark_light::Mode::Default => wiredash_theme::ColorScheme::Light,
        };
        theme_engine.set_scheme(system_scheme);
        theme_engine.follow_system = true;
    } else {
        theme_engine.set_scheme(config.color_scheme);
    }

    (
        Self {
            current_view: config.resolve_view(),
            sidebar_collapsed: config.sidebar_collapsed,
            theme_engine,
        },
        Task::none(),
    )
}
```

**Step 2: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`

**Step 3: Commit**

```bash
git add wiredash/crates/wiredash-app/
git commit -s -m "core: detect system theme on startup via dark-light"
```

---

## Task 9: Placeholder Content Views

Add distinct placeholder content for each of the 21 views, showing view name, description, and relevant keyboard shortcut hint.

**Files:**
- Create: `wiredash/crates/wiredash-app/src/views.rs`
- Modify: `wiredash/crates/wiredash-app/src/main.rs`

**Step 1: Create views.rs**

```rust
// wiredash-app/src/views.rs
use crate::navigation::View;
use iced::widget::{column, container, text, horizontal_rule};
use iced::{Element, Fill};

impl View {
    pub fn description(&self) -> &'static str {
        match self {
            Self::Dashboard => "Mission control: stats, schedule, priorities, activity feed.",
            Self::Control => "System monitoring and automation control center.",
            Self::Notes => "All notes — create, edit, search, and organize.",
            Self::Tasks => "Task tracking with status, priority, and assignees.",
            Self::Calendar => "Week view calendar with agent-managed events.",
            Self::AgentChat => "Chat with AI agents for assistance and automation.",
            Self::Terminal => "Integrated terminal emulator.",
            Self::Files => "File explorer with navigation and file operations.",
            Self::Agents => "Manage AI agents: Orchestrator, Comms, Research, TaskMaster, Code.",
            Self::Spreadsheets => "Editable data tables and spreadsheets.",
            Self::Communications => "Unified inbox: email, messages, phone — with AI triage.",
            Self::Newsletters => "Newsletter management and reading.",
            Self::CallQueue => "Phone call queue and callback management.",
            Self::Git => "Git status, branches, commits, and diffs.",
            Self::Conversations => "Team conversations and discussion threads.",
            Self::Workspaces => "Workspace management and switching.",
            Self::CodeSearch => "Search code across repositories.",
            Self::Diagnostics => "System diagnostics and health checks.",
            Self::Favorites => "Starred notes and notebooks.",
            Self::Archive => "Archived notes.",
            Self::Trash => "Deleted items — restore or permanently delete.",
        }
    }
}

pub fn placeholder_view<'a, M: 'a>(view: View) -> Element<'a, M> {
    container(
        column![
            text(format!("{} {}", view.icon(), view.title())).size(28),
            horizontal_rule(1),
            text(view.description()).size(14),
            text("").size(8),  // spacer
            text("This view will be implemented in a future phase.").size(12),
        ]
        .spacing(8)
    )
    .padding(24)
    .width(Fill)
    .height(Fill)
    .into()
}
```

**Step 2: Update content_view() in main.rs**

```rust
fn content_view(&self) -> Element<'_, Message> {
    views::placeholder_view(self.current_view)
}
```

Add `mod views;` to main.rs.

**Step 3: Verify compilation**

Run: `cd wiredash && cargo check -p wiredash-app`

**Step 4: Commit**

```bash
git add wiredash/crates/wiredash-app/
git commit -s -m "core: add placeholder content views for all 21 routes"
```

---

## Task 10: Finalize Exports + Full Workspace Tests

Verify all 6 crates compile, all tests pass, and the binary builds successfully.

**Files:**
- Possibly modify: `wiredash/crates/wiredash-app/src/main.rs` (fix any remaining issues)

**Step 1: Run full workspace check**

Run: `cd wiredash && cargo check --workspace`
Expected: No errors.

**Step 2: Run full workspace tests**

Run: `cd wiredash && cargo test --workspace -- --nocapture`
Expected: All tests pass. Count should be approximately:
- `wiredash-crypto`: 9 tests
- `wiredash-db`: 5 tests
- `wiredash-core`: ~26 tests
- `wiredash-sync`: ~42 tests
- `wiredash-theme`: 9 tests
- `wiredash-app`: 0 tests (binary crate, GUI — tested manually)

**Step 3: Build the binary**

Run: `cd wiredash && cargo build -p wiredash-app`
Expected: Binary builds successfully at `target/debug/wiredash` (or `wiredash.exe` on Windows).

**Step 4: Run cargo clippy**

Run: `cd wiredash && cargo clippy --workspace 2>&1 | head -60`
Report warnings.

**Step 5: Commit**

```bash
git add wiredash/
git commit -s -m "core: finalize Phase 3 — all crates compile, tests pass, binary builds"
```

---

## NOT Doing (Deferred)

- **Icon font** — Using Unicode placeholders for now. Phase 4+ will add Material Design Icons via embedded font.
- **SVG logo** — The red claw SVG logo will be embedded in a future task. For now, "Wiredash" text.
- **System tray** — iced's tray support is limited. Deferred to Phase 4+.
- **Auto-launch on boot** — Requires `auto-launch` crate + platform-specific setup. Deferred.
- **Custom theme loading from file** — Only embedded defaults for now. User-imported themes deferred.
- **Sidebar drag reorder** — Static route order for now.
- **Tab switcher (Home/Notebooks/Tags)** — Deferred to Phase 5 when notebook/tag views are built.
- **Window state save/restore** — Save position/size on close. Deferred.
- **Splash screen** — Not needed for desktop app.

## Verification Checklist

After all tasks:
1. `cargo check --workspace` — no compilation errors across 6 crates
2. `cargo test --workspace` — all ~90+ tests pass
3. `cargo build -p wiredash-app` — binary builds successfully
4. `cargo clippy --workspace` — review warnings (non-blocking)
5. Launch binary manually — window opens with sidebar, 21 routes, theme toggle works
6. Config persists — change theme, restart, same theme loads
7. Keyboard: Ctrl+B toggles sidebar, Ctrl+1..9 navigates, Ctrl+Shift+T toggles theme
