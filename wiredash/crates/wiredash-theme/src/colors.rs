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

/// Theme scopes (matching Workstation JSON format).
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
