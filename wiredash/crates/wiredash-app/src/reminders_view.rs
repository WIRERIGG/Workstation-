//! Reminders view — list + create/edit form, mirroring Workstation.

use iced::widget::{button, column, container, pick_list, row, rule, scrollable, text, text_input, toggler, Space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::reminders::Reminders;
use wiredash_core::types::Reminder;
use wiredash_db::Database;

pub struct ReminderSummary {
    pub id: String,
    pub title: String,
    pub date: i64,
    pub mode: String,
    #[allow(dead_code)]
    pub priority: String,
    pub disabled: bool,
}

pub struct RemindersViewState {
    pub reminder_list: Vec<ReminderSummary>,
    pub selected_index: Option<usize>,
    pub editing: bool,
    // Form fields
    pub form_title: String,
    pub form_date: String,
    pub form_time: String,
    pub form_mode: String,
    pub form_recurring_mode: String,
    pub form_selected_days: Vec<i32>,
    pub form_priority: String,
    pub form_description: String,
    pub form_disabled: bool,
}

impl RemindersViewState {
    pub fn new() -> Self {
        Self {
            reminder_list: Vec::new(),
            selected_index: None,
            editing: false,
            form_title: String::new(),
            form_date: String::new(),
            form_time: String::new(),
            form_mode: "once".into(),
            form_recurring_mode: "daily".into(),
            form_selected_days: Vec::new(),
            form_priority: "silent".into(),
            form_description: String::new(),
            form_disabled: false,
        }
    }

    pub fn refresh(&mut self, db: &Database) {
        let reminders = Reminders::new(db);
        match reminders.list() {
            Ok(list) => {
                self.reminder_list = list.into_iter().map(|r| ReminderSummary {
                    id: r.base.id,
                    title: r.title,
                    date: r.date,
                    mode: r.mode,
                    priority: r.priority,
                    disabled: r.disabled.unwrap_or(false),
                }).collect();
            }
            Err(e) => tracing::error!("Failed to load reminders: {e}"),
        }
    }

    pub fn load_reminder(&mut self, index: usize, db: &Database) {
        self.selected_index = Some(index);
        let Some(summary) = self.reminder_list.get(index) else { return; };
        let reminders = Reminders::new(db);
        let Some(rem) = reminders.get(&summary.id).ok().flatten() else { return; };

        self.editing = true;
        self.form_title = rem.title;
        self.form_description = rem.description.unwrap_or_default();
        self.form_priority = rem.priority;
        self.form_mode = rem.mode;
        self.form_recurring_mode = rem.recurring_mode.unwrap_or("daily".into());
        self.form_selected_days = rem.selected_days.unwrap_or_default();
        self.form_disabled = rem.disabled.unwrap_or(false);

        // Format date/time from timestamp
        let dt = chrono::DateTime::from_timestamp_millis(rem.date)
            .unwrap_or_else(chrono::Utc::now);
        self.form_date = dt.format("%Y-%m-%d").to_string();
        self.form_time = dt.format("%H:%M").to_string();
    }

    pub fn create_reminder(&mut self, _db: &Database) {
        self.editing = true;
        self.selected_index = None;
        self.form_title = "New Reminder".into();
        self.form_description.clear();
        self.form_priority = "silent".into();
        self.form_mode = "once".into();
        self.form_recurring_mode = "daily".into();
        self.form_selected_days.clear();
        self.form_disabled = false;

        let now = chrono::Utc::now();
        self.form_date = now.format("%Y-%m-%d").to_string();
        self.form_time = now.format("%H:%M").to_string();
    }

    pub fn save_reminder(&mut self, db: &Database) {
        let date_str = format!("{}T{}:00Z", self.form_date, self.form_time);
        let date_ts = chrono::DateTime::parse_from_rfc3339(&date_str)
            .map(|dt| dt.timestamp_millis())
            .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis());

        let reminders = Reminders::new(db);

        if let Some(idx) = self.selected_index {
            // Update existing
            if let Some(summary) = self.reminder_list.get(idx) {
                if let Ok(Some(mut rem)) = reminders.get(&summary.id) {
                    rem.title = self.form_title.clone();
                    rem.description = if self.form_description.is_empty() { None } else { Some(self.form_description.clone()) };
                    rem.priority = self.form_priority.clone();
                    rem.date = date_ts;
                    rem.mode = self.form_mode.clone();
                    rem.recurring_mode = if self.form_mode == "recurring" { Some(self.form_recurring_mode.clone()) } else { None };
                    rem.selected_days = if self.form_mode == "recurring" && self.form_recurring_mode == "weekly" {
                        Some(self.form_selected_days.clone())
                    } else { None };
                    rem.disabled = Some(self.form_disabled);
                    let _ = reminders.update(&rem);
                }
            }
        } else {
            // Create new
            let mut rem = Reminder::new(&self.form_title, date_ts);
            rem.description = if self.form_description.is_empty() { None } else { Some(self.form_description.clone()) };
            rem.priority = self.form_priority.clone();
            rem.mode = self.form_mode.clone();
            rem.recurring_mode = if self.form_mode == "recurring" { Some(self.form_recurring_mode.clone()) } else { None };
            rem.selected_days = if self.form_mode == "recurring" && self.form_recurring_mode == "weekly" {
                Some(self.form_selected_days.clone())
            } else { None };
            rem.disabled = Some(self.form_disabled);
            let _ = reminders.add(&rem);
        }

        self.refresh(db);
    }

    pub fn delete_reminder(&mut self, db: &Database) {
        let Some(idx) = self.selected_index else { return; };
        let Some(summary) = self.reminder_list.get(idx) else { return; };
        let _ = Reminders::new(db).remove(&summary.id);
        self.editing = false;
        self.selected_index = None;
        self.refresh(db);
    }

    pub fn snooze_reminder(&mut self, db: &Database, minutes: i64) {
        let Some(idx) = self.selected_index else { return; };
        let Some(summary) = self.reminder_list.get(idx) else { return; };
        let reminders = Reminders::new(db);
        if let Ok(Some(mut rem)) = reminders.get(&summary.id) {
            rem.snooze_until = Some(chrono::Utc::now().timestamp_millis() + minutes * 60 * 1000);
            let _ = reminders.update(&rem);
        }
        self.refresh(db);
    }

    pub fn update(&mut self, msg: RemindersMessage, db: &Database) -> bool {
        match msg {
            RemindersMessage::SelectReminder(idx) => { self.load_reminder(idx, db); true }
            RemindersMessage::NewReminder => { self.create_reminder(db); true }
            RemindersMessage::SetTitle(s) => { self.form_title = s; true }
            RemindersMessage::SetDescription(s) => { self.form_description = s; true }
            RemindersMessage::SetDate(s) => { self.form_date = s; true }
            RemindersMessage::SetTime(s) => { self.form_time = s; true }
            RemindersMessage::SetMode(s) => { self.form_mode = s; true }
            RemindersMessage::SetRecurringMode(s) => { self.form_recurring_mode = s; true }
            RemindersMessage::ToggleDay(d) => {
                if self.form_selected_days.contains(&d) {
                    self.form_selected_days.retain(|&x| x != d);
                } else {
                    self.form_selected_days.push(d);
                }
                true
            }
            RemindersMessage::SetPriority(s) => { self.form_priority = s; true }
            RemindersMessage::SaveReminder => { self.save_reminder(db); true }
            RemindersMessage::DeleteReminder => { self.delete_reminder(db); true }
            RemindersMessage::SnoozeReminder(mins) => { self.snooze_reminder(db, mins); true }
            RemindersMessage::ToggleDisabled => { self.form_disabled = !self.form_disabled; true }
        }
    }
}

