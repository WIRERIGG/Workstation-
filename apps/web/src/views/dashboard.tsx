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

import { useState, useMemo } from "react";
import { Box, Flex, Text } from "@theme-ui/components";
import { useStore as useAgentStore, Agent, AgentStatus } from "../stores/agent-store";
import { useStore as useTaskStore, WorkstationTask } from "../stores/task-store";
import { useStore as useCommsStore, CommMessage } from "../stores/comms-store";
import { useStore as useCalendarStore, CalendarEvent } from "../stores/calendar-store";
import { navigate } from "../navigation";

// ── Helpers ──

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelativeDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 0 && diffDays <= 6) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  running: "#22c55e",
  idle: "#94a3b8",
  error: "#ef4444",
  offline: "#6b7280"
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#94a3b8"
};

// ── Components ──

function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        bg: STATUS_COLORS[status],
        flexShrink: 0,
        boxShadow: status === "running" ? `0 0 6px ${STATUS_COLORS[status]}` : "none"
      }}
    />
  );
}

function SectionHeader({
  title,
  actionLabel,
  onAction
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Flex sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
      <Text
        sx={{
          fontSize: 11,
          fontWeight: "bold",
          color: "paragraph-secondary",
          textTransform: "uppercase",
          letterSpacing: "1px"
        }}
      >
        {title}
      </Text>
      {actionLabel && onAction && (
        <Text
          onClick={onAction}
          sx={{
            fontSize: 11,
            color: "accent",
            cursor: "pointer",
            "&:hover": { textDecoration: "underline" }
          }}
        >
          {actionLabel}
        </Text>
      )}
    </Flex>
  );
}

function TodaySchedule() {
  const events = useCalendarStore((s) => s.events);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86400000;
  const tomorrowEnd = todayEnd + 86400000;

  const upcomingEvents = events
    .filter((e) => e.startTime >= todayStart && e.startTime < tomorrowEnd)
    .sort((a, b) => a.startTime - b.startTime);

  if (upcomingEvents.length === 0) {
    return (
      <Text sx={{ fontSize: 12, color: "paragraph-secondary", fontStyle: "italic", py: 2 }}>
        No events scheduled for today or tomorrow.
      </Text>
    );
  }

  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      {upcomingEvents.map((event) => (
        <ScheduleEventRow key={event.id} event={event} />
      ))}
    </Flex>
  );
}

