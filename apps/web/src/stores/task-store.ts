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
import { loadPersistedData, persistDataDebounced } from "../utils/workstation-persist";
import { registerStoreForHydration } from "../utils/workstation-hydrate";

// ── Task Types ──

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskType = "feature" | "bug" | "chore" | "docs" | "refactor" | "test";

export type TaskAssignee = {
  type: "agent" | "human";
  id: string;
  name: string;
};

export type TaskComment = {
  id: string;
  authorId: string;
  authorName: string;
  authorType: "agent" | "human";
  content: string;
  timestamp: number;
};

export type TaskContext = {
  done: string[];
  remaining: string[];
  decisions: string[];
  uncertainties: string[];
  updatedAt: number;
};

export type LinkedFile = {
  path: string;
  sha: string;
  status: "unchanged" | "modified" | "new";
};

export type ActivityEntry = {
  id: string;
  type: "log" | "decision" | "blocker" | "handoff" | "review" | "status_change";
  content: string;
  authorId: string;
  authorName: string;
  timestamp: number;
};

export type Epic = {
  id: string;
  title: string;
  description: string;
  taskIds: string[];
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: number;
  updatedAt: number;
};

export type WorkstationTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  assignee: TaskAssignee | null;
  createdAt: number;
  updatedAt: number;
  dueDate: number | null;
  tags: string[];
  comments: TaskComment[];
  parentTaskId: string | null;
  subtaskIds: string[];
  source: "manual" | "agent" | "email" | "calendar";
  sourceAgentId: string | null;
  epicId: string | null;
  gitBranch: string | null;
  gitCommits: string[];
  linkedFiles: LinkedFile[];
  contextHandoff: TaskContext | null;
  reviewStatus: "none" | "in_review" | "approved" | "rejected";
  reviewerId: string | null;
  activityLog: ActivityEntry[];
  dependencies: string[];
  blockedBy: string[];
};

// ── Default Tasks (demo data) ──

