//! Editor view — combines toolbar, edit pane, preview pane, and status line.

use iced::widget::{column, container, markdown, row, scrollable, text, text_editor};
use iced::{Element, Fill, Theme};

use crate::editor::{EditorMessage, EditorMode, EditorState};
use crate::toolbar::{self, ToolbarAction};

/// Build the full editor view: toolbar + content area + status line.
///
/// The `map_msg` closure converts internal [`EditorMessage`]s into whatever
/// `Msg` the parent application expects. It must be `Copy` so it can be
/// threaded through multiple sub-widgets.
pub fn editor_view<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    theme: &Theme,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    // 1. Toolbar
    let toolbar = toolbar::toolbar_view(
        state.mode,
        move |action: ToolbarAction| map_msg(EditorMessage::InsertSnippet(action.snippet())),
        move |mode| map_msg(EditorMessage::SetMode(mode)),
    );

    // 2. Content area based on current mode
    let content_area: Element<'a, Msg> = match state.mode {
        EditorMode::Edit => edit_pane(state, map_msg),
        EditorMode::Preview => preview_pane(state, theme, map_msg),
        EditorMode::Split => split_pane(state, theme, map_msg),
    };

    // 3. Status line
    let dirty_indicator = if state.dirty { " [modified]" } else { "" };
    let status_text = format!("Mode: {}{}", state.mode.label(), dirty_indicator);

    let status_line = container(text(status_text).size(11))
        .width(Fill)
        .padding([2, 8])
        .style(|theme: &Theme| {
            let palette = theme.extended_palette();
            container::Style {
                background: Some(iced::Background::Color(
                    palette.background.weak.color,
                )),
                border: iced::Border {
                    width: 1.0,
                    color: palette.background.strong.color,
                    ..Default::default()
                },
                ..Default::default()
            }
        });

    column![toolbar, content_area, status_line]
        .height(Fill)
        .into()
}

/// The text-editing pane with syntax highlighting.
fn edit_pane<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    text_editor(&state.content)
        .placeholder("Start writing markdown...")
        .on_action(move |action| map_msg(EditorMessage::Edit(action)))
        .highlight("markdown", iced::highlighter::Theme::SolarizedDark)
        .padding(16)
        .height(Fill)
        .into()
}

/// The markdown preview pane, rendered from the parsed preview items.
fn preview_pane<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    theme: &Theme,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    if state.preview_items.is_empty() {
        return container(
            text("Nothing to preview. Start writing!")
                .size(14)
                .color(iced::Color::from_rgb(0.5, 0.5, 0.5)),
        )
        .width(Fill)
        .height(Fill)
        .padding(16)
        .center(Fill)
        .into();
    }

    let settings = markdown::Settings::from(theme);

    let md: Element<'a, markdown::Uri> =
        markdown::view(&state.preview_items, settings);

    let mapped: Element<'a, Msg> =
        md.map(move |url| map_msg(EditorMessage::LinkClicked(url)));

    scrollable(container(mapped).padding(16))
        .width(Fill)
        .height(Fill)
        .into()
}

/// Side-by-side split: edit on the left, preview on the right.
fn split_pane<'a, Msg: Clone + 'a>(
    state: &'a EditorState,
    theme: &Theme,
    map_msg: impl Fn(EditorMessage) -> Msg + Copy + 'a,
) -> Element<'a, Msg> {
    let left = container(edit_pane(state, map_msg))
        .width(Fill)
        .height(Fill)
        .style(|theme: &Theme| {
            let palette = theme.extended_palette();
            container::Style {
                border: iced::Border {
                    width: 0.0,
                    color: palette.background.strong.color,
                    ..Default::default()
                },
                ..Default::default()
            }
        });

    let right = container(preview_pane(state, theme, map_msg))
        .width(Fill)
        .height(Fill);

    row![left, right]
        .spacing(1)
        .height(Fill)
        .into()
}
