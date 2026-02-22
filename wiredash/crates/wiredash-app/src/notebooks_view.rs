//! Notebooks view -- list notebooks, show notes in selected notebook, edit.

use iced::widget::{button, column, container, row, scrollable, text, text_input, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::content::Content;
use wiredash_core::collections::notebooks::Notebooks;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::relations::Relations;
use wiredash_core::types::{ContentItem, Note, Notebook};
use wiredash_db::Database;
use wiredash_editor::{editor_view, EditorMessage, EditorState};

/// Lightweight summary of a notebook for the sidebar list.
pub struct NotebookSummary {
    pub id: String,
    pub title: String,
    #[allow(dead_code)] // TODO: use for pinned indicator in notebook list
    pub pinned: bool,
    pub note_count: usize,
}

/// Lightweight summary of a note in a notebook.
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub pinned: bool,
}

/// Messages produced by the notebooks view.
#[derive(Debug, Clone)]
pub enum NotebooksMessage {
    SelectNotebook(usize),
    SelectNote(usize),
    NewNotebook,
    NewNote,
    RenameNotebook(String),
    SubmitRename,
    CancelRename,
    DeleteNotebook,
    Editor(EditorMessage),
    SaveNote,
}

pub struct NotebooksViewState {
    pub notebook_list: Vec<NotebookSummary>,
    pub selected_notebook: Option<usize>,
    pub note_list: Vec<NoteSummary>,
    pub selected_note: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
    pub renaming: bool,
    pub rename_text: String,
}

impl NotebooksViewState {
    pub fn new() -> Self {
        Self {
            notebook_list: Vec::new(),
            selected_notebook: None,
            note_list: Vec::new(),
            selected_note: None,
            editor: EditorState::new(),
            db_content_id: None,
            renaming: false,
            rename_text: String::new(),
        }
    }

    /// Reload notebook list from DB, counting notes per notebook via Relations.
    pub fn refresh_notebooks(&mut self, db: &Database) {
        match Notebooks::new(db).list() {
            Ok(nbs) => {
                let relations = Relations::new(db);
                self.notebook_list = nbs
                    .into_iter()
                    .map(|nb| {
                        let count = relations
                            .from_ids("notebook", &nb.base.id, "note")
                            .map(|ids| ids.len())
                            .unwrap_or(0);
                        NotebookSummary {
                            id: nb.base.id,
                            title: if nb.title.is_empty() {
                                "Untitled".to_string()
                            } else {
                                nb.title
                            },
                            pinned: nb.pinned,
                            note_count: count,
                        }
                    })
                    .collect();
            }
            Err(e) => tracing::error!("Failed to load notebooks: {e}"),
        }
    }

