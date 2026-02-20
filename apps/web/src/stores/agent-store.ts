/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import createStore from "../common/store";
import BaseStore from "./index";
import { getOpenClawClient } from "../utils/openclaw-client";
import { useStore as useOpenClawStore } from "./openclaw-store";

// ── Agent Types ──

export type AgentStatus = "idle" | "running" | "error" | "offline";

export type AgentCapability =
  | "task-management"
  | "email"
  | "messaging"
  | "phone"
  | "scheduling"
  | "data-analysis"
  | "code-review"
  | "content-writing"
  | "research";

export type AgentActivityEntry = {
  id: string;
  timestamp: number;
  type: "info" | "action" | "error" | "result";
  message: string;
  metadata?: Record<string, unknown>;
};

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  capabilities: AgentCapability[];
  model: string;
  avatar: string; // emoji or icon identifier
  createdAt: number;
  lastActiveAt: number;
  tasksCompleted: number;
  tasksInProgress: number;
  activity: AgentActivityEntry[];
  config: Record<string, unknown>;
  tokenUsage: TokenUsage;
  costEstimate: number;
  memory: Record<string, string>;
};

// ── Default Agents (Claude Pipeline) ──

function createDefaultAgents(): Agent[] {
  const now = Date.now();
  return [
    {
      id: "agent-orchestrator",
      name: "Orchestrator",
      description:
        "Master coordinator. Routes tasks to specialized agents, manages workflows, and ensures nothing falls through the cracks.",
      status: "idle",
      capabilities: ["task-management", "scheduling"],
      model: "claude-opus-4-6",
      avatar: "🧠",
      createdAt: now,
      lastActiveAt: now,
      tasksCompleted: 0,
      tasksInProgress: 0,
      activity: [
        {
          id: "init-1",
          timestamp: now,
          type: "info",
          message: "Orchestrator initialized. Ready to coordinate agents."
        }
      ],
      config: { maxConcurrentTasks: 5, escalationThreshold: 3 },
      tokenUsage: { input: 0, output: 0, total: 0 },
      costEstimate: 0,
      memory: { role: "coordinator", priority_strategy: "urgency-first" }
    },
    {
      id: "agent-comms",
      name: "Comms Agent",
      description:
        "Handles all business communications — email triage, message drafting, follow-up scheduling, and phone log management.",
      status: "idle",
      capabilities: ["email", "messaging", "phone"],
      model: "claude-sonnet-4-5-20250929",
      avatar: "📡",
      createdAt: now,
      lastActiveAt: now,
      tasksCompleted: 0,
      tasksInProgress: 0,
      activity: [
        {
          id: "init-2",
          timestamp: now,
          type: "info",
          message: "Comms Agent online. Monitoring email, messages, and phone."
        }
      ],
      config: { autoTriageEnabled: true, draftReviewRequired: true },
      tokenUsage: { input: 0, output: 0, total: 0 },
      costEstimate: 0,
      memory: { inbox_rules: "triage by sender priority", tone: "professional" }
    },
    {
      id: "agent-researcher",
      name: "Research Agent",
      description:
        "Deep research and analysis. Gathers information, summarizes findings, and produces actionable intelligence.",
      status: "idle",
      capabilities: ["research", "data-analysis", "content-writing"],
      model: "claude-sonnet-4-5-20250929",
      avatar: "🔬",
      createdAt: now,
      lastActiveAt: now,
      tasksCompleted: 0,
      tasksInProgress: 0,
      activity: [
        {
          id: "init-3",
          timestamp: now,
          type: "info",
          message: "Research Agent ready. Standing by for analysis tasks."
        }
      ],
      config: { maxSearchDepth: 3, citeSources: true },
      tokenUsage: { input: 0, output: 0, total: 0 },
      costEstimate: 0,
      memory: { preferred_sources: "academic, official docs", depth: "thorough" }
    },
    {
      id: "agent-taskmaster",
      name: "TaskMaster",
      description:
        "Task tracking and project management. Creates, prioritizes, and tracks tasks. Sends reminders and escalates blockers.",
      status: "idle",
      capabilities: ["task-management", "scheduling"],
      model: "claude-sonnet-4-5-20250929",
      avatar: "📋",
      createdAt: now,
      lastActiveAt: now,
      tasksCompleted: 0,
      tasksInProgress: 0,
      activity: [
        {
          id: "init-4",
          timestamp: now,
          type: "info",
          message: "TaskMaster online. Tracking all active projects."
        }
      ],
      config: { autoAssign: true, dailyDigest: true },
      tokenUsage: { input: 0, output: 0, total: 0 },
      costEstimate: 0,
      memory: { workflow: "kanban", escalation_after: "24h" }
    },
    {
      id: "agent-coder",
      name: "Code Agent",
      description:
        "Code review, bug fixing, and development tasks. Integrates with your repositories and CI/CD pipelines.",
      status: "offline",
      capabilities: ["code-review", "research"],
      model: "claude-opus-4-6",
      avatar: "💻",
      createdAt: now,
      lastActiveAt: now,
      tasksCompleted: 0,
      tasksInProgress: 0,
      activity: [
        {
          id: "init-5",
          timestamp: now,
          type: "info",
          message: "Code Agent initialized. Awaiting repository connection."
        }
      ],
      config: { autoReview: false, languages: ["typescript", "python", "mql5"] },
      tokenUsage: { input: 0, output: 0, total: 0 },
      costEstimate: 0,
      memory: { repo: "Workstation", branch: "master", linter: "eslint" }
    }
  ];
}

