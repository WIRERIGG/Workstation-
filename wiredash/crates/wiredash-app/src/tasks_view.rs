//! Tasks view — list with filters, detail/edit panel.

use iced::widget::{button, column, container, row, scrollable, text, text_input, rule, space, pick_list};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::tasks::Tasks;
use wiredash_core::types::TaskItem;
use wiredash_db::Database;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskFilter {
    All,
    Open,
    InProgress,
    Done,
}

impl TaskFilter {
    pub const ALL: &'static [TaskFilter] = &[
        TaskFilter::All,
        TaskFilter::Open,
        TaskFilter::InProgress,
        TaskFilter::Done,
    ];

    pub fn label(&self) -> &'static str {
        match self {
            Self::All => "All",
            Self::Open => "Open",
            Self::InProgress => "In Progress",
            Self::Done => "Done",
        }
    }

    fn matches(&self, status: &str) -> bool {
        match self {
            Self::All => true,
            Self::Open => status == "open",
            Self::InProgress => status == "in_progress",
            Self::Done => status == "done",
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum TasksMessage {
    Refresh,
    SelectTask(usize),
    SetFilter(TaskFilter),
    NewTask,
    SetTitle(String),
    SetDescription(String),
    SetStatus(String),
    SetPriority(String),
    SetAssignee(String),
    SaveTask,
    DeleteTask,
}

pub struct TasksViewState {
    pub task_list: Vec<TaskItem>,
    pub filtered_indices: Vec<usize>,
    pub selected_index: Option<usize>,
    pub filter: TaskFilter,
    // Form fields
    pub form_title: String,
    pub form_description: String,
    pub form_status: String,
    pub form_priority: String,
    pub form_assignee: String,
    pub editing_id: Option<String>,
}

impl TasksViewState {
    pub fn new() -> Self {
        Self {
            task_list: Vec::new(),
            filtered_indices: Vec::new(),
            selected_index: None,
            filter: TaskFilter::All,
            form_title: String::new(),
            form_description: String::new(),
            form_status: "open".into(),
            form_priority: "medium".into(),
            form_assignee: String::new(),
            editing_id: None,
        }
    }

    pub fn refresh(&mut self, db: &Database) {
        self.task_list = Tasks::new(db).list(None).unwrap_or_default();
        self.apply_filter();
    }

    fn apply_filter(&mut self) {
        self.filtered_indices = self
            .task_list
            .iter()
            .enumerate()
            .filter(|(_, t)| self.filter.matches(&t.status))
            .map(|(i, _)| i)
            .collect();
    }

    fn load_task_into_form(&mut self, task: &TaskItem) {
        self.form_title = task.title.clone();
        self.form_description = task.description.clone().unwrap_or_default();
        self.form_status = task.status.clone();
        self.form_priority = task.priority.clone();
        self.form_assignee = task.assignee.clone().unwrap_or_default();
        self.editing_id = Some(task.base.id.clone());
    }

    fn clear_form(&mut self) {
        self.form_title.clear();
        self.form_description.clear();
        self.form_status = "open".into();
        self.form_priority = "medium".into();
        self.form_assignee.clear();
        self.editing_id = None;
    }

    pub fn update(&mut self, msg: TasksMessage, db: &Database) {
        match msg {
            TasksMessage::Refresh => self.refresh(db),
            TasksMessage::SelectTask(idx) => {
                self.selected_index = Some(idx);
                if let Some(&real_idx) = self.filtered_indices.get(idx) {
                    if let Some(task) = self.task_list.get(real_idx).cloned() {
                        self.load_task_into_form(&task);
                    }
                }
            }
            TasksMessage::SetFilter(f) => {
                self.filter = f;
                self.apply_filter();
                self.selected_index = None;
            }
            TasksMessage::NewTask => {
                self.clear_form();
                self.selected_index = None;
            }
            TasksMessage::SetTitle(s) => self.form_title = s,
            TasksMessage::SetDescription(s) => self.form_description = s,
            TasksMessage::SetStatus(s) => self.form_status = s,
            TasksMessage::SetPriority(s) => self.form_priority = s,
            TasksMessage::SetAssignee(s) => self.form_assignee = s,
            TasksMessage::SaveTask => {
                let tasks = Tasks::new(db);

                if let Some(ref id) = self.editing_id {
                    // Update existing
                    let _ = tasks.update_status(id, &self.form_status);
                    let _ = tasks.update_priority(id, &self.form_priority);
                } else {
                    // Create new
                    let task = TaskItem::new(&self.form_title);
                    let mut t = task;
                    t.description = if self.form_description.is_empty() {
                        None
                    } else {
                        Some(self.form_description.clone())
                    };
                    t.status = self.form_status.clone();
                    t.priority = self.form_priority.clone();
                    t.assignee = if self.form_assignee.is_empty() {
                        None
                    } else {
                        Some(self.form_assignee.clone())
                    };
                    let _ = tasks.add(&t);
                }
                self.refresh(db);
                self.clear_form();
            }
            TasksMessage::DeleteTask => {
                if let Some(ref id) = self.editing_id {
                    let _ = Tasks::new(db).remove(id);
                    self.refresh(db);
                    self.clear_form();
                    self.selected_index = None;
                }
            }
        }
    }
}

pub fn tasks_view<'a>(
    state: &'a TasksViewState,
    _theme: &Theme,
) -> Element<'a, TasksMessage> {
    // Filter tabs
    let mut filter_row: Vec<Element<'_, TasksMessage>> = Vec::new();
    for f in TaskFilter::ALL {
        let is_selected = *f == state.filter;
        let btn = button(text(f.label()).size(11))
            .on_press(TasksMessage::SetFilter(f.clone()))
            .padding([4, 10])
            .style(move |theme: &Theme, status| {
                let mut style = button::text(theme, status);
                if is_selected {
                    style.background = Some(iced::Background::Color(
                        iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.1),
                    ));
                    style.text_color = iced::Color::from_rgb8(0xE0, 0x00, 0x00);
                }
                style
            });
        filter_row.push(btn.into());
    }
    filter_row.push(space::horizontal().into());
    filter_row.push(
        button(text("+ New").size(11))
            .on_press(TasksMessage::NewTask)
            .padding([4, 10])
            .style(button::primary)
            .into(),
    );
    let filters = row(filter_row).spacing(4).align_y(Center);

    // Task list
    let mut list_items: Vec<Element<'_, TasksMessage>> = Vec::new();
    for (display_idx, &real_idx) in state.filtered_indices.iter().enumerate() {
        if let Some(task) = state.task_list.get(real_idx) {
            let is_selected = state.selected_index == Some(display_idx);
            let status_dot = match task.status.as_str() {
                "done" => "●",
                "in_progress" => "◐",
                "cancelled" => "○",
                _ => "◯",
            };
            let priority_color = match task.priority.as_str() {
                "urgent" => iced::Color::from_rgb8(0xE0, 0x00, 0x00),
                "high" => iced::Color::from_rgb8(0xFF, 0x8C, 0x00),
                "medium" => iced::Color::from_rgb8(0x00, 0x80, 0xE0),
                _ => iced::Color::from_rgb8(0x80, 0x80, 0x80),
            };

            let item = button(
                row![
                    text(status_dot).size(12),
                    column![
                        text(&task.title).size(12),
                        text(&task.priority).size(9).color(priority_color),
                    ]
                    .spacing(2),
                ]
                .spacing(8)
                .align_y(Center),
            )
            .on_press(TasksMessage::SelectTask(display_idx))
            .padding([8, 12])
            .width(Fill)
            .style(move |theme: &Theme, status| {
                let mut style = button::text(theme, status);
                if is_selected {
                    style.background = Some(iced::Background::Color(
                        iced::Color::from_rgba8(0xE0, 0x00, 0x00, 0.08),
                    ));
                }
                style
            });

            list_items.push(item.into());
        }
    }

    let list_panel = column![
        filters,
        rule::horizontal(1),
        scrollable(column(list_items).spacing(1)).height(Fill),
    ]
    .spacing(4)
    .width(320);

    // Detail/edit panel
    let detail_panel = task_form(state);

    let content = row![
        container(list_panel).padding(8).height(Fill),
        rule::vertical(1),
        container(detail_panel).padding(16).width(Fill).height(Fill),
    ];

    container(content)
        .width(Fill)
        .height(Fill)
        .into()
}

