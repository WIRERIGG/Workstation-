mod navigation;
mod icons;
mod config;
mod notes_view;
mod notebooks_view;
mod tags_view;

use iced::{Element, Task, Theme, Size, Subscription, Fill, Center};
use iced::widget::{container, text, column, row, scrollable, button, rule, space};
use iced::keyboard;
use navigation::{View, Section};
use wiredash_theme::ThemeEngine;

fn main() -> iced::Result {
    tracing_subscriber::fmt::init();

    iced::application(Wiredash::new, Wiredash::update, Wiredash::view)
        .title(Wiredash::title)
        .theme(Wiredash::theme)
        .subscription(Wiredash::subscription)
        .window_size(Size::new(1200.0, 800.0))
        .centered()
        .run()
}

struct Wiredash {
    current_view: View,
    sidebar_collapsed: bool,
    theme_engine: ThemeEngine,
    db: wiredash_db::Database,
    notes_state: notes_view::NotesViewState,
    notebooks_state: notebooks_view::NotebooksViewState,
    tags_state: tags_view::TagsViewState,
    save_pending: bool,
}

#[derive(Debug, Clone)]
enum Message {
    Navigate(View),
    ToggleSidebar,
    ToggleTheme,
    KeyboardEvent(keyboard::Event),
    Notes(notes_view::NotesMessage),
    Notebooks(notebooks_view::NotebooksMessage),
    Tags(tags_view::TagsMessage),
    AutoSaveTick,
}

impl Wiredash {
    fn new() -> (Self, Task<Message>) {
        let cfg = config::AppConfig::load();
        let mut theme_engine = ThemeEngine::new();

        if cfg.follow_system_theme {
            let system_scheme = match dark_light::detect() {
                dark_light::Mode::Dark => wiredash_theme::ColorScheme::Dark,
                dark_light::Mode::Light | dark_light::Mode::Default => wiredash_theme::ColorScheme::Light,
            };
            theme_engine.set_scheme(system_scheme);
            theme_engine.follow_system = true;
        } else {
            theme_engine.set_scheme(cfg.color_scheme);
        }

        // Open database
        let db_dir = config::AppConfig::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let _ = std::fs::create_dir_all(&db_dir);
        let db_path = db_dir.join("wiredash.db");
        let db_path_str = db_path.to_string_lossy();
        let db = wiredash_db::Database::open(
            &db_path_str,
            None,
        ).expect("Failed to open database — check disk permissions and free space");

        let mut notes_state = notes_view::NotesViewState::new();
        notes_state.refresh_list(&db);
        let mut notebooks_state = notebooks_view::NotebooksViewState::new();
        notebooks_state.refresh_notebooks(&db);
        let mut tags_state = tags_view::TagsViewState::new();
        tags_state.refresh_tags(&db);

        (
            Self {
                current_view: cfg.resolve_view(),
                sidebar_collapsed: cfg.sidebar_collapsed,
                theme_engine,
                db,
                notes_state,
                notebooks_state,
                tags_state,
                save_pending: false,
            },
            Task::none(),
        )
    }

