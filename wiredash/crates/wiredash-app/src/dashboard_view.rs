//! Dashboard view — mission control with stats, schedule, and priority tasks.

use iced::widget::{button, column, container, row, scrollable, text, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::calendar_events::CalendarEvents;
use wiredash_core::collections::tasks::Tasks;
use wiredash_core::types::{CalendarEvent, TaskItem};
use wiredash_db::Database;

use crate::navigation::View;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum DashboardMessage {
    Refresh,
    NavigateTo(View),
}

pub struct DashboardViewState {
    pub note_count: usize,
    pub open_task_count: usize,
    pub today_event_count: usize,
    pub active_agent_count: usize,
    pub today_events: Vec<CalendarEvent>,
    pub priority_tasks: Vec<TaskItem>,
}

impl DashboardViewState {
    pub fn new() -> Self {
        Self {
            note_count: 0,
            open_task_count: 0,
            today_event_count: 0,
            active_agent_count: 0,
            today_events: Vec::new(),
            priority_tasks: Vec::new(),
        }
    }

    pub fn refresh(&mut self, db: &Database) {
        // Note count — use count_rows instead of loading all notes
        self.note_count = db
            .count_rows_sync("notes", Some("deleted = 0"))
            .unwrap_or(0);

        // Open tasks — load once, derive both count and priority list
        let all_tasks = Tasks::new(db).list(None).unwrap_or_default();
        let mut open_tasks: Vec<TaskItem> = all_tasks
            .into_iter()
            .filter(|t| t.status != "done" && t.status != "cancelled")
            .collect();
        self.open_task_count = open_tasks.len();

        // Priority tasks (top 5 open, by priority)
        open_tasks.sort_by(|a, b| {
            priority_rank(&a.priority).cmp(&priority_rank(&b.priority))
        });
        open_tasks.truncate(5);
        self.priority_tasks = open_tasks;

        // Today's events
        let now = chrono::Utc::now();
        let today_start = now
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .map(|dt| dt.and_utc().timestamp_millis())
            .unwrap_or(0);
        let today_end = today_start + 86_400_000;
        self.today_events = CalendarEvents::new(db)
            .list_in_range(today_start, today_end)
            .unwrap_or_default();
        self.today_event_count = self.today_events.len();

        // Active agents — use count_rows with status filter
        self.active_agent_count = db
            .count_rows_sync("agents", Some("status = 'active'"))
            .unwrap_or(0);
    }

    pub fn update(&mut self, msg: DashboardMessage, db: &Database) -> Option<View> {
        match msg {
            DashboardMessage::Refresh => {
                self.refresh(db);
                None
            }
            DashboardMessage::NavigateTo(view) => Some(view),
        }
    }
}

fn priority_rank(p: &str) -> u8 {
    match p {
        "urgent" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    }
}

fn priority_color(p: &str) -> iced::Color {
    match p {
        "urgent" => iced::Color::from_rgb8(0xE0, 0x00, 0x00),
        "high" => iced::Color::from_rgb8(0xFF, 0x8C, 0x00),
        "medium" => iced::Color::from_rgb8(0x00, 0x80, 0xE0),
        "low" => iced::Color::from_rgb8(0x60, 0x60, 0x60),
        _ => iced::Color::from_rgb8(0x80, 0x80, 0x80),
    }
}

pub fn dashboard_view<'a>(
    state: &'a DashboardViewState,
    _theme: &Theme,
) -> Element<'a, DashboardMessage> {
    // Greeting
    let hour = chrono::Local::now().hour();
    let greeting = match hour {
        0..=11 => "Good morning",
        12..=17 => "Good afternoon",
        _ => "Good evening",
    };
    let greeting_row = text(greeting).size(28);

    // Stat cards
    let note_count = state.note_count.to_string();
    let task_count = state.open_task_count.to_string();
    let event_count = state.today_event_count.to_string();
    let agent_count = state.active_agent_count.to_string();
    let cards = row![
        stat_card("Notes", &note_count, View::Notes),
        stat_card("Open Tasks", &task_count, View::Tasks),
        stat_card("Today's Events", &event_count, View::Calendar),
        stat_card("Active Agents", &agent_count, View::Agents),
    ]
    .spacing(12);

    // Today's schedule
    let mut schedule_items: Vec<Element<'_, DashboardMessage>> = vec![
        text("Today's Schedule").size(16).into(),
        rule::horizontal(1).into(),
    ];
    if state.today_events.is_empty() {
        schedule_items.push(text("No events today").size(12).into());
    } else {
        for event in &state.today_events {
            let time_str = format_time(event.start_date);
            let title = event.title.clone();
            schedule_items.push(
                row![
                    text(time_str).size(11).width(60),
                    text(title).size(12),
                ]
                .spacing(8)
                .into(),
            );
        }
    }
    let schedule_col = column(schedule_items).spacing(6);

    // Priority tasks
    let mut task_items: Vec<Element<'_, DashboardMessage>> = vec![
        text("Priority Tasks").size(16).into(),
        rule::horizontal(1).into(),
    ];
    if state.priority_tasks.is_empty() {
        task_items.push(text("No open tasks").size(12).into());
    } else {
        for task in &state.priority_tasks {
            let color = priority_color(&task.priority);
            let priority_label = task.priority.clone();
            let title_label = task.title.clone();
            task_items.push(
                row![
                    container(text(priority_label).size(9).color(iced::Color::WHITE))
                        .padding([2, 6])
                        .style(move |_: &Theme| container::Style {
                            background: Some(iced::Background::Color(color)),
                            border: iced::Border {
                                radius: 3.0.into(),
                                ..Default::default()
                            },
                            ..Default::default()
                        }),
                    text(title_label).size(12),
                ]
                .spacing(8)
                .align_y(Center)
                .into(),
            );
        }
    }
    let tasks_col = column(task_items).spacing(6);

    // Two-column layout
    let two_col = row![
        container(schedule_col).width(Fill).padding(12),
        rule::vertical(1),
        container(tasks_col).width(Fill).padding(12),
    ]
    .spacing(0);

    let content = column![
        greeting_row,
        space::vertical().height(12),
        cards,
        space::vertical().height(16),
        two_col,
    ]
    .spacing(4);

    container(scrollable(
        container(content).padding(24).width(Fill),
    ))
    .width(Fill)
    .height(Fill)
    .into()
}

fn stat_card<'a>(
    label: &str,
    value: &str,
    nav: View,
) -> Element<'a, DashboardMessage> {
    let card_content = column![
        text(value.to_string()).size(28),
        text(label.to_string()).size(11),
    ]
    .spacing(4)
    .align_x(iced::Alignment::Center);

    button(
        container(card_content)
            .padding([16, 20])
            .center_x(Fill)
            .center_y(Fill),
    )
    .on_press(DashboardMessage::NavigateTo(nav))
    .width(Fill)
    .style(|theme: &Theme, status| {
        let palette = theme.extended_palette();
        let mut style = button::secondary(theme, status);
        style.background = Some(iced::Background::Color(palette.background.weak.color));
        style.border = iced::Border {
            width: 1.0,
            color: palette.background.strong.color,
            radius: 8.0.into(),
        };
        style
    })
    .into()
}

fn format_time(millis: i64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(millis)
        .single()
        .map(|dt| dt.format("%H:%M").to_string())
        .unwrap_or_else(|| "--:--".into())
}

use chrono::Timelike;
