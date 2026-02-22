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

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import { AppEventManager, AppEvents } from "../common/app-events";
import {
  useStore as useTaskStore,
  WorkstationTask,
  TaskStatus,
  TaskPriority,
  TaskType,
  Epic,
  TaskContext,
  ActivityEntry,
  LinkedFile
} from "../stores/task-store";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

// ── Configuration Constants ──

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; bg: string }
> = {
  backlog: { label: "Backlog", color: "#6b7280", bg: "#6b728015" },
  todo: { label: "To Do", color: "#3b82f6", bg: "#3b82f615" },
  in_progress: { label: "In Progress", color: "#f59e0b", bg: "#f59e0b15" },
  in_review: { label: "Review", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
  done: { label: "Done", color: "#22c55e", bg: "#22c55e15" },
  cancelled: { label: "Cancelled", color: "#94a3b8", bg: "#94a3b815" }
};

const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string; icon: string }
> = {
  critical: { label: "Critical", color: "#ef4444", icon: "!!" },
  high: { label: "High", color: "#f59e0b", icon: "!" },
  medium: { label: "Medium", color: "#3b82f6", icon: "-" },
  low: { label: "Low", color: "#94a3b8", icon: "." }
};

const TYPE_CONFIG: Record<
  TaskType,
  { label: string; color: string; icon: string }
> = {
  feature: { label: "Feature", color: "#22c55e", icon: "+" },
  bug: { label: "Bug", color: "#ef4444", icon: "!" },
  chore: { label: "Chore", color: "#8b949e", icon: "~" },
  docs: { label: "Docs", color: "#60a5fa", icon: "D" },
  refactor: { label: "Refactor", color: "#a78bfa", icon: "R" },
  test: { label: "Test", color: "#eab308", icon: "T" }
};

const ACTIVITY_ICONS: Record<ActivityEntry["type"], string> = {
  log: ">",
  decision: "*",
  blocker: "X",
  handoff: ">>",
  review: "?",
  status_change: "~"
};

const FILE_STATUS_COLORS: Record<LinkedFile["status"], string> = {
  unchanged: "#6b7280",
  modified: "#f59e0b",
  new: "#22c55e"
};

// ── Reusable Badge / Indicator Components ──

function StatusBadge({ status }: { status: TaskStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <Text
      sx={{
        fontSize: 10,
        fontWeight: "bold",
        px: "6px",
        py: "2px",
        borderRadius: 4,
        color: config.color,
        bg: config.bg,
        border: `1px solid ${config.color}30`,
        textTransform: "uppercase",
        letterSpacing: "0.5px"
      }}
    >
      {config.label}
    </Text>
  );
}

function PriorityIndicator({ priority }: { priority: TaskPriority }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <Text
      title={config.label}
      sx={{
        fontSize: 10,
        lineHeight: 1,
        fontWeight: "bold",
        color: config.color,
        fontFamily: "monospace"
      }}
    >
      [{config.icon}]
    </Text>
  );
}

function TypeBadge({ type }: { type: TaskType }) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.chore;
  return (
    <Text
      sx={{
        fontSize: 9,
        fontWeight: "bold",
        px: "5px",
        py: "1px",
        borderRadius: 3,
        color: config.color,
        bg: `${config.color}18`,
        border: `1px solid ${config.color}30`,
        textTransform: "uppercase",
        letterSpacing: "0.3px",
        fontFamily: "monospace"
      }}
    >
      {config.icon} {config.label}
    </Text>
  );
}