#[derive(Debug, Clone)]
pub enum RemindersMessage {
    SelectReminder(usize),
    NewReminder,
    SetTitle(String),
    SetDescription(String),
    SetDate(String),
    SetTime(String),
    SetMode(String),
    SetRecurringMode(String),
    ToggleDay(i32),
    SetPriority(String),
    SaveReminder,
    DeleteReminder,
    SnoozeReminder(i64),
    ToggleDisabled,
}

// -- View functions -------------------------------------------------------

pub fn reminders_view<'a>(state: &'a RemindersViewState, _theme: &Theme) -> Element<'a, RemindersMessage> {
    let list = reminder_list(state);
    let detail = if state.editing {
        reminder_form(state)
    } else {
        container(
            text("Select a reminder or create a new one.").size(14)
        ).padding(24).width(Fill).height(Fill).into()
    };

    row![
        container(scrollable(list)).width(320).height(Fill),
        rule::vertical(1),
        container(scrollable(detail)).width(Fill).height(Fill).padding(24),
    ]
    .into()
}

fn reminder_list<'a>(state: &'a RemindersViewState) -> Element<'a, RemindersMessage> {
    let mut items: Vec<Element<'a, RemindersMessage>> = Vec::new();

    items.push(
        container(
            row![
                text("Reminders").size(18),
                Space::new().width(Fill),
                button(text("+ New").size(12))
                    .on_press(RemindersMessage::NewReminder)
                    .padding([4, 10]),
            ]
            .align_y(Center)
        )
        .padding([12, 16])
        .into(),
    );

    items.push(rule::horizontal(1).into());

    let now = chrono::Utc::now().timestamp_millis();
    let today_start = {
        let today = chrono::Utc::now().date_naive();
        today.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis()
    };
    let tomorrow_start = today_start + 86_400_000;

    // Group: Overdue
    let overdue: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.date < now && !r.disabled)
        .collect();
    if !overdue.is_empty() {
        items.push(
            container(text("OVERDUE").size(10).color(iced::Color::from_rgb8(0xE0, 0x00, 0x00)))
                .padding(iced::Padding::ZERO.top(8).right(16).bottom(4).left(16)).into()
        );
        for (i, rem) in &overdue {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    // Group: Today
    let today: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.date >= today_start && r.date < tomorrow_start && !r.disabled)
        .collect();
    if !today.is_empty() {
        items.push(
            container(text("TODAY").size(10).color(iced::Color::from_rgb8(0x00, 0x7B, 0xFF)))
                .padding(iced::Padding::ZERO.top(8).right(16).bottom(4).left(16)).into()
        );
        for (i, rem) in &today {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    // Group: Upcoming
    let upcoming: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.date >= tomorrow_start && !r.disabled)
        .collect();
    if !upcoming.is_empty() {
        items.push(
            container(text("UPCOMING").size(10).color(iced::Color::from_rgb8(0x88, 0x88, 0x88)))
                .padding(iced::Padding::ZERO.top(8).right(16).bottom(4).left(16)).into()
        );
        for (i, rem) in &upcoming {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    // Group: Disabled
    let disabled: Vec<_> = state.reminder_list.iter().enumerate()
        .filter(|(_, r)| r.disabled)
        .collect();
    if !disabled.is_empty() {
        items.push(
            container(text("DISABLED").size(10).color(iced::Color::from_rgb8(0xAA, 0xAA, 0xAA)))
                .padding(iced::Padding::ZERO.top(8).right(16).bottom(4).left(16)).into()
        );
        for (i, rem) in &disabled {
            items.push(reminder_list_item(*i, rem, state.selected_index == Some(*i)));
        }
    }

    if state.reminder_list.is_empty() {
        items.push(
            container(text("No reminders yet.").size(13))
                .padding(16).into()
        );
    }

    column(items).spacing(1).into()
}

fn reminder_list_item<'a>(
    index: usize,
    rem: &ReminderSummary,
    selected: bool,
) -> Element<'a, RemindersMessage> {
    let dt = chrono::DateTime::from_timestamp_millis(rem.date)
        .map(|d| d.format("%b %d, %H:%M").to_string())
        .unwrap_or_else(|| "Unknown".into());

    let mode_icon = if rem.mode == "recurring" { "↻" } else { "○" };
    let title = rem.title.clone();
    let subtitle = format!("{mode_icon}  {dt}");
    let label = column![
        text(title).size(13),
        text(subtitle).size(11).color(iced::Color::from_rgb8(0x88, 0x88, 0x88)),
    ].spacing(2);

    button(label)
        .on_press(RemindersMessage::SelectReminder(index))
        .padding([8, 16])
        .width(Fill)
        .style(move |theme: &Theme, status| {
            let mut style = button::text(theme, status);
            if selected {
                style.background = Some(iced::Background::Color(
                    iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.1),
                ));
            }
            style
        })
        .into()
}