function ScheduleEventRow({ event }: { event: CalendarEvent }) {
  const isPast = event.endTime < Date.now();
  const isNow = event.startTime <= Date.now() && event.endTime > Date.now();

  return (
    <Flex
      onClick={() => navigate("/calendar" as never)}
      sx={{
        alignItems: "center",
        gap: 2,
        py: "6px",
        px: 2,
        borderRadius: 6,
        cursor: "pointer",
        opacity: isPast ? 0.5 : 1,
        bg: isNow ? `${event.color}10` : "transparent",
        borderLeft: isNow ? `3px solid ${event.color}` : "3px solid transparent",
        "&:hover": { bg: "hover" }
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bg: event.color,
          flexShrink: 0
        }}
      />
      <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Text
          sx={{
            fontSize: 12,
            fontWeight: isNow ? "bold" : "normal",
            color: "heading",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {event.title}
        </Text>
        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
          {event.allDay
            ? `${formatRelativeDate(event.startTime)} — All day`
            : `${formatRelativeDate(event.startTime)} ${formatTime(event.startTime)} – ${formatTime(event.endTime)}`}
          {event.attendees.length > 0 && ` · ${event.attendees.join(", ")}`}
        </Text>
      </Flex>
      {isNow && (
        <Text sx={{ fontSize: 9, fontWeight: "bold", color: event.color, flexShrink: 0 }}>
          NOW
        </Text>
      )}
    </Flex>
  );
}

function PriorityTasks() {
  const tasks = useTaskStore((s) => s.tasks);

  const priorityTasks = tasks
    .filter(
      (t) =>
        (t.priority === "critical" || t.priority === "high") &&
        t.status !== "done" &&
        t.status !== "cancelled"
    )
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, 5);

  if (priorityTasks.length === 0) {
    return (
      <Text sx={{ fontSize: 12, color: "paragraph-secondary", fontStyle: "italic", py: 2 }}>
        No high-priority tasks.
      </Text>
    );
  }

  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      {priorityTasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </Flex>
  );
}

function TaskRow({ task }: { task: WorkstationTask }) {
  const isOverdue =
    task.dueDate && task.dueDate < Date.now() && task.status !== "done";

  return (
    <Flex
      onClick={() => navigate("/tasks" as never)}
      sx={{
        alignItems: "center",
        gap: 2,
        py: "6px",
        px: 2,
        borderRadius: 6,
        cursor: "pointer",
        "&:hover": { bg: "hover" }
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: 2,
          bg: PRIORITY_COLORS[task.priority],
          flexShrink: 0
        }}
      />
      <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Text
          sx={{
            fontSize: 12,
            color: "heading",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {task.title}
        </Text>
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Text sx={{ fontSize: 10, color: PRIORITY_COLORS[task.priority], fontWeight: "bold" }}>
            {task.priority.toUpperCase()}
          </Text>
          {task.assignee && (
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
              · {task.assignee.name}
            </Text>
          )}
          {task.dueDate && (
            <Text
              sx={{
                fontSize: 10,
                color: isOverdue ? "#ef4444" : "paragraph-secondary",
                fontWeight: isOverdue ? "bold" : "normal"
              }}
            >
              · {isOverdue ? "OVERDUE" : `Due ${formatRelativeDate(task.dueDate)}`}
            </Text>
          )}
        </Flex>
      </Flex>
      <Text
        sx={{
          fontSize: 10,
          color:
            task.status === "in_progress"
              ? "#3b82f6"
              : task.status === "todo"
              ? "#f59e0b"
              : "paragraph-secondary",
          fontWeight: "bold",
          flexShrink: 0
        }}
      >
        {task.status === "in_progress"
          ? "IN PROGRESS"
          : task.status.toUpperCase().replace("_", " ")}
      </Text>
    </Flex>
  );
}

function AgentStatusList() {
  const agents = useAgentStore((s) => s.agents);

  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      {agents.map((agent) => (
        <AgentRow key={agent.id} agent={agent} />
      ))}
    </Flex>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const latestActivity = agent.activity[0];
  return (
    <Flex
      onClick={() => navigate("/agents" as never)}
      sx={{
        alignItems: "center",
        gap: 2,
        py: "6px",
        px: 2,
        borderRadius: 6,
        cursor: "pointer",
        "&:hover": { bg: "hover" }
      }}
    >
      <Text sx={{ fontSize: 16, flexShrink: 0 }}>{agent.avatar}</Text>
      <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading" }}>
            {agent.name}
          </Text>
          <StatusDot status={agent.status} />
        </Flex>
        {latestActivity && (
          <Text
            sx={{
              fontSize: 10,
              color: "paragraph-secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {latestActivity.message}
          </Text>
        )}
      </Flex>
      {agent.tasksInProgress > 0 && (
        <Text sx={{ fontSize: 10, color: "accent", fontWeight: "bold", flexShrink: 0 }}>
          {agent.tasksInProgress} active
        </Text>
      )}
    </Flex>
  );
}

function CostUsageWidget() {
  const agents = useAgentStore((s) => s.agents);
  const totalTokens = agents.reduce((sum, a) => sum + a.tokenUsage.total, 0);
  const totalCost = agents.reduce((sum, a) => sum + a.costEstimate, 0);

  const sortedAgents = [...agents]
    .filter((a) => a.tokenUsage.total > 0)
    .sort((a, b) => b.tokenUsage.total - a.tokenUsage.total);

  const maxTokens = sortedAgents.length > 0 ? sortedAgents[0].tokenUsage.total : 1;

  return (
    <Flex sx={{ flexDirection: "column", gap: 2 }}>
      <Flex sx={{ gap: 3 }}>
        <Flex sx={{ flexDirection: "column" }}>
          <Text sx={{ fontSize: 16, fontWeight: "bold", color: "heading" }}>
            {totalTokens > 0
              ? totalTokens >= 1_000_000
                ? `${(totalTokens / 1_000_000).toFixed(1)}M`
                : totalTokens >= 1_000
                ? `${(totalTokens / 1_000).toFixed(1)}K`
                : String(totalTokens)
              : "0"}
          </Text>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>Total Tokens</Text>
        </Flex>
        <Flex sx={{ flexDirection: "column" }}>
          <Text sx={{ fontSize: 16, fontWeight: "bold", color: "#22c55e" }}>
            ${totalCost.toFixed(4)}
          </Text>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>Est. Cost</Text>
        </Flex>
      </Flex>

      {sortedAgents.length === 0 ? (
        <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontStyle: "italic" }}>
          No usage data yet
        </Text>
      ) : (
        sortedAgents.map((agent) => (
          <Flex key={agent.id} sx={{ flexDirection: "column", gap: "2px" }}>
            <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Text sx={{ fontSize: 10, color: "heading" }}>
                {agent.avatar} {agent.name}
              </Text>
              <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                {agent.tokenUsage.total >= 1_000
                  ? `${(agent.tokenUsage.total / 1_000).toFixed(1)}K`
                  : agent.tokenUsage.total}{" "}
                (${agent.costEstimate.toFixed(4)})
              </Text>
            </Flex>
            <Box
              sx={{
                height: 6,
                borderRadius: 3,
                bg: "background",
                overflow: "hidden"
              }}
            >
              <Box
                sx={{
                  height: "100%",
                  width: `${(agent.tokenUsage.total / maxTokens) * 100}%`,
                  borderRadius: 3,
                  bg: "accent",
                  transition: "width 0.3s ease"
                }}
              />
            </Box>
          </Flex>
        ))
      )}
    </Flex>
  );
}

function DashboardCard({
  children,
  sx: sxProp
}: {
  children: React.ReactNode;
  sx?: Record<string, unknown>;
}) {
  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        p: "12px",
        gap: 1,
        ...sxProp
      }}
    >
      {children}
    </Flex>
  );
}

