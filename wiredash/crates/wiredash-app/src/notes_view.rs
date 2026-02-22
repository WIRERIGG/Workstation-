//! Notes view - list + markdown editor for creating and editing notes.

use iced::widget::{button, column, container, row, scrollable, text, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::content::Content;
use wiredash_core::collections::notes::Notes;
use wiredash_core::types::{ContentItem, Note};
use wiredash_db::Database;
use wiredash_editor::{editor_view, EditorMessage, EditorState};

/// Lightweight summary of a note for the sidebar list.
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    #[allow(dead_code)] // TODO: use for "modified X ago" display in note list
    pub date_modified: i64,
    pub pinned: bool,
    pub favorite: bool,
}

/// Messages produced by the notes view.
#[derive(Debug, Clone)]
pub enum NotesMessage {
    SelectNote(usize),
    NewNote,
    Editor(EditorMessage),
    SaveNote,
}

pub struct NotesViewState {
    pub note_list: Vec<NoteSummary>,
    pub selected_index: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
}

impl NotesViewState {
    pub fn new() -> Self {
        Self {
            note_list: Vec::new(),
            selected_index: None,
            editor: EditorState::new(),
            db_content_id: None,
        }
    }

    /// Reload the sidebar list from the database.
    pub fn refresh_list(&mut self, db: &Database) {
        match Notes::new(db).list(Some(200)) {
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
                        date_modified: n.base.date_modified,
                        pinned: n.pinned,
                        favorite: n.favorite,
                    })
                    .collect();
            }
            Err(e) => {
                tracing::error!("Failed to load notes: {e}");
            }
        }
    }

    /// Load a note content into the editor by sidebar index.
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
            Err(e) => {
                tracing::error!("Failed to load content for note: {e}");
            }
        }
    }

    /// Create a brand-new note + content row and select it.
    pub fn create_note(&mut self, db: &Database) {
        let mut note = Note::new("Untitled");
        let mut content_item = ContentItem::new();
        content_item.note_id = Some(note.base.id.clone());
        content_item.data = Some(String::new());
        note.content_id = Some(content_item.base.id.clone());

        let notes_col = Notes::new(db);
        let content_col = Content::new(db);

        if let Err(e) = notes_col.add(&note) {
            tracing::error!("Failed to create note: {e}");
            return;
        }
        if let Err(e) = content_col.add(&content_item) {
            tracing::error!("Failed to create content: {e}");
            return;
        }

        let new_note_id = note.base.id.clone();
        let new_content_id = content_item.base.id.clone();

        self.refresh_list(db);

        if let Some(idx) = self.note_list.iter().position(|n| n.id == new_note_id) {
            self.editor = EditorState::new();
            self.editor.note_id = Some(new_note_id);
            self.db_content_id = Some(new_content_id);
            self.selected_index = Some(idx);
        }
    }

    /// Persist the current editor content back to the database.
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

        // Extract title from first non-empty line
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

    /// Process a NotesMessage. Returns true if the view needs a redraw.
    pub fn update(&mut self, message: NotesMessage, db: &Database) -> bool {
        match message {
            NotesMessage::SelectNote(index) => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.load_note(index, db);
                true
            }
            NotesMessage::NewNote => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.create_note(db);
                true
            }
            NotesMessage::Editor(msg) => {
                self.editor.update(msg);
                true
            }
            NotesMessage::SaveNote => {
                self.save_current(db);
                self.refresh_list(db);
                true
            }
        }
    }
}

// View functions

/// Build the full notes view: sidebar list + editor area.
pub fn notes_view<'a>(
    state: &'a NotesViewState,
    theme: &Theme,
) -> Element<'a, NotesMessage> {
    let sidebar = note_list_sidebar(state);
    let editor_area = editor_area_view(state, theme);

    row![
        container(sidebar).width(260).height(Fill),
        rule::vertical(1),
        container(editor_area).width(Fill).height(Fill),
    ]
    .height(Fill)
    .into()
}

/// The left sidebar: new-note button + scrollable note list.
fn note_list_sidebar(state: &NotesViewState) -> Element<'_, NotesMessage> {
    let mut items: Vec<Element<'_, NotesMessage>> = Vec::new();

    items.push(
        container(
            button(text("+ New Note").size(13))
                .on_press(NotesMessage::NewNote)
                .padding([6, 12])
                .width(Fill)
                .style(button::primary),
        )
        .padding(iced::Padding::ZERO.top(8).right(8).bottom(4).left(8))
        .into(),
    );

    for (i, note) in state.note_list.iter().enumerate() {
        let is_selected = state.selected_index == Some(i);

        let mut label = String::new();
        if note.pinned {
            label.push_str("[pin] ");
        }
        if note.favorite {
            label.push_str("[fav] ");
        }
        label.push_str(&note.title);

        let note_btn = button(
            column![
                text(label).size(13),
            ]
            .spacing(2),
        )
        .on_press(NotesMessage::SelectNote(i))
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

    let list_col = column(items).spacing(1);

    container(scrollable(list_col))
        .style(|theme: &Theme| {
            let palette = theme.extended_palette();
            container::Style {
                background: Some(iced::Background::Color(palette.background.weak.color)),
                border: iced::Border {
                    width: 0.0,
                    color: palette.background.strong.color,
                    ..Default::default()
                },
                ..Default::default()
            }
        })
        .height(Fill)
        .into()
}

/// The right area: either the editor (when a note is selected) or a placeholder.
fn editor_area_view<'a>(
    state: &'a NotesViewState,
    theme: &Theme,
) -> Element<'a, NotesMessage> {
    if state.selected_index.is_some() {
        let save_btn = container(
            row![
                space::horizontal(),
                button(text("Save").size(12))
                    .on_press(NotesMessage::SaveNote)
                    .padding([4, 16])
                    .style(button::primary),
            ]
            .align_y(Center)
            .padding([4, 8]),
        );

        column![
            save_btn,
            editor_view(&state.editor, theme, NotesMessage::Editor),
        ]
        .height(Fill)
        .into()
    } else {
        container(
            text("Select a note or create a new one to start editing.")
                .size(14)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into()
    }
}
