//! Calendar view — week grid with event management.

use iced::widget::{button, column, container, row, scrollable, text, text_input, rule};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::calendar_events::CalendarEvents;
use wiredash_core::types::CalendarEvent;
use wiredash_db::Database;

use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum CalendarMessage {
    PrevWeek,
    NextWeek,
    Today,
    Refresh,
    SelectEvent(String),
    NewEvent,
    SetTitle(String),
    SetDescription(String),
    SaveEvent,
    DeleteEvent,
}

pub struct CalendarViewState {
    pub week_start: NaiveDate,
    pub events: Vec<CalendarEvent>,
    pub selected_event_id: Option<String>,
    // Form
    pub form_title: String,
    pub form_description: String,
    pub editing_id: Option<String>,
}

impl CalendarViewState {
    pub fn new() -> Self {
        let today = Local::now().date_naive();
        let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        Self {
            week_start,
            events: Vec::new(),
            selected_event_id: None,
            form_title: String::new(),
            form_description: String::new(),
            editing_id: None,
        }
    }

    pub fn refresh(&mut self, db: &Database) {
        let start_ms = self
            .week_start
            .and_hms_opt(0, 0, 0)
            .map(|dt| dt.and_utc().timestamp_millis())
            .unwrap_or(0);
        let end_ms = start_ms + 7 * 86_400_000;
        self.events = CalendarEvents::new(db)
            .list_in_range(start_ms, end_ms)
            .unwrap_or_default();
    }

    fn clear_form(&mut self) {
        self.form_title.clear();
        self.form_description.clear();
        self.editing_id = None;
        self.selected_event_id = None;
    }

    pub fn update(&mut self, msg: CalendarMessage, db: &Database) {
        match msg {
            CalendarMessage::PrevWeek => {
                self.week_start -= Duration::days(7);
                self.refresh(db);
            }
            CalendarMessage::NextWeek => {
                self.week_start += Duration::days(7);
                self.refresh(db);
            }
            CalendarMessage::Today => {
                let today = Local::now().date_naive();
                self.week_start =
                    today - Duration::days(today.weekday().num_days_from_monday() as i64);
                self.refresh(db);
            }
            CalendarMessage::Refresh => self.refresh(db),
            CalendarMessage::SelectEvent(id) => {
                self.selected_event_id = Some(id.clone());
                if let Some(event) = self.events.iter().find(|e| e.base.id == id) {
                    self.form_title = event.title.clone();
                    self.form_description = event.description.clone().unwrap_or_default();
                    self.editing_id = Some(id);
                }
            }
            CalendarMessage::NewEvent => self.clear_form(),
            CalendarMessage::SetTitle(s) => self.form_title = s,
            CalendarMessage::SetDescription(s) => self.form_description = s,
            CalendarMessage::SaveEvent => {
                if self.form_title.is_empty() {
                    return;
                }
                let cal = CalendarEvents::new(db);
                if self.editing_id.is_none() {
                    // Create new event (default: today, 1 hour)
                    let now = chrono::Utc::now().timestamp_millis();
                    let event = CalendarEvent::new(
                        &self.form_title,
                        now,
                        now + 3_600_000,
                    );
                    let mut e = event;
                    e.description = if self.form_description.is_empty() {
                        None
                    } else {
                        Some(self.form_description.clone())
                    };
                    let _ = cal.add(&e);
                }
                // TODO: update existing events
                self.refresh(db);
                self.clear_form();
            }
            CalendarMessage::DeleteEvent => {
                if let Some(ref id) = self.editing_id {
                    let _ = CalendarEvents::new(db).remove(id);
                    self.refresh(db);
                    self.clear_form();
                }
            }
        }
    }
}

