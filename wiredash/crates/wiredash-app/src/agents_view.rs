//! Agents view — card grid with configuration panel.

use iced::widget::{button, column, container, row, scrollable, text, text_input, rule, space};
use iced::{Element, Fill, Theme, Center};
use wiredash_core::collections::agents::Agents;
use wiredash_core::types::Agent;
use wiredash_db::Database;

/// Default agents seeded on first load.
const DEFAULT_AGENTS: &[(&str, &str, &str)] = &[
    ("Orchestrator", "orchestrator", "Coordinates all other agents and manages workflows."),
    ("Comms", "communications", "Handles email drafting, message triage, and notifications."),
    ("Research", "research", "Web research, document analysis, and information synthesis."),
    ("TaskMaster", "task_management", "Task creation, prioritization, scheduling, and tracking."),
    ("Code", "development", "Code analysis, generation, review, and debugging."),
];

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum AgentsMessage {
    Refresh,
    SelectAgent(usize),
    UpdateStatus(String),
    SetName(String),
    SetRole(String),
    SetModel(String),
    SetSystemPrompt(String),
    SaveAgent,
    DeleteAgent,
    NewAgent,
}

pub struct AgentsViewState {
    pub agent_list: Vec<Agent>,
    pub selected_index: Option<usize>,
    // Form
    pub form_name: String,
    pub form_role: String,
    pub form_model: String,
    pub form_system_prompt: String,
    pub editing_id: Option<String>,
}

impl AgentsViewState {
    pub fn new() -> Self {
        Self {
            agent_list: Vec::new(),
            selected_index: None,
            form_name: String::new(),
            form_role: String::new(),
            form_model: String::new(),
            form_system_prompt: String::new(),
            editing_id: None,
        }
    }

    pub fn refresh(&mut self, db: &Database) {
        self.agent_list = Agents::new(db).list(None).unwrap_or_default();

        // Seed defaults if empty
        if self.agent_list.is_empty() {
            let agents_coll = Agents::new(db);
            for (name, role, prompt) in DEFAULT_AGENTS {
                let mut agent = Agent::new(name, role);
                agent.system_prompt = Some(prompt.to_string());
                agent.model = Some("claude-opus-4-6".into());
                agent.capabilities = Some(vec![role.to_string()]);
                let _ = agents_coll.add(&agent);
            }
            self.agent_list = agents_coll.list(None).unwrap_or_default();
        }
    }

    fn load_agent_into_form(&mut self, agent: &Agent) {
        self.form_name = agent.name.clone();
        self.form_role = agent.role.clone();
        self.form_model = agent.model.clone().unwrap_or_default();
        self.form_system_prompt = agent.system_prompt.clone().unwrap_or_default();
        self.editing_id = Some(agent.base.id.clone());
    }

    fn clear_form(&mut self) {
        self.form_name.clear();
        self.form_role.clear();
        self.form_model.clear();
        self.form_system_prompt.clear();
        self.editing_id = None;
        self.selected_index = None;
    }

    pub fn update(&mut self, msg: AgentsMessage, db: &Database) {
        match msg {
            AgentsMessage::Refresh => self.refresh(db),
            AgentsMessage::SelectAgent(idx) => {
                self.selected_index = Some(idx);
                if let Some(agent) = self.agent_list.get(idx).cloned() {
                    self.load_agent_into_form(&agent);
                }
            }
            AgentsMessage::UpdateStatus(status) => {
                if let Some(ref id) = self.editing_id {
                    let _ = Agents::new(db).update_status(id, &status);
                    self.refresh(db);
                }
            }
            AgentsMessage::SetName(s) => self.form_name = s,
            AgentsMessage::SetRole(s) => self.form_role = s,
            AgentsMessage::SetModel(s) => self.form_model = s,
            AgentsMessage::SetSystemPrompt(s) => self.form_system_prompt = s,
            AgentsMessage::SaveAgent => {
                if self.form_name.is_empty() {
                    return;
                }
                let agents = Agents::new(db);
                if self.editing_id.is_none() {
                    let mut agent = Agent::new(&self.form_name, &self.form_role);
                    agent.model = if self.form_model.is_empty() {
                        None
                    } else {
                        Some(self.form_model.clone())
                    };
                    agent.system_prompt = if self.form_system_prompt.is_empty() {
                        None
                    } else {
                        Some(self.form_system_prompt.clone())
                    };
                    let _ = agents.add(&agent);
                }
                // TODO: update existing agent fields
                self.refresh(db);
                self.clear_form();
            }
            AgentsMessage::DeleteAgent => {
                if let Some(ref id) = self.editing_id {
                    let _ = Agents::new(db).remove(id);
                    self.refresh(db);
                    self.clear_form();
                }
            }
            AgentsMessage::NewAgent => self.clear_form(),
        }
    }
}

