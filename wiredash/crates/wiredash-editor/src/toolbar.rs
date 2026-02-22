//! Editor toolbar — provides markdown formatting actions and mode toggling.

use crate::editor::EditorMode;
use iced::widget::{button, container, row, text, tooltip};
use iced::{Element, Fill, Theme};

/// A formatting or insertion action triggered from the toolbar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolbarAction {
    Bold,
    Italic,
    Strikethrough,
    Heading(u8),
    Link,
    Image,
    Code,
    CodeBlock,
    Quote,
    BulletList,
    NumberedList,
    HorizontalRule,
    Table,
}

impl ToolbarAction {
    /// Returns the markdown snippet to insert for this action.
    pub fn snippet(&self) -> String {
        match self {
            Self::Bold => "**bold**".into(),
            Self::Italic => "*italic*".into(),
            Self::Strikethrough => "~~strikethrough~~".into(),
            Self::Heading(level) => {
                let hashes = "#".repeat(*level as usize);
                format!("{} Heading\n", hashes)
            }
            Self::Link => "[link text](https://example.com)".into(),
            Self::Image => "![alt text](https://example.com/image.png)".into(),
            Self::Code => "`code`".into(),
            Self::CodeBlock => "```\ncode\n```\n".into(),
            Self::Quote => "> quote\n".into(),
            Self::BulletList => "- item 1\n- item 2\n- item 3\n".into(),
            Self::NumberedList => "1. item 1\n2. item 2\n3. item 3\n".into(),
            Self::HorizontalRule => "\n---\n".into(),
            Self::Table => "| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n".into(),
        }
    }

    /// Short label for the toolbar button.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Bold => "B",
            Self::Italic => "I",
            Self::Strikethrough => "S",
            Self::Heading(1) => "H1",
            Self::Heading(2) => "H2",
            Self::Heading(3) => "H3",
            Self::Heading(_) => "H",
            Self::Link => "🔗",
            Self::Image => "🖼",
            Self::Code => "<>",
            Self::CodeBlock => "{ }",
            Self::Quote => "❝",
            Self::BulletList => "•",
            Self::NumberedList => "1.",
            Self::HorizontalRule => "—",
            Self::Table => "⊞",
        }
    }

    /// Descriptive tooltip text for the toolbar button.
    pub fn tooltip_text(&self) -> &'static str {
        match self {
            Self::Bold => "Bold",
            Self::Italic => "Italic",
            Self::Strikethrough => "Strikethrough",
            Self::Heading(1) => "Heading 1",
            Self::Heading(2) => "Heading 2",
            Self::Heading(3) => "Heading 3",
            Self::Heading(_) => "Heading",
            Self::Link => "Insert Link",
            Self::Image => "Insert Image",
            Self::Code => "Inline Code",
            Self::CodeBlock => "Code Block",
            Self::Quote => "Blockquote",
            Self::BulletList => "Bullet List",
            Self::NumberedList => "Numbered List",
            Self::HorizontalRule => "Horizontal Rule",
            Self::Table => "Insert Table",
        }
    }
}

/// The default set of toolbar actions, presented left-to-right.
pub fn toolbar_actions() -> Vec<ToolbarAction> {
    vec![
        ToolbarAction::Bold,
        ToolbarAction::Italic,
        ToolbarAction::Strikethrough,
        ToolbarAction::Heading(1),
        ToolbarAction::Heading(2),
        ToolbarAction::Heading(3),
        ToolbarAction::Link,
        ToolbarAction::Image,
        ToolbarAction::Code,
        ToolbarAction::CodeBlock,
        ToolbarAction::Quote,
        ToolbarAction::BulletList,
        ToolbarAction::NumberedList,
        ToolbarAction::HorizontalRule,
        ToolbarAction::Table,
    ]
}

/// A constant-style accessor for the toolbar actions (returns a static slice).
pub static TOOLBAR_ACTIONS: &[&str] = &[
    "Bold", "Italic", "Strikethrough", "H1", "H2", "H3",
    "Link", "Image", "Code", "CodeBlock", "Quote",
    "BulletList", "NumberedList", "HorizontalRule", "Table",
];

/// Build the toolbar view: a horizontal row of formatting buttons + mode toggle.
pub fn toolbar_view<'a, Msg: Clone + 'a>(
    current_mode: EditorMode,
    on_action: impl Fn(ToolbarAction) -> Msg + 'a,
    on_mode: impl Fn(EditorMode) -> Msg + 'a,
) -> Element<'a, Msg> {
    let actions = toolbar_actions();
    let mut items: Vec<Element<'a, Msg>> = Vec::with_capacity(actions.len() + 4);

    for action in actions {
        let tip = action.tooltip_text();
        let label = action.label();
        let msg = on_action(action);

        let btn = button(
            text(label).size(12),
        )
        .on_press(msg)
        .padding([4, 6])
        .style(button::text);

        items.push(
            tooltip(btn, tip, tooltip::Position::Bottom)
                .gap(4)
                .into(),
        );
    }

    // Separator before mode toggle
    items.push(
        container(text("│").size(14))
            .padding([0, 4])
            .into(),
    );

    // Mode toggle buttons
    for mode in [EditorMode::Edit, EditorMode::Split, EditorMode::Preview] {
        let is_active = mode == current_mode;
        let mode_msg = on_mode(mode);

        let btn = button(
            text(mode.label()).size(11),
        )
        .on_press(mode_msg)
        .padding([4, 8])
        .style(move |theme: &Theme, status| {
            let mut style = button::text(theme, status);
            if is_active {
                style.background = Some(iced::Background::Color(
                    iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.15),
                ));
                style.text_color = iced::Color::from_rgb8(0xE0, 0x00, 0x00);
            }
            style
        });

        items.push(btn.into());
    }

    container(
        row(items)
            .spacing(2)
            .align_y(iced::Center),
    )
    .width(Fill)
    .padding([4, 8])
    .style(|theme: &Theme| {
        let palette = theme.extended_palette();
        container::Style {
            background: Some(iced::Background::Color(palette.background.weak.color)),
            border: iced::Border {
                width: 1.0,
                color: palette.background.strong.color,
                ..Default::default()
            },
            ..Default::default()
        }
    })
    .into()
}