pub fn calendar_view<'a>(
    state: &'a CalendarViewState,
    _theme: &Theme,
) -> Element<'a, CalendarMessage> {
    // Header: < Mon Feb 23 – Sun Mar 1 >
    let week_end = state.week_start + Duration::days(6);
    let header_text = format!(
        "{} – {}",
        state.week_start.format("%a %b %d"),
        week_end.format("%a %b %d"),
    );
    let header = row![
        button(text("<").size(14))
            .on_press(CalendarMessage::PrevWeek)
            .padding([4, 10])
            .style(button::text),
        button(text("Today").size(11))
            .on_press(CalendarMessage::Today)
            .padding([4, 10])
            .style(button::secondary),
        text(header_text.clone()).size(14),
        button(text(">").size(14))
            .on_press(CalendarMessage::NextWeek)
            .padding([4, 10])
            .style(button::text),
    ]
    .spacing(8)
    .align_y(Center);

    // 7-column grid
    let mut day_columns: Vec<Element<'_, CalendarMessage>> = Vec::new();
    let today = Local::now().date_naive();

    for day_offset in 0..7 {
        let day = state.week_start + Duration::days(day_offset);
        let is_today = day == today;
        let day_label = day.format("%a %d").to_string();

        let day_start_ms = day
            .and_hms_opt(0, 0, 0)
            .map(|dt| dt.and_utc().timestamp_millis())
            .unwrap_or(0);
        let day_end_ms = day_start_ms + 86_400_000;

        // Filter events for this day
        let day_events: Vec<&CalendarEvent> = state
            .events
            .iter()
            .filter(|e| e.start_date < day_end_ms && e.end_date > day_start_ms)
            .collect();

        let mut col_items: Vec<Element<'_, CalendarMessage>> = vec![
            container(
                text(day_label)
                    .size(11)
                    .color(if is_today {
                        iced::Color::from_rgb8(0xE0, 0x00, 0x00)
                    } else {
                        iced::Color::from_rgb8(0x60, 0x60, 0x60)
                    }),
            )
            .center_x(Fill)
            .padding([4, 0])
            .into(),
            rule::horizontal(1).into(),
        ];

        for event in day_events {
            let event_id = event.base.id.clone();
            let is_selected = state.selected_event_id.as_ref() == Some(&event.base.id);
            let time_str = format_time(event.start_date);
            let color = event
                .color
                .as_deref()
                .map(hex_to_color)
                .unwrap_or(iced::Color::from_rgb8(0x00, 0x80, 0xE0));

            col_items.push(
                button(
                    column![
                        text(time_str).size(9),
                        text(event.title.clone()).size(10),
                    ]
                    .spacing(1),
                )
                .on_press(CalendarMessage::SelectEvent(event_id))
                .padding([4, 6])
                .width(Fill)
                .style(move |theme: &Theme, status| {
                    let mut style = button::text(theme, status);
                    if is_selected {
                        style.background =
                            Some(iced::Background::Color(iced::Color::from_rgba8(
                                (color.r * 255.0) as u8,
                                (color.g * 255.0) as u8,
                                (color.b * 255.0) as u8,
                                0.15,
                            )));
                    }
                    style.border = iced::Border {
                        width: 0.0,
                        color,
                        radius: 4.0.into(),
                    };
                    style
                })
                .into(),
            );
        }

        let day_col = container(scrollable(column(col_items).spacing(2)))
            .width(Fill)
            .height(Fill)
            .style(move |theme: &Theme| {
                let palette = theme.extended_palette();
                container::Style {
                    border: iced::Border {
                        width: 0.5,
                        color: palette.background.strong.color,
                        ..Default::default()
                    },
                    ..Default::default()
                }
            });

        day_columns.push(day_col.into());
    }

    let grid = row(day_columns).spacing(0).height(Fill);

    // Event form (bottom panel)
    let form = event_form(state);

    let content = column![
        container(header).padding([12, 16]),
        grid,
        rule::horizontal(1),
        container(form).padding([8, 16]),
    ]
    .spacing(0);

    container(content)
        .width(Fill)
        .height(Fill)
        .into()
}

fn event_form<'a>(state: &'a CalendarViewState) -> Element<'a, CalendarMessage> {
    let title_label = if state.editing_id.is_some() {
        "Edit Event"
    } else {
        "New Event"
    };

    let mut items: Vec<Element<'_, CalendarMessage>> = vec![
        text(title_label).size(13).into(),
        row![
            text_input("Event title...", &state.form_title)
                .on_input(CalendarMessage::SetTitle)
                .size(12)
                .padding(6),
            text_input("Description...", &state.form_description)
                .on_input(CalendarMessage::SetDescription)
                .size(12)
                .padding(6),
            button(text("Save").size(11))
                .on_press(CalendarMessage::SaveEvent)
                .padding([4, 12])
                .style(button::primary),
        ]
        .spacing(8)
        .into(),
    ];
    if state.editing_id.is_some() {
        items.push(
            button(text("Delete Event").size(11))
                .on_press(CalendarMessage::DeleteEvent)
                .padding([4, 12])
                .style(button::danger)
                .into(),
        );
    }

    column(items).spacing(6).into()
}

fn format_time(millis: i64) -> String {
    chrono::Local
        .timestamp_millis_opt(millis)
        .single()
        .map(|dt| dt.format("%H:%M").to_string())
        .unwrap_or_else(|| "--:--".into())
}

fn hex_to_color(hex: &str) -> iced::Color {
    let hex = hex.trim_start_matches('#');
    if hex.len() >= 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
        iced::Color::from_rgb8(r, g, b)
    } else {
        iced::Color::from_rgb8(0x00, 0x80, 0xE0)
    }
}