// ── Agent Stream Types ──

export type StreamLineType =
  | "stdout"
  | "stderr"
  | "tool_call"
  | "thinking"
  | "result"
  | "info"
  | "error";

export type StreamLine = {
  timestamp: number;
  type: StreamLineType;
  content: string;
};

export type AgentStream = {
  agentId: string;
  workspaceId: string | null;
  lines: StreamLine[];
  isActive: boolean;
};

const MAX_STREAM_LINES = 1000;

// ── Agent Store ──

class AgentStore extends BaseStore<AgentStore> {
  agents: Agent[] = createDefaultAgents();
  selectedAgentId: string | null = null;
  isLoading = false;
  agentStreams: AgentStream[] = [];

  get selectedAgent(): Agent | undefined {
    return this.agents.find((a) => a.id === this.selectedAgentId);
  }

  refresh = () => {
    // In future: fetch agent status from backend
    this.set((state) => {
      state.agents = [...state.agents];
    });
  };

  selectAgent = (id: string | null) => {
    this.set((state) => {
      state.selectedAgentId = id;
    });
  };

  updateAgentStatus = (agentId: string, status: AgentStatus) => {
    this.set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (agent) {
        agent.status = status;
        agent.lastActiveAt = Date.now();
      }
    });
  };

  addActivity = (agentId: string, entry: Omit<AgentActivityEntry, "id">) => {
    this.set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (agent) {
        agent.activity.unshift({
          ...entry,
          id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        });
        // Keep last 100 entries
        if (agent.activity.length > 100) {
          agent.activity = agent.activity.slice(0, 100);
        }
        agent.lastActiveAt = Date.now();
      }
    });
  };

  startAgent = async (agentId: string) => {
    this.updateAgentStatus(agentId, "running");

    const agent = this.get().agents.find((a) => a.id === agentId);
    const ocState = useOpenClawStore.getState();

    // If OpenClaw is connected, spawn a session for this agent
    if (ocState.connectionState === "connected" && agent) {
      try {
        const client = getOpenClawClient();
        const result = await client.sessionSpawn({
          agent: agent.name.toLowerCase().replace(/\s+/g, "-"),
          model: agent.model,
          system_prompt: `You are ${agent.name}. ${agent.description}`
        });
        this.addActivity(agentId, {
          timestamp: Date.now(),
          type: "action",
          message: `OpenClaw session started: ${result.session_id.slice(0, 12)}...`,
          metadata: { sessionId: result.session_id }
        });

        // Register session in openclaw store
        useOpenClawStore.getState().setActiveSession(result.session_id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to start";
        this.addActivity(agentId, {
          timestamp: Date.now(),
          type: "error",
          message: `OpenClaw error: ${msg}. Running in local mode.`
        });
      }
    } else {
      this.addActivity(agentId, {
        timestamp: Date.now(),
        type: "info",
        message: "Agent started (local mode)."
      });
    }
  };

  stopAgent = (agentId: string) => {
    this.updateAgentStatus(agentId, "idle");
    this.addActivity(agentId, {
      timestamp: Date.now(),
      type: "info",
      message: "Agent stopped."
    });
  };

  getAgentsByCapability = (capability: AgentCapability): Agent[] => {
    return this.get().agents.filter((a) =>
      a.capabilities.includes(capability)
    );
  };

  getActiveAgents = (): Agent[] => {
    return this.get().agents.filter((a) => a.status === "running");
  };

  updateTokenUsage = (agentId: string, usage: Partial<TokenUsage>) => {
    this.set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (agent) {
        if (usage.input !== undefined) agent.tokenUsage.input += usage.input;
        if (usage.output !== undefined) agent.tokenUsage.output += usage.output;
        agent.tokenUsage.total = agent.tokenUsage.input + agent.tokenUsage.output;
        // Estimate cost: ~$3/M input, ~$15/M output for Opus; ~$0.80/$4 for Sonnet
        const isOpus = agent.model.includes("opus");
        const inputRate = isOpus ? 15 / 1_000_000 : 3 / 1_000_000;
        const outputRate = isOpus ? 75 / 1_000_000 : 15 / 1_000_000;
        agent.costEstimate =
          agent.tokenUsage.input * inputRate +
          agent.tokenUsage.output * outputRate;
      }
    });
  };

  updateAgentMemory = (agentId: string, key: string, value: string) => {
    this.set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (agent) {
        agent.memory[key] = value;
      }
    });
  };

  deleteAgentMemory = (agentId: string, key: string) => {
    this.set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (agent) {
        delete agent.memory[key];
      }
    });
  };

  getTotalCost = (): number => {
    return this.get().agents.reduce((sum, a) => sum + a.costEstimate, 0);
  };

  getTotalTokens = (): number => {
    return this.get().agents.reduce((sum, a) => sum + a.tokenUsage.total, 0);
  };

  // ── Agent Stream Methods ──

  appendStreamLine = (
    agentId: string,
    type: StreamLineType,
    content: string,
    workspaceId?: string | null
  ) => {
    this.set((state) => {
      let stream = state.agentStreams.find((s) => s.agentId === agentId);
      if (!stream) {
        stream = {
          agentId,
          workspaceId: workspaceId ?? null,
          lines: [],
          isActive: true
        };
        state.agentStreams.push(stream);
      }
      stream.lines.push({ timestamp: Date.now(), type, content });
      // FIFO: keep max lines
      if (stream.lines.length > MAX_STREAM_LINES) {
        stream.lines = stream.lines.slice(
          stream.lines.length - MAX_STREAM_LINES
        );
      }
      stream.isActive = true;
    });
  };

  clearStream = (agentId: string) => {
    this.set((state) => {
      const stream = state.agentStreams.find((s) => s.agentId === agentId);
      if (stream) {
        stream.lines = [];
      }
    });
  };

  setStreamActive = (agentId: string, active: boolean) => {
    this.set((state) => {
      const stream = state.agentStreams.find((s) => s.agentId === agentId);
      if (stream) {
        stream.isActive = active;
      }
    });
  };

  getActiveStreams = (): AgentStream[] => {
    return this.get().agentStreams.filter((s) => s.isActive);
  };
}

const [useStore, store] = createStore<AgentStore>(
  (set, get) => new AgentStore(set, get)
);

export { useStore, store };