// ── Risk & Opportunity Alerts ──

type RiskAlert = {
  id: string;
  type: "risk" | "opportunity";
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  source: string;
  timestamp: number;
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#3b82f6"
};

function generateAlerts(
  tasks: WorkstationTask[],
  messages: CommMessage[],
  events: CalendarEvent[]
): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const now = Date.now();
  const day = 86400000;

  const overdueTasks = tasks.filter(
    (t) => t.dueDate && t.dueDate < now && t.status !== "done" && t.status !== "cancelled"
  );
  if (overdueTasks.length > 0) {
    alerts.push({
      id: "risk-overdue-tasks",
      type: "risk",
      severity: overdueTasks.length >= 3 ? "high" : "medium",
      title: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}`,
      description: overdueTasks.map((t) => t.title).slice(0, 3).join(", "),
      source: "Tasks",
      timestamp: now
    });
  }

  const staleUnread = messages.filter(
    (m) => !m.isRead && m.timestamp < now - day
  );
  if (staleUnread.length > 0) {
    alerts.push({
      id: "risk-stale-unread",
      type: "risk",
      severity: staleUnread.length >= 5 ? "high" : "medium",
      title: `${staleUnread.length} unread message${staleUnread.length > 1 ? "s" : ""} > 24h`,
      description: "Messages need attention before they become stale",
      source: "Communications",
      timestamp: now
    });
  }

  const unassignedCritical = tasks.filter(
    (t) => t.priority === "critical" && !t.assignee && t.status !== "done" && t.status !== "cancelled"
  );
  if (unassignedCritical.length > 0) {
    alerts.push({
      id: "risk-unassigned-critical",
      type: "risk",
      severity: "high",
      title: `${unassignedCritical.length} critical task${unassignedCritical.length > 1 ? "s" : ""} unassigned`,
      description: unassignedCritical.map((t) => t.title).join(", "),
      source: "Tasks",
      timestamp: now
    });
  }

  const readyDrafts = messages.filter((m) => m.agentDraftReply && !m.isRead);
  if (readyDrafts.length > 0) {
    alerts.push({
      id: "opp-drafts-ready",
      type: "opportunity",
      severity: "low",
      title: `${readyDrafts.length} AI draft${readyDrafts.length > 1 ? "s" : ""} ready to send`,
      description: "Review and send AI-generated replies",
      source: "Communications",
      timestamp: now
    });
  }

  const nearCompletion = tasks.filter(
    (t) =>
      t.status === "in_progress" &&
      t.dueDate &&
      t.dueDate > now &&
      t.dueDate < now + day
  );
  if (nearCompletion.length > 0) {
    alerts.push({
      id: "opp-near-completion",
      type: "opportunity",
      severity: "low",
      title: `${nearCompletion.length} task${nearCompletion.length > 1 ? "s" : ""} due soon`,
      description: "In-progress tasks that can be completed today",
      source: "Tasks",
      timestamp: now
    });
  }

  const upcomingMeetings = events.filter(
    (e) => e.type === "meeting" && e.startTime > now && e.startTime < now + 2 * 3600000
  );
  if (upcomingMeetings.length > 0) {
    alerts.push({
      id: "opp-upcoming-meetings",
      type: "opportunity",
      severity: "low",
      title: `${upcomingMeetings.length} meeting${upcomingMeetings.length > 1 ? "s" : ""} in the next 2 hours`,
      description: upcomingMeetings.map((e) => e.title).join(", "),
      source: "Calendar",
      timestamp: now
    });
  }

  return alerts.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    if (a.type !== b.type) return a.type === "risk" ? -1 : 1;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

function RiskAlertsWidget() {
  const tasks = useTaskStore((s) => s.tasks);
  const messages = useCommsStore((s) => s.messages);
  const events = useCalendarStore((s) => s.events);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const alerts = useMemo(
    () => generateAlerts(tasks, messages, events),
    [tasks, messages, events]
  );

  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.id));

  if (visibleAlerts.length === 0) {
    return (
      <Text sx={{ fontSize: 12, color: "paragraph-secondary", fontStyle: "italic", py: 2 }}>
        No alerts — everything looks good.
      </Text>
    );
  }

  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      {visibleAlerts.map((alert) => (
        <Flex
          key={alert.id}
          sx={{
            alignItems: "flex-start",
            gap: 2,
            py: "6px",
            px: 2,
            borderRadius: 6,
            borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity]}`,
            bg: `${SEVERITY_COLORS[alert.severity]}08`,
            "&:hover": { bg: `${SEVERITY_COLORS[alert.severity]}15` }
          }}
        >
          <Text
            sx={{
              fontSize: 12,
              flexShrink: 0,
              mt: "1px"
            }}
          >
            {alert.type === "risk" ? "!" : "+"}
          </Text>
          <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
            <Flex sx={{ alignItems: "center", gap: 1 }}>
              <Text
                sx={{
                  fontSize: 12,
                  fontWeight: "bold",
                  color: alert.type === "risk" ? SEVERITY_COLORS[alert.severity] : "#22c55e"
                }}
              >
                {alert.title}
              </Text>
              <Text
                sx={{
                  fontSize: 9,
                  px: "4px",
                  py: "1px",
                  borderRadius: 4,
                  bg: alert.type === "risk" ? `${SEVERITY_COLORS[alert.severity]}20` : "#22c55e20",
                  color: alert.type === "risk" ? SEVERITY_COLORS[alert.severity] : "#22c55e",
                  fontWeight: "bold",
                  textTransform: "uppercase"
                }}
              >
                {alert.type}
              </Text>
            </Flex>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {alert.description}
            </Text>
          </Flex>
          <Flex sx={{ alignItems: "center", gap: 1, flexShrink: 0 }}>
            <Text sx={{ fontSize: 9, color: "paragraph-secondary" }}>
              {alert.source}
            </Text>
            <Text
              onClick={() => setDismissed((prev) => new Set([...prev, alert.id]))}
              sx={{
                fontSize: 10,
                color: "paragraph-secondary",
                cursor: "pointer",
                px: 1,
                borderRadius: 4,
                "&:hover": { bg: "hover", color: "heading" }
              }}
            >
              x
            </Text>
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
}