function ReviewBadge({ reviewStatus }: { reviewStatus: WorkstationTask["reviewStatus"] }) {
  if (!reviewStatus || reviewStatus === "none") return null;
  const configs = {
    in_review: { label: "In Review", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
    approved: { label: "Approved", color: "#22c55e", bg: "#22c55e15" },
    rejected: { label: "Rejected", color: "#ef4444", bg: "#ef444415" }
  };
  const config = configs[reviewStatus];
  return (
    <Text
      sx={{
        fontSize: 9,
        fontWeight: "bold",
        px: "5px",
        py: "1px",
        borderRadius: 3,
        color: config.color,
        bg: config.bg,
        border: `1px solid ${config.color}40`,
        textTransform: "uppercase",
        letterSpacing: "0.3px"
      }}
    >
      {reviewStatus === "in_review" ? "?" : reviewStatus === "approved" ? "OK" : "X"} {config.label}
    </Text>
  );
}

// ── Utility ──

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((ts - now.getTime()) / 86400000);

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diffMin = Math.floor((now - ts) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function SectionHeader({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <Flex sx={{ alignItems: "center", gap: 1, mb: 1 }}>
      <Text sx={{ fontSize: 11, fontWeight: "bold", color: "paragraph-secondary", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {title}
      </Text>
      {count !== undefined && (
        <Text sx={{ fontSize: 10, color: "paragraph-secondary", bg: "background", px: "5px", py: "1px", borderRadius: 8, fontWeight: "bold" }}>
          {count}
        </Text>
      )}
      {children && <Flex sx={{ flex: 1 }} />}
      {children}
    </Flex>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <Flex sx={{ flexDirection: "column" }}>
      <Text sx={{ fontSize: 10, color: "paragraph-secondary", textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text sx={{ fontSize: 13, color: "heading" }}>{value}</Text>
    </Flex>
  );
}

// ── Epics Panel ──

function EpicsPanel() {
  const epics = useTaskStore((s) => s.epics);
  const tasks = useTaskStore((s) => s.tasks);
  const addEpic = useTaskStore((s) => s.addEpic);
  const deleteEpic = useTaskStore((s) => s.deleteEpic);
  const selectTask = useTaskStore((s) => s.selectTask);

  const [collapsed, setCollapsed] = useState(true);
  const [expandedEpicId, setExpandedEpicId] = useState<string | null>(null);
  const [newEpicTitle, setNewEpicTitle] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  if (epics.length === 0 && !showNewInput && collapsed) {
    return (
      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          bg: "background-secondary",
          borderRadius: 8,
          border: "1px solid var(--border)",
          px: 3,
          py: 2
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading" }}>Epics</Text>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>(none)</Text>
        </Flex>
        <Button
          variant="secondary"
          sx={{ fontSize: 11, px: 2, py: 1 }}
          onClick={() => { setShowNewInput(true); setCollapsed(false); }}
        >
          + New Epic
        </Button>
      </Flex>
    );
  }

  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <Flex
        onClick={() => setCollapsed(!collapsed)}
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 3,
          py: 2,
          cursor: "pointer",
          "&:hover": { bg: "hover" }
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontFamily: "monospace" }}>
            {collapsed ? ">" : "v"}
          </Text>
          <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading" }}>Epics</Text>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary", bg: "background", px: "5px", py: "1px", borderRadius: 8, fontWeight: "bold" }}>
            {epics.length}
          </Text>
        </Flex>
        <Button
          variant="secondary"
          sx={{ fontSize: 11, px: 2, py: 1 }}
          onClick={(e) => { e.stopPropagation(); setShowNewInput(true); setCollapsed(false); }}
        >
          + New Epic
        </Button>
      </Flex>

      {/* Body */}
      {!collapsed && (
        <Flex sx={{ flexDirection: "column", px: 2, pb: 2, gap: 1 }}>
          {epics.map((epic) => {
            const epicTasks = tasks.filter((t) => epic.taskIds.includes(t.id));
            const doneTasks = epicTasks.filter((t) => t.status === "done" || t.status === "cancelled");
            const progress = epicTasks.length > 0 ? (doneTasks.length / epicTasks.length) * 100 : 0;
            const isExpanded = expandedEpicId === epic.id;

            return (
              <Flex key={epic.id} sx={{ flexDirection: "column", gap: 1 }}>
                <Flex
                  onClick={() => setExpandedEpicId(isExpanded ? null : epic.id)}
                  sx={{
                    alignItems: "center",
                    gap: 2,
                    px: 2,
                    py: "6px",
                    borderRadius: 6,
                    cursor: "pointer",
                    bg: isExpanded ? "hover" : "transparent",
                    "&:hover": { bg: "hover" }
                  }}
                >
                  <Text sx={{ fontSize: 10, color: "paragraph-secondary", fontFamily: "monospace", width: 10 }}>
                    {isExpanded ? "v" : ">"}
                  </Text>
                  <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading", flex: 1 }}>
                    {epic.title}
                  </Text>
                  <PriorityIndicator priority={epic.priority} />
                  {/* Progress bar */}
                  <Flex sx={{ alignItems: "center", gap: 1, width: 100 }}>
                    <Box sx={{ flex: 1, height: 4, bg: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                      <Box sx={{ width: `${progress}%`, height: "100%", bg: "#22c55e", borderRadius: 2, transition: "width 0.2s" }} />
                    </Box>
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                      {doneTasks.length}/{epicTasks.length}
                    </Text>
                  </Flex>
                  <Button
                    variant="secondary"
                    sx={{ fontSize: 9, px: 1, py: 0, color: "#ef4444", bg: "transparent" }}
                    onClick={(e) => { e.stopPropagation(); deleteEpic(epic.id); }}
                    title="Delete epic"
                  >
                    x
                  </Button>
                </Flex>

                {/* Expanded child tasks */}
                {isExpanded && epicTasks.length > 0 && (
                  <Flex sx={{ flexDirection: "column", ml: 4, gap: "2px" }}>
                    {epicTasks.map((t) => (
                      <Flex
                        key={t.id}
                        onClick={() => selectTask(t.id)}
                        sx={{
                          alignItems: "center",
                          gap: 1,
                          px: 2,
                          py: 1,
                          borderRadius: 4,
                          cursor: "pointer",
                          "&:hover": { bg: "hover" }
                        }}
                      >
                        <Box sx={{
                          width: 6, height: 6, borderRadius: "50%",
                          bg: STATUS_CONFIG[t.status].color, flexShrink: 0
                        }} />
                        <Text sx={{
                          fontSize: 11, color: t.status === "done" ? "paragraph-secondary" : "heading",
                          textDecoration: t.status === "done" ? "line-through" : "none",
                          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                        }}>
                          {t.title}
                        </Text>
                        <TypeBadge type={t.type} />
                      </Flex>
                    ))}
                  </Flex>
                )}
                {isExpanded && epicTasks.length === 0 && (
                  <Text sx={{ fontSize: 11, color: "paragraph-secondary", ml: 4, fontStyle: "italic" }}>
                    No tasks in this epic
                  </Text>
                )}
              </Flex>
            );
          })}

          {/* New epic input */}
          {showNewInput && (
            <Flex sx={{ gap: 1, px: 2 }}>
              <Input
                value={newEpicTitle}
                onChange={(e) => setNewEpicTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newEpicTitle.trim()) {
                    addEpic({ title: newEpicTitle.trim(), description: "", status: "todo", priority: "medium" });
                    setNewEpicTitle("");
                    setShowNewInput(false);
                  }
                  if (e.key === "Escape") { setShowNewInput(false); setNewEpicTitle(""); }
                }}
                autoFocus
                placeholder="Epic title... (Enter to create, Esc to cancel)"
                sx={{
                  flex: 1, fontSize: 12, border: "1px solid var(--accent)",
                  borderRadius: 4, px: 2, py: 1, bg: "background"
                }}
              />
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}

// ── Task Row (List View) ──

function TaskRow({
  task,
  isSelected,
  onSelect
}: {
  task: WorkstationTask;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const tasks = useTaskStore((s) => s.tasks);
  const isOverdue =
    task.dueDate &&
    task.dueDate < Date.now() &&
    task.status !== "done" &&
    task.status !== "cancelled";

  // Check if blocked
  const deps = task.dependencies || [];
  const isBlocked = deps.length > 0 &&
    deps.some((depId) => {
      const dep = tasks.find((d) => d.id === depId);
      return dep && dep.status !== "done" && dep.status !== "cancelled";
    });

  const subs = task.subtaskIds || [];
  const subtaskCount = subs.length;
  const subtasksDone = tasks.filter(
    (t) => subs.includes(t.id) && t.status === "done"
  ).length;

  return (
    <Flex
      onClick={onSelect}
      sx={{
        alignItems: "center",
        gap: 2,
        py: 2,
        px: 3,
        borderRadius: 6,
        bg: isSelected ? "hover" : "transparent",
        border: isSelected ? "1px solid var(--accent)" : "1px solid transparent",
        cursor: "pointer",
        opacity: isBlocked ? 0.65 : 1,
        "&:hover": { bg: "hover" }
      }}
    >
      {/* Checkbox */}
      <Box
        onClick={(e) => {
          e.stopPropagation();
          updateTaskStatus(
            task.id,
            task.status === "done" ? "todo" : "done"
          );
        }}
        sx={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border:
            task.status === "done"
              ? "2px solid #22c55e"
              : "2px solid var(--border)",
          bg: task.status === "done" ? "#22c55e" : "transparent",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          "&:hover": {
            borderColor: task.status === "done" ? "#22c55e" : "var(--accent)"
          }
        }}
      >
        {task.status === "done" && (
          <Text sx={{ fontSize: 11, color: "white", lineHeight: 1, fontFamily: "monospace" }}>ok</Text>
        )}
      </Box>

      {/* Blocked indicator */}
      {isBlocked && (
        <Text title="Blocked by dependency" sx={{ fontSize: 12, color: "#ef4444", fontFamily: "monospace", fontWeight: "bold", flexShrink: 0 }}>
          [B]
        </Text>
      )}

      <PriorityIndicator priority={task.priority} />

      {/* Title + meta */}
      <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Text
            sx={{
              fontSize: 13,
              fontWeight: task.status === "done" ? "normal" : "bold",
              color: task.status === "done" ? "paragraph-secondary" : "heading",
              textDecoration: task.status === "done" ? "line-through" : "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {task.title}
          </Text>
          {subtaskCount > 0 && (
            <Text sx={{ fontSize: 10, color: "paragraph-secondary", fontFamily: "monospace", flexShrink: 0 }}>
              [{subtasksDone}/{subtaskCount}]
            </Text>
          )}
        </Flex>
        <Flex sx={{ alignItems: "center", gap: 2, mt: "2px" }}>
          {task.assignee && (
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {task.assignee.type === "agent" ? "[A]" : "[H]"} {task.assignee.name}
            </Text>
          )}
          {(task.tags || []).length > 0 && (
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {(task.tags || []).map((t) => `#${t}`).join(" ")}
            </Text>
          )}
        </Flex>
      </Flex>

      {/* Type badge */}
      <TypeBadge type={task.type} />

      {/* Review badge */}
      <ReviewBadge reviewStatus={task.reviewStatus} />

      {/* Due date */}
      {task.dueDate && (
        <Text
          sx={{
            fontSize: 11,
            color: isOverdue ? "#ef4444" : "paragraph-secondary",
            fontWeight: isOverdue ? "bold" : "normal",
            flexShrink: 0
          }}
        >
          {formatDate(task.dueDate)}
        </Text>
      )}

      <StatusBadge status={task.status} />
    </Flex>
  );
}

// ── Task Detail Panel ──

function TaskDetail({ task }: { task: WorkstationTask }) {
  const updateTask = useTaskStore((s) => s.updateTask);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const selectTask = useTaskStore((s) => s.selectTask);
  const addComment = useTaskStore((s) => s.addComment);
  const addSubtask = useTaskStore((s) => s.addSubtask);
  const getSubtasks = useTaskStore((s) => s.getSubtasks);
  const linkBranch = useTaskStore((s) => s.linkBranch);
  const unlinkBranch = useTaskStore((s) => s.unlinkBranch);
  const linkCommit = useTaskStore((s) => s.linkCommit);
  const linkFile = useTaskStore((s) => s.linkFile);
  const unlinkFile = useTaskStore((s) => s.unlinkFile);
  const updateContext = useTaskStore((s) => s.updateContext);
  const addLogEntry = useTaskStore((s) => s.addLogEntry);
  const submitForReview = useTaskStore((s) => s.submitForReview);
  const approveTask = useTaskStore((s) => s.approveTask);
  const rejectTask = useTaskStore((s) => s.rejectTask);
  const addDependency = useTaskStore((s) => s.addDependency);
  const removeDependency = useTaskStore((s) => s.removeDependency);
  const tasks = useTaskStore((s) => s.tasks);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState(task.description);
  const [newComment, setNewComment] = useState("");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newCommitSha, setNewCommitSha] = useState("");
  const [newFilePath, setNewFilePath] = useState("");
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [newLogContent, setNewLogContent] = useState("");
  const [newLogType, setNewLogType] = useState<ActivityEntry["type"]>("log");
  const [newDepId, setNewDepId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  // Context handoff state
  const ctx = task.contextHandoff || { done: [], remaining: [], decisions: [], uncertainties: [], updatedAt: 0 };
  const [ctxNewDone, setCtxNewDone] = useState("");
  const [ctxNewRemaining, setCtxNewRemaining] = useState("");
  const [ctxNewDecision, setCtxNewDecision] = useState("");
  const [ctxNewUncertainty, setCtxNewUncertainty] = useState("");

  const statusFlow: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];
  const priorities: TaskPriority[] = ["critical", "high", "medium", "low"];
  const types: TaskType[] = ["feature", "bug", "chore", "docs", "refactor", "test"];

  const subtasks = getSubtasks(task.id);

  // Dependencies
  const taskDeps = task.dependencies || [];
  const taskBlocked = task.blockedBy || [];
  const dependsOnTasks = tasks.filter((t) => taskDeps.includes(t.id));
  const blocksTasks = tasks.filter((t) => taskBlocked.includes(t.id));
  const availableForDep = tasks.filter(
    (t) => t.id !== task.id && !taskDeps.includes(t.id) && t.parentTaskId !== task.id
  );

  const handleDelete = () => {
    selectTask(null);
    deleteTask(task.id);
  };

  const handleCtxUpdate = (field: keyof TaskContext, items: string[]) => {
    const updated: TaskContext = {
      done: field === "done" ? items : ctx.done,
      remaining: field === "remaining" ? items : ctx.remaining,
      decisions: field === "decisions" ? items : ctx.decisions,
      uncertainties: field === "uncertainties" ? items : ctx.uncertainties,
      updatedAt: Date.now()
    };
    updateContext(task.id, updated);
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        flex: 1,
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden",
        minWidth: 340
      }}
    >
      {/* Header */}
      <Flex
        sx={{
          flexDirection: "column",
          p: 3,
          gap: 2,
          borderBottom: "1px solid var(--border)",
          flexShrink: 0
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <PriorityIndicator priority={task.priority} />
          {isEditingTitle ? (
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => {
                if (editTitle.trim()) updateTask(task.id, { title: editTitle.trim() });
                setIsEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (editTitle.trim()) updateTask(task.id, { title: editTitle.trim() });
                  setIsEditingTitle(false);
                }
                if (e.key === "Escape") setIsEditingTitle(false);
              }}
              autoFocus
              sx={{ flex: 1, fontSize: 16, fontWeight: "bold", border: "1px solid var(--accent)", borderRadius: 4, px: 1, py: 0 }}
            />
          ) : (
            <Text
              onClick={() => { setEditTitle(task.title); setIsEditingTitle(true); }}
              sx={{ fontSize: 16, fontWeight: "bold", color: "heading", flex: 1, cursor: "text", "&:hover": { textDecoration: "underline" } }}
            >
              {task.title}
            </Text>
          )}
          <Button
            variant="secondary"
            sx={{ fontSize: 10, px: 1, py: 0, color: "#ef4444", bg: "transparent" }}
            onClick={handleDelete}
            title="Delete task"
          >
            Delete
          </Button>
        </Flex>

        {/* Status flow */}
        <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
          {statusFlow.map((status) => (
            <Button
              key={status}
              variant={task.status === status ? "accent" : "secondary"}
              sx={{
                fontSize: 11, px: 2, py: 1, borderRadius: 4,
                ...(status === "in_review" ? { borderColor: "#a78bfa40" } : {})
              }}
              onClick={() => updateTaskStatus(task.id, status)}
            >
              {STATUS_CONFIG[status].label}
            </Button>
          ))}
        </Flex>

        {/* Priority selector */}
        <Flex sx={{ gap: 1, alignItems: "center" }}>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary", textTransform: "uppercase", fontWeight: "bold" }}>
            Priority:
          </Text>
          {priorities.map((p) => (
            <Button
              key={p}
              variant={task.priority === p ? "accent" : "secondary"}
              sx={{ fontSize: 10, px: 1, py: "2px", borderRadius: 4 }}
              onClick={() => updateTask(task.id, { priority: p })}
            >
              [{PRIORITY_CONFIG[p].icon}] {p}
            </Button>
          ))}
        </Flex>

        {/* Type selector */}
        <Flex sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary", textTransform: "uppercase", fontWeight: "bold" }}>
            Type:
          </Text>
          {types.map((t) => {
            const tc = TYPE_CONFIG[t];
            return (
              <Button
                key={t}
                variant="secondary"
                sx={{
                  fontSize: 10, px: 1, py: "2px", borderRadius: 4,
                  color: task.type === t ? tc.color : "paragraph-secondary",
                  bg: task.type === t ? `${tc.color}18` : "transparent",
                  border: task.type === t ? `1px solid ${tc.color}40` : "1px solid transparent",
                  fontFamily: "monospace"
                }}
                onClick={() => updateTask(task.id, { type: t })}
              >
                {tc.icon} {tc.label}
              </Button>
            );
          })}
        </Flex>

        {/* Review workflow buttons */}
        <Flex sx={{ gap: 1, alignItems: "center" }}>
          {task.status === "in_progress" && task.reviewStatus !== "in_review" && (
            <Button
              variant="secondary"
              sx={{ fontSize: 11, px: 2, py: 1, color: "#a78bfa", border: "1px solid #a78bfa40" }}
              onClick={() => submitForReview(task.id)}
            >
              Submit for Review
            </Button>
          )}
          {task.reviewStatus === "in_review" && (
            <>
              <Button
                variant="secondary"
                sx={{ fontSize: 11, px: 2, py: 1, color: "#22c55e", border: "1px solid #22c55e40" }}
                onClick={() => approveTask(task.id)}
              >
                Approve
              </Button>
              {showRejectInput ? (
                <Flex sx={{ gap: 1, flex: 1 }}>
                  <Input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && rejectReason.trim()) {
                        rejectTask(task.id, rejectReason.trim());
                        setRejectReason("");
                        setShowRejectInput(false);
                      }
                      if (e.key === "Escape") { setShowRejectInput(false); setRejectReason(""); }
                    }}
                    autoFocus
                    placeholder="Rejection reason..."
                    sx={{ flex: 1, fontSize: 11, border: "1px solid #ef4444", borderRadius: 4, px: 1, py: "2px" }}
                  />
                </Flex>
              ) : (
                <Button
                  variant="secondary"
                  sx={{ fontSize: 11, px: 2, py: 1, color: "#ef4444", border: "1px solid #ef444440" }}
                  onClick={() => setShowRejectInput(true)}
                >
                  Reject
                </Button>
              )}
            </>
          )}
          <ReviewBadge reviewStatus={task.reviewStatus} />
        </Flex>
      </Flex>

      {/* Body - scrollable */}
      <Flex sx={{ flexDirection: "column", p: 3, gap: 3, flex: 1, overflow: "auto" }}>
        {/* Description */}
        <Flex sx={{ flexDirection: "column", gap: 1 }}>
          <SectionHeader title="Description" />
          {isEditingDesc ? (
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              onBlur={() => {
                updateTask(task.id, { description: editDesc });
                setIsEditingDesc(false);
              }}
              autoFocus
              style={{
                fontSize: 13, color: "var(--paragraph)", lineHeight: 1.6,
                border: "1px solid var(--accent)", borderRadius: 4,
                padding: 8, backgroundColor: "var(--background)", resize: "vertical", minHeight: 80,
                fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box"
              }}
            />
          ) : (
            <Text
              onClick={() => { setEditDesc(task.description); setIsEditingDesc(true); }}
              sx={{ fontSize: 13, color: "paragraph", lineHeight: 1.6, cursor: "text", "&:hover": { bg: "hover" }, borderRadius: 4, p: 1 }}
            >
              {task.description || "Click to add description..."}
            </Text>
          )}
        </Flex>

        {/* Meta */}
        <Flex sx={{ gap: 4, flexWrap: "wrap" }}>
          <MetaField label="Assignee" value={
            task.assignee
              ? `${task.assignee.type === "agent" ? "[A]" : "[H]"} ${task.assignee.name}`
              : "Unassigned"
          } />
          <MetaField label="Source" value={task.source} />
          <MetaField
            label="Due"
            value={task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No deadline"}
          />
          <MetaField
            label="Created"
            value={new Date(task.createdAt).toLocaleDateString()}
          />
        </Flex>

        {/* Tags */}
        {(task.tags || []).length > 0 && (
          <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
            {(task.tags || []).map((tag) => (
              <Text
                key={tag}
                sx={{
                  fontSize: 11, px: 2, py: "2px", borderRadius: 4,
                  bg: "background", color: "accent", border: "1px solid var(--border)"
                }}
              >
                #{tag}
              </Text>
            ))}
          </Flex>
        )}

        {/* ── Git Integration ── */}
        <Flex sx={{ flexDirection: "column", gap: 2, bg: "background", p: 2, borderRadius: 6, border: "1px solid var(--border)" }}>
          <SectionHeader title="Git Integration" />

          {/* Branch */}
          <Flex sx={{ alignItems: "center", gap: 1 }}>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontWeight: "bold", width: 60 }}>Branch:</Text>
            {task.gitBranch ? (
              <Flex sx={{ alignItems: "center", gap: 1, flex: 1 }}>
                <Text sx={{ fontSize: 12, color: "#a78bfa", fontFamily: "monospace", bg: "#a78bfa15", px: "6px", py: "2px", borderRadius: 4 }}>
                  {task.gitBranch}
                </Text>
                <Button
                  variant="secondary"
                  sx={{ fontSize: 9, px: 1, py: 0, color: "#ef4444" }}
                  onClick={() => unlinkBranch(task.id)}
                >
                  x
                </Button>
              </Flex>
            ) : (
              <Flex sx={{ gap: 1, flex: 1 }}>
                <Input
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newBranch.trim()) {
                      linkBranch(task.id, newBranch.trim());
                      setNewBranch("");
                    }
                  }}
                  placeholder="feature/my-branch"
                  sx={{ flex: 1, fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, px: 1, py: "2px", fontFamily: "monospace" }}
                />
              </Flex>
            )}
          </Flex>

          {/* Commits */}
          <Flex sx={{ flexDirection: "column", gap: 1 }}>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontWeight: "bold" }}>
              Commits ({(task.gitCommits || []).length}):
            </Text>
            {(task.gitCommits || []).length > 0 && (
              <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
                {(task.gitCommits || []).map((sha) => (
                  <Text
                    key={sha}
                    sx={{
                      fontSize: 11, fontFamily: "monospace", color: "#f59e0b",
                      bg: "#f59e0b15", px: "6px", py: "2px", borderRadius: 4
                    }}
                  >
                    {sha.slice(0, 7)}
                  </Text>
                ))}
              </Flex>
            )}
            <Flex sx={{ gap: 1 }}>
              <Input
                value={newCommitSha}
                onChange={(e) => setNewCommitSha(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newCommitSha.trim()) {
                    linkCommit(task.id, newCommitSha.trim());
                    setNewCommitSha("");
                  }
                }}
                placeholder="Commit SHA..."
                sx={{ flex: 1, fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, px: 1, py: "2px", fontFamily: "monospace" }}
              />
            </Flex>
          </Flex>

          {/* Files */}
          <Flex sx={{ flexDirection: "column", gap: 1 }}>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontWeight: "bold" }}>
              Files ({(task.linkedFiles || []).length}):
            </Text>
            {(task.linkedFiles || []).map((f) => (
              <Flex key={f.path} sx={{ alignItems: "center", gap: 1 }}>
                <Text sx={{
                  fontSize: 9, fontWeight: "bold", px: "4px", py: "1px", borderRadius: 3,
                  color: FILE_STATUS_COLORS[f.status], bg: `${FILE_STATUS_COLORS[f.status]}15`,
                  textTransform: "uppercase", fontFamily: "monospace"
                }}>
                  {f.status === "new" ? "N" : f.status === "modified" ? "M" : "U"}
                </Text>
                <Text sx={{ fontSize: 11, fontFamily: "monospace", color: "paragraph", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.path}
                </Text>
                <Button
                  variant="secondary"
                  sx={{ fontSize: 9, px: 1, py: 0, color: "#ef4444" }}
                  onClick={() => unlinkFile(task.id, f.path)}
                >
                  x
                </Button>
              </Flex>
            ))}
            <Flex sx={{ gap: 1 }}>
              <Input
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFilePath.trim()) {
                    linkFile(task.id, newFilePath.trim(), "");
                    setNewFilePath("");
                  }
                }}
                placeholder="File path..."
                sx={{ flex: 1, fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, px: 1, py: "2px", fontFamily: "monospace" }}
              />
            </Flex>
          </Flex>
        </Flex>

        {/* ── Subtasks ── */}
        <Flex sx={{ flexDirection: "column", gap: 2, bg: "background", p: 2, borderRadius: 6, border: "1px solid var(--border)" }}>
          <SectionHeader title="Subtasks" count={subtasks.length} />
          {subtasks.map((st) => (
            <Flex
              key={st.id}
              sx={{ alignItems: "center", gap: 1, px: 1 }}
            >
              <Box
                onClick={() => {
                  const store = useTaskStore.getState();
                  store.updateTaskStatus(st.id, st.status === "done" ? "todo" : "done");
                }}
                sx={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: st.status === "done" ? "2px solid #22c55e" : "2px solid var(--border)",
                  bg: st.status === "done" ? "#22c55e" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
                }}
              >
                {st.status === "done" && (
                  <Text sx={{ fontSize: 9, color: "white", lineHeight: 1, fontFamily: "monospace" }}>ok</Text>
                )}
              </Box>
              <Text
                onClick={() => selectTask(st.id)}
                sx={{
                  fontSize: 12, flex: 1, cursor: "pointer",
                  color: st.status === "done" ? "paragraph-secondary" : "heading",
                  textDecoration: st.status === "done" ? "line-through" : "none",
                  "&:hover": { textDecoration: "underline" }
                }}
              >
                {st.title}
              </Text>
              <StatusBadge status={st.status} />
            </Flex>
          ))}
          <Flex sx={{ gap: 1 }}>
            <Input
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubtaskTitle.trim()) {
                  addSubtask(task.id, newSubtaskTitle.trim());
                  setNewSubtaskTitle("");
                }
              }}
              placeholder="Add subtask..."
              sx={{ flex: 1, fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, px: 2, py: 1, bg: "background-secondary" }}
            />
          </Flex>
        </Flex>

        {/* ── Context Handoff Panel ── */}
        <Flex sx={{ flexDirection: "column", bg: "background", borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
          <Flex
            onClick={() => setShowContextPanel(!showContextPanel)}
            sx={{
              alignItems: "center", gap: 1, px: 2, py: "6px", cursor: "pointer",
              "&:hover": { bg: "hover" }
            }}
          >
            <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontFamily: "monospace" }}>
              {showContextPanel ? "v" : ">"}
            </Text>
            <Text sx={{ fontSize: 11, fontWeight: "bold", color: "paragraph-secondary", textTransform: "uppercase" }}>
              Context Handoff
            </Text>
            {ctx.updatedAt > 0 && (
              <Text sx={{ fontSize: 10, color: "paragraph-secondary", ml: 1 }}>
                (updated {formatTimestamp(ctx.updatedAt)})
              </Text>
            )}
          </Flex>
          {showContextPanel && (
            <Flex sx={{ flexDirection: "column", gap: 2, p: 2, pt: 0 }}>
              {/* Done */}
              <ContextList
                label="Done"
                items={ctx.done}
                inputValue={ctxNewDone}
                onInputChange={setCtxNewDone}
                onAdd={(item) => { handleCtxUpdate("done", [...ctx.done, item]); setCtxNewDone(""); }}
                onRemove={(idx) => handleCtxUpdate("done", ctx.done.filter((_, i) => i !== idx))}
                color="#22c55e"
              />
              {/* Remaining */}
              <ContextList
                label="Remaining"
                items={ctx.remaining}
                inputValue={ctxNewRemaining}
                onInputChange={setCtxNewRemaining}
                onAdd={(item) => { handleCtxUpdate("remaining", [...ctx.remaining, item]); setCtxNewRemaining(""); }}
                onRemove={(idx) => handleCtxUpdate("remaining", ctx.remaining.filter((_, i) => i !== idx))}
                color="#3b82f6"
              />
              {/* Decisions */}
              <ContextList
                label="Decisions"
                items={ctx.decisions}
                inputValue={ctxNewDecision}
                onInputChange={setCtxNewDecision}
                onAdd={(item) => { handleCtxUpdate("decisions", [...ctx.decisions, item]); setCtxNewDecision(""); }}
                onRemove={(idx) => handleCtxUpdate("decisions", ctx.decisions.filter((_, i) => i !== idx))}
                color="#f59e0b"
              />
              {/* Uncertainties */}
              <ContextList
                label="Uncertainties"
                items={ctx.uncertainties}
                inputValue={ctxNewUncertainty}
                onInputChange={setCtxNewUncertainty}
                onAdd={(item) => { handleCtxUpdate("uncertainties", [...ctx.uncertainties, item]); setCtxNewUncertainty(""); }}
                onRemove={(idx) => handleCtxUpdate("uncertainties", ctx.uncertainties.filter((_, i) => i !== idx))}
                color="#ef4444"
              />
            </Flex>
          )}
        </Flex>

        {/* ── Dependencies ── */}
        <Flex sx={{ flexDirection: "column", gap: 2, bg: "background", p: 2, borderRadius: 6, border: "1px solid var(--border)" }}>
          <SectionHeader title="Dependencies" />

          {/* Depends on */}
          <Flex sx={{ flexDirection: "column", gap: 1 }}>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary", fontWeight: "bold" }}>Depends on:</Text>
            {dependsOnTasks.length > 0 ? (
              dependsOnTasks.map((dep) => (
                <Flex key={dep.id} sx={{ alignItems: "center", gap: 1, px: 1 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: "50%", bg: STATUS_CONFIG[dep.status].color, flexShrink: 0 }} />
                  <Text sx={{ fontSize: 11, color: "heading", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {dep.title}
                  </Text>
                  <StatusBadge status={dep.status} />
                  <Button
                    variant="secondary"
                    sx={{ fontSize: 9, px: 1, py: 0, color: "#ef4444" }}
                    onClick={() => removeDependency(task.id, dep.id)}
                  >
                    x
                  </Button>
                </Flex>
              ))
            ) : (
              <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontStyle: "italic", px: 1 }}>None</Text>
            )}
            <Flex sx={{ gap: 1 }}>
              <select
                value={newDepId}
                onChange={(e) => {
                  if (e.target.value) {
                    addDependency(task.id, e.target.value);
                    setNewDepId("");
                  }
                }}
                style={{
                  flex: 1, fontSize: 11, border: "1px solid var(--border)", borderRadius: 4,
                  padding: "2px 4px", backgroundColor: "var(--background-secondary)", color: "var(--paragraph)",
                  fontFamily: "inherit"
                }}
              >
                <option value="">Add dependency...</option>
                {availableForDep.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </Flex>
          </Flex>

          {/* Blocks */}
          <Flex sx={{ flexDirection: "column", gap: 1 }}>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary", fontWeight: "bold" }}>Blocks:</Text>
            {blocksTasks.length > 0 ? (
              blocksTasks.map((bt) => (
                <Flex key={bt.id} sx={{ alignItems: "center", gap: 1, px: 1 }}>
                  <Text sx={{ fontSize: 10, color: "#ef4444", fontFamily: "monospace", fontWeight: "bold" }}>[B]</Text>
                  <Text
                    onClick={() => selectTask(bt.id)}
                    sx={{ fontSize: 11, color: "heading", flex: 1, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                  >
                    {bt.title}
                  </Text>
                  <StatusBadge status={bt.status} />
                </Flex>
              ))
            ) : (
              <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontStyle: "italic", px: 1 }}>None</Text>
            )}
          </Flex>
        </Flex>

        {/* ── Activity Log ── */}
        <Flex sx={{ flexDirection: "column", gap: 2, bg: "background", p: 2, borderRadius: 6, border: "1px solid var(--border)" }}>
          <SectionHeader title="Activity Log" count={(task.activityLog || []).length} />

          {/* Timeline */}
          {(task.activityLog || []).length > 0 && (
            <Flex sx={{ flexDirection: "column", gap: 1 }}>
              {[...(task.activityLog || [])].reverse().slice(0, 20).map((entry) => (
                <Flex key={entry.id} sx={{ alignItems: "flex-start", gap: 1, px: 1 }}>
                  <Text sx={{
                    fontSize: 10, fontFamily: "monospace", fontWeight: "bold",
                    color: entry.type === "blocker" ? "#ef4444"
                      : entry.type === "review" ? "#a78bfa"
                      : entry.type === "decision" ? "#f59e0b"
                      : entry.type === "handoff" ? "#22c55e"
                      : "paragraph-secondary",
                    width: 20, textAlign: "center", flexShrink: 0, mt: "1px"
                  }}>
                    {ACTIVITY_ICONS[entry.type]}
                  </Text>
                  <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <Flex sx={{ alignItems: "center", gap: 1 }}>
                      <Text sx={{ fontSize: 10, fontWeight: "bold", color: "heading" }}>{entry.authorName}</Text>
                      <Text sx={{ fontSize: 9, color: "paragraph-secondary" }}>{formatTimestamp(entry.timestamp)}</Text>
                    </Flex>
                    <Text sx={{ fontSize: 11, color: "paragraph", lineHeight: 1.4 }}>{entry.content}</Text>
                  </Flex>
                </Flex>
              ))}
            </Flex>
          )}

          {/* Add log entry */}
          <Flex sx={{ gap: 1, alignItems: "center" }}>
            <select
              value={newLogType}
              onChange={(e) => setNewLogType(e.target.value as ActivityEntry["type"])}
              style={{
                fontSize: 11, border: "1px solid var(--border)", borderRadius: 4,
                padding: "2px 4px", backgroundColor: "var(--background-secondary)", color: "var(--paragraph)",
                fontFamily: "inherit"
              }}
            >
              <option value="log">Log</option>
              <option value="decision">Decision</option>
              <option value="blocker">Blocker</option>
              <option value="handoff">Handoff</option>
              <option value="review">Review</option>
            </select>
            <Input
              value={newLogContent}
              onChange={(e) => setNewLogContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newLogContent.trim()) {
                  addLogEntry(task.id, newLogType, newLogContent.trim(), "user", "You");
                  setNewLogContent("");
                }
              }}
              placeholder="Add log entry..."
              sx={{ flex: 1, fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, px: 2, py: 1, bg: "background-secondary" }}
            />
          </Flex>
        </Flex>

        {/* ── Comments ── */}
        <Flex sx={{ flexDirection: "column", gap: 2 }}>
          <SectionHeader title="Comments" count={(task.comments || []).length} />
          {(task.comments || []).map((comment) => (
            <Flex
              key={comment.id}
              sx={{
                flexDirection: "column", gap: 1, p: 2,
                borderRadius: 6, bg: "background", border: "1px solid var(--border)"
              }}
            >
              <Flex sx={{ alignItems: "center", gap: 1 }}>
                <Text sx={{ fontSize: 11, fontWeight: "bold", color: "heading" }}>
                  {comment.authorType === "agent" ? "[A]" : "[H]"}{" "}
                  {comment.authorName}
                </Text>
                <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                  {formatTimestamp(comment.timestamp)}
                </Text>
              </Flex>
              <Text sx={{ fontSize: 12, color: "paragraph", lineHeight: 1.5 }}>
                {comment.content}
              </Text>
            </Flex>
          ))}

          {/* Add Comment */}
          <Flex sx={{ gap: 1 }}>
            <Input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newComment.trim()) {
                  addComment(task.id, {
                    authorId: "user",
                    authorName: "You",
                    authorType: "human",
                    content: newComment.trim(),
                    timestamp: Date.now()
                  });
                  setNewComment("");
                }
              }}
              placeholder="Add a comment..."
              sx={{
                flex: 1, fontSize: 12, border: "1px solid var(--border)",
                borderRadius: 6, px: 2, py: 1, bg: "background",
                "&:focus": { borderColor: "var(--accent)", outline: "none" }
              }}
            />
            <Button
              variant="secondary"
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={() => {
                if (newComment.trim()) {
                  addComment(task.id, {
                    authorId: "user",
                    authorName: "You",
                    authorType: "human",
                    content: newComment.trim(),
                    timestamp: Date.now()
                  });
                  setNewComment("");
                }
              }}
              disabled={!newComment.trim()}
            >
              Post
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Flex>
  );
}

