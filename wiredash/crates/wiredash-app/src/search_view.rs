//! Search view — FTS5 full-text search across notes and content.

use iced::widget::{button, column, container, row, scrollable, text, text_input, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::content::Content;
use wiredash_core::collections::notes::Notes;
use wiredash_core::collections::search::Search;
use wiredash_db::Database;
use wiredash_editor::{editor_view, EditorMessage, EditorState};

pub struct SearchResult {
    pub note_id: String,
    pub title: String,
}

#[derive(Debug, Clone)]
pub enum SearchMessage {
    QueryChanged(String),
    ExecuteSearch,
    SelectResult(usize),
    Editor(EditorMessage),
    SaveNote,
}

pub struct SearchViewState {
    pub query: String,
    pub results: Vec<SearchResult>,
    pub selected_result: Option<usize>,
    pub editor: EditorState,
    pub db_content_id: Option<String>,
}

impl SearchViewState {
    pub fn new() -> Self {
        Self {
            query: String::new(),
            results: Vec::new(),
            selected_result: None,
            editor: EditorState::new(),
            db_content_id: None,
        }
    }

    /// Execute FTS search combining title and content matches.
    pub fn execute_search(&mut self, db: &Database) {
        if self.query.trim().is_empty() {
            self.results.clear();
            return;
        }

        let search = Search::new(db);
        let notes_col = Notes::new(db);

        // Collect matching note IDs from both title and content searches
        let mut note_ids: Vec<String> = Vec::new();

        if let Ok(ids) = search.search_notes(&self.query) {
            for id in ids {
                if !note_ids.contains(&id) {
                    note_ids.push(id);
                }
            }
        }

        if let Ok(ids) = search.search_content(&self.query) {
            for id in ids {
                if !note_ids.contains(&id) {
                    note_ids.push(id);
                }
            }
        }

        // Load note metadata for results
        self.results = note_ids
            .into_iter()
            .filter_map(|note_id| {
                notes_col.get(&note_id).ok().flatten().map(|note| SearchResult {
                    note_id: note.base.id,
                    title: if note.title.is_empty() {
                        "Untitled".to_string()
                    } else {
                        note.title
                    },
                })
            })
            .collect();

        // Clear selection when results change
        self.selected_result = None;
        self.editor = EditorState::new();
        self.db_content_id = None;
    }

    /// Load a search result's content into the editor.
    pub fn select_result(&mut self, index: usize, db: &Database) {
        let Some(result) = self.results.get(index) else {
            return;
        };
        let note_id = result.note_id.clone();

        match Content::new(db).find_by_note_id(&note_id) {
            Ok(Some(content_item)) => {
                let data = content_item.data.as_deref().unwrap_or("");
                self.editor = EditorState::with_content(data);
                self.editor.note_id = Some(note_id);
                self.db_content_id = Some(content_item.base.id);
                self.selected_result = Some(index);
            }
            Ok(None) => {
                self.editor = EditorState::new();
                self.editor.note_id = Some(note_id);
                self.db_content_id = None;
                self.selected_result = Some(index);
            }
            Err(e) => tracing::error!("Failed to load search result content: {e}"),
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

        // Index for FTS search
        let search = Search::new(db);
        if let Err(e) = search.index_note(note_id, &title) {
            tracing::warn!("FTS index note failed: {e}");
        }
        if let Err(e) = search.index_content(content_id, note_id, &editor_text) {
            tracing::warn!("FTS index content failed: {e}");
        }

        self.editor.mark_saved();

        // Update result title in list
        if let Some(idx) = self.selected_result {
            if let Some(result) = self.results.get_mut(idx) {
                result.title = if title.is_empty() {
                    "Untitled".to_string()
                } else {
                    title
                };
            }
        }
    }

    /// Process a SearchMessage. Returns true if the view needs a redraw.
    pub fn update(&mut self, message: SearchMessage, db: &Database) -> bool {
        match message {
            SearchMessage::QueryChanged(q) => {
                self.query = q;
                true
            }
            SearchMessage::ExecuteSearch => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.execute_search(db);
                true
            }
            SearchMessage::SelectResult(index) => {
                if self.editor.dirty {
                    self.save_current(db);
                }
                self.select_result(index, db);
                true
            }
            SearchMessage::Editor(msg) => {
                self.editor.update(msg);
                true
            }
            SearchMessage::SaveNote => {
                self.save_current(db);
                true
            }
        }
    }
}

// ---------------------------------------------------------------------------
// View functions
// ---------------------------------------------------------------------------

/// Build the full search view: search bar + results + editor.
pub fn search_view<'a>(
    state: &'a SearchViewState,
    theme: &Theme,
) -> Element<'a, SearchMessage> {
    let search_bar = container(
        text_input("Search notes and content...", &state.query)
            .on_input(SearchMessage::QueryChanged)
            .on_submit(SearchMessage::ExecuteSearch)
            .padding(10)
            .size(14),
    )
    .padding(8);

    let results_panel = search_results_list(state);
    let editor_area = search_editor_area(state, theme);

    column![
        search_bar,
        rule::horizontal(1),
        row![
            container(results_panel).width(320).height(Fill),
            rule::vertical(1),
            container(editor_area).width(Fill).height(Fill),
        ]
        .height(Fill),
    ]
    .height(Fill)
    .into()
}

/// Left panel: search results list.
fn search_results_list(state: &SearchViewState) -> Element<'_, SearchMessage> {
    if state.query.is_empty() {
        return container(
            text("Type a query and press Enter to search.")
                .size(13)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into();
    }

    if state.results.is_empty() {
        return container(
            text("No results found.")
                .size(13)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into();
    }

    let mut items: Vec<Element<'_, SearchMessage>> = Vec::new();

    items.push(
        container(
            text(format!(
                "{} result{}",
                state.results.len(),
                if state.results.len() == 1 { "" } else { "s" }
            ))
            .size(11)
            .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .padding([8, 12])
        .into(),
    );

    for (i, result) in state.results.iter().enumerate() {
        let is_selected = state.selected_result == Some(i);

        let result_btn = button(text(&result.title).size(13))
            .on_press(SearchMessage::SelectResult(i))
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

        items.push(result_btn.into());
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
fn search_editor_area<'a>(
    state: &'a SearchViewState,
    theme: &Theme,
) -> Element<'a, SearchMessage> {
    if state.selected_result.is_some() {
        let save_btn = container(
            row![
                space::horizontal(),
                button(text("Save").size(12))
                    .on_press(SearchMessage::SaveNote)
                    .padding([4, 16])
                    .style(button::primary),
            ]
            .align_y(Center)
            .padding([4, 8]),
        );

        column![
            save_btn,
            editor_view(&state.editor, theme, SearchMessage::Editor),
        ]
        .height(Fill)
        .into()
    } else {
        container(
            text("Select a search result to view and edit.")
                .size(14)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .center(Fill)
        .into()
    }
}
