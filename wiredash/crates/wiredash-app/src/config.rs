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
}

fn default_view() -> String { "Dashboard".into() }
fn default_scheme() -> ColorScheme { ColorScheme::Light }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            last_view: default_view(),
            sidebar_collapsed: false,
            color_scheme: default_scheme(),
            follow_system_theme: false,
        }
    }
}

impl AppConfig {
    pub fn resolve_view(&self) -> View {
        View::ALL.iter()
            .find(|v| v.title() == self.last_view)
            .copied()
            .unwrap_or(View::Dashboard)
    }

    pub fn config_dir() -> Option<PathBuf> {
        directories::ProjectDirs::from("com", "wiredash", "Wiredash")
            .map(|dirs| dirs.config_dir().to_path_buf())
    }

    #[allow(dead_code)] // used in Phase 4 for database path
    pub fn data_dir() -> Option<PathBuf> {
        directories::ProjectDirs::from("com", "wiredash", "Wiredash")
            .map(|dirs| dirs.data_dir().to_path_buf())
    }

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

    pub fn save(&self) {
        let Some(config_dir) = Self::config_dir() else { return; };
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
