pub mod colors;
pub mod defaults;

use colors::{ColorVariant, ThemeScopes};
use iced::theme::Palette;
use iced::Theme;
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
                warning: base.accent_color(),
                danger: error.accent_color(),
            },
        )
    }

    /// Get the navigation menu colors (falls back to base).
    pub fn nav_colors(&self) -> &ColorVariant {
        self.scopes
            .navigation_menu
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
        self.scopes
            .base
            .selected
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

impl Default for ThemeEngine {
    fn default() -> Self {
        Self::new()
    }
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