function createDefaultTasks(): WorkstationTask[] {
  const now = Date.now();
  const hour = 3600000;
  const day = 86400000;

  return [
    {
      id: "task-1",
      title: "Set up email integration",
      description:
        "Connect Gmail/Outlook API so Comms Agent can triage incoming messages automatically.",
      status: "todo",
      priority: "high",
      type: "feature",
      assignee: { type: "agent", id: "agent-comms", name: "Comms Agent" },
      createdAt: now - 2 * hour,
      updatedAt: now - 2 * hour,
      dueDate: now + 2 * day,
      tags: ["infrastructure", "email"],
      comments: [
        {
          id: "tc-1",
          authorId: "agent-orchestrator",
          authorName: "Orchestrator",
          authorType: "agent",
          content: "Created task. Comms Agent will need OAuth credentials for Gmail API.",
          timestamp: now - 2 * hour
        }
      ],
      parentTaskId: null,
      subtaskIds: [],
      source: "agent",
      sourceAgentId: "agent-orchestrator",
      epicId: null,
      gitBranch: null,
      gitCommits: [],
      linkedFiles: [],
      contextHandoff: null,
      reviewStatus: "none",
      reviewerId: null,
      activityLog: [
        { id: "al-1", type: "status_change", content: "Task created", authorId: "agent-orchestrator", authorName: "Orchestrator", timestamp: now - 2 * hour }
      ],
      dependencies: [],
      blockedBy: []
    },
    {
      id: "task-2",
      title: "Review Q1 financial data",
      description:
        "Analyze revenue, expenses, and projections from the spreadsheet. Produce a summary report.",
      status: "in_progress",
      priority: "medium",
      type: "chore",
      assignee: { type: "agent", id: "agent-researcher", name: "Research Agent" },
      createdAt: now - 5 * hour,
      updatedAt: now - hour,
      dueDate: now + day,
      tags: ["finance", "analysis"],
      comments: [
        {
          id: "tc-2",
          authorId: "agent-researcher",
          authorName: "Research Agent",
          authorType: "agent",
          content: "Spreadsheet loaded. Analyzing revenue trends across 3 product lines.",
          timestamp: now - hour
        }
      ],
      parentTaskId: null,
      subtaskIds: [],
      source: "manual",
      sourceAgentId: null,
      epicId: null,
      gitBranch: null,
      gitCommits: [],
      linkedFiles: [],
      contextHandoff: null,
      reviewStatus: "none",
      reviewerId: null,
      activityLog: [],
      dependencies: [],
      blockedBy: []
    },
    {
      id: "task-3",
      title: "Draft response to partnership inquiry",
      description:
        "Acme Corp reached out about a potential partnership. Draft a professional response expressing interest.",
      status: "todo",
      priority: "high",
      type: "chore",
      assignee: { type: "agent", id: "agent-comms", name: "Comms Agent" },
      createdAt: now - hour,
      updatedAt: now - hour,
      dueDate: now + day,
      tags: ["email", "partnerships"],
      comments: [],
      parentTaskId: null,
      subtaskIds: [],
      source: "email",
      sourceAgentId: "agent-comms",
      epicId: null,
      gitBranch: null,
      gitCommits: [],
      linkedFiles: [],
      contextHandoff: null,
      reviewStatus: "none",
      reviewerId: null,
      activityLog: [],
      dependencies: [],
      blockedBy: []
    },
    {
      id: "task-4",
      title: "Schedule team standup for next week",
      description:
        "Find a 30-minute slot that works for all 5 team members. Send calendar invites.",
      status: "backlog",
      priority: "low",
      type: "chore",
      assignee: null,
      createdAt: now - 3 * hour,
      updatedAt: now - 3 * hour,
      dueDate: now + 5 * day,
      tags: ["scheduling", "team"],
      comments: [],
      parentTaskId: null,
      subtaskIds: [],
      source: "manual",
      sourceAgentId: null,
      epicId: null,
      gitBranch: null,
      gitCommits: [],
      linkedFiles: [],
      contextHandoff: null,
      reviewStatus: "none",
      reviewerId: null,
      activityLog: [],
      dependencies: [],
      blockedBy: []
    },
    {
      id: "task-5",
      title: "Code review: auth module refactor",
      description:
        "Review the PR for the authentication module. Check for security issues, test coverage, and code quality.",
      status: "todo",
      priority: "medium",
      type: "refactor",
      assignee: { type: "agent", id: "agent-coder", name: "Code Agent" },
      createdAt: now - 4 * hour,
      updatedAt: now - 4 * hour,
      dueDate: now + 2 * day,
      tags: ["code-review", "security"],
      comments: [],
      parentTaskId: null,
      subtaskIds: [],
      source: "agent",
      sourceAgentId: "agent-taskmaster",
      epicId: null,
      gitBranch: null,
      gitCommits: [],
      linkedFiles: [],
      contextHandoff: null,
      reviewStatus: "none",
      reviewerId: null,
      activityLog: [],
      dependencies: [],
      blockedBy: []
    }
  ];
}

// ── Migration: ensure old persisted tasks have new array/object fields ──

function migrateTask(t: Partial<WorkstationTask> & { id: string }): WorkstationTask {
  return {
    ...t,
    type: t.type || "chore",
    epicId: t.epicId ?? null,
    gitBranch: t.gitBranch ?? null,
    gitCommits: t.gitCommits || [],
    linkedFiles: t.linkedFiles || [],
    contextHandoff: t.contextHandoff ?? null,
    reviewStatus: t.reviewStatus || "none",
    reviewerId: t.reviewerId ?? null,
    activityLog: t.activityLog || [],
    dependencies: t.dependencies || [],
    blockedBy: t.blockedBy || [],
    subtaskIds: t.subtaskIds || [],
    comments: t.comments || [],
    tags: t.tags || [],
  } as WorkstationTask;
}

function loadAndMigrateTasks(): WorkstationTask[] {
  const raw = loadPersistedData<WorkstationTask[]>("tasks");
  if (!raw) return createDefaultTasks();
  return raw.map(migrateTask);
}

// ── Task Store ──

