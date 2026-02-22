use crate::icons;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Section {
    Workspace,
    Tools,
    Developer,
    Organize,
}

impl Section {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Workspace => "WORKSPACE",
            Self::Tools => "TOOLS",
            Self::Developer => "DEVELOPER",
            Self::Organize => "ORGANIZE",
        }
    }

    pub const ALL: &'static [Section] = &[
        Section::Workspace,
        Section::Tools,
        Section::Developer,
        Section::Organize,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum View {
    Dashboard, Control, Notes, Notebooks, Tags, Search, Tasks, Calendar, AgentChat, Terminal, Files,
    Agents, Spreadsheets, Communications, Newsletters, CallQueue,
    Git, Conversations, Workspaces, CodeSearch, Diagnostics,
    Favorites, Archive, Trash,
}

impl View {
    pub fn title(&self) -> &'static str {
        match self {
            Self::Dashboard => "Dashboard",
            Self::Control => "Control",
            Self::Notes => "Notes",
            Self::Notebooks => "Notebooks",
            Self::Tags => "Tags",
            Self::Search => "Search",
            Self::Tasks => "Tasks",
            Self::Calendar => "Calendar",
            Self::AgentChat => "Agent Chat",
            Self::Terminal => "Terminal",
            Self::Files => "Files",
            Self::Agents => "Agents",
            Self::Spreadsheets => "Spreadsheets",
            Self::Communications => "Communications",
            Self::Newsletters => "Newsletters",
            Self::CallQueue => "Call Queue",
            Self::Git => "Git",
            Self::Conversations => "Conversations",
            Self::Workspaces => "Workspaces",
            Self::CodeSearch => "Code Search",
            Self::Diagnostics => "Diagnostics",
            Self::Favorites => "Favorites",
            Self::Archive => "Archive",
            Self::Trash => "Trash",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            Self::Dashboard => icons::DASHBOARD,
            Self::Control => icons::CONTROL,
            Self::Notes => icons::NOTE,
            Self::Notebooks => icons::NOTEBOOK,
            Self::Tags => icons::TAG,
            Self::Search => icons::SEARCH,
            Self::Tasks => icons::TASKS,
            Self::Calendar => icons::CALENDAR,
            Self::AgentChat => icons::CHAT,
            Self::Terminal => icons::TERMINAL,
            Self::Files => icons::FILE,
            Self::Agents => icons::ROBOT,
            Self::Spreadsheets => icons::TABLE,
            Self::Communications => icons::MESSAGE,
            Self::Newsletters => icons::NEWSPAPER,
            Self::CallQueue => icons::PHONE,
            Self::Git => icons::GIT,
            Self::Conversations => icons::FORUM,
            Self::Workspaces => icons::WORKSPACES,
            Self::CodeSearch => icons::SEARCH,
            Self::Diagnostics => icons::ISSUE,
            Self::Favorites => icons::STAR,
            Self::Archive => icons::ARCHIVE,
            Self::Trash => icons::TRASH,
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::Dashboard => "Mission control: stats, schedule, priorities, activity feed.",
            Self::Control => "System monitoring and automation control center.",
            Self::Notes => "All notes — create, edit, search, and organize.",
            Self::Notebooks => "Organize notes into notebooks.",
            Self::Tags => "Manage tags and filter notes by tag.",
            Self::Search => "Full-text search across all notes and content.",
            Self::Tasks => "Task tracking with status, priority, and assignees.",
            Self::Calendar => "Week view calendar with agent-managed events.",
            Self::AgentChat => "Chat with AI agents for assistance and automation.",
            Self::Terminal => "Integrated terminal emulator.",
            Self::Files => "File explorer with navigation and file operations.",
            Self::Agents => "Manage AI agents: Orchestrator, Comms, Research, TaskMaster, Code.",
            Self::Spreadsheets => "Editable data tables and spreadsheets.",
            Self::Communications => "Unified inbox: email, messages, phone — with AI triage.",
            Self::Newsletters => "Newsletter management and reading.",
            Self::CallQueue => "Phone call queue and callback management.",
            Self::Git => "Git status, branches, commits, and diffs.",
            Self::Conversations => "Team conversations and discussion threads.",
            Self::Workspaces => "Workspace management and switching.",
            Self::CodeSearch => "Search code across repositories.",
            Self::Diagnostics => "System diagnostics and health checks.",
            Self::Favorites => "Starred notes and notebooks.",
            Self::Archive => "Archived notes.",
            Self::Trash => "Deleted items — restore or permanently delete.",
        }
    }

    pub fn section(&self) -> Section {
        match self {
            Self::Dashboard | Self::Control | Self::Notes | Self::Notebooks | Self::Tags | Self::Search | Self::Tasks |
            Self::Calendar | Self::AgentChat | Self::Terminal | Self::Files => Section::Workspace,
            Self::Agents | Self::Spreadsheets | Self::Communications |
            Self::Newsletters | Self::CallQueue => Section::Tools,
            Self::Git | Self::Conversations | Self::Workspaces |
            Self::CodeSearch | Self::Diagnostics => Section::Developer,
            Self::Favorites | Self::Archive | Self::Trash => Section::Organize,
        }
    }

    pub const ALL: &'static [View] = &[
        View::Dashboard, View::Control, View::Notes, View::Notebooks, View::Tags, View::Search,
        View::Tasks, View::Calendar, View::AgentChat, View::Terminal, View::Files,
        View::Agents, View::Spreadsheets, View::Communications,
        View::Newsletters, View::CallQueue,
        View::Git, View::Conversations, View::Workspaces,
        View::CodeSearch, View::Diagnostics,
        View::Favorites, View::Archive, View::Trash,
    ];

    pub fn for_section(section: Section) -> Vec<View> {
        Self::ALL.iter()
            .filter(|v| v.section() == section)
            .copied()
            .collect()
    }
}
