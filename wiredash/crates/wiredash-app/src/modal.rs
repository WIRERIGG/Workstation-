#![allow(dead_code)]
//! Reusable modal dialog overlay using iced Stack + opaque + mouse_area.

use iced::widget::{center, column, container, mouse_area, opaque, row, stack, text, Space};
use iced::{Color, Element, Theme};

/// Wrap `base` content with a modal overlay showing `dialog`.
/// Clicking the backdrop fires `on_blur`.
pub fn modal<'a, Message: Clone + 'a>(
    base: impl Into<Element<'a, Message>>,
    dialog: impl Into<Element<'a, Message>>,
    on_blur: Message,
) -> Element<'a, Message> {
    stack![
        base.into(),
        opaque(
            mouse_area(
                center(
                    opaque(dialog)
                ).style(|_theme: &Theme| {
                    container::Style {
                        background: Some(iced::Background::Color(
                            Color { a: 0.6, ..Color::BLACK },
                        )),
                        ..Default::default()
                    }
                })
            )
            .on_press(on_blur)
        )
    ]
    .into()
}

/// A styled dialog card with title, body content, and action buttons.
pub fn dialog_card<'a, Message: 'a>(
    title_text: &str,
    body: impl Into<Element<'a, Message>>,
    actions: Vec<Element<'a, Message>>,
) -> Element<'a, Message> {
    let header = text(title_text.to_owned()).size(18);
    let action_row: Element<'a, Message> = row(actions).spacing(8).into();

    container(
        column![
            header,
            iced::widget::rule::horizontal(1),
            body.into(),
            Space::new().height(8),
            action_row,
        ]
        .spacing(12)
        .width(400)
    )
    .padding(20)
    .style(|theme: &Theme| {
        let palette = theme.extended_palette();
        container::Style {
            background: Some(iced::Background::Color(palette.background.base.color)),
            border: iced::Border {
                width: 1.0,
                color: palette.background.strong.color,
                radius: 8.0.into(),
            },
            shadow: iced::Shadow {
                color: Color { a: 0.3, ..Color::BLACK },
                offset: iced::Vector::new(0.0, 4.0),
                blur_radius: 12.0,
            },
            ..Default::default()
        }
    })
    .into()
}
