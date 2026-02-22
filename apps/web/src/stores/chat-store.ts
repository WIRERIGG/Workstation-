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
import { getOpenClawClient } from "../utils/openclaw-client";
import { useStore as useOpenClawStore } from "./openclaw-store";

// ── Chat Types ──

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "system";
  agentId: string | null;
  agentName: string | null;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  toolCalls?: Array<{
    toolName: string;
    status: "running" | "complete" | "error";
  }>;
  metadata?: {
    actionType?:
      | "task-created"
      | "email-drafted"
      | "event-scheduled"
      | "search-result"
      | "tool-use";
    actionData?: Record<string, unknown>;
    openclawSessionId?: string;
    tokenCount?: number;
  };
};

// ── Chat Store ──

class ChatStore extends BaseStore<ChatStore> {
  isOpen = false;
  messages: ChatMessage[] = [
    {
      id: "welcome",
      role: "system",
      agentId: null,
      agentName: null,
      content:
        "Welcome to Workstation. Type a command or ask a question. The Orchestrator will route your request to the right agent.",
      timestamp: Date.now()
    }
  ];
  isProcessing = false;
  targetAgentId: string | null = null;

  // Track active streaming message for appending deltas
  private streamingMessageId: string | null = null;
  private eventCleanups: Array<() => void> = [];

  toggle = () => {
    this.set((state) => {
      state.isOpen = !state.isOpen;
    });
  };

  open = () => {
    this.set((state) => {
      state.isOpen = true;
    });
  };

  close = () => {
    this.set((state) => {
      state.isOpen = false;
    });
  };

  setTargetAgent = (agentId: string | null) => {
    this.set((state) => {
      state.targetAgentId = agentId;
    });
  };

  sendMessage = (content: string) => {
    const now = Date.now();
    const userMsg: ChatMessage = {
      id: `msg-${now}`,
      role: "user",
      agentId: null,
      agentName: null,
      content,
      timestamp: now
    };

    this.set((state) => {
      state.messages.push(userMsg);
      state.isProcessing = true;
    });

    // Check if OpenClaw is connected
    const ocState = useOpenClawStore.getState();
    if (ocState.connectionState === "connected") {
      this.sendViaOpenClaw(content);
    } else {
      // Fallback to simulated response
      setTimeout(() => {
        this.simulateAgentResponse(content);
      }, 800 + Math.random() * 1200);
    }
  };

  // ── OpenClaw Integration ──

