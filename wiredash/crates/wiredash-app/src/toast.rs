//! Toast notification system adapted from iced official toast example.

use iced::widget::{button, column, container, row, text};
use iced::{Color, Element, Theme};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastStatus {
    Success,
    Warning,
    Error,
    Info,
}

impl ToastStatus {
    pub fn color(&self) -> Color {
        match self {
            Self::Success => Color::from_rgb8(0x28, 0xA7, 0x45),
            Self::Warning => Color::from_rgb8(0xFF, 0xA5, 0x00),
            Self::Error   => Color::from_rgb8(0xE0, 0x00, 0x00),
            Self::Info    => Color::from_rgb8(0x00, 0x7B, 0xFF),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Toast {
    pub title: String,
    pub status: ToastStatus,
}

pub struct ToastManager {
    toasts: Vec<(Toast, Instant)>,
    timeout: Duration,
}

impl ToastManager {
    pub fn new() -> Self {
        Self {
            toasts: Vec::new(),
            timeout: Duration::from_secs(4),
        }
    }

    pub fn push(&mut self, title: impl Into<String>, status: ToastStatus) {
        self.toasts.push((
            Toast { title: title.into(), status },
            Instant::now(),
        ));
    }

    /// Remove expired toasts. Returns true if any were removed.
    pub fn tick(&mut self) -> bool {
        let before = self.toasts.len();
        self.toasts.retain(|(_, created)| created.elapsed() < self.timeout);
        self.toasts.len() != before
    }

    pub fn dismiss(&mut self, index: usize) {
        if index < self.toasts.len() {
            self.toasts.remove(index);
        }
    }

    pub fn has_toasts(&self) -> bool {
        !self.toasts.is_empty()
    }

    pub fn view<'a, Message: Clone + 'a>(
        &'a self,
        on_dismiss: impl Fn(usize) -> Message + 'a,
    ) -> Element<'a, Message> {
        let toasts: Vec<Element<'a, Message>> = self.toasts.iter().enumerate().map(|(i, (toast, _))| {
            let dismiss_msg = on_dismiss(i);
            let status_color = toast.status.color();
            container(
                row![
                    text(&toast.title).size(13).color(Color::WHITE),
                    button(text("\u{00D7}").size(13).color(Color::WHITE))
                        .on_press(dismiss_msg)
                        .style(button::text)
                        .padding([2, 6]),
                ]
                .spacing(8)
                .align_y(iced::Center)
            )
            .padding([8, 12])
            .style(move |_theme: &Theme| {
                container::Style {
                    background: Some(iced::Background::Color(status_color)),
                    border: iced::Border {
                        radius: 6.0.into(),
                        ..Default::default()
                    },
                    ..Default::default()
                }
            })
            .into()
        }).collect();

        container(column(toasts).spacing(4))
            .padding(8)
            .into()
    }
}