    fn title(&self) -> String {
        format!("Wiredash — {}", self.current_view.title())
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        let mut state_changed = false;
        match message {
            Message::Navigate(view) => {
                self.current_view = view;
                state_changed = true;
            }
            Message::ToggleSidebar => {
                self.sidebar_collapsed = !self.sidebar_collapsed;
                state_changed = true;
            }
            Message::ToggleTheme => {
                self.theme_engine.toggle_scheme();
                state_changed = true;
            }
            Message::Notes(msg) => {
                let changed = self.notes_state.update(msg, &self.db);
                if changed && self.notes_state.editor.dirty {
                    self.save_pending = true;
                }
            }
            Message::Notebooks(msg) => {
                let changed = self.notebooks_state.update(msg, &self.db);
                if changed && self.notebooks_state.editor.dirty {
                    self.save_pending = true;
                }
            }
            Message::Tags(msg) => {
                let changed = self.tags_state.update(msg, &self.db);
                if changed && self.tags_state.editor.dirty {
                    self.save_pending = true;
                }
            }
            Message::AutoSaveTick => {
                if self.save_pending && self.notes_state.editor.dirty {
                    self.notes_state.save_current(&self.db);
                    self.save_pending = false;
                }
                if self.save_pending && self.notebooks_state.editor.dirty {
                    self.notebooks_state.save_current(&self.db);
                    self.save_pending = false;
                }
                if self.save_pending && self.tags_state.editor.dirty {
                    self.tags_state.save_current(&self.db);
                    self.save_pending = false;
                }
            }
            Message::KeyboardEvent(event) => {
                if let keyboard::Event::KeyPressed { key, modifiers, .. } = event {
                    if modifiers.command() {
                        match key.as_ref() {
                            keyboard::Key::Character("s") => {
                                if self.notes_state.editor.dirty {
                                    self.notes_state.save_current(&self.db);
                                    self.save_pending = false;
                                    state_changed = true;
                                }
                                if self.notebooks_state.editor.dirty {
                                    self.notebooks_state.save_current(&self.db);
                                    self.save_pending = false;
                                    state_changed = true;
                                }
                                if self.tags_state.editor.dirty {
                                    self.tags_state.save_current(&self.db);
                                    self.save_pending = false;
                                    state_changed = true;
                                }
                            }
                            keyboard::Key::Character("b") => {
                                self.sidebar_collapsed = !self.sidebar_collapsed;
                                state_changed = true;
                            }
                            keyboard::Key::Character(c) => {
                                if modifiers.shift() && c == "T" {
                                    self.theme_engine.toggle_scheme();
                                    state_changed = true;
                                } else if c.len() == 1 {
                                    if let Some(digit) = c.chars().next().and_then(|ch| ch.to_digit(10)) {
                                        if (1..=9).contains(&digit) {
                                            let idx = (digit - 1) as usize;
                                            if let Some(view) = View::ALL.get(idx) {
                                                self.current_view = *view;
                                                state_changed = true;
                                            }
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        if state_changed {
            self.save_config();
        }
        Task::none()
    }

    fn save_config(&self) {
        let cfg = config::AppConfig {
            last_view: self.current_view.title().into(),
            sidebar_collapsed: self.sidebar_collapsed,
            color_scheme: self.theme_engine.active_definition().color_scheme,
            follow_system_theme: self.theme_engine.follow_system,
        };
        cfg.save();
    }

    fn view(&self) -> Element<'_, Message> {
        let sidebar_width: f32 = if self.sidebar_collapsed { 50.0 } else { 240.0 };

        let sidebar = self.sidebar_view();
        let content = self.content_view();
        let status_bar = self.status_bar_view();

        column![
            row![
                container(sidebar)
                    .width(sidebar_width)
                    .height(Fill),
                container(content)
                    .width(Fill)
                    .height(Fill),
            ]
            .height(Fill),
            status_bar,
        ]
        .into()
    }

    fn theme(&self) -> Theme {
        self.theme_engine.active_iced_theme()
    }

    fn subscription(&self) -> Subscription<Message> {
        let keyboard_sub = keyboard::listen().map(Message::KeyboardEvent);
        if self.save_pending {
            let save_sub = iced::time::every(std::time::Duration::from_secs(2))
                .map(|_| Message::AutoSaveTick);
            Subscription::batch([keyboard_sub, save_sub])
        } else {
            keyboard_sub
        }
    }

    fn sidebar_view(&self) -> Element<'_, Message> {
        let mut sidebar_items: Vec<Element<'_, Message>> = Vec::new();
        let theme_def = self.theme_engine.active_definition();
        let nav = theme_def.nav_colors();

        // Logo header (click to toggle sidebar)
        if self.sidebar_collapsed {
            sidebar_items.push(
                container(
                    button(text("W").size(20))
                        .on_press(Message::ToggleSidebar)
                        .style(button::text)
                        .width(Fill),
                )
                    .padding(10)
                    .center_x(Fill)
                    .into(),
            );
        } else {
            sidebar_items.push(
                container(
                    button(text("Wiredash").size(18))
                        .on_press(Message::ToggleSidebar)
                        .style(button::text)
                        .width(Fill),
                )
                    .padding([12, 16])
                    .into(),
            );
        }

        // Sections with route items
        for section in Section::ALL {
            if !self.sidebar_collapsed {
                sidebar_items.push(
                    container(
                        text(section.label())
                            .size(10)
                            .color(nav.placeholder_color())
                    )
                    .padding(iced::Padding::ZERO.top(12).right(16).bottom(4).left(16))
                    .into(),
                );
            }

            for view in View::for_section(*section) {
                let is_selected = view == self.current_view;
                let label = if self.sidebar_collapsed {
                    text(view.icon()).size(16)
                } else {
                    text(format!("  {}  {}", view.icon(), view.title())).size(13)
                };

                let btn = button(label)
                    .on_press(Message::Navigate(view))
                    .padding(if self.sidebar_collapsed { [8, 4] } else { [6, 12] })
                    .width(Fill)
                    .style(move |theme: &Theme, status| {
                        let mut style = button::text(theme, status);
                        if is_selected {
                            style.background = Some(iced::Background::Color(
                                iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.1),
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

                sidebar_items.push(btn.into());
            }
        }

        // Theme toggle at bottom
        let theme_label = if self.sidebar_collapsed { "◑" } else { "◑ Toggle Theme" };
        sidebar_items.push(
            container(
                button(text(theme_label).size(12))
                    .on_press(Message::ToggleTheme)
                    .padding([6, 12])
                    .width(Fill)
                    .style(button::text),
            )
            .padding([8, 0])
            .into(),
        );

        let sidebar_col = column(sidebar_items).spacing(1);

        container(scrollable(sidebar_col))
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
            .height(Fill)
            .into()
    }

    fn content_view(&self) -> Element<'_, Message> {
        match self.current_view {
            View::Notes => {
                notes_view::notes_view(&self.notes_state, &self.theme_engine.active_iced_theme())
                    .map(Message::Notes)
            }
            View::Notebooks => {
                notebooks_view::notebooks_view(&self.notebooks_state, &self.theme_engine.active_iced_theme())
                    .map(Message::Notebooks)
            }
            View::Tags => {
                tags_view::tags_view(&self.tags_state, &self.theme_engine.active_iced_theme())
                    .map(Message::Tags)
            }
            view => {
                container(
                    column![
                        text(format!("{} {}", view.icon(), view.title())).size(28),
                        rule::horizontal(1),
                        text(view.description()).size(14),
                        text("").size(8),
                        text("This view will be implemented in a future phase.").size(12),
                    ]
                    .spacing(8)
                )
                .padding(24)
                .width(Fill)
                .height(Fill)
                .into()
            }
        }
    }

    fn status_bar_view(&self) -> Element<'_, Message> {
        let scheme_label = match self.theme_engine.active_definition().color_scheme {
            wiredash_theme::ColorScheme::Light => "Light",
            wiredash_theme::ColorScheme::Dark => "Dark",
        };

        container(
            row![
                text(format!("  {}", self.current_view.title())).size(11),
                space::horizontal(),
                text(format!("Theme: {}  ", scheme_label)).size(11),
            ]
            .align_y(Center)
        )
        .style(|theme: &Theme| {
            let palette = theme.extended_palette();
            container::Style {
                background: Some(iced::Background::Color(palette.background.strong.color)),
                ..Default::default()
            }
        })
        .height(24)
        .width(Fill)
        .into()
    }
}