// ── Context List (used in Context Handoff panel) ──

function ContextList({
  label,
  items,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  color
}: {
  label: string;
  items: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: (item: string) => void;
  onRemove: (idx: number) => void;
  color: string;
}) {
  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      <Text sx={{ fontSize: 10, fontWeight: "bold", color, textTransform: "uppercase" }}>
        {label} ({items.length})
      </Text>
      {items.map((item, idx) => (
        <Flex key={idx} sx={{ alignItems: "center", gap: 1, px: 1 }}>
          <Text sx={{ fontSize: 10, color, fontFamily: "monospace", fontWeight: "bold", flexShrink: 0 }}>-</Text>
          <Text sx={{ fontSize: 11, color: "paragraph", flex: 1 }}>{item}</Text>
          <Button
            variant="secondary"
            sx={{ fontSize: 9, px: 1, py: 0, color: "#ef4444", bg: "transparent" }}
            onClick={() => onRemove(idx)}
          >
            x
          </Button>
        </Flex>
      ))}
      <Input
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && inputValue.trim()) {
            onAdd(inputValue.trim());
          }
        }}
        placeholder={`Add ${label.toLowerCase()} item...`}
        sx={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, px: 1, py: "2px", bg: "background-secondary" }}
      />
    </Flex>
  );
}

