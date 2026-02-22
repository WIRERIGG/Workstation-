//! Organize views — Favorites, Archive, Trash.
//! Filtered note lists with editor integration.

use iced::widget::{button, column, container, row, scrollable, text, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::content::Content;
use wiredash_core::collections::notes::Notes;
use wiredash_core::types::{SortBy, SortDirection};
use wiredash_db::Database;
use wiredash_editor::{editor_view, EditorMessage, EditorState};

/// Which filter to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteFilter {
    Favorites,
    Archived,
    Trashed,
}

impl NoteFilter {
    pub fn title(&self) -> &'static str {
        match self {
            Self::Favorites => "Favorites",
            Self::Archived => "Archive",
            Self::Trashed => "Trash",
        }
    }

    pub fn empty_message(&self) -> &'static str {
        match self {
            Self::Favorites => "No favorite notes yet. Star notes to see them here.",
            Self::Archived => "No archived notes.",
            Self::Trashed => "Trash is empty.",
        }
    }
}

/// Lightweight summary of a note for the sidebar list.
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub content_id: Option<String>,
}

/// Messages produced by the filtered notes views.
#[derive(Debug, Clone)]
pub enum FilteredNotesMessage {
    SelectNote(usize),
    Editor(EditorMessage),
    SaveNote,
    /// Favorites: unfavorite. Archive: unarchive. Trash: restore.
    ActionPrimary,
    /// Trash only: permanent delete.
    ActionSecondary,
}

pub struct FilteredNotesState {
    pub note_list: Vec<NoteSummary>,
    pub selected_index: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
}

impl FilteredNotesState {
    pub fn new() -> Self {
        Self {
            note_list: Vec::new(),
            selected_index: None,
            editor: EditorState::new(),
            db_content_id: None,
        }
    }

    /// Reload note list based on filter.
    pub fn refresh(&mut self, db: &Database, filter: NoteFilter) {
        let notes_col = Notes::new(db);
        let result = match filter {
            NoteFilter::Favorites => notes_col.list_filtered(
                true,
                false,
                SortBy::DateModified,
                SortDirection::Desc,
                Some(200),
            ),
            NoteFilter::Archived => notes_col.list_filtered(
                false,
                true,
                SortBy::DateModified,
                SortDirection::Desc,
                Some(200),
            ),
            NoteFilter::Trashed => notes_col.trashed(),
        };

        match result {
            Ok(notes) => {
                self.note_list = notes
                    .into_iter()
                    .map(|n| NoteSummary {
                        id: n.base.id,
                        title: if n.title.is_empty() {
                            "Untitled".to_string()
                        } else {
                            n.title
                        },
                        content_id: n.content_id,
                    })
                    .collect();
            }
            Err(e) => tracing::error!("Failed to load filtered notes: {e}"),
        }
    }

    /// Load a note's content into the editor.
    pub fn load_note(&mut self, index: usize, db: &Database) {
        let Some(summary) = self.note_list.get(index) else {
            return;
        };
        let note_id = summary.id.clone();

        match Content::new(db).find_by_note_id(&note_id) {
            Ok(Some(content_item)) => {
                let data = content_item.data.as_deref().unwrap_or("");
                self.editor = EditorState::with_content(data);
                self.editor.note_id = Some(note_id);
                self.db_content_id = Some(content_item.base.id);
                self.selected_index = Some(index);
            }
            Ok(None) => {
                self.editor = EditorState::new();
                self.editor.note_id = Some(note_id);
                self.db_content_id = None;
                self.selected_index = Some(index);
            }
            Err(e) => tracing::error!("Failed to load content: {e}"),
        }
    }

    /// Save editor content.
    pub fn save_current(&mut self, db: &Database) {
        let Some(ref content_id) = self.db_content_id else {
            return;
        };
        let Some(ref note_id) = self.editor.note_id else {
            return;
        };

        let editor_text = self.editor.text();

        if let Err(e) = Content::new(db).update_data(content_id, &editor_text) {
            tracing::error!("Failed to save content: {e}");
            return;
        }

        let title = editor_text
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim_start_matches('#').trim())
            .unwrap_or("Untitled")
            .to_string();

        if let Err(e) = Notes::new(db).update_title(note_id, &title) {
            tracing::error!("Failed to update title: {e}");
            return;
        }

        // Index for FTS search
        let search = wiredash_core::collections::search::Search::new(db);
        if let Err(e) = search.index_note(note_id, &title) {
            tracing::warn!("FTS index note failed: {e}");
        }
        if let Err(e) = search.index_content(content_id, note_id, &editor_text) {
            tracing::warn!("FTS index content failed: {e}");
        }

        self.editor.mark_saved();