class TaskStore extends BaseStore<TaskStore> {
  tasks: WorkstationTask[] = loadAndMigrateTasks();
  epics: Epic[] = loadPersistedData<Epic[]>("epics") || [];
  selectedTaskId: string | null = null;
  filterStatus: TaskStatus | "all" = "all";
  filterPriority: TaskPriority | "all" = "all";
  filterType: TaskType | "all" = "all";
  isLoading = false;

  private persistTasks = () => {
    persistDataDebounced("tasks", this.get().tasks);
  };

  private persistEpics = () => {
    persistDataDebounced("epics", this.get().epics);
  };

  refresh = () => {
    this.set((state) => {
      state.tasks = [...state.tasks];
    });
  };

  selectTask = (id: string | null) => {
    this.set((state) => {
      state.selectedTaskId = id;
    });
  };

  setFilterStatus = (status: TaskStatus | "all") => {
    this.set((state) => {
      state.filterStatus = status;
    });
  };

  setFilterPriority = (priority: TaskPriority | "all") => {
    this.set((state) => {
      state.filterPriority = priority;
    });
  };

  setFilterType = (type: TaskType | "all") => {
    this.set((state) => {
      state.filterType = type;
    });
  };

  getFilteredTasks = (): WorkstationTask[] => {
    const state = this.get();
    return state.tasks.filter((t) => {
      if (state.filterStatus !== "all" && t.status !== state.filterStatus)
        return false;
      if (state.filterPriority !== "all" && t.priority !== state.filterPriority)
        return false;
      if (state.filterType !== "all" && t.type !== state.filterType)
        return false;
      return true;
    });
  };

  addTask = (
    task: Omit<WorkstationTask, "id" | "createdAt" | "updatedAt" | "comments" | "subtaskIds" | "activityLog" | "gitCommits" | "linkedFiles" | "dependencies" | "blockedBy">
  ) => {
    const now = Date.now();
    this.set((state) => {
      state.tasks.unshift({
        ...task,
        id: `task-${now}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
        comments: [],
        subtaskIds: [],
        activityLog: [{ id: `al-${now}`, type: "status_change", content: "Task created", authorId: "system", authorName: "System", timestamp: now }],
        gitCommits: [],
        linkedFiles: [],
        dependencies: [],
        blockedBy: []
      });
    });
    this.persistTasks();
  };

  updateTask = (taskId: string, updates: Partial<WorkstationTask>) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        Object.assign(task, updates, { updatedAt: Date.now() });
      }
    });
    this.persistTasks();
  };

  updateTaskStatus = (taskId: string, status: TaskStatus) => {
    const task = this.get().tasks.find((t) => t.id === taskId);
    if (task) {
      this.addLogEntry(taskId, "status_change", `Status changed: ${task.status} → ${status}`, "system", "System");
    }
    this.updateTask(taskId, { status });
  };

  assignTask = (taskId: string, assignee: TaskAssignee | null) => {
    this.updateTask(taskId, { assignee });
  };

  addComment = (taskId: string, comment: Omit<TaskComment, "id">) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        task.comments.push({
          ...comment,
          id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        });
        task.updatedAt = Date.now();
      }
    });
    this.persistTasks();
  };

  deleteTask = (taskId: string) => {
    this.set((state) => {
      state.tasks = state.tasks.filter((t) => t.id !== taskId);
      // Remove from epics
      for (const epic of state.epics) {
        epic.taskIds = epic.taskIds.filter((id) => id !== taskId);
      }
    });
    this.persistTasks();
    this.persistEpics();
  };

  getTasksByStatus = (status: TaskStatus): WorkstationTask[] => {
    return this.get().tasks.filter((t) => t.status === status);
  };

  getTasksByAgent = (agentId: string): WorkstationTask[] => {
    return this.get().tasks.filter(
      (t) => t.assignee?.type === "agent" && t.assignee.id === agentId
    );
  };

  getStats = () => {
    const tasks = this.get().tasks;
    return {
      total: tasks.length,
      backlog: tasks.filter((t) => t.status === "backlog").length,
      todo: tasks.filter((t) => t.status === "todo").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      inReview: tasks.filter((t) => t.status === "in_review").length,
      done: tasks.filter((t) => t.status === "done").length,
      cancelled: tasks.filter((t) => t.status === "cancelled").length,
      critical: tasks.filter((t) => t.priority === "critical").length,
      overdue: tasks.filter(
        (t) => t.dueDate && t.dueDate < Date.now() && t.status !== "done" && t.status !== "cancelled"
      ).length
    };
  };

  // ── Epics ──

  addEpic = (epic: Omit<Epic, "id" | "createdAt" | "updatedAt" | "taskIds">) => {
    const now = Date.now();
    this.set((state) => {
      state.epics.push({
        ...epic,
        id: `epic-${now}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
        taskIds: []
      });
    });
    this.persistEpics();
  };