    /// Reload notes for the currently selected notebook.
    pub fn refresh_notes(&mut self, db: &Database) {
        let Some(idx) = self.selected_notebook else {
            self.note_list.clear();
            return;
        };
        let Some(nb) = self.notebook_list.get(idx) else {
            self.note_list.clear();
            return;
        };
        let nb_id = nb.id.clone();

        match Relations::new(db).from_ids("notebook", &nb_id, "note") {
            Ok(note_ids) => match Notes::new(db).list_by_ids(&note_ids) {
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
                            pinned: n.pinned,
                        })
                        .collect();
                }
                Err(e) => tracing::error!("Failed to load notes for notebook: {e}"),
            },
            Err(e) => tracing::error!("Failed to load notebook relations: {e}"),
        }
    }

    /// Load a note content into the editor.
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
                self.selected_note = Some(index);
            }
            Ok(None) => {
                self.editor = EditorState::new();
                self.editor.note_id = Some(note_id);
                self.db_content_id = None;
                self.selected_note = Some(index);
            }
            Err(e) => tracing::error!("Failed to load content: {e}"),
        }
    }

    /// Create a new notebook.
    pub fn create_notebook(&mut self, db: &Database) {
        let nb = Notebook::new("Untitled Notebook");
        if let Err(e) = Notebooks::new(db).add(&nb) {
            tracing::error!("Failed to create notebook: {e}");
            return;
        }
        self.refresh_notebooks(db);
        if let Some(idx) = self.notebook_list.iter().position(|n| n.id == nb.base.id) {
            self.selected_notebook = Some(idx);
            self.refresh_notes(db);
        }
    }

    /// Create a new note inside the selected notebook.
    pub fn create_note(&mut self, db: &Database) {
        let Some(nb_idx) = self.selected_notebook else {
            return;
        };
        let Some(nb) = self.notebook_list.get(nb_idx) else {
            return;
        };
        let nb_id = nb.id.clone();

        let mut note = Note::new("Untitled");
        let mut content_item = ContentItem::new();
        content_item.note_id = Some(note.base.id.clone());
        content_item.data = Some(String::new());
        note.content_id = Some(content_item.base.id.clone());

        let notes_col = Notes::new(db);
        let content_col = Content::new(db);
        let relations = Relations::new(db);

        if let Err(e) = notes_col.add(&note) {
            tracing::error!("Failed to create note: {e}");
            return;
        }
        if let Err(e) = content_col.add(&content_item) {
            tracing::error!("Failed to create content: {e}");
            return;
        }
        if let Err(e) = relations.add("notebook", &nb_id, "note", &note.base.id) {
            tracing::error!("Failed to link note to notebook: {e}");
            return;
        }

        let new_note_id = note.base.id.clone();
        let new_content_id = content_item.base.id.clone();

        self.refresh_notes(db);
        self.refresh_notebooks(db);

        if let Some(idx) = self.note_list.iter().position(|n| n.id == new_note_id) {
            self.editor = EditorState::new();
            self.editor.note_id = Some(new_note_id);
            self.db_content_id = Some(new_content_id);
            self.selected_note = Some(idx);
        }
    }

    /// Save the current editor content.
    pub fn save_current(&mut self, db: &Database) {
        let Some(ref content_id) = self.db_content_id else {
            return;
        };
        let content_id = content_id.clone();
        let Some(ref note_id) = self.editor.note_id else {
            return;
        };
        let note_id = note_id.clone();

        let editor_text = self.editor.text();

        if let Err(e) = Content::new(db).update_data(&content_id, &editor_text) {
            tracing::error!("Failed to save content: {e}");
            return;
        }

        let title = editor_text
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim_start_matches('#').trim())
            .unwrap_or("Untitled")
            .to_string();

        if let Err(e) = Notes::new(db).update_title(&note_id, &title) {
            tracing::error!("Failed to update title: {e}");
            return;
        }

        self.editor.mark_saved();

        if let Some(idx) = self.selected_note {
            if let Some(summary) = self.note_list.get_mut(idx) {
                summary.title = if title.is_empty() {
                    "Untitled".to_string()
                } else {
                    title
                };
            }
        }
    }

    /// Delete the selected notebook.
    pub fn delete_notebook(&mut self, db: &Database) {
        let Some(idx) = self.selected_notebook else {
            return;
        };
        let Some(nb) = self.notebook_list.get(idx) else {
            return;
        };
        let nb_id = nb.id.clone();

        if let Err(e) = Relations::new(db).unlink_all_from("notebook", &nb_id) {
            tracing::error!("Failed to unlink notebook relations: {e}");
        }
        if let Err(e) = Notebooks::new(db).move_to_trash(&nb_id) {
            tracing::error!("Failed to trash notebook: {e}");
            return;
        }

        self.selected_notebook = None;
        self.note_list.clear();
        self.selected_note = None;
        self.editor = EditorState::new();
        self.db_content_id = None;
        self.refresh_notebooks(db);
    }

    /// Process a NotebooksMessage. Returns true if the view changed.
    pub fn update(&mut self, message: NotebooksMessage, db: &Database) -> bool {
        match message {
            NotebooksMessage::SelectNotebook(index) => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.selected_notebook = Some(index);
                self.selected_note = None;
                self.editor = EditorState::new();
                self.db_content_id = None;
                self.refresh_notes(db);
                true
            }
            NotebooksMessage::SelectNote(index) => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.load_note(index, db);
                true
            }
            NotebooksMessage::NewNotebook => {
                self.create_notebook(db);
                true
            }
            NotebooksMessage::NewNote => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.create_note(db);
                true
            }
            NotebooksMessage::RenameNotebook(new_text) => {
                if !self.renaming {
                    self.renaming = true;
                    self.rename_text = new_text;
                } else {
                    self.rename_text = new_text;
                }
                true
            }
            NotebooksMessage::SubmitRename => {
                if let Some(idx) = self.selected_notebook {
                    if let Some(nb) = self.notebook_list.get(idx) {
                        let id = nb.id.clone();
                        let new_title = self.rename_text.clone();
                        if let Err(e) = Notebooks::new(db).update_title(&id, &new_title) {
                            tracing::error!("Failed to rename notebook: {e}");
                        }
                    }
                }
                self.renaming = false;
                self.rename_text.clear();
                self.refresh_notebooks(db);
                true
            }
            NotebooksMessage::CancelRename => {
                self.renaming = false;
                self.rename_text.clear();
                true
            }
            NotebooksMessage::DeleteNotebook => {
                self.delete_notebook(db);
                true
            }
            NotebooksMessage::Editor(msg) => {
                self.editor.update(msg);
                true
            }
            NotebooksMessage::SaveNote => {
                self.save_current(db);
                self.refresh_notes(db);
                true
            }
        }
    }
}

// ---------------------------------------------------------------------------
// View functions
// ---------------------------------------------------------------------------

