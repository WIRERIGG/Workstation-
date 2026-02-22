mod navigation;
mod icons;
mod config;
mod notes_view;
mod notebooks_view;
mod tags_view;
mod search_view;
mod organize_views;
mod modal;
mod toast;
mod settings_view;
mod app_lock;
mod vault;
mod reminders_view;
mod dashboard_view;
mod tasks_view;
mod calendar_view;
mod agents_view;

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
    search_state: search_view::SearchViewState,
    favorites_state: organize_views::FilteredNotesState,
    archive_state: organize_views::FilteredNotesState,
    trash_state: organize_views::FilteredNotesState,
    settings_state: settings_view::SettingsViewState,
    app_lock_state: app_lock::AppLockState,
    reminders_state: reminders_view::RemindersViewState,
    dashboard_state: dashboard_view::DashboardViewState,
    tasks_state: tasks_view::TasksViewState,
    calendar_state: calendar_view::CalendarViewState,
    agents_state: agents_view::AgentsViewState,
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
    SearchView(search_view::SearchMessage),
    Favorites(organize_views::FilteredNotesMessage),
    ArchiveView(organize_views::FilteredNotesMessage),
    TrashView(organize_views::FilteredNotesMessage),
    SettingsView(settings_view::SettingsMessage),
    AutoSaveTick,
    AppLock(app_lock::AppLockMessage),
    InactivityCheck,
    RemindersView(reminders_view::RemindersMessage),
    DashboardView(dashboard_view::DashboardMessage),
    TasksView(tasks_view::TasksMessage),
    CalendarView(calendar_view::CalendarMessage),
    AgentsView(agents_view::AgentsMessage),
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

        // Open database (LanceDB — directory-based)
        let db_dir = config::AppConfig::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let _ = std::fs::create_dir_all(&db_dir);
        let db_path = db_dir.join("wiredash.lance");
        let db_path_str = db_path.to_string_lossy();
        let db = wiredash_db::sync_run(
            wiredash_db::Database::open(&db_path_str)
        ).expect("Failed to open database — check disk permissions and free space");

        let mut notes_state = notes_view::NotesViewState::new();
        notes_state.refresh_list(&db);
        let mut notebooks_state = notebooks_view::NotebooksViewState::new();
        notebooks_state.refresh_notebooks(&db);
        let mut tags_state = tags_view::TagsViewState::new();
        let search_state = search_view::SearchViewState::new();
        tags_state.refresh_tags(&db);
        let mut favorites_state = organize_views::FilteredNotesState::new();
        favorites_state.refresh(&db, organize_views::NoteFilter::Favorites);
        let mut archive_state = organize_views::FilteredNotesState::new();
        archive_state.refresh(&db, organize_views::NoteFilter::Archived);
        let mut trash_state = organize_views::FilteredNotesState::new();
        trash_state.refresh(&db, organize_views::NoteFilter::Trashed);
        let mut settings_state = settings_view::SettingsViewState::new();
        settings_state.load_all(&db);

        let app_lock_enabled = {
            let settings = wiredash_core::collections::settings::Settings::new(&db);
            settings.get_setting("app_lock_enabled").ok().flatten()
                .and_then(|v: serde_json::Value| v.as_bool())
                .unwrap_or(false)
        };
        let app_lock_state = app_lock::AppLockState::new(app_lock_enabled);

        let mut reminders_state = reminders_view::RemindersViewState::new();
        reminders_state.refresh(&db);

        let mut dashboard_state = dashboard_view::DashboardViewState::new();
        dashboard_state.refresh(&db);
        let mut tasks_state = tasks_view::TasksViewState::new();
        tasks_state.refresh(&db);
        let mut calendar_state = calendar_view::CalendarViewState::new();
        calendar_state.refresh(&db);
        let mut agents_state = agents_view::AgentsViewState::new();
        agents_state.refresh(&db);

        (
            Self {
                current_view: cfg.resolve_view(),
                sidebar_collapsed: cfg.sidebar_collapsed,
                theme_engine,
                db,
                notes_state,
                notebooks_state,
                tags_state,
                search_state,
                favorites_state,
                archive_state,
                trash_state,
                settings_state,
                app_lock_state,
                reminders_state,
                dashboard_state,
                tasks_state,
                calendar_state,
                agents_state,
                save_pending: false,
            },
            Task::none(),
        )
    }

    fn title(&self) -> String {
        format!("Wiredash — {}", self.current_view.title())
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        // Record user activity for inactivity timer
        if !matches!(message, Message::AutoSaveTick | Message::InactivityCheck) {
            self.app_lock_state.record_activity();
        }

        let mut state_changed = false;
        match message {
            Message::Navigate(view) => {
                // Save any dirty editor before switching away
                self.save_all_dirty();

                // Refresh the target view's data
                match view {
                    View::Notes => self.notes_state.refresh_list(&self.db),
                    View::Notebooks => self.notebooks_state.refresh_notebooks(&self.db),
                    View::Tags => self.tags_state.refresh_tags(&self.db),
                    View::Favorites => self.favorites_state.refresh(&self.db, organize_views::NoteFilter::Favorites),
                    View::Archive => self.archive_state.refresh(&self.db, organize_views::NoteFilter::Archived),
                    View::Trash => self.trash_state.refresh(&self.db, organize_views::NoteFilter::Trashed),
                    View::Settings => self.settings_state.load_all(&self.db),
                    View::Reminders => self.reminders_state.refresh(&self.db),
                    View::Dashboard => self.dashboard_state.refresh(&self.db),
                    View::Tasks => self.tasks_state.refresh(&self.db),
                    View::Calendar => self.calendar_state.refresh(&self.db),
                    View::Agents => self.agents_state.refresh(&self.db),
                    _ => {} // Search etc. don't need refresh
                }

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
            Message::SearchView(msg) => {
                let changed = self.search_state.update(msg, &self.db);
                if changed && self.search_state.editor.dirty {
                    self.save_pending = true;
                }
            }
            Message::Favorites(msg) => {
                let changed = self.favorites_state.update(msg, &self.db, organize_views::NoteFilter::Favorites);
                if changed && self.favorites_state.editor.dirty {
                    self.save_pending = true;
                }
            }
            Message::ArchiveView(msg) => {
                let changed = self.archive_state.update(msg, &self.db, organize_views::NoteFilter::Archived);
                if changed && self.archive_state.editor.dirty {
                    self.save_pending = true;
                }
            }
            Message::TrashView(msg) => {
                let changed = self.trash_state.update(msg, &self.db, organize_views::NoteFilter::Trashed);
                if changed && self.trash_state.editor.dirty {
                    self.save_pending = true;
                }
            }
            Message::SettingsView(msg) => {
                // Apply theme setting immediately
                if let settings_view::SettingsMessage::SetValue(ref key, ref value) = msg {
                    if key == "theme_scheme" {
                        if let Some(scheme_str) = value.as_str() {
                            match scheme_str {
                                "Light" => {
                                    self.theme_engine.follow_system = false;
                                    self.theme_engine.set_scheme(wiredash_theme::ColorScheme::Light);
                                }
                                "Dark" => {
                                    self.theme_engine.follow_system = false;
                                    self.theme_engine.set_scheme(wiredash_theme::ColorScheme::Dark);
                                }
                                "Auto" => {
                                    self.theme_engine.follow_system = true;
                                    let system = match dark_light::detect() {
                                        dark_light::Mode::Dark => wiredash_theme::ColorScheme::Dark,
                                        _ => wiredash_theme::ColorScheme::Light,
                                    };
                                    self.theme_engine.set_scheme(system);
                                }
                                _ => {}
                            }
                            self.save_config();
                        }
                    }
                }
                self.settings_state.update(msg, &self.db);
            }
            Message::AppLock(msg) => {
                match msg {
                    app_lock::AppLockMessage::PasswordInput(s) => {
                        self.app_lock_state.password_input = s;
                    }
                    app_lock::AppLockMessage::TryUnlock => {
                        if app_lock::try_unlock(&self.db, &self.app_lock_state.password_input) {
                            self.app_lock_state.locked = false;
                            self.app_lock_state.password_input.clear();
                            self.app_lock_state.error = None;
                            self.app_lock_state.record_activity();
                        } else {
                            self.app_lock_state.error = Some("Incorrect password.".into());
                        }
                    }
                }
            }
            Message::InactivityCheck => {
                if !self.app_lock_state.locked {
                    let timeout = self.settings_state.get_string("app_lock_timeout", "Immediately");
                    let enabled = self.settings_state.get_bool("app_lock_enabled", false);
                    if enabled && self.app_lock_state.should_lock(&timeout) {
                        self.app_lock_state.locked = true;
                    }
                }
            }
            Message::RemindersView(msg) => {
                self.reminders_state.update(msg, &self.db);
            }
            Message::DashboardView(msg) => {
                if let Some(nav) = self.dashboard_state.update(msg, &self.db) {
                    self.current_view = nav;
                    state_changed = true;
                }
            }
            Message::TasksView(msg) => {
                self.tasks_state.update(msg, &self.db);
            }
            Message::CalendarView(msg) => {
                self.calendar_state.update(msg, &self.db);
            }
            Message::AgentsView(msg) => {
                self.agents_state.update(msg, &self.db);
            }
            Message::AutoSaveTick => {
                if self.save_pending {
                    self.save_all_dirty();
                }
            }
            Message::KeyboardEvent(event) => {
                if let keyboard::Event::KeyPressed { key, modifiers, .. } = event {
                    if modifiers.command() {
                        match key.as_ref() {
                            keyboard::Key::Character("s") => {
                                self.save_all_dirty();
                            }
                            keyboard::Key::Character("b") => {
                                self.sidebar_collapsed = !self.sidebar_collapsed;
                                state_changed = true;
                            }
                            keyboard::Key::Character("f") => {
                                self.save_all_dirty();
                                self.current_view = View::Search;
                                state_changed = true;
                            }
                            keyboard::Key::Character(c) => {
                                if modifiers.shift() && c == "T" {
                                    self.theme_engine.toggle_scheme();
                                    state_changed = true;
                                } else if c.len() == 1 {
                                    if let Some(digit) = c.chars().next().and_then(|ch: char| ch.to_digit(10)) {
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

    /// Save all dirty editors across every view.
    fn save_all_dirty(&mut self) {
        if self.notes_state.editor.dirty {
            self.notes_state.save_current(&self.db);
        }
        if self.notebooks_state.editor.dirty {
            self.notebooks_state.save_current(&self.db);
        }
        if self.tags_state.editor.dirty {
            self.tags_state.save_current(&self.db);
        }
        if self.search_state.editor.dirty {
            self.search_state.save_current(&self.db);
        }
        if self.favorites_state.editor.dirty {
            self.favorites_state.save_current(&self.db);
        }
        if self.archive_state.editor.dirty {
            self.archive_state.save_current(&self.db);
        }
        if self.trash_state.editor.dirty {
            self.trash_state.save_current(&self.db);
        }
        self.save_pending = false;
    }

    fn view(&self) -> Element<'_, Message> {
        if self.app_lock_state.locked {
            return app_lock::gate_view(&self.app_lock_state).map(Message::AppLock);
        }

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
        let mut subs = vec![keyboard_sub];
        if self.save_pending {
            subs.push(
                iced::time::every(std::time::Duration::from_secs(2))
                    .map(|_| Message::AutoSaveTick)
            );
        }
        if self.settings_state.get_bool("app_lock_enabled", false) && !self.app_lock_state.locked {
            subs.push(
                iced::time::every(std::time::Duration::from_secs(10))
                    .map(|_| Message::InactivityCheck)
            );
        }
        Subscription::batch(subs)
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
            View::Search => {
                search_view::search_view(&self.search_state, &self.theme_engine.active_iced_theme())
                    .map(Message::SearchView)
            }
            View::Favorites => {
                organize_views::filtered_notes_view(&self.favorites_state, &self.theme_engine.active_iced_theme(), organize_views::NoteFilter::Favorites)
                    .map(Message::Favorites)
            }
            View::Archive => {
                organize_views::filtered_notes_view(&self.archive_state, &self.theme_engine.active_iced_theme(), organize_views::NoteFilter::Archived)
                    .map(Message::ArchiveView)
            }
            View::Trash => {
                organize_views::filtered_notes_view(&self.trash_state, &self.theme_engine.active_iced_theme(), organize_views::NoteFilter::Trashed)
                    .map(Message::TrashView)
            }
            View::Settings => {
                settings_view::settings_view(&self.settings_state, &self.theme_engine.active_iced_theme())
                    .map(Message::SettingsView)
            }
            View::Reminders => {
                reminders_view::reminders_view(&self.reminders_state, &self.theme_engine.active_iced_theme())
                    .map(Message::RemindersView)
            }
            View::Dashboard => {
                dashboard_view::dashboard_view(&self.dashboard_state, &self.theme_engine.active_iced_theme())
                    .map(Message::DashboardView)
            }
            View::Tasks => {
                tasks_view::tasks_view(&self.tasks_state, &self.theme_engine.active_iced_theme())
                    .map(Message::TasksView)
            }
            View::Calendar => {
                calendar_view::calendar_view(&self.calendar_state, &self.theme_engine.active_iced_theme())
                    .map(Message::CalendarView)
            }
            View::Agents => {
                agents_view::agents_view(&self.agents_state, &self.theme_engine.active_iced_theme())
                    .map(Message::AgentsView)
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