  updateEpic = (epicId: string, updates: Partial<Epic>) => {
    this.set((state) => {
      const epic = state.epics.find((e) => e.id === epicId);
      if (epic) {
        Object.assign(epic, updates, { updatedAt: Date.now() });
      }
    });
    this.persistEpics();
  };

  deleteEpic = (epicId: string) => {
    this.set((state) => {
      state.epics = state.epics.filter((e) => e.id !== epicId);
      // Unlink tasks
      for (const task of state.tasks) {
        if (task.epicId === epicId) task.epicId = null;
      }
    });
    this.persistEpics();
    this.persistTasks();
  };

  addTaskToEpic = (taskId: string, epicId: string) => {
    this.set((state) => {
      const epic = state.epics.find((e) => e.id === epicId);
      const task = state.tasks.find((t) => t.id === taskId);
      if (epic && task) {
        if (!epic.taskIds.includes(taskId)) epic.taskIds.push(taskId);
        task.epicId = epicId;
        task.updatedAt = Date.now();
      }
    });
    this.persistEpics();
    this.persistTasks();
  };

  removeTaskFromEpic = (taskId: string) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task && task.epicId) {
        const epic = state.epics.find((e) => e.id === task.epicId);
        if (epic) epic.taskIds = epic.taskIds.filter((id) => id !== taskId);
        task.epicId = null;
        task.updatedAt = Date.now();
      }
    });
    this.persistEpics();
    this.persistTasks();
  };

  // ── Git integration ──

  linkBranch = (taskId: string, branch: string) => {
    this.updateTask(taskId, { gitBranch: branch });
    this.addLogEntry(taskId, "log", `Linked branch: ${branch}`, "system", "System");
  };

  unlinkBranch = (taskId: string) => {
    const task = this.get().tasks.find((t) => t.id === taskId);
    if (task?.gitBranch) {
      this.addLogEntry(taskId, "log", `Unlinked branch: ${task.gitBranch}`, "system", "System");
    }
    this.updateTask(taskId, { gitBranch: null });
  };

  linkCommit = (taskId: string, commitSha: string) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task && !task.gitCommits.includes(commitSha)) {
        task.gitCommits.push(commitSha);
        task.updatedAt = Date.now();
      }
    });
    this.persistTasks();
  };

  linkFile = (taskId: string, path: string, sha: string) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        const existing = task.linkedFiles.find((f) => f.path === path);
        if (existing) {
          existing.sha = sha;
          existing.status = "unchanged";
        } else {
          task.linkedFiles.push({ path, sha, status: "new" });
        }
        task.updatedAt = Date.now();
      }
    });
    this.persistTasks();
  };

  unlinkFile = (taskId: string, path: string) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        task.linkedFiles = task.linkedFiles.filter((f) => f.path !== path);
        task.updatedAt = Date.now();
      }
    });
    this.persistTasks();
  };

  // ── Context handoff ──

  updateContext = (taskId: string, context: TaskContext) => {
    this.updateTask(taskId, { contextHandoff: { ...context, updatedAt: Date.now() } });
    this.addLogEntry(taskId, "handoff", "Context handoff updated", "system", "System");
  };

  // ── Activity log ──

  addLogEntry = (taskId: string, type: ActivityEntry["type"], content: string, authorId: string, authorName: string) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        task.activityLog.push({
          id: `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          content,
          authorId,
          authorName,
          timestamp: Date.now()
        });
        task.updatedAt = Date.now();
      }
    });
    this.persistTasks();
  };

  // ── Review workflow ──

  submitForReview = (taskId: string) => {
    this.updateTask(taskId, { status: "in_review", reviewStatus: "in_review" });
    this.addLogEntry(taskId, "review", "Submitted for review", "system", "System");
  };

  approveTask = (taskId: string) => {
    this.updateTask(taskId, { status: "done", reviewStatus: "approved" });
    this.addLogEntry(taskId, "review", "Task approved", "system", "System");
  };

  rejectTask = (taskId: string, reason: string) => {
    this.updateTask(taskId, { status: "in_progress", reviewStatus: "rejected" });
    this.addLogEntry(taskId, "review", `Task rejected: ${reason}`, "system", "System");
    this.addComment(taskId, {
      authorId: "system",
      authorName: "Review System",
      authorType: "human",
      content: `Review rejected: ${reason}`,
      timestamp: Date.now()
    });
  };

  // ── Dependencies ──

  addDependency = (taskId: string, dependsOnId: string) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      const depTask = state.tasks.find((t) => t.id === dependsOnId);
      if (task && depTask) {
        if (!task.dependencies.includes(dependsOnId)) task.dependencies.push(dependsOnId);
        if (!depTask.blockedBy.includes(taskId)) depTask.blockedBy.push(taskId);
        task.updatedAt = Date.now();
      }
    });
    this.persistTasks();
  };

  removeDependency = (taskId: string, dependsOnId: string) => {
    this.set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      const depTask = state.tasks.find((t) => t.id === dependsOnId);
      if (task) {
        task.dependencies = task.dependencies.filter((id) => id !== dependsOnId);
        task.updatedAt = Date.now();
      }
      if (depTask) {
        depTask.blockedBy = depTask.blockedBy.filter((id) => id !== taskId);
      }
    });
    this.persistTasks();
  };

  // ── Queries ──

  getBlockedTasks = (): WorkstationTask[] => {
    return this.get().tasks.filter((t) =>
      t.dependencies.length > 0 &&
      t.dependencies.some((depId) => {
        const dep = this.get().tasks.find((d) => d.id === depId);
        return dep && dep.status !== "done" && dep.status !== "cancelled";
      })
    );
  };

  getReadyTasks = (): WorkstationTask[] => {
    return this.get().tasks.filter((t) =>
      t.status === "todo" &&
      (t.dependencies.length === 0 ||
        t.dependencies.every((depId) => {
          const dep = this.get().tasks.find((d) => d.id === depId);
          return dep && (dep.status === "done" || dep.status === "cancelled");
        }))
    );
  };

  getSubtasks = (taskId: string): WorkstationTask[] => {
    return this.get().tasks.filter((t) => t.parentTaskId === taskId);
  };

  addSubtask = (parentId: string, title: string) => {
    const now = Date.now();
    const subtaskId = `task-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const parent = this.get().tasks.find((t) => t.id === parentId);

    this.set((state) => {
      const parentTask = state.tasks.find((t) => t.id === parentId);
      if (parentTask) {
        parentTask.subtaskIds.push(subtaskId);
        parentTask.updatedAt = now;
      }
      state.tasks.push({
        id: subtaskId,
        title,
        description: "",
        status: "todo",
        priority: parent?.priority || "medium",
        type: parent?.type || "chore",
        assignee: null,
        createdAt: now,
        updatedAt: now,
        dueDate: null,
        tags: [],
        comments: [],
        parentTaskId: parentId,
        subtaskIds: [],
        source: "manual",
        sourceAgentId: null,
        epicId: parent?.epicId || null,
        gitBranch: null,
        gitCommits: [],
        linkedFiles: [],
        contextHandoff: null,
        reviewStatus: "none",
        reviewerId: null,
        activityLog: [],
        dependencies: [],
        blockedBy: []
      });
    });
    this.persistTasks();
  };
}

const [useStore, store] = createStore<TaskStore>(
  (set, get) => new TaskStore(set, get)
);

registerStoreForHydration("tasks", (data) => {
  const raw = data as WorkstationTask[];
  store.set({ tasks: Array.isArray(raw) ? raw.map(migrateTask) : [] });
}, () => store.tasks);

export { useStore, store };