// ── Kanban Board View (DnD-enabled) ──

const KANBAN_COLUMNS: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];

function KanbanBoard({
  tasks,
  selectedTaskId,
  onSelectTask
}: {
  tasks: WorkstationTask[];
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
}) {
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const [activeTask, setActiveTask] = useState<WorkstationTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    if (KANBAN_COLUMNS.includes(overId as TaskStatus)) {
      const task = tasks.find((t) => t.id === taskId);
      if (task && task.status !== overId) {
        updateTaskStatus(taskId, overId as TaskStatus);
      }
      return;
    }

    // Dropped on another task -- move to that task's column
    const overTask = tasks.find((t) => t.id === overId);
    if (overTask) {
      const task = tasks.find((t) => t.id === taskId);
      if (task && task.status !== overTask.status) {
        updateTaskStatus(taskId, overTask.status);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <Flex sx={{ flex: 1, gap: 2, minHeight: 0, overflow: "auto" }}>
        {KANBAN_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasks.filter((t) => t.status === status)}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
            onMoveTask={updateTaskStatus}
          />
        ))}
      </Flex>

      <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
        {activeTask && (
          <KanbanCardContent task={activeTask} isSelected={false} isDragOverlay />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  status,
  tasks,
  selectedTaskId,
  onSelectTask,
  onMoveTask
}: {
  status: TaskStatus;
  tasks: WorkstationTask[];
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
}) {
  const config = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <Flex
      sx={{
        flexDirection: "column",
        flex: 1,
        minWidth: 170,
        bg: isOver ? `${config.color}08` : "background-secondary",
        borderRadius: 8,
        border: isOver
          ? `2px dashed ${config.color}`
          : "1px solid var(--border)",
        overflow: "hidden",
        transition: "all 0.15s ease"
      }}
    >
      {/* Column Header */}
      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          p: 2,
          borderBottom: "1px solid var(--border)"
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bg: config.color
            }}
          />
          <Text
            sx={{
              fontSize: 11,
              fontWeight: "bold",
              color: "heading"
            }}
          >
            {config.label}
          </Text>
        </Flex>
        <Text
          sx={{
            fontSize: 11,
            color: "paragraph-secondary",
            bg: "background",
            px: "6px",
            py: "1px",
            borderRadius: 10,
            fontWeight: "bold"
          }}
        >
          {tasks.length}
        </Text>
      </Flex>

      {/* Column Cards */}
      <Flex
        ref={setNodeRef}
        sx={{
          flexDirection: "column",
          gap: 1,
          p: 1,
          flex: 1,
          overflow: "auto",
          minHeight: 60
        }}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableKanbanCard
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              onClick={() =>
                onSelectTask(task.id === selectedTaskId ? null : task.id)
              }
              onMoveLeft={() => {
                const idx = KANBAN_COLUMNS.indexOf(task.status);
                if (idx > 0) onMoveTask(task.id, KANBAN_COLUMNS[idx - 1]);
              }}
              onMoveRight={() => {
                const idx = KANBAN_COLUMNS.indexOf(task.status);
                if (idx < KANBAN_COLUMNS.length - 1)
                  onMoveTask(task.id, KANBAN_COLUMNS[idx + 1]);
              }}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <Flex
            sx={{
              alignItems: "center",
              justifyContent: "center",
              py: 4,
              opacity: 0.5
            }}
          >
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {isOver ? "Drop here" : "Empty"}
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}