  private sendViaOpenClaw = async (content: string) => {
    const client = getOpenClawClient();
    const ocState = useOpenClawStore.getState();
    const now = Date.now();
    const messageId = `msg-oc-${now}`;

    // Build conversation context from recent messages
    const context = this.get()
      .messages.slice(-10)
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: (m.role === "agent" ? "assistant" : m.role) as
          | "user"
          | "assistant"
          | "system",
        content: m.content
      }));

    // Create a placeholder streaming message
    this.set((state) => {
      state.messages.push({
        id: messageId,
        role: "agent",
        agentId: "openclaw",
        agentName: "OpenClaw",
        content: "",
        timestamp: now,
        isStreaming: true,
        toolCalls: []
      });
    });
    this.streamingMessageId = messageId;

    // Set up event listeners for this response
    this.cleanupStreamListeners();

    const unsubDelta = client.on("assistant", (data) => {
      this.set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.content += data.delta;
        }
      });
    });

    const unsubEnd = client.on("assistant.end", (data) => {
      this.set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.isStreaming = false;
          if (data.total_tokens) {
            msg.metadata = {
              ...msg.metadata,
              tokenCount: data.total_tokens
            };
          }
        }
        state.isProcessing = false;
      });
      this.streamingMessageId = null;
      this.cleanupStreamListeners();
    });

    const unsubToolStart = client.on("tool.start", (data) => {
      this.set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = [];
          msg.toolCalls.push({
            toolName: data.tool_name,
            status: "running"
          });
        }
      });
    });

    const unsubToolEnd = client.on("tool.end", (data) => {
      this.set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (msg && msg.toolCalls) {
          const tool = msg.toolCalls.find((t) => t.status === "running");
          if (tool) {
            tool.status = data.error ? "error" : "complete";
          }
        }
      });
    });

    const unsubError = client.on("error", (data) => {
      this.set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.isStreaming = false;
          if (!msg.content) {
            msg.content = `Error: ${data.message}`;
          }
        }
        state.isProcessing = false;
      });
      this.streamingMessageId = null;
      this.cleanupStreamListeners();
    });

    this.eventCleanups = [
      unsubDelta,
      unsubEnd,
      unsubToolStart,
      unsubToolEnd,
      unsubError
    ];

    // Send via OpenClaw
    try {
      await client.chatSend({
        message: content,
        session_id: ocState.activeSessionId || undefined,
        context
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Failed to send";
      this.set((state) => {
        const msg = state.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.content = `Connection error: ${errMsg}. Falling back to local mode.`;
          msg.isStreaming = false;
        }
        state.isProcessing = false;
      });
      this.streamingMessageId = null;
      this.cleanupStreamListeners();
    }
  };

  private cleanupStreamListeners = () => {
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups = [];
  };

  // ── Simulated Response (Fallback) ──

  private simulateAgentResponse = (userMessage: string) => {
    const now = Date.now();
    const lowerMsg = userMessage.toLowerCase();

    let agentId = this.get().targetAgentId || "agent-orchestrator";
    let agentName = "Orchestrator";
    let response = "";
    let metadata: ChatMessage["metadata"] = undefined;

    // Route to appropriate agent based on content
    if (
      lowerMsg.includes("email") ||
      lowerMsg.includes("message") ||
      lowerMsg.includes("reply") ||
      lowerMsg.includes("send")
    ) {
      agentId = "agent-comms";
      agentName = "Comms Agent";
      response =
        "I've reviewed the communications inbox. You have 4 unread messages. The highest priority is the partnership proposal from Sarah Chen at Acme Corp. I've already drafted a response — you can review it in the Communications tab.";
    } else if (
      lowerMsg.includes("task") ||
      lowerMsg.includes("todo") ||
      lowerMsg.includes("assign") ||
      lowerMsg.includes("create task")
    ) {
      agentId = "agent-taskmaster";
      agentName = "TaskMaster";
      response =
        "I've analyzed your current workload. You have 2 tasks in progress and 2 in the queue. The email integration setup is due in 2 days — I've assigned it to the Comms Agent. Want me to create a new task or reprioritize the existing ones?";
      metadata = { actionType: "task-created" };
    } else if (
      lowerMsg.includes("research") ||
      lowerMsg.includes("analyze") ||
      lowerMsg.includes("report") ||
      lowerMsg.includes("find")
    ) {
      agentId = "agent-researcher";
      agentName = "Research Agent";
      response =
        "Starting research. I'll compile findings and create a summary report. Based on the Q1 financial data in the spreadsheet, revenue is trending up 10% month-over-month across all product lines. Would you like a detailed breakdown?";
    } else if (
      lowerMsg.includes("code") ||
      lowerMsg.includes("review") ||
      lowerMsg.includes("bug") ||
      lowerMsg.includes("pr")
    ) {
      agentId = "agent-coder";
      agentName = "Code Agent";
      response =
        "I've reviewed the auth module PR #247. Found 3 test failures related to the token refresh logic. The fix looks straightforward — want me to suggest the changes or create a patch?";
    } else if (
      lowerMsg.includes("schedule") ||
      lowerMsg.includes("meeting") ||
      lowerMsg.includes("calendar") ||
      lowerMsg.includes("call")
    ) {
      agentId = "agent-orchestrator";
      agentName = "Orchestrator";
      response =
        "I've checked your calendar. You have a team standup at 9 AM and the Acme Corp partnership call at 2 PM today. Tomorrow has a focus block in the morning and the product demo prep. Want me to schedule a new event?";
      metadata = { actionType: "event-scheduled" };
    } else if (
      lowerMsg.includes("status") ||
      lowerMsg.includes("summary")
    ) {
      agentId = "agent-orchestrator";
      agentName = "Orchestrator";
      response = `Here's your status update:\n\n**Tasks:** 1 in progress, 3 to do, 0 blocked\n**Comms:** 4 unread messages, 2 draft replies ready\n**Calendar:** 2 events today\n**Agents:** 4 idle, 1 offline (Code Agent awaiting repo connection)\n\nHighest priority: Review the Acme Corp partnership proposal.`;
    } else {
      response = `Understood. Let me route this to the right agent. Based on your request, I'm coordinating with the team. Is there a specific agent you'd like me to direct this to?\n\nAvailable agents: Comms, Research, TaskMaster, Code.`;
    }

    // Add [Offline Mode] indicator when not connected to OpenClaw
    const ocState = useOpenClawStore.getState();
    if (ocState.connectionState !== "connected") {
      response += "\n\n_[Offline mode — connect to OpenClaw for live AI responses]_";
    }

    this.set((state) => {
      state.messages.push({
        id: `msg-${now}`,
        role: "agent",
        agentId,
        agentName,
        content: response,
        timestamp: now,
        metadata
      });
      state.isProcessing = false;
    });
  };

  clearChat = () => {
    this.cleanupStreamListeners();
    this.streamingMessageId = null;
    this.set((state) => {
      state.messages = [
        {
          id: "welcome-new",
          role: "system",
          agentId: null,
          agentName: null,
          content: "Chat cleared. How can I help?",
          timestamp: Date.now()
        }
      ];
    });
  };
}

const [useStore, store] = createStore<ChatStore>(
  (set, get) => new ChatStore(set, get)
);

export { useStore, store };
