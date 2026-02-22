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

// ── OpenClaw Gateway WebSocket Client ──
// Connects to the OpenClaw Gateway via WebSocket protocol.
// Handles challenge/token auth, typed JSON RPC frames, and event streaming.

// ── Frame Types ──

export type OpenClawFrameType =
  // Client → Server
  | "connect"
  | "chat.send"
  | "agent"
  | "agent.wait"
  | "config.patch"
  | "config.apply"
  | "sessions_spawn"
  // Client → Server (Control)
  | "channels.status"
  | "sessions.list"
  | "sessions.patch"
  | "cron.list"
  | "cron.create"
  | "cron.update"
  | "cron.delete"
  | "cron.run"
  | "skills.list"
  | "skills.enable"
  | "skills.disable"
  | "skills.install"
  | "skills.apikey"
  | "exec.approvals.list"
  | "exec.approvals.update"
  | "exec.allowlist.get"
  | "exec.allowlist.set"
  | "config.get"
  | "config.schema"
  | "token.usage"
  | "system.presence"
  // Server → Client (auth)
  | "challenge"
  | "connected"
  // Server → Client (events)
  | "error"
  | "assistant"
  | "assistant.end"
  | "tool.start"
  | "tool.end"
  | "agent.started"
  | "agent.complete"
  | "agent.error"
  | "session.created"
  | "heartbeat"
  // Server → Client (Control push events)
  | "channel-status"
  | "presence"
  | "cron.result";

export type OpenClawFrame = {
  type: OpenClawFrameType;
  id?: string;
  payload?: Record<string, unknown>;
};

// ── RPC Request/Response Types ──

export type ChatSendPayload = {
  message: string;
  session_id?: string;
  agent?: string;
  model?: string;
  system_prompt?: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  }>;
  context?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
};

export type AgentPayload = {
  task: string;
  agent?: string;
  session_id?: string;
  model?: string;
  tools?: string[];
  workspace?: string;
};

export type AgentWaitPayload = {
  task_id: string;
  timeout?: number;
};

export type ConfigPatchPayload = {
  path: string;
  value: unknown;
};

export type SessionSpawnPayload = {
  agent?: string;
  model?: string;
  system_prompt?: string;
  tools?: string[];
  workspace?: string;
};

// ── Control Payload Types ──

export type ChannelStatusPayload = {
  channel: string;
  status: "connected" | "disconnected" | "pending_qr" | "error";
  qr_code?: string;
  phone?: string;
  handle?: string;
  error?: string;
};

export type GatewaySession = {
  id: string;
  agent?: string;
  model?: string;
  created_at: number;
  status: "active" | "completed" | "error" | "idle";
  thinking?: boolean;
  verbose?: boolean;
  message_count?: number;
};

export type CronJob = {
  id: string;
  name: string;
  schedule: string;
  agent?: string;
  task: string;
  enabled: boolean;
  last_run?: number;
  next_run?: number;
  run_count: number;
};

export type GatewaySkill = {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  installed: boolean;
  requires_api_key?: boolean;
  tags?: string[];
};

export type ExecApproval = {
  id: string;
  command: string;
  agent?: string;
  session_id?: string;
  requested_at: number;
  status: "pending" | "approved" | "denied";
};

export type ExecAllowlist = {
  patterns: string[];
};

export type ConfigSchemaNode = {
  type: "string" | "number" | "boolean" | "object" | "array" | "unsupported";
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, ConfigSchemaNode>;
  items?: ConfigSchemaNode;
};

export type TokenUsageEntry = {
  session_id?: string;
  agent?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  timestamp: number;
};

export type PresenceNode = {
  id: string;
  hostname: string;
  version: string;
  role: "primary" | "replica" | "standalone";
  status: "healthy" | "degraded" | "offline";
  connected_clients: number;
  uptime_seconds: number;
};

// ── Event Types (Server → Client) ──

export type AssistantDeltaEvent = {
  type: "assistant";
  payload: {
    delta: string;
    session_id?: string;
  };
};

export type AssistantEndEvent = {
  type: "assistant.end";
  payload: {
    session_id?: string;
    total_tokens?: number;
    finish_reason?: string;
  };
};

export type ToolStartEvent = {
  type: "tool.start";
  payload: {
    tool_name: string;
    tool_id: string;
    arguments?: Record<string, unknown>;
  };
};

export type ToolEndEvent = {
  type: "tool.end";
  payload: {
    tool_id: string;
    result?: unknown;
    error?: string;
  };
};

export type AgentStartedEvent = {
  type: "agent.started";
  payload: {
    task_id: string;
    agent: string;
  };
};

export type AgentCompleteEvent = {
  type: "agent.complete";
  payload: {
    task_id: string;
    result: unknown;
  };
};