function SortableKanbanCard({
  task,
  isSelected,
  onClick,
  onMoveLeft,
  onMoveRight
}: {
  task: WorkstationTask;
  isSelected: boolean;
  onClick: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1
  };

  return (
    <Box ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCardContent
        task={task}
        isSelected={isSelected}
        onClick={onClick}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
      />
    </Box>
  );
}

function KanbanCardContent({
  task,
  isSelected,
  onClick,
  onMoveLeft,
  onMoveRight,
  isDragOverlay
}: {
  task: WorkstationTask;
  isSelected: boolean;
  onClick?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  isDragOverlay?: boolean;
}) {
  const priorityConfig = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const typeConfig = TYPE_CONFIG[task.type] || TYPE_CONFIG.chore;
  const canMoveLeft = KANBAN_COLUMNS.indexOf(task.status) > 0;
  const canMoveRight =
    KANBAN_COLUMNS.indexOf(task.status) < KANBAN_COLUMNS.length - 1;

  const allTasks = useTaskStore((s) => s.tasks);
  const kanbanDeps = task.dependencies || [];
  const isBlocked = kanbanDeps.length > 0 &&
    kanbanDeps.some((depId) => {
      const dep = allTasks.find((d) => d.id === depId);
      return dep && dep.status !== "done" && dep.status !== "cancelled";
    });

  return (
    <Flex
      onClick={onClick}
      sx={{
        flexDirection: "column",
        bg: isDragOverlay ? "hover" : isSelected ? "hover" : "background",
        borderRadius: 6,
        p: 2,
        border: isSelected
          ? "2px solid var(--accent)"
          : isDragOverlay
          ? "2px solid var(--accent)"
          : "1px solid var(--border)",
        cursor: isDragOverlay ? "grabbing" : "pointer",
        gap: 1,
        opacity: isBlocked ? 0.65 : 1,
        boxShadow: isDragOverlay ? "0 4px 12px rgba(0,0,0,0.15)" : "none",
        "&:hover": isDragOverlay ? {} : { bg: "hover" }
      }}
    >
      {/* Top row: type + priority */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <TypeBadge type={task.type} />
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          {isBlocked && (
            <Text sx={{ fontSize: 9, color: "#ef4444", fontFamily: "monospace", fontWeight: "bold" }}>[B]</Text>
          )}
          <Text
            sx={{
              fontSize: 10,
              color: priorityConfig.color,
              fontWeight: "bold",
              fontFamily: "monospace",
              flexShrink: 0
            }}
          >
            [{priorityConfig.icon}]
          </Text>
        </Flex>
      </Flex>

      {/* Title */}
      <Text
        sx={{
          fontSize: 12,
          fontWeight: "bold",
          color: "heading",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {task.title}
      </Text>

      {/* Subtask count */}
      {(task.subtaskIds || []).length > 0 && (
        <Text sx={{ fontSize: 10, color: "paragraph-secondary", fontFamily: "monospace" }}>
          subtasks: {(task.subtaskIds || []).length}
        </Text>
      )}

      {task.assignee && (
        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
          {task.assignee.type === "agent" ? "[A]" : "[H]"} {task.assignee.name}
        </Text>
      )}

      {task.dueDate && (
        <Text
          sx={{
            fontSize: 10,
            color:
              task.dueDate < Date.now() ? "#ef4444" : "paragraph-secondary"
          }}
        >
          Due {new Date(task.dueDate).toLocaleDateString()}
        </Text>
      )}

      {/* Review badge on card */}
      {task.reviewStatus && task.reviewStatus !== "none" && (
        <ReviewBadge reviewStatus={task.reviewStatus} />
      )}

      {/* Move buttons (accessibility fallback) */}
      {!isDragOverlay && (
        <Flex sx={{ gap: 1, mt: 1 }}>
          {canMoveLeft && onMoveLeft && (
            <Button
              variant="secondary"
              sx={{ fontSize: 10, px: 1, py: 0, flex: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                onMoveLeft();
              }}
            >
              &larr;
            </Button>
          )}
          {canMoveRight && onMoveRight && (
            <Button
              variant="secondary"
              sx={{ fontSize: 10, px: 1, py: 0, flex: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                onMoveRight();
              }}
            >
              &rarr;
            </Button>
          )}
        </Flex>
      )}
    </Flex>
  );
}

// ── Quick Add Task ──

function QuickAddTask() {
  const addTask = useTaskStore((s) => s.addTask);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskType, setNewTaskType] = useState<TaskType>("feature");
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for dashboard quick-create event
  useEffect(() => {
    const sub = AppEventManager.subscribe(AppEvents.createNewTask, () => {
      inputRef.current?.focus();
    });
    return () => sub.unsubscribe();
  }, []);

  const handleAdd = () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    addTask({
      title,
      description: "",
      status: "todo",
      priority: "medium",
      type: newTaskType,
      assignee: null,
      dueDate: null,
      tags: [],
      parentTaskId: null,
      source: "manual",
      sourceAgentId: null,
      epicId: null,
      gitBranch: null,
      contextHandoff: null,
      reviewStatus: "none",
      reviewerId: null
    });
    setNewTaskTitle("");
  };

  return (
    <Flex sx={{ gap: 1, alignItems: "center" }}>
      <select
        value={newTaskType}
        onChange={(e) => setNewTaskType(e.target.value as TaskType)}
        style={{
          fontSize: 11, border: "1px solid var(--border)", borderRadius: 6,
          padding: "4px 6px", backgroundColor: "var(--background-secondary)", color: "var(--paragraph)",
          fontFamily: "inherit"
        }}
      >
        {(Object.keys(TYPE_CONFIG) as TaskType[]).map((t) => (
          <option key={t} value={t}>{TYPE_CONFIG[t].icon} {TYPE_CONFIG[t].label}</option>
        ))}
      </select>
      <Input
        ref={inputRef}
        value={newTaskTitle}
        onChange={(e) => setNewTaskTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
        placeholder="Quick add task... (press Enter)"
        sx={{
          flex: 1,
          fontSize: 13,
          border: "1px solid var(--border)",
          borderRadius: 6,
          px: 2,
          py: 1,
          bg: "background-secondary",
          "&:focus": { borderColor: "var(--accent)", outline: "none" }
        }}
      />
      <Button
        variant="accent"
        sx={{ fontSize: 12, px: 3, py: 1 }}
        onClick={handleAdd}
        disabled={!newTaskTitle.trim()}
      >
        Add
      </Button>
    </Flex>
  );
}

// ── Main Tasks View ──

function TasksView() {
  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);
  const filterStatus = useTaskStore((s) => s.filterStatus);
  const setFilterStatus = useTaskStore((s) => s.setFilterStatus);
  const filterType = useTaskStore((s) => s.filterType);
  const setFilterType = useTaskStore((s) => s.setFilterType);
  const [view, setView] = useState<"list" | "board">("list");

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterStatus !== "all" && t.status !== filterStatus) return false;
      if (filterType !== "all" && t.type !== filterType) return false;
      return true;
    });
  }, [tasks, filterStatus, filterType]);

  const statusFilters: (TaskStatus | "all")[] = [
    "all",
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done"
  ];

  const typeFilters: (TaskType | "all")[] = [
    "all",
    "feature",
    "bug",
    "chore",
    "docs",
    "refactor",
    "test"
  ];

  const stats = {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    inReview: tasks.filter((t) => t.status === "in_review").length,
    todo: tasks.filter((t) => t.status === "todo").length
  };

  return (
    <Flex
      sx={{
        flex: 1,
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        p: 3,
        gap: 3
      }}
    >
      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Flex sx={{ flexDirection: "column" }}>
          <Text variant="heading" sx={{ fontSize: 22 }}>
            Tasks
          </Text>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
            {stats.total} total &middot; {stats.inProgress} in progress &middot;{" "}
            {stats.inReview} in review &middot; {stats.todo} to do
          </Text>
        </Flex>
        <Flex sx={{ gap: 1 }}>
          <Button
            variant={view === "list" ? "accent" : "secondary"}
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={() => setView("list")}
          >
            List
          </Button>
          <Button
            variant={view === "board" ? "accent" : "secondary"}
            sx={{ fontSize: 11, px: 2, py: 1 }}
            onClick={() => setView("board")}
          >
            Board
          </Button>
        </Flex>
      </Flex>

      {/* Status Filters */}
      <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
        {statusFilters.map((status) => (
          <Button
            key={status}
            variant={filterStatus === status ? "accent" : "secondary"}
            sx={{ fontSize: 11, px: 2, py: 1, borderRadius: 4 }}
            onClick={() => setFilterStatus(status)}
          >
            {status === "all"
              ? `All (${tasks.length})`
              : `${STATUS_CONFIG[status].label} (${tasks.filter((t) => t.status === status).length})`}
          </Button>
        ))}
      </Flex>

      {/* Type Filters */}
      <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
        {typeFilters.map((type) => {
          const isActive = filterType === type;
          const tc = type !== "all" ? TYPE_CONFIG[type] : null;
          return (
            <Button
              key={type}
              variant="secondary"
              sx={{
                fontSize: 11, px: 2, py: 1, borderRadius: 4,
                fontFamily: "monospace",
                color: isActive ? (tc ? tc.color : "var(--accent)") : "paragraph-secondary",
                bg: isActive ? (tc ? `${tc.color}18` : "var(--accent-bg)") : "transparent",
                border: isActive ? `1px solid ${tc ? `${tc.color}40` : "var(--accent)"}` : "1px solid transparent"
              }}
              onClick={() => setFilterType(type)}
            >
              {type === "all"
                ? `All Types`
                : `${tc!.icon} ${tc!.label} (${tasks.filter((t) => t.type === type).length})`}
            </Button>
          );
        })}
      </Flex>

      {/* Epics Panel */}
      <EpicsPanel />

      {/* Quick Add */}
      <QuickAddTask />

      {/* Content */}
      {view === "board" ? (
        <KanbanBoard
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={selectTask}
        />
      ) : (
        <Flex sx={{ flex: 1, gap: 3, minHeight: 0 }}>
          {/* Task List */}
          <Flex
            sx={{
              flexDirection: "column",
              flex: selectedTask ? 1 : 1,
              overflow: "auto",
              bg: "background-secondary",
              borderRadius: 8,
              border: "1px solid var(--border)",
              py: 1
            }}
          >
            {filteredTasks.length === 0 ? (
              <Flex
                sx={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <Text sx={{ color: "paragraph-secondary", fontSize: 13 }}>
                  No tasks matching this filter
                </Text>
              </Flex>
            ) : (
              filteredTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedTaskId === task.id}
                  onSelect={() =>
                    selectTask(selectedTaskId === task.id ? null : task.id)
                  }
                />
              ))
            )}
          </Flex>

          {/* Detail Panel */}
          {selectedTask && <TaskDetail task={selectedTask} />}
        </Flex>
      )}
    </Flex>
  );
}

export default TasksView;
