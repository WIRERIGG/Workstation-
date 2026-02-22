//! Core editor state and message handling for the Wiredash markdown editor.
//!
//! Provides a split-pane editor with live markdown preview, syntax highlighting,
//! and toolbar-driven snippet insertion.

use iced::widget::{markdown, text_editor};
use std::sync::Arc;

/// Controls which pane(s) the editor displays.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum EditorMode {
    /// Show only the text editor.
    #[default]
    Edit,
    /// Show the editor and markdown preview side by side.
    Preview,
    /// Show both editor and preview in a split layout.
    Split,
}

impl EditorMode {
    /// Cycle to the next mode: Edit -> Split -> Preview -> Edit.
    pub fn cycle(self) -> Self {
        match self {
            Self::Edit => Self::Split,
            Self::Split => Self::Preview,
            Self::Preview => Self::Edit,
        }
    }

    /// Human-readable label for the mode.
    pub fn label(self) -> &'static str {
        match self {
            Self::Edit => "Edit",
            Self::Split => "Split",
            Self::Preview => "Preview",
        }
    }
}

/// Messages produced by the editor component.
#[derive(Debug, Clone)]
pub enum EditorMessage {
    /// A text editor action (keystroke, click, selection, etc.).
    Edit(text_editor::Action),
    /// User clicked a link in the markdown preview.
    LinkClicked(String),
    /// Set the editor mode directly.
    SetMode(EditorMode),
    /// Cycle through editor modes.
    CycleMode,
    /// Insert a markdown snippet at the current cursor position.
    InsertSnippet(String),
}

/// The state of the editor component.
pub struct EditorState {
    /// The text editor content buffer.
    pub content: text_editor::Content,
    /// Parsed markdown items for preview rendering.
    pub preview_items: Vec<markdown::Item>,
    /// Current display mode.
    pub mode: EditorMode,
    /// Whether the content has unsaved changes.
    pub dirty: bool,
    /// Optional associated note ID.
    pub note_id: Option<String>,
    /// A version counter that increments on each edit, useful for change detection.
    pub content_id: u64,
}

impl EditorState {
    /// Create a new empty editor.
    pub fn new() -> Self {
        Self {
            content: text_editor::Content::new(),
            preview_items: Vec::new(),
            mode: EditorMode::default(),
            dirty: false,
            note_id: None,
            content_id: 0,
        }
    }

    /// Create an editor pre-populated with the given text.
    pub fn with_content(text: &str) -> Self {
        let content = text_editor::Content::with_text(text);
        let preview_items: Vec<markdown::Item> = markdown::parse(text).collect();
        Self {
            content,
            preview_items,
            mode: EditorMode::default(),
            dirty: false,
            note_id: None,
            content_id: 0,
        }
    }

    /// Return the full text content of the editor.
    pub fn text(&self) -> String {
        self.content.text()
    }

    /// Process an editor message and update state accordingly.
    pub fn update(&mut self, message: EditorMessage) {
        match message {
            EditorMessage::Edit(action) => {
                let is_edit = action.is_edit();
                self.content.perform(action);
                if is_edit {
                    self.dirty = true;
                    self.content_id = self.content_id.wrapping_add(1);
                    let text = self.content.text();
                    self.preview_items = markdown::parse(&text).collect();
                }
            }
            EditorMessage::InsertSnippet(snippet) => {
                let action = text_editor::Action::Edit(
                    text_editor::Edit::Paste(Arc::new(snippet)),
                );
                self.content.perform(action);
                self.dirty = true;
                self.content_id = self.content_id.wrapping_add(1);
                let text = self.content.text();
                self.preview_items = markdown::parse(&text).collect();
            }
            EditorMessage::LinkClicked(url) => {
                let _ = open::that(&url);
            }
            EditorMessage::SetMode(mode) => {
                self.mode = mode;
                // Re-parse preview when switching to a mode that shows it
                if matches!(self.mode, EditorMode::Preview | EditorMode::Split) {
                    let text = self.content.text();
                    self.preview_items = markdown::parse(&text).collect();
                }
            }
            EditorMessage::CycleMode => {
                self.mode = self.mode.cycle();
                if matches!(self.mode, EditorMode::Preview | EditorMode::Split) {
                    let text = self.content.text();
                    self.preview_items = markdown::parse(&text).collect();
                }
            }
        }
    }

    /// Reset the dirty flag, typically after saving.
    pub fn mark_saved(&mut self) {
        self.dirty = false;
    }
}

impl Default for EditorState {
    fn default() -> Self {
        Self::new()
    }
}
