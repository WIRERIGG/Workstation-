/*
This file is part of the Workstation project

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
import { registerStoreForHydration } from "../utils/workstation-hydrate";
import {
  getOpenClawClient,
  resetOpenClawClient,
  ConnectionState,
  type OpenClawClient,
  type ChannelStatusPayload,
  type GatewaySession,
  type CronJob,
  type GatewaySkill,
  type ExecApproval,
  type ConfigSchemaNode,
  type TokenUsageEntry,
  type PresenceNode
} from "../utils/openclaw-client";

export type {
  ChannelStatusPayload,
  GatewaySession,
  CronJob,
  GatewaySkill,
  ExecApproval,
  ConfigSchemaNode,
  TokenUsageEntry,
  PresenceNode
};

// ── Persistence Helpers ──

const STORAGE_KEY = "workstation:openclaw-settings";

function loadSettings(): {
  gatewayUrl: string;
  authToken: string;
  autoReconnect: boolean;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {
    gatewayUrl: "ws://127.0.0.1:18789",
    authToken: "",
    autoReconnect: true
  };
}

function saveSettings(settings: {
  gatewayUrl: string;
  authToken: string;
  autoReconnect: boolean;
}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }

  // Write-through to Electron backend (fire-and-forget)
  if (IS_DESKTOP_APP) {
    import("../common/desktop-bridge").then(({ desktop }) => {
      desktop?.workstationData.save
        .mutate({ key: "openclaw-settings", data: settings })
        .catch(console.error);
    });
  }
}

// ── Types ──

export type GatewayInfo = {
  version?: string;
  connectedAt?: number;
  sessionCount?: number;
  agentCount?: number;
};

export type OpenClawSession = {
  id: string;
  agent?: string;
  model?: string;
  createdAt: number;
  status: "active" | "completed" | "error";
};

export type ActiveToolCall = {
  toolId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  startedAt: number;
  result?: unknown;
  error?: string;
};

// ── OpenClaw Store ──

class OpenClawStore extends BaseStore<OpenClawStore> {
  // Connection settings (user-configurable, persisted)
  gatewayUrl = loadSettings().gatewayUrl;
  authToken = loadSettings().authToken;
  autoReconnect = loadSettings().autoReconnect;

  // Connection state
  connectionState: ConnectionState = "disconnected";
  connectionError: string | null = null;
  lastConnectedAt: number | null = null;

  // Gateway info
  gatewayInfo: GatewayInfo = {};

  // Sessions
  sessions: OpenClawSession[] = [];
  activeSessionId: string | null = null;

  // Active tool calls (shown in UI during streaming)
  activeToolCalls: ActiveToolCall[] = [];

  // Streaming state
  isStreaming = false;
  streamBuffer = "";

  // ── Control Panel State ──

  // Channels
  channels: ChannelStatusPayload[] = [];
  channelsLoading = false;

  // Gateway Sessions (full list from gateway)
  gatewaySessions: GatewaySession[] = [];
  gatewaySessionsLoading = false;

  // Cron
  cronJobs: CronJob[] = [];
  cronLoading = false;

  // Skills
  skills: GatewaySkill[] = [];
  skillsLoading = false;

  // Exec
  execApprovals: ExecApproval[] = [];
  execAllowlist: string[] = [];
  execLoading = false;

  // Config
  configData: Record<string, unknown> = {};
  configSchema: Record<string, ConfigSchemaNode> = {};
  configHash: string | null = null;
  configLoading = false;
  configDirty = false;

  // Token Usage
  tokenUsage: TokenUsageEntry[] = [];
  tokenUsageLoading = false;

  // Presence
  presenceNodes: PresenceNode[] = [];
  presenceLoading = false;

  // ── Connection Methods ──

  connect = async () => {
    const client = getOpenClawClient();
    client.configure({
      gatewayUrl: this.get().gatewayUrl,
      authToken: this.get().authToken,
      autoReconnect: this.get().autoReconnect
    });

    // Set up event listeners before connecting
    this.setupEventListeners(client);

    this.set((state) => {
      state.connectionState = "connecting";
      state.connectionError = null;
    });

    try {
      await client.connect();
      this.set((state) => {
        state.connectionState = "connected";
        state.lastConnectedAt = Date.now();
        state.gatewayInfo.connectedAt = Date.now();
      });
      // Auto-refresh control panel data
      this.refreshChannels();
      this.refreshGatewaySessions();
      this.refreshPresence();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      this.set((state) => {
        state.connectionState = "error";
        state.connectionError = message;
      });
      throw err;
    }
  };

  disconnect = () => {
    const client = getOpenClawClient();
    client.disconnect();
    this.set((state) => {
      state.connectionState = "disconnected";
      state.isStreaming = false;
      state.streamBuffer = "";
      state.activeToolCalls = [];
    });
  };

  reconnect = async () => {
    resetOpenClawClient();
    await this.connect();
  };

  // ── Settings ──

  setGatewayUrl = (url: string) => {
    this.set((state) => {
      state.gatewayUrl = url;
    });
    this.persistSettings();
  };

  setAuthToken = (token: string) => {
    this.set((state) => {
      state.authToken = token;
    });
    this.persistSettings();
  };

  setAutoReconnect = (enabled: boolean) => {
    this.set((state) => {
      state.autoReconnect = enabled;
    });
    this.persistSettings();
  };

  private persistSettings = () => {
    const s = this.get();
    saveSettings({
      gatewayUrl: s.gatewayUrl,
      authToken: s.authToken,
      autoReconnect: s.autoReconnect
    });
  };

  // ── Session Management ──

  spawnSession = async (options?: {
    agent?: string;
    model?: string;
    systemPrompt?: string;
    tools?: string[];
  }) => {
    const client = getOpenClawClient();
    const result = await client.sessionSpawn({
      agent: options?.agent,
      model: options?.model,
      system_prompt: options?.systemPrompt,
      tools: options?.tools
    });

    const session: OpenClawSession = {
      id: result.session_id,
      agent: options?.agent,
      model: options?.model,
      createdAt: Date.now(),
      status: "active"
    };

    this.set((state) => {
      state.sessions.push(session);
      state.activeSessionId = session.id;
      state.gatewayInfo.sessionCount = (state.gatewayInfo.sessionCount || 0) + 1;
    });

    return session;
  };

  setActiveSession = (sessionId: string | null) => {
    this.set((state) => {
      state.activeSessionId = sessionId;
    });
  };

  // ── Agent Task Execution ──

  runAgentTask = async (task: string, agent?: string) => {
    const client = getOpenClawClient();
    const sessionId = this.get().activeSessionId || undefined;

    const result = await client.agentRun({
      task,
      agent,
      session_id: sessionId
    });

    return result.task_id;
  };

  waitForAgent = async (taskId: string, timeout?: number) => {
    const client = getOpenClawClient();
    return client.agentWait({ task_id: taskId, timeout });
  };

  // ── Control Panel Actions ──

  // Channels
  refreshChannels = async () => {
    const client = getOpenClawClient();
    this.set((s) => { s.channelsLoading = true; });
    try {
      const result = await client.channelsStatus();
      this.set((s) => { s.channels = result.channels; s.channelsLoading = false; });
    } catch {
      this.set((s) => { s.channelsLoading = false; });
    }
  };

  // Gateway Sessions
  refreshGatewaySessions = async () => {
    const client = getOpenClawClient();
    this.set((s) => { s.gatewaySessionsLoading = true; });
    try {
      const result = await client.sessionsList();
      this.set((s) => { s.gatewaySessions = result.sessions; s.gatewaySessionsLoading = false; });
    } catch {
      this.set((s) => { s.gatewaySessionsLoading = false; });
    }
  };

  patchGatewaySession = async (id: string, patch: Partial<Pick<GatewaySession, "thinking" | "verbose">>) => {
    const client = getOpenClawClient();
    await client.sessionsPatch(id, patch);
    this.set((s) => {
      const session = s.gatewaySessions.find((gs) => gs.id === id);
      if (session) Object.assign(session, patch);
    });
  };

  // Cron
  refreshCronJobs = async () => {
    const client = getOpenClawClient();
    this.set((s) => { s.cronLoading = true; });
    try {
      const result = await client.cronList();
      this.set((s) => { s.cronJobs = result.jobs; s.cronLoading = false; });
    } catch {
      this.set((s) => { s.cronLoading = false; });
    }
  };

  createCronJob = async (job: Omit<CronJob, "id" | "last_run" | "next_run" | "run_count">) => {
    const client = getOpenClawClient();
    await client.cronCreate(job);
    await this.refreshCronJobs();
  };

  updateCronJob = async (id: string, patch: Partial<Omit<CronJob, "id">>) => {
    const client = getOpenClawClient();
    await client.cronUpdate(id, patch);
    this.set((s) => {
      const job = s.cronJobs.find((j) => j.id === id);
      if (job) Object.assign(job, patch);
    });
  };

  deleteCronJob = async (id: string) => {
    const client = getOpenClawClient();
    await client.cronDelete(id);
    this.set((s) => { s.cronJobs = s.cronJobs.filter((j) => j.id !== id); });
  };

  runCronJobNow = async (id: string) => {
    const client = getOpenClawClient();
    await client.cronRun(id);
  };

  // Skills
  refreshSkills = async () => {
    const client = getOpenClawClient();
    this.set((s) => { s.skillsLoading = true; });
    try {
      const result = await client.skillsList();
      this.set((s) => { s.skills = result.skills; s.skillsLoading = false; });
    } catch {
      this.set((s) => { s.skillsLoading = false; });
    }
  };

  toggleSkill = async (id: string, enabled: boolean) => {
    const client = getOpenClawClient();
    if (enabled) await client.skillsEnable(id);
    else await client.skillsDisable(id);
    this.set((s) => {
      const skill = s.skills.find((sk) => sk.id === id);
      if (skill) skill.enabled = enabled;
    });
  };

  installSkill = async (id: string) => {
    const client = getOpenClawClient();
    await client.skillsInstall(id);
    this.set((s) => {
      const skill = s.skills.find((sk) => sk.id === id);
      if (skill) skill.installed = true;
    });
  };

  setSkillApiKey = async (id: string, key: string) => {
    const client = getOpenClawClient();
    await client.skillsSetApiKey(id, key);
  };

  // Exec Approvals
  refreshExecApprovals = async () => {
    const client = getOpenClawClient();
    this.set((s) => { s.execLoading = true; });
    try {
      const result = await client.execApprovalsList();
      this.set((s) => { s.execApprovals = result.approvals; s.execLoading = false; });
    } catch {
      this.set((s) => { s.execLoading = false; });
    }
  };

  updateExecApproval = async (id: string, status: "approved" | "denied") => {
    const client = getOpenClawClient();
    await client.execApprovalUpdate(id, status);
    this.set((s) => {
      const approval = s.execApprovals.find((a) => a.id === id);
      if (approval) approval.status = status;
    });
  };

  refreshExecAllowlist = async () => {
    const client = getOpenClawClient();
    try {
      const result = await client.execAllowlistGet();
      this.set((s) => { s.execAllowlist = result.patterns; });
    } catch {
      // ignore
    }
  };

  setExecAllowlist = async (patterns: string[]) => {
    const client = getOpenClawClient();
    await client.execAllowlistSet(patterns);
    this.set((s) => { s.execAllowlist = patterns; });
  };

  // Config
  loadConfig = async () => {
    const client = getOpenClawClient();
    this.set((s) => { s.configLoading = true; });
    try {
      const [configResult, schemaResult] = await Promise.all([
        client.configGet(),
        client.configSchema()
      ]);
      this.set((s) => {
        s.configData = configResult.config;
        s.configHash = configResult.hash;
        s.configSchema = schemaResult.schema;
        s.configLoading = false;
        s.configDirty = false;
      });
    } catch {
      this.set((s) => { s.configLoading = false; });
    }
  };

  patchConfigLocal = (path: string, value: unknown) => {
    this.set((s) => {
      const keys = path.split(".");
      let obj = s.configData as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) {
        if (typeof obj[keys[i]] !== "object" || obj[keys[i]] === null) {
          obj[keys[i]] = {};
        }
        obj = obj[keys[i]] as Record<string, unknown>;
      }
      obj[keys[keys.length - 1]] = value;
      s.configDirty = true;
    });
  };

  applyConfig = async () => {
    const client = getOpenClawClient();
    const state = this.get();
    // Send each top-level key as a patch
    for (const [key, value] of Object.entries(state.configData)) {
      await client.configPatch({ path: key, value });
    }
    await client.configApply();
    // Reload to get fresh hash
    await this.loadConfig();
  };

  revertConfig = async () => {
    await this.loadConfig();
  };

  // Token Usage
  refreshTokenUsage = async (window?: string) => {
    const client = getOpenClawClient();
    this.set((s) => { s.tokenUsageLoading = true; });
    try {
      const result = await client.tokenUsage(window ? { window } : undefined);
      this.set((s) => { s.tokenUsage = result.entries; s.tokenUsageLoading = false; });
    } catch {
      this.set((s) => { s.tokenUsageLoading = false; });
    }
  };

  // Presence
  refreshPresence = async () => {
    const client = getOpenClawClient();
    this.set((s) => { s.presenceLoading = true; });
    try {
      const result = await client.systemPresence();
      this.set((s) => { s.presenceNodes = result.nodes; s.presenceLoading = false; });
    } catch {
      this.set((s) => { s.presenceLoading = false; });
    }
  };

  // ── Streaming State ──

  clearStreamBuffer = () => {
    this.set((state) => {
      state.streamBuffer = "";
      state.isStreaming = false;
      state.activeToolCalls = [];
    });
  };

  // ── Internal Event Handling ──

  private setupEventListeners = (client: OpenClawClient) => {
    // Connection state changes
    client.on("connection-state", (state) => {
      this.set((s) => {
        s.connectionState = state;
        if (state === "disconnected") {
          s.isStreaming = false;
          s.activeToolCalls = [];
        }
      });
    });

    // Streaming assistant response
    client.on("assistant", (data) => {
      this.set((state) => {
        state.isStreaming = true;
        state.streamBuffer += data.delta;
      });
    });

    client.on("assistant.end", () => {
      this.set((state) => {
        state.isStreaming = false;
      });
    });

    // Tool call tracking
    client.on("tool.start", (data) => {
      this.set((state) => {
        state.activeToolCalls.push({
          toolId: data.tool_id,
          toolName: data.tool_name,
          arguments: data.arguments,
          startedAt: Date.now()
        });
      });
    });

    client.on("tool.end", (data) => {
      this.set((state) => {
        const idx = state.activeToolCalls.findIndex(
          (t) => t.toolId === data.tool_id
        );
        if (idx >= 0) {
          state.activeToolCalls[idx].result = data.result;
          state.activeToolCalls[idx].error = data.error;
          // Remove after a short delay to allow UI to show completion
          setTimeout(() => {
            this.set((s) => {
              s.activeToolCalls = s.activeToolCalls.filter(
                (t) => t.toolId !== data.tool_id
              );
            });
          }, 1000);
        }
      });
    });

    // Agent lifecycle
    client.on("agent.started", (data) => {
      this.set((state) => {
        const session = state.sessions.find(
          (s) => s.id === data.task_id || s.agent === data.agent
        );
        if (session) session.status = "active";
      });
    });

    client.on("agent.complete", (data) => {
      this.set((state) => {
        const session = state.sessions.find((s) => s.id === data.task_id);
        if (session) session.status = "completed";
      });
    });

    client.on("agent.error", (data) => {
      this.set((state) => {
        const session = state.sessions.find((s) => s.id === data.task_id);
        if (session) session.status = "error";
        state.connectionError = data.error;
      });
    });

    // Errors
    client.on("error", (data) => {
      this.set((state) => {
        state.connectionError = data.message;
      });
    });

    // ── Control Push Events ──

    client.on("channel-status", (data) => {
      this.set((state) => {
        const idx = state.channels.findIndex((c) => c.channel === data.channel);
        if (idx >= 0) {
          state.channels[idx] = data;
        } else {
          state.channels.push(data);
        }
      });
    });

    client.on("presence", (data) => {
      this.set((state) => {
        state.presenceNodes = data.nodes;
      });
    });

    client.on("cron.result", (data) => {
      this.set((state) => {
        const job = state.cronJobs.find((j) => j.id === data.cron_id);
        if (job) {
          job.last_run = data.ran_at;
          job.run_count = (job.run_count || 0) + 1;
        }
      });
    });
  };
}

const [useStore, store] = createStore<OpenClawStore>(
  (set, get) => new OpenClawStore(set, get)
);

registerStoreForHydration("openclaw-settings", (data) => {
  const settings = data as { gatewayUrl: string; authToken: string; autoReconnect: boolean };
  store.set({ gatewayUrl: settings.gatewayUrl, authToken: settings.authToken, autoReconnect: settings.autoReconnect });
}, () => ({ gatewayUrl: store.gatewayUrl, authToken: store.authToken, autoReconnect: store.autoReconnect }));

export { useStore, store };