// ── Main Dashboard ──

function DashboardView() {
  const agents = useAgentStore((s) => s.agents);
  const activeAgents = agents.filter((a) => a.status === "running").length;

  return (
    <Flex
      sx={{
        flex: 1,
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
        p: 3,
        gap: 3
      }}
    >
      {/* Header */}
      <Flex sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <Text variant="heading" sx={{ fontSize: 22 }}>
          {getGreeting()}
        </Text>
        <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
          {agents.length} agents · {activeAgents} active ·{" "}
          {new Date().toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric"
          })}
        </Text>
      </Flex>

      {/* Row 1: Alerts | Schedule | Agents */}
      <Flex sx={{ gap: 3, flex: 1, minHeight: 0 }}>
        <DashboardCard sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <SectionHeader title="Alerts & Opportunities" />
          <RiskAlertsWidget />
        </DashboardCard>

        <DashboardCard sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <SectionHeader
            title="Today's Schedule"
            actionLabel="Calendar"
            onAction={() => navigate("/calendar" as never)}
          />
          <TodaySchedule />
        </DashboardCard>

        <DashboardCard sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <SectionHeader
            title="Agent Status"
            actionLabel="Manage"
            onAction={() => navigate("/agents" as never)}
          />
          <AgentStatusList />
        </DashboardCard>
      </Flex>

      {/* Row 2: Tasks | Cost & Usage */}
      <Flex sx={{ gap: 3 }}>
        <DashboardCard sx={{ flex: 2, minWidth: 0, maxHeight: 280, overflow: "auto" }}>
          <SectionHeader
            title="Priority Tasks"
            actionLabel="View All"
            onAction={() => navigate("/tasks" as never)}
          />
          <PriorityTasks />
        </DashboardCard>

        <DashboardCard sx={{ flex: 1, minWidth: 0, maxHeight: 280, overflow: "auto" }}>
          <SectionHeader title="Cost & Usage" />
          <CostUsageWidget />
        </DashboardCard>
      </Flex>
    </Flex>
  );
}

export default DashboardView;
