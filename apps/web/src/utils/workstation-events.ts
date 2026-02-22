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

// ── Workstation Cross-Module Events ──
// Connects agent chat commands to task-store, comms-store, calendar-store, etc.
// Also handles OpenClaw connection events and notifications.

import { showToast } from "./toast";
import { useStore as useTaskStore } from "../stores/task-store";
import { useStore as useAgentStore } from "../stores/agent-store";
import { useStore as useChatStore } from "../stores/chat-store";
import { useStore as useOpenClawStore } from "../stores/openclaw-store";
import { navigate } from "../navigation";

let initialized = false;

export function initWorkstationEvents() {
  if (initialized) return;
  initialized = true;

  // ── OpenClaw Connection Events ──
  useOpenClawStore.subscribe(
    (s) => s.connectionState,
    (state, prev) => {
      if (state === "connected" && prev !== "connected") {
        showToast("success", "Connected to OpenClaw Gateway");

        // Update all agents to reflect connected state
        const agentStore = useAgentStore.getState();
        agentStore.addActivity("agent-orchestrator", {
          timestamp: Date.now(),
          type: "info",
          message: "OpenClaw Gateway connected. Live AI responses enabled."
        });
      }

      if (state === "disconnected" && prev === "connected") {
        showToast("warn", "Disconnected from OpenClaw Gateway");
      }

      if (state === "error" && prev !== "error") {
        const error =
          useOpenClawStore.getState().connectionError || "Connection failed";
        showToast("error", `OpenClaw: ${error}`);
      }
    }
  );

  // ── Agent Status Change Notifications ──
  useAgentStore.subscribe(
    (s) => s.agents.map((a) => a.status),
    (statuses, prevStatuses) => {
      const agents = useAgentStore.getState().agents;
      for (let i = 0; i < statuses.length; i++) {
        if (statuses[i] !== prevStatuses[i]) {
          const agent = agents[i];
          if (statuses[i] === "running") {
            showToast("info", `${agent.name} is now running`);
          } else if (statuses[i] === "error") {
            showToast("error", `${agent.name} encountered an error`);
          }
        }
      }
    }
  );

  // ── Task Completion Notifications ──
  useTaskStore.subscribe(
    (s) => s.tasks.filter((t) => t.status === "done").length,
    (doneCount, prevDoneCount) => {
      if (doneCount > prevDoneCount) {
        showToast("success", "Task completed!");
      }
    }
  );

  // ── Chat Command Parser ──
  // Intercepts specific chat patterns to trigger cross-module actions
  useChatStore.subscribe(
    (s) => s.messages,
    (messages, prevMessages) => {
      if (messages.length <= prevMessages.length) return;
      const latest = messages[messages.length - 1];
      if (latest.role !== "user") return;

      const content = latest.content.toLowerCase().trim();

      // Quick navigation commands
      if (content === "/dashboard" || content === "/home") {
        navigate("/dashboard");
        return;
      }
      if (content === "/tasks") {
        navigate("/tasks");
        return;
      }
      if (content === "/agents") {
        navigate("/agents");
        return;
      }
      if (content === "/calendar") {
        navigate("/calendar");
        return;
      }
      if (content === "/comms" || content === "/messages") {
        navigate("/communications");
        return;
      }
      if (content === "/sheets" || content === "/spreadsheets") {
        navigate("/spreadsheets");
        return;
      }

      // Quick task creation: "task: Buy groceries"
      if (content.startsWith("task:") || content.startsWith("todo:")) {
        const taskTitle = latest.content.slice(content.indexOf(":") + 1).trim();
        if (taskTitle) {
          createQuickTask(taskTitle);
        }
      }
    }
  );
}

// ── Quick Actions ──

function createQuickTask(title: string) {
  const taskStore = useTaskStore.getState();
  taskStore.addTask({
    title,
    description: "Created via Agent Chat",
    status: "todo",
    priority: "medium",
    assignee: null,
    dueDate: null,
    tags: ["quick-add"],
    parentTaskId: null,
    source: "agent",
    sourceAgentId: "agent-orchestrator",
    type: "chore",
    epicId: null,
    gitBranch: null,
    contextHandoff: null,
    reviewStatus: "none",
    reviewerId: null
  });

  // Notify in chat
  const chatStore = useChatStore.getState();
  chatStore.sendMessage; // Don't actually send, just log
  showToast("success", `Task created: ${title}`, [
    {
      text: "View Tasks",
      onClick: () => navigate("/tasks")
    }
  ]);

  // Log agent activity
  useAgentStore.getState().addActivity("agent-taskmaster", {
    timestamp: Date.now(),
    type: "action",
    message: `Created task: "${title}" via chat`
  });
}

export function navigateToAgentChat(agentId: string) {
  const chatStore = useChatStore.getState();
  chatStore.setTargetAgent(agentId);
  chatStore.open();
}