/// Build the full notebooks view: notebook list + note list + editor.
pub fn notebooks_view<'a>(
    state: &'a NotebooksViewState,
    theme: &Theme,
) -> Element<'a, NotebooksMessage> {
    let nb_sidebar = notebook_sidebar(state);
    let note_list = notebook_note_list(state);
    let editor_area = notebook_editor_area(state, theme);

    row![
        container(nb_sidebar).width(240).height(Fill),
        rule::vertical(1),
        container(note_list).width(260).height(Fill),
        rule::vertical(1),
        container(editor_area).width(Fill).height(Fill),
    ]
    .height(Fill)
    .into()
}

/// Left panel: notebook list with "New Notebook" button.
fn notebook_sidebar(state: &NotebooksViewState) -> Element<'_, NotebooksMessage> {
    let mut items: Vec<Element<'_, NotebooksMessage>> = Vec::new();

    items.push(
        container(
            button(text("+ New Notebook").size(13))
                .on_press(NotebooksMessage::NewNotebook)
                .padding([6, 12])
                .width(Fill)
                .style(button::primary),
        )
        .padding(iced::Padding::ZERO.top(8).right(8).bottom(4).left(8))
        .into(),
    );

    for (i, nb) in state.notebook_list.iter().enumerate() {
        let is_selected = state.selected_notebook == Some(i);
        let label = format!("{} ({})", nb.title, nb.note_count);

        let nb_btn = button(text(label).size(13))
            .on_press(NotebooksMessage::SelectNotebook(i))
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

        items.push(nb_btn.into());
    }

    if state.selected_notebook.is_some() {
        items.push(rule::horizontal(1).into());

        if state.renaming {
            items.push(
                container(
                    column![
                        text_input("New name...", &state.rename_text)
                            .on_input(NotebooksMessage::RenameNotebook)
                            .on_submit(NotebooksMessage::SubmitRename)
                            .padding(6)
                            .size(12),
                        row![
                            button(text("Save").size(11))
                                .on_press(NotebooksMessage::SubmitRename)
                                .padding([4, 8])
                                .style(button::primary),
                            button(text("Cancel").size(11))
                                .on_press(NotebooksMessage::CancelRename)
                                .padding([4, 8])
                                .style(button::secondary),
                        ]
                        .spacing(4),
                    ]
                    .spacing(4),
                )
                .padding(8)
                .into(),
            );
        } else {
            let rename_title = state
                .notebook_list
                .get(state.selected_notebook.unwrap_or(0))
                .map(|nb| nb.title.clone())
                .unwrap_or_default();

            items.push(
                container(
                    row![
                        button(text("Rename").size(11))
                            .on_press(NotebooksMessage::RenameNotebook(rename_title))
                            .padding([4, 8])
                            .style(button::secondary),
                        button(text("Delete").size(11))
                            .on_press(NotebooksMessage::DeleteNotebook)
                            .padding([4, 8])
                            .style(button::secondary),
                    ]
                    .spacing(4),
                )
                .padding(8)
                .into(),
            );
        }
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

/// Center panel: notes in the selected notebook.
fn notebook_note_list(state: &NotebooksViewState) -> Element<'_, NotebooksMessage> {
    if state.selected_notebook.is_none() {
        return container(
            text("Select a notebook to see its notes.")
                .size(13)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into();
    }

    let mut items: Vec<Element<'_, NotebooksMessage>> = Vec::new();

    items.push(
        container(
            button(text("+ New Note").size(13))
                .on_press(NotebooksMessage::NewNote)
                .padding([6, 12])
                .width(Fill)
                .style(button::primary),
        )
        .padding(iced::Padding::ZERO.top(8).right(8).bottom(4).left(8))
        .into(),
    );

    for (i, note) in state.note_list.iter().enumerate() {
        let is_selected = state.selected_note == Some(i);
        let mut label = String::new();
        if note.pinned {
            label.push_str("[pin] ");
        }
        label.push_str(&note.title);

        let note_btn = button(text(label).size(13))
            .on_press(NotebooksMessage::SelectNote(i))
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

    if state.note_list.is_empty() {
        items.push(
            container(
                text("No notes in this notebook yet.")
                    .size(12)
                    .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
            )
            .padding(12)
            .into(),
        );
    }

    let list_col = column(items).spacing(1);
    container(scrollable(list_col)).height(Fill).into()
}

/// Right panel: editor or placeholder.
fn notebook_editor_area<'a>(
    state: &'a NotebooksViewState,
    theme: &Theme,
) -> Element<'a, NotebooksMessage> {
    if state.selected_note.is_some() {
        let save_btn = container(
            row![
                space::horizontal(),
                button(text("Save").size(12))
                    .on_press(NotebooksMessage::SaveNote)
                    .padding([4, 16])
                    .style(button::primary),
            ]
            .align_y(Center)
            .padding([4, 8]),
        );

        column![
            save_btn,
            editor_view(&state.editor, theme, NotebooksMessage::Editor),
        ]
        .height(Fill)
        .into()
    } else {
        container(
            text("Select a note to start editing.")
                .size(14)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into()
    }
}
