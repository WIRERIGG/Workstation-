//! wiredash-editor — Markdown editor component for the Wiredash desktop app.
//!
//! Provides a TipTap-style editing experience with:
//! - Live markdown preview (split pane or full preview)
//! - Toolbar with formatting actions
//! - Syntax highlighting via iced's highlighter feature

mod editor;
mod toolbar;
mod view;

pub use editor::{EditorMessage, EditorMode, EditorState};
pub use toolbar::{toolbar_actions, toolbar_view, ToolbarAction, TOOLBAR_ACTIONS};
pub use view::editor_view;