fn reminder_form<'a>(state: &'a RemindersViewState) -> Element<'a, RemindersMessage> {
    let is_recurring = state.form_mode == "recurring";
    let is_weekly = state.form_recurring_mode == "weekly";

    let mode_options: &[&str] = &["once", "recurring"];
    let current_mode: Option<&str> = Some(state.form_mode.as_str());

    let mut items: Vec<Element<'a, RemindersMessage>> = vec![
        text("Reminder").size(22).into(),
        rule::horizontal(1).into(),
        text_input("Title", &state.form_title)
            .on_input(RemindersMessage::SetTitle)
            .size(16)
            .into(),
        text_input("Description (optional)", &state.form_description)
            .on_input(RemindersMessage::SetDescription)
            .into(),
        row![
            column![
                text("Date").size(11),
                text_input("YYYY-MM-DD", &state.form_date)
                    .on_input(RemindersMessage::SetDate)
                    .width(140),
            ].spacing(4),
            column![
                text("Time").size(11),
                text_input("HH:MM", &state.form_time)
                    .on_input(RemindersMessage::SetTime)
                    .width(100),
            ].spacing(4),
        ].spacing(16).into(),
        row![
            text("Mode").size(13),
            pick_list(
                mode_options,
                current_mode,
                |v: &str| RemindersMessage::SetMode(v.to_string()),
            ),
        ].spacing(8).align_y(Center).into(),
    ];

    if is_recurring {
        let recurring_options: &[&str] = &["daily", "weekly", "monthly"];
        let current_recurring: Option<&str> = Some(state.form_recurring_mode.as_str());
        items.push(
            row![
                text("Repeat").size(13),
                pick_list(
                    recurring_options,
                    current_recurring,
                    |v: &str| RemindersMessage::SetRecurringMode(v.to_string()),
                ),
            ].spacing(8).align_y(Center).into()
        );

        if is_weekly {
            let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            let day_buttons: Vec<Element<'a, RemindersMessage>> = days.iter().enumerate().map(|(i, label)| {
                let day_num = (i + 1) as i32;
                let is_selected = state.form_selected_days.contains(&day_num);
                button(text(*label).size(11))
                    .on_press(RemindersMessage::ToggleDay(day_num))
                    .padding([4, 8])
                    .style(move |theme: &Theme, status| {
                        let mut style = button::secondary(theme, status);
                        if is_selected {
                            style.background = Some(iced::Background::Color(
                                iced::Color::from_rgb8(0xE0, 0x00, 0x00),
                            ));
                            style.text_color = iced::Color::WHITE;
                        }
                        style
                    })
                    .into()
            }).collect();
            items.push(row(day_buttons).spacing(4).into());
        }
    }

    let priority_options: &[&str] = &["silent", "vibrate", "urgent"];
    let current_priority: Option<&str> = Some(state.form_priority.as_str());
    items.push(
        row![
            text("Priority").size(13),
            pick_list(
                priority_options,
                current_priority,
                |v: &str| RemindersMessage::SetPriority(v.to_string()),
            ),
        ].spacing(8).align_y(Center).into()
    );

    items.push(
        row![
            text("Disabled").size(13),
            toggler(state.form_disabled)
                .on_toggle(|_| RemindersMessage::ToggleDisabled),
        ].spacing(8).align_y(Center).into()
    );

    items.push(Space::new().height(8).into());

    // Action buttons
    items.push(
        row![
            button(text("Save").size(13))
                .on_press(RemindersMessage::SaveReminder)
                .padding([6, 16]),
            button(text("Snooze 15min").size(12))
                .on_press(RemindersMessage::SnoozeReminder(15))
                .style(button::secondary)
                .padding([6, 12]),
            button(text("Snooze 1h").size(12))
                .on_press(RemindersMessage::SnoozeReminder(60))
                .style(button::secondary)
                .padding([6, 12]),
            Space::new().width(Fill),
            button(text("Delete").size(12))
                .on_press(RemindersMessage::DeleteReminder)
                .style(button::danger)
                .padding([6, 12]),
        ].spacing(8).into()
    );

    column(items).spacing(8).into()
}