fn task_form<'a>(state: &'a TasksViewState) -> Element<'a, TasksMessage> {
    let title = if state.editing_id.is_some() {
        "Edit Task"
    } else {
        "New Task"
    };

    let status_options: Vec<String> = vec![
        "open".into(),
        "in_progress".into(),
        "done".into(),
        "cancelled".into(),
    ];
    let priority_options: Vec<String> = vec![
        "low".into(),
        "medium".into(),
        "high".into(),
        "urgent".into(),
    ];

    let mut form_items: Vec<Element<'_, TasksMessage>> = vec![
        text(title).size(18).into(),
        rule::horizontal(1).into(),
        text("Title").size(11).into(),
        text_input("Task title...", &state.form_title)
            .on_input(TasksMessage::SetTitle)
            .size(13)
            .padding(8)
            .into(),
        text("Description").size(11).into(),
        text_input("Description...", &state.form_description)
            .on_input(TasksMessage::SetDescription)
            .size(13)
            .padding(8)
            .into(),
        text("Status").size(11).into(),
        pick_list(status_options, Some(state.form_status.clone()), TasksMessage::SetStatus)
            .text_size(12)
            .padding(6)
            .into(),
        text("Priority").size(11).into(),
        pick_list(priority_options, Some(state.form_priority.clone()), TasksMessage::SetPriority)
            .text_size(12)
            .padding(6)
            .into(),
        text("Assignee").size(11).into(),
        text_input("Assignee...", &state.form_assignee)
            .on_input(TasksMessage::SetAssignee)
            .size(13)
            .padding(8)
            .into(),
        space::vertical().height(8).into(),
    ];

    // Action buttons
    let mut actions: Vec<Element<'_, TasksMessage>> = vec![
        button(text("Save").size(12))
            .on_press(TasksMessage::SaveTask)
            .padding([6, 16])
            .style(button::primary)
            .into(),
    ];
    if state.editing_id.is_some() {
        actions.push(
            button(text("Delete").size(12))
                .on_press(TasksMessage::DeleteTask)
                .padding([6, 16])
                .style(button::danger)
                .into(),
        );
    }
    form_items.push(row(actions).spacing(8).into());

    scrollable(column(form_items).spacing(6)).into()
}