pub fn agents_view<'a>(
    state: &'a AgentsViewState,
    _theme: &Theme,
) -> Element<'a, AgentsMessage> {
    let header = row![
        text("Agents").size(20),
        space::horizontal(),
        button(text("+ New Agent").size(11))
            .on_press(AgentsMessage::NewAgent)
            .padding([4, 12])
            .style(button::primary),
    ]
    .align_y(Center);

    // Card grid (2 columns)
    let mut grid_rows: Vec<Element<'_, AgentsMessage>> = Vec::new();
    let mut row_cards: Vec<Element<'_, AgentsMessage>> = Vec::new();

    for (idx, agent) in state.agent_list.iter().enumerate() {
        let is_selected = state.selected_index == Some(idx);
        let card = agent_card(agent, idx, is_selected);
        row_cards.push(card);

        if row_cards.len() == 2 {
            grid_rows.push(row(std::mem::take(&mut row_cards)).spacing(12).into());
        }
    }
    if !row_cards.is_empty() {
        grid_rows.push(row(row_cards).spacing(12).into());
    }

    let grid = column(grid_rows).spacing(12);

    // Detail panel
    let detail = agent_detail(state);

    let content = row![
        container(scrollable(
            column![header, space::vertical().height(12), grid].spacing(4).width(Fill),
        ))
        .padding(16)
        .width(Fill)
        .height(Fill),
        rule::vertical(1),
        container(scrollable(detail))
            .padding(16)
            .width(350)
            .height(Fill),
    ];

    container(content)
        .width(Fill)
        .height(Fill)
        .into()
}

fn agent_card<'a>(
    agent: &'a Agent,
    idx: usize,
    is_selected: bool,
) -> Element<'a, AgentsMessage> {
    let status_color = match agent.status.as_str() {
        "active" => iced::Color::from_rgb8(0x00, 0xC0, 0x00),
        "busy" => iced::Color::from_rgb8(0xFF, 0x8C, 0x00),
        "error" => iced::Color::from_rgb8(0xE0, 0x00, 0x00),
        _ => iced::Color::from_rgb8(0x80, 0x80, 0x80),
    };

    let content = column![
        row![
            text("●").size(10).color(status_color),
            text(&agent.name).size(14),
        ]
        .spacing(6)
        .align_y(Center),
        text(&agent.role).size(10).color(iced::Color::from_rgb8(0x80, 0x80, 0x80)),
        text(&agent.status).size(9).color(status_color),
    ]
    .spacing(4);

    button(container(content).padding(12))
        .on_press(AgentsMessage::SelectAgent(idx))
        .width(Fill)
        .style(move |theme: &Theme, status| {
            let palette = theme.extended_palette();
            let mut style = button::secondary(theme, status);
            style.background = Some(iced::Background::Color(palette.background.weak.color));
            style.border = iced::Border {
                width: if is_selected { 2.0 } else { 1.0 },
                color: if is_selected {
                    iced::Color::from_rgb8(0xE0, 0x00, 0x00)
                } else {
                    palette.background.strong.color
                },
                radius: 8.0.into(),
            };
            style
        })
        .into()
}

fn agent_detail<'a>(state: &'a AgentsViewState) -> Element<'a, AgentsMessage> {
    let title = if state.editing_id.is_some() {
        "Agent Configuration"
    } else {
        "New Agent"
    };

    let mut items: Vec<Element<'_, AgentsMessage>> = vec![
        text(title).size(16).into(),
        rule::horizontal(1).into(),
        text("Name").size(11).into(),
        text_input("Agent name...", &state.form_name)
            .on_input(AgentsMessage::SetName)
            .size(12)
            .padding(6)
            .into(),
        text("Role").size(11).into(),
        text_input("Role...", &state.form_role)
            .on_input(AgentsMessage::SetRole)
            .size(12)
            .padding(6)
            .into(),
        text("Model").size(11).into(),
        text_input("e.g. claude-opus-4-6", &state.form_model)
            .on_input(AgentsMessage::SetModel)
            .size(12)
            .padding(6)
            .into(),
        text("System Prompt").size(11).into(),
        text_input("System prompt...", &state.form_system_prompt)
            .on_input(AgentsMessage::SetSystemPrompt)
            .size(12)
            .padding(6)
            .into(),
        space::vertical().height(8).into(),
    ];

    // Action buttons
    let mut actions: Vec<Element<'_, AgentsMessage>> = vec![
        button(text("Save").size(12))
            .on_press(AgentsMessage::SaveAgent)
            .padding([6, 16])
            .style(button::primary)
            .into(),
    ];
    if state.editing_id.is_some() {
        actions.push(
            button(text("Activate").size(12))
                .on_press(AgentsMessage::UpdateStatus("active".into()))
                .padding([6, 16])
                .style(button::success)
                .into(),
        );
        actions.push(
            button(text("Deactivate").size(12))
                .on_press(AgentsMessage::UpdateStatus("idle".into()))
                .padding([6, 16])
                .style(button::secondary)
                .into(),
        );
        actions.push(
            button(text("Delete").size(12))
                .on_press(AgentsMessage::DeleteAgent)
                .padding([6, 16])
                .style(button::danger)
                .into(),
        );
    }
    items.push(row(actions).spacing(8).into());

    column(items).spacing(6).into()
}