export type AgentErrorEvent = {
  type: "agent.error";
  payload: {
    task_id: string;
    error: string;
  };
};

export type OpenClawEvent =
  | AssistantDeltaEvent
  | AssistantEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | AgentStartedEvent
  | AgentCompleteEvent
  | AgentErrorEvent;

// ── Connection State ──

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "error";

// ── Event Listener Types ──

export type OpenClawEventMap = {
  "connection-state": ConnectionState;
  assistant: AssistantDeltaEvent["payload"];
  "assistant.end": AssistantEndEvent["payload"];
  "tool.start": ToolStartEvent["payload"];
  "tool.end": ToolEndEvent["payload"];
  "agent.started": AgentStartedEvent["payload"];
  "agent.complete": AgentCompleteEvent["payload"];
  "agent.error": AgentErrorEvent["payload"];
  error: { message: string; code?: string };
  heartbeat: Record<string, never>;
  "channel-status": ChannelStatusPayload;
  "presence": { nodes: PresenceNode[] };
  "cron.result": { cron_id: string; success: boolean; error?: string; ran_at: number };
};

type EventCallback<K extends keyof OpenClawEventMap> = (
  data: OpenClawEventMap[K]
) => void;

// ── OpenClaw Client ──

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private listeners = new Map<string, Set<EventCallback<never>>>();
  private pendingRpc = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private rpcCounter = 0;

  private gatewayUrl: string;
  private authToken: string;
  private autoReconnect: boolean;

  constructor(options: {
    gatewayUrl?: string;
    authToken?: string;
    autoReconnect?: boolean;
  } = {}) {
    this.gatewayUrl = options.gatewayUrl || "ws://127.0.0.1:18789";
    this.authToken = options.authToken || "";
    this.autoReconnect = options.autoReconnect ?? true;
  }

  // ── Public API ──

  get state(): ConnectionState {
    return this.connectionState;
  }

  get isConnected(): boolean {
    return this.connectionState === "connected";
  }

  configure(options: {
    gatewayUrl?: string;
    authToken?: string;
    autoReconnect?: boolean;
  }) {
    if (options.gatewayUrl !== undefined) this.gatewayUrl = options.gatewayUrl;
    if (options.authToken !== undefined) this.authToken = options.authToken;
    if (options.autoReconnect !== undefined)
      this.autoReconnect = options.autoReconnect;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connectionState === "connected") {
        resolve();
        return;
      }

      if (this.ws) {
        this.cleanup();
      }

      this.setConnectionState("connecting");
      this.reconnectAttempts++;

      try {
        this.ws = new WebSocket(this.gatewayUrl);
      } catch (err) {
        this.setConnectionState("error");
        reject(new Error(`Failed to create WebSocket: ${err}`));
        return;
      }

      const connectTimeout = setTimeout(() => {
        if (this.connectionState !== "connected") {
          this.cleanup();
          this.setConnectionState("error");
          reject(new Error("Connection timeout"));
        }
      }, 10000);

      this.ws.onopen = () => {
        // Wait for the challenge frame from server
        this.setConnectionState("authenticating");
      };

      this.ws.onmessage = (event) => {
        let frame: OpenClawFrame;
        try {
          frame = JSON.parse(event.data as string);
        } catch {
          console.warn("[OpenClaw] Invalid frame:", event.data);
          return;
        }

        // Handle auth handshake
        if (frame.type === "challenge") {
          this.sendFrame({
            type: "connect",
            payload: {
              token: this.authToken,
              client: "workstation",
              version: "1.0.0"
            }
          });
          return;
        }

        if (frame.type === "connected") {
          clearTimeout(connectTimeout);
          this.setConnectionState("connected");
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
          return;
        }

        if (frame.type === "heartbeat") {
          this.emit("heartbeat", {});
          return;
        }

        // Handle RPC responses (frames with matching id) — must come before
        // general error handling so error frames with RPC ids resolve correctly
        if (frame.id && this.pendingRpc.has(frame.id)) {
          const pending = this.pendingRpc.get(frame.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRpc.delete(frame.id);
            if (frame.type === "error") {
              pending.reject(
                new Error(
                  (frame.payload?.message as string) || "RPC error"
                )
              );
            } else {
              pending.resolve(frame.payload);
            }
          }
          return;
        }

        // General error handling (non-RPC errors)
        if (frame.type === "error") {
          const msg =
            (frame.payload?.message as string) || "Unknown gateway error";
          if (this.connectionState !== "connected") {
            clearTimeout(connectTimeout);
            this.setConnectionState("error");
            reject(new Error(msg));
          }
          this.emit("error", { message: msg, code: frame.payload?.code as string });
          return;
        }

        // Handle streaming events
        this.handleEvent(frame);
      };

      this.ws.onerror = (err) => {
        console.error("[OpenClaw] WebSocket error:", err);
        if (this.connectionState !== "connected") {
          clearTimeout(connectTimeout);
          this.setConnectionState("error");
          reject(new Error("WebSocket connection error"));
        }
        this.emit("error", { message: "WebSocket error" });
      };

      this.ws.onclose = (event) => {
        const wasConnected = this.connectionState === "connected";
        this.cleanup();
        this.setConnectionState("disconnected");

        if (wasConnected && this.autoReconnect) {
          this.scheduleReconnect();
        }

        if (!wasConnected) {
          clearTimeout(connectTimeout);
          reject(
            new Error(`Connection closed: ${event.code} ${event.reason}`)
          );
        }
      };
    });
  }

  disconnect() {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.setConnectionState("disconnected");
  }

  // ── RPC Methods ──

  async chatSend(payload: ChatSendPayload): Promise<void> {
    this.ensureConnected();
    this.sendFrame({
      type: "chat.send",
      id: this.nextRpcId(),
      payload: payload as unknown as Record<string, unknown>
    });
    // Response comes as streaming events (assistant, assistant.end)
  }

  async agentRun(payload: AgentPayload): Promise<{ task_id: string }> {
    return this.rpc("agent", payload as unknown as Record<string, unknown>) as Promise<{
      task_id: string;
    }>;
  }

  async agentWait(payload: AgentWaitPayload): Promise<unknown> {
    return this.rpc(
      "agent.wait",
      payload as unknown as Record<string, unknown>,
      (payload.timeout || 60) * 1000 + 5000
    );
  }

  async configPatch(payload: ConfigPatchPayload): Promise<void> {
    await this.rpc(
      "config.patch",
      payload as unknown as Record<string, unknown>
    );
  }

  async configApply(): Promise<void> {
    await this.rpc("config.apply", {});
  }

  async sessionSpawn(
    payload: SessionSpawnPayload
  ): Promise<{ session_id: string }> {
    return this.rpc(
      "sessions_spawn",
      payload as unknown as Record<string, unknown>
    ) as Promise<{ session_id: string }>;
  }

  // ── Control RPC Methods ──

  async channelsStatus(): Promise<{ channels: ChannelStatusPayload[] }> {
    return this.rpc("channels.status", {}) as Promise<{ channels: ChannelStatusPayload[] }>;
  }

  async sessionsList(): Promise<{ sessions: GatewaySession[] }> {
    return this.rpc("sessions.list", {}) as Promise<{ sessions: GatewaySession[] }>;
  }

  async sessionsPatch(id: string, patch: Partial<Pick<GatewaySession, "thinking" | "verbose">>): Promise<void> {
    await this.rpc("sessions.patch", { id, ...patch });
  }

  async cronList(): Promise<{ jobs: CronJob[] }> {
    return this.rpc("cron.list", {}) as Promise<{ jobs: CronJob[] }>;
  }

  async cronCreate(job: Omit<CronJob, "id" | "last_run" | "next_run" | "run_count">): Promise<{ id: string }> {
    return this.rpc("cron.create", job as unknown as Record<string, unknown>) as Promise<{ id: string }>;
  }

  async cronUpdate(id: string, patch: Partial<Omit<CronJob, "id">>): Promise<void> {
    await this.rpc("cron.update", { id, ...patch } as unknown as Record<string, unknown>);
  }

  async cronDelete(id: string): Promise<void> {
    await this.rpc("cron.delete", { id });
  }

  async cronRun(id: string): Promise<void> {
    await this.rpc("cron.run", { id });
  }

  async skillsList(): Promise<{ skills: GatewaySkill[] }> {
    return this.rpc("skills.list", {}) as Promise<{ skills: GatewaySkill[] }>;
  }

  async skillsEnable(id: string): Promise<void> {
    await this.rpc("skills.enable", { id });
  }

  async skillsDisable(id: string): Promise<void> {
    await this.rpc("skills.disable", { id });
  }

  async skillsInstall(id: string): Promise<void> {
    await this.rpc("skills.install", { id });
  }

  async skillsSetApiKey(id: string, key: string): Promise<void> {
    await this.rpc("skills.apikey", { id, key });
  }

  async execApprovalsList(): Promise<{ approvals: ExecApproval[] }> {
    return this.rpc("exec.approvals.list", {}) as Promise<{ approvals: ExecApproval[] }>;
  }

  async execApprovalUpdate(id: string, status: "approved" | "denied"): Promise<void> {
    await this.rpc("exec.approvals.update", { id, status });
  }

  async execAllowlistGet(): Promise<ExecAllowlist> {
    return this.rpc("exec.allowlist.get", {}) as Promise<ExecAllowlist>;
  }

  async execAllowlistSet(patterns: string[]): Promise<void> {
    await this.rpc("exec.allowlist.set", { patterns });
  }

  async configGet(): Promise<{ config: Record<string, unknown>; hash: string }> {
    return this.rpc("config.get", {}) as Promise<{ config: Record<string, unknown>; hash: string }>;
  }

  async configSchema(): Promise<{ schema: Record<string, ConfigSchemaNode> }> {
    return this.rpc("config.schema", {}) as Promise<{ schema: Record<string, ConfigSchemaNode> }>;
  }

  async tokenUsage(options?: { window?: string }): Promise<{ entries: TokenUsageEntry[] }> {
    return this.rpc("token.usage", options || {}) as Promise<{ entries: TokenUsageEntry[] }>;
  }

  async systemPresence(): Promise<{ nodes: PresenceNode[] }> {
    return this.rpc("system.presence", {}) as Promise<{ nodes: PresenceNode[] }>;
  }

  // ── Event Subscription ──

  on<K extends keyof OpenClawEventMap>(
    event: K,
    callback: EventCallback<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback<never>);

    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback<never>);
    };
  }

  off<K extends keyof OpenClawEventMap>(
    event: K,
    callback: EventCallback<K>
  ) {
    this.listeners.get(event)?.delete(callback as EventCallback<never>);
  }

  // ── Internal ──

  private emit<K extends keyof OpenClawEventMap>(
    event: K,
    data: OpenClawEventMap[K]
  ) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        (cb as EventCallback<K>)(data);
      } catch (err) {
        console.error(`[OpenClaw] Error in ${event} listener:`, err);
      }
    });
  }

  private setConnectionState(state: ConnectionState) {
    this.connectionState = state;
    this.emit("connection-state", state);
  }

  private sendFrame(frame: OpenClawFrame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(frame));
  }

  private nextRpcId(): string {
    return `rpc-${++this.rpcCounter}-${Date.now()}`;
  }

  private rpc(
    type: OpenClawFrameType,
    payload: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.ensureConnected();
      const id = this.nextRpcId();

      const timeout = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`RPC timeout for ${type}`));
      }, timeoutMs);

      this.pendingRpc.set(id, { resolve, reject, timeout });

      this.sendFrame({ type, id, payload });
    });
  }

  private ensureConnected() {
    if (!this.isConnected) {
      throw new Error("Not connected to OpenClaw Gateway");
    }
  }

  private handleEvent(frame: OpenClawFrame) {
    switch (frame.type) {
      case "assistant":
        this.emit("assistant", frame.payload as AssistantDeltaEvent["payload"]);
        break;
      case "assistant.end":
        this.emit(
          "assistant.end",
          frame.payload as AssistantEndEvent["payload"]
        );
        break;
      case "tool.start":
        this.emit("tool.start", frame.payload as ToolStartEvent["payload"]);
        break;
      case "tool.end":
        this.emit("tool.end", frame.payload as ToolEndEvent["payload"]);
        break;
      case "agent.started":
        this.emit(
          "agent.started",
          frame.payload as AgentStartedEvent["payload"]
        );
        break;
      case "agent.complete":
        this.emit(
          "agent.complete",
          frame.payload as AgentCompleteEvent["payload"]
        );
        break;
      case "agent.error":
        this.emit("agent.error", frame.payload as AgentErrorEvent["payload"]);
        break;
      case "channel-status":
        this.emit("channel-status", frame.payload as ChannelStatusPayload);
        break;
      case "presence":
        this.emit("presence", frame.payload as { nodes: PresenceNode[] });
        break;
      case "cron.result":
        this.emit("cron.result", frame.payload as OpenClawEventMap["cron.result"]);
        break;
      default:
        console.debug("[OpenClaw] Unhandled frame type:", frame.type);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        try {
          this.sendFrame({ type: "heartbeat" as OpenClawFrameType });
        } catch {
          // Connection lost
        }
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private cleanup() {
    this.stopHeartbeat();

    // Reject all pending RPCs
    for (const [id, pending] of this.pendingRpc) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
      this.pendingRpc.delete(id);
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn("[OpenClaw] Max reconnect attempts reached");
      this.emit("error", {
        message: "Max reconnect attempts reached. Please reconnect manually."
      });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(
      `[OpenClaw] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.warn("[OpenClaw] Reconnect failed:", err.message);
      });
    }, delay);
  }
}

// ── Singleton Instance ──

let clientInstance: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!clientInstance) {
    clientInstance = new OpenClawClient();
  }
  return clientInstance;
}

export function resetOpenClawClient() {
  if (clientInstance) {
    clientInstance.disconnect();
    clientInstance = null;
  }
}
