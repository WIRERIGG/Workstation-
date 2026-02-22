//! Tags view -- list tags, show notes with selected tag, edit.

use iced::widget::{button, column, container, row, scrollable, text, text_input, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::content::Content;
use wiredash_core::collections::tags::Tags;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::relations::Relations;
use wiredash_core::types::Tag;
use wiredash_db::Database;
use wiredash_editor::{editor_view, EditorMessage, EditorState};

/// Lightweight summary of a tag for the sidebar list.
pub struct TagSummary {
    pub id: String,
    pub title: String,
    pub note_count: usize,
}

/// Lightweight summary of a note linked to a tag.
pub struct NoteSummary {
    pub id: String,
    pub title: String,
}

/// Messages produced by the tags view.
#[derive(Debug, Clone)]
pub enum TagsMessage {
    SelectTag(usize),
    SelectNote(usize),
    NewTag,
    RenameTag(String),
    SubmitRename,
    CancelRename,
    DeleteTag,
    Editor(EditorMessage),
    SaveNote,
}

pub struct TagsViewState {
    pub tag_list: Vec<TagSummary>,
    pub selected_tag: Option<usize>,
    pub note_list: Vec<NoteSummary>,
    pub selected_note: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
    pub renaming: bool,
    pub rename_text: String,
}

impl TagsViewState {
    pub fn new() -> Self {
        Self {
            tag_list: Vec::new(),
            selected_tag: None,
            note_list: Vec::new(),
            selected_note: None,
            editor: EditorState::new(),
            db_content_id: None,
            renaming: false,
            rename_text: String::new(),
        }
    }

    /// Reload tag list from DB, counting notes per tag via Relations.
    pub fn refresh_tags(&mut self, db: &Database) {
        match Tags::new(db).list() {
            Ok(tags) => {
                let relations = Relations::new(db);
                self.tag_list = tags
                    .into_iter()
                    .map(|tag| {
                        let count = relations
                            .to_ids("note", "tag", &tag.base.id)
                            .map(|ids| ids.len())
                            .unwrap_or(0);
                        TagSummary {
                            id: tag.base.id,
                            title: if tag.title.is_empty() {
                                "Untitled".to_string()
                            } else {
                                tag.title
                            },
                            note_count: count,
                        }
                    })
                    .collect();
            }
            Err(e) => tracing::error!("Failed to load tags: {e}"),
        }
    }

    /// Reload notes for the currently selected tag.
    pub fn refresh_notes(&mut self, db: &Database) {
        let Some(idx) = self.selected_tag else {
            self.note_list.clear();
            return;
        };
        let Some(tag) = self.tag_list.get(idx) else {
            self.note_list.clear();
            return;
        };
        let tag_id = tag.id.clone();

        match Relations::new(db).to_ids("note", "tag", &tag_id) {
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
                        })
                        .collect();
                }
                Err(e) => tracing::error!("Failed to load notes for tag: {e}"),
            },
            Err(e) => tracing::error!("Failed to load tag relations: {e}"),
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

    /// Create a new tag (no note or content creation).
    pub fn create_tag(&mut self, db: &Database) {
        let tag = Tag::new("New Tag");
        if let Err(e) = Tags::new(db).add(&tag) {
            tracing::error!("Failed to create tag: {e}");
            return;
        }
        self.refresh_tags(db);
        if let Some(idx) = self.tag_list.iter().position(|t| t.id == tag.base.id) {
            self.selected_tag = Some(idx);
            self.refresh_notes(db);
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

        // Index for FTS search
        let search = wiredash_core::collections::search::Search::new(db);
        if let Err(e) = search.index_note(&note_id, &title) {
            tracing::warn!("FTS index note failed: {e}");
        }
        if let Err(e) = search.index_content(&content_id, &note_id, &editor_text) {
            tracing::warn!("FTS index content failed: {e}");
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

    /// Delete the selected tag. Hard delete (tags have no trash).
    pub fn delete_tag(&mut self, db: &Database) {
        let Some(idx) = self.selected_tag else {
            return;
        };
        let Some(tag) = self.tag_list.get(idx) else {
            return;
        };
        let tag_id = tag.id.clone();

        if let Err(e) = Relations::new(db).unlink_all_to("tag", &tag_id) {
            tracing::error!("Failed to unlink tag relations: {e}");
        }
        if let Err(e) = Tags::new(db).remove(&tag_id) {
            tracing::error!("Failed to delete tag: {e}");
            return;
        }

        self.selected_tag = None;
        self.note_list.clear();
        self.selected_note = None;
        self.editor = EditorState::new();
        self.db_content_id = None;
        self.refresh_tags(db);
    }

    /// Process a TagsMessage. Returns true if the view changed.
    pub fn update(&mut self, message: TagsMessage, db: &Database) -> bool {
        match message {
            TagsMessage::SelectTag(index) => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.selected_tag = Some(index);
                self.selected_note = None;
                self.editor = EditorState::new();
                self.db_content_id = None;
                self.refresh_notes(db);
                true
            }
            TagsMessage::SelectNote(index) => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.load_note(index, db);
                true
            }
            TagsMessage::NewTag => {
                self.create_tag(db);
                true
            }
            TagsMessage::RenameTag(new_text) => {
                if !self.renaming {
                    self.renaming = true;
                    self.rename_text = new_text;
                } else {
                    self.rename_text = new_text;
                }
                true
            }
            TagsMessage::SubmitRename => {
                if let Some(idx) = self.selected_tag {
                    if let Some(tag) = self.tag_list.get(idx) {
                        let id = tag.id.clone();
                        let new_title = self.rename_text.clone();
                        if let Err(e) = Tags::new(db).update_title(&id, &new_title) {
                            tracing::error!("Failed to rename tag: {e}");
                        }
                    }
                }
                self.renaming = false;
                self.rename_text.clear();
                self.refresh_tags(db);
                true
            }
            TagsMessage::CancelRename => {
                self.renaming = false;
                self.rename_text.clear();
                true
            }
            TagsMessage::DeleteTag => {
                self.delete_tag(db);
                true
            }
            TagsMessage::Editor(msg) => {
                self.editor.update(msg);
                true
            }
            TagsMessage::SaveNote => {
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

/// Build the full tags view: tag list + note list + editor.
pub fn tags_view<'a>(
    state: &'a TagsViewState,
    theme: &Theme,
) -> Element<'a, TagsMessage> {
    let tag_sidebar_el = tag_sidebar(state);
    let note_list = tag_note_list(state);
    let editor_area = tag_editor_area(state, theme);

    row![
        container(tag_sidebar_el).width(220).height(Fill),
        rule::vertical(1),
        container(note_list).width(280).height(Fill),
        rule::vertical(1),
        container(editor_area).width(Fill).height(Fill),
    ]
    .height(Fill)
    .into()
}

/// Left panel: tag list with "New Tag" button.
fn tag_sidebar(state: &TagsViewState) -> Element<'_, TagsMessage> {
    let mut items: Vec<Element<'_, TagsMessage>> = Vec::new();

    items.push(
        container(
            button(text("+ New Tag").size(13))
                .on_press(TagsMessage::NewTag)
                .padding([6, 12])
                .width(Fill)
                .style(button::primary),
        )
        .padding(iced::Padding::ZERO.top(8).right(8).bottom(4).left(8))
        .into(),
    );

    for (i, tag) in state.tag_list.iter().enumerate() {
        let is_selected = state.selected_tag == Some(i);
        let label = format!("{} ({})", tag.title, tag.note_count);

        let tag_btn = button(text(label).size(13))
            .on_press(TagsMessage::SelectTag(i))
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

        items.push(tag_btn.into());
    }

    if state.selected_tag.is_some() {
        items.push(rule::horizontal(1).into());

        if state.renaming {
            items.push(
                container(
                    column![
                        text_input("New name...", &state.rename_text)
                            .on_input(TagsMessage::RenameTag)
                            .on_submit(TagsMessage::SubmitRename)
                            .padding(6)
                            .size(12),
                        row![
                            button(text("Save").size(11))
                                .on_press(TagsMessage::SubmitRename)
                                .padding([4, 8])
                                .style(button::primary),
                            button(text("Cancel").size(11))
                                .on_press(TagsMessage::CancelRename)
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
                .tag_list
                .get(state.selected_tag.unwrap_or(0))
                .map(|t| t.title.clone())
                .unwrap_or_default();

            items.push(
                container(
                    row![
                        button(text("Rename").size(11))
                            .on_press(TagsMessage::RenameTag(rename_title))
                            .padding([4, 8])
                            .style(button::secondary),
                        button(text("Delete").size(11))
                            .on_press(TagsMessage::DeleteTag)
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

/// Center panel: notes linked to the selected tag.
fn tag_note_list(state: &TagsViewState) -> Element<'_, TagsMessage> {
    if state.selected_tag.is_none() {
        return container(
            text("Select a tag to see its notes.")
                .size(13)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into();
    }

    let mut items: Vec<Element<'_, TagsMessage>> = Vec::new();

    for (i, note) in state.note_list.iter().enumerate() {
        let is_selected = state.selected_note == Some(i);
        let label = note.title.clone();

        let note_btn = button(text(label).size(13))
            .on_press(TagsMessage::SelectNote(i))
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
                text("No notes with this tag yet.")
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
fn tag_editor_area<'a>(
    state: &'a TagsViewState,
    theme: &Theme,
) -> Element<'a, TagsMessage> {
    if state.selected_note.is_some() {
        let save_btn = container(
            row![
                space::horizontal(),
                button(text("Save").size(12))
                    .on_press(TagsMessage::SaveNote)
                    .padding([4, 16])
                    .style(button::primary),
            ]
            .align_y(Center)
            .padding([4, 8]),
        );

        column![
            save_btn,
            editor_view(&state.editor, theme, TagsMessage::Editor),
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