        if let Some(idx) = self.selected_index {
            if let Some(summary) = self.note_list.get_mut(idx) {
                summary.title = if title.is_empty() {
                    "Untitled".to_string()
                } else {
                    title
                };
            }
        }
    }

    /// Handle the primary action button (unfavorite/unarchive/restore).
    fn action_primary(&mut self, db: &Database, filter: NoteFilter) {
        let Some(idx) = self.selected_index else {
            return;
        };
        let Some(note) = self.note_list.get(idx) else {
            return;
        };
        let id = note.id.clone();

        let notes = Notes::new(db);
        let result = match filter {
            NoteFilter::Favorites => notes.set_favorite(&id, false),
            NoteFilter::Archived => notes.set_archived(&id, false),
            NoteFilter::Trashed => notes.restore_from_trash(&id),
        };

        if let Err(e) = result {
            tracing::error!("Action failed: {e}");
            return;
        }

        // Clear selection and refresh
        self.selected_index = None;
        self.editor = EditorState::new();
        self.db_content_id = None;
        self.refresh(db, filter);
    }

    /// Trash only: permanently delete note + content.
    fn action_secondary(&mut self, db: &Database) {
        let Some(idx) = self.selected_index else {
            return;
        };
        let Some(note) = self.note_list.get(idx) else {
            return;
        };
        let id = note.id.clone();
        let content_id = note.content_id.clone();

        // Delete content first if it exists
        if let Some(ref cid) = content_id {
            if let Err(e) = Content::new(db).remove(cid) {
                tracing::error!("Failed to delete content: {e}");
            }
        }

        if let Err(e) = Notes::new(db).remove(&id) {
            tracing::error!("Failed to permanently delete note: {e}");
            return;
        }

        self.selected_index = None;
        self.editor = EditorState::new();
        self.db_content_id = None;
        self.refresh(db, NoteFilter::Trashed);
    }

    /// Process message. Returns true if view changed.
    pub fn update(
        &mut self,
        message: FilteredNotesMessage,
        db: &Database,
        filter: NoteFilter,
    ) -> bool {
        match message {
            FilteredNotesMessage::SelectNote(index) => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.load_note(index, db);
                true
            }
            FilteredNotesMessage::Editor(msg) => {
                self.editor.update(msg);
                true
            }
            FilteredNotesMessage::SaveNote => {
                self.save_current(db);
                true
            }
            FilteredNotesMessage::ActionPrimary => {
                self.action_primary(db, filter);
                true
            }
            FilteredNotesMessage::ActionSecondary => {
                self.action_secondary(db);
                true
            }
        }
    }
}

// ---------------------------------------------------------------------------
// View functions
// ---------------------------------------------------------------------------

/// Build the filtered notes view.
pub fn filtered_notes_view<'a>(
    state: &'a FilteredNotesState,
    theme: &Theme,
    filter: NoteFilter,
) -> Element<'a, FilteredNotesMessage> {
    let note_list = filtered_note_list(state, filter);
    let editor_area = filtered_editor_area(state, theme, filter);

    row![
        container(note_list).width(300).height(Fill),
        rule::vertical(1),
        container(editor_area).width(Fill).height(Fill),
    ]
    .height(Fill)
    .into()
}

/// Left panel: filtered note list with action buttons.
fn filtered_note_list<'a>(
    state: &'a FilteredNotesState,
    filter: NoteFilter,
) -> Element<'a, FilteredNotesMessage> {
    let mut items: Vec<Element<'a, FilteredNotesMessage>> = Vec::new();

    // Header
    items.push(
        container(text(filter.title()).size(14))
            .padding(iced::Padding::ZERO.top(12).right(12).bottom(4).left(12))
            .into(),
    );

    if state.note_list.is_empty() {
        items.push(
            container(
                text(filter.empty_message())
                    .size(12)
                    .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            )
            .padding(12)
            .into(),
        );
    }

    for (i, note) in state.note_list.iter().enumerate() {
        let is_selected = state.selected_index == Some(i);

        let note_btn = button(text(&note.title).size(13))
            .on_press(FilteredNotesMessage::SelectNote(i))
            .padding([8, 12])
            .width(Fill)
            .style(move |theme: &Theme, status| {
                let mut style = button::text(theme, status);
                if is_selected {
                    style.background = Some(iced::Background::Color(
                        iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.12),
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

        items.push(note_btn.into());
    }

    // Action buttons when a note is selected
    if state.selected_index.is_some() {
        items.push(rule::horizontal(1).into());

        let primary_label = match filter {
            NoteFilter::Favorites => "Unfavorite",
            NoteFilter::Archived => "Unarchive",
            NoteFilter::Trashed => "Restore",
        };

        let mut action_row_items: Vec<Element<'a, FilteredNotesMessage>> = vec![
            button(text(primary_label).size(11))
                .on_press(FilteredNotesMessage::ActionPrimary)
                .padding([4, 8])
                .style(button::secondary)
                .into(),
        ];

        if filter == NoteFilter::Trashed {
            action_row_items.push(
                button(text("Delete Forever").size(11))
                    .on_press(FilteredNotesMessage::ActionSecondary)
                    .padding([4, 8])
                    .style(button::secondary)
                    .into(),
            );
        }

        items.push(
            container(row(action_row_items).spacing(4))
                .padding(8)
                .into(),
        );
    }

    let list_col = column(items).spacing(1);

    container(scrollable(list_col))
        .style(|theme: &Theme| {
            let palette = theme.extended_palette();
            container::Style {
                background: Some(iced::Background::Color(palette.background.weak.color)),
                ..Default::default()
            }
        })
        .height(Fill)
        .into()
}

/// Right panel: editor or placeholder.
fn filtered_editor_area<'a>(
    state: &'a FilteredNotesState,
    theme: &Theme,
    filter: NoteFilter,
) -> Element<'a, FilteredNotesMessage> {
    if state.selected_index.is_some() {
        let save_btn = container(
            row![
                space::horizontal(),
                button(text("Save").size(12))
                    .on_press(FilteredNotesMessage::SaveNote)
                    .padding([4, 16])
                    .style(button::primary),
            ]
            .align_y(Center)
            .padding([4, 8]),
        );

        column![
            save_btn,
            editor_view(&state.editor, theme, FilteredNotesMessage::Editor),
        ]
        .height(Fill)
        .into()
    } else {
        let msg = match filter {
            NoteFilter::Favorites => "Select a favorite note to edit.",
            NoteFilter::Archived => "Select an archived note to view.",
            NoteFilter::Trashed => "Select a trashed note to restore or delete.",
        };
        container(
            text(msg)
                .size(14)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into()
    }
}
