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

import { useState, useMemo, useEffect } from "react";
import { Box, Button, Flex, Text } from "@theme-ui/components";
import { useStore as useAgentStore, Agent, AgentStatus } from "../stores/agent-store";
import { useStore as useTaskStore, WorkstationTask } from "../stores/task-store";
import { useStore as useCommsStore, CommMessage } from "../stores/comms-store";
import { useStore as useCalendarStore, CalendarEvent } from "../stores/calendar-store";
import { useStore as useSpreadsheetStore } from "../stores/spreadsheet-store";
import { useStore as useOpenClawStore } from "../stores/openclaw-store";
import { navigate } from "../navigation";
import { AppEventManager, AppEvents } from "../common/app-events";

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

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

const EVENT_TYPE_ICONS: Record<string, string> = {
  meeting: "M",
  deadline: "!",
  reminder: "R",
  block: "B"
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

function StatCard({
  label,
  value,
  color,
  onClick
}: {
  label: string;
  value: number | string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <Flex
      onClick={onClick}
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        p: "12px",
        flex: "1 1 0",
        minWidth: 100,
        cursor: onClick ? "pointer" : "default",
        border: "1px solid var(--border)",
        transition: "all 0.15s ease",
        "&:hover": onClick
          ? { borderColor: "var(--accent)", bg: "hover", transform: "translateY(-1px)" }
          : {}
      }}
    >
      <Text sx={{ fontSize: 22, fontWeight: "bold", color: color || "heading", lineHeight: 1 }}>
        {value}
      </Text>
      <Text sx={{ fontSize: 11, color: "paragraph-secondary", mt: 1 }}>
        {label}
      </Text>
    </Flex>
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

function QuickActions() {
  const quickActions = [
    { label: "New Task", icon: "+", route: "/tasks", event: AppEvents.createNewTask },
    { label: "Compose", icon: "@", route: "/communications", event: AppEvents.composeMessage },
    { label: "New Event", icon: "#", route: "/calendar", event: AppEvents.createNewEvent },
    { label: "New Sheet", icon: "$", route: "/spreadsheets", event: AppEvents.createNewSheet }
  ];

  return (
    <Flex sx={{ gap: 2, flexWrap: "wrap" }}>
      {quickActions.map((action) => (
        <Button
          key={action.label}
          variant="secondary"
          onClick={() => {
            navigate(action.route as never);
            // Delay event so the target view has time to mount and subscribe
            setTimeout(() => AppEventManager.publish(action.event), 300);
          }}
          sx={{
            fontSize: 12,
            px: 3,
            py: "6px",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            gap: 1,
            border: "1px solid var(--border)",
            bg: "background-secondary",
            color: "heading",
            cursor: "pointer",
            "&:hover": { borderColor: "var(--accent)", bg: "hover" }
          }}
        >
          <Text sx={{ fontWeight: "bold", color: "accent" }}>{action.icon}</Text>
          {action.label}
        </Button>
      ))}
    </Flex>
  );
}

function TodaySchedule() {
  const events = useCalendarStore((s) => s.events);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86400000;
  const tomorrowEnd = todayEnd + 86400000;

  // Get today's and tomorrow's events, sorted by time
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

function RecentSpreadsheets() {
  const sheets = useSpreadsheetStore((s) => s.spreadsheets);

  const recent = [...sheets]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  if (recent.length === 0) {
    return (
      <Text sx={{ fontSize: 12, color: "paragraph-secondary", fontStyle: "italic", py: 2 }}>
        No spreadsheets yet.
      </Text>
    );
  }

  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      {recent.map((sheet) => (
        <Flex
          key={sheet.id}
          onClick={() => navigate("/spreadsheets" as never)}
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
          <Text sx={{ fontSize: 14, color: "#22c55e", fontWeight: "bold", flexShrink: 0 }}>
            #
          </Text>
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
              {sheet.name}
            </Text>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
              {sheet.rows.length} rows · {sheet.columns.length} cols · Updated{" "}
              {formatTimeAgo(sheet.updatedAt)}
            </Text>
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
}

type ActivityType = "all" | "info" | "action" | "error" | "result";

const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  info: "#94a3b8",
  action: "#3b82f6",
  error: "#ef4444",
  result: "#22c55e"
};

function ActivityFeed() {
  const agents = useAgentStore((s) => s.agents);
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterType, setFilterType] = useState<ActivityType>("all");

  const allActivity = agents
    .flatMap((agent) =>
      agent.activity.map((entry) => ({
        ...entry,
        agentId: agent.id,
        agentName: agent.name,
        agentAvatar: agent.avatar
      }))
    )
    .sort((a, b) => b.timestamp - a.timestamp);

  const filteredActivity = allActivity
    .filter((entry) => filterAgent === "all" || entry.agentId === filterAgent)
    .filter((entry) => filterType === "all" || entry.type === filterType)
    .slice(0, 15);

  const typeCounts = allActivity.reduce(
    (acc, entry) => {
      acc[entry.type] = (acc[entry.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      {/* Agent filter pills */}
      <Flex sx={{ gap: 1, flexWrap: "wrap", mb: 1 }}>
        <FilterPill
          label="All"
          isActive={filterAgent === "all"}
          onClick={() => setFilterAgent("all")}
        />
        {agents.map((agent) => (
          <FilterPill
            key={agent.id}
            label={`${agent.avatar} ${agent.name}`}
            isActive={filterAgent === agent.id}
            onClick={() => setFilterAgent(filterAgent === agent.id ? "all" : agent.id)}
          />
        ))}
      </Flex>

      {/* Type filter pills */}
      <Flex sx={{ gap: 1, mb: 1 }}>
        <FilterPill
          label={`All (${allActivity.length})`}
          isActive={filterType === "all"}
          onClick={() => setFilterType("all")}
        />
        {(["info", "action", "error", "result"] as const).map((type) => (
          <FilterPill
            key={type}
            label={`${type} (${typeCounts[type] || 0})`}
            isActive={filterType === type}
            onClick={() => setFilterType(filterType === type ? "all" : type)}
            color={ACTIVITY_TYPE_COLORS[type]}
          />
        ))}
      </Flex>

      {filteredActivity.length === 0 ? (
        <Text sx={{ fontSize: 12, color: "paragraph-secondary", fontStyle: "italic", py: 2 }}>
          No matching activity.
        </Text>
      ) : (
        filteredActivity.map((entry) => (
          <Flex
            key={entry.id}
            sx={{
              alignItems: "flex-start",
              gap: 2,
              py: "4px",
              px: 2,
              borderRadius: 4,
              "&:hover": { bg: "hover" }
            }}
          >
            <Text sx={{ fontSize: 12, flexShrink: 0 }}>{entry.agentAvatar}</Text>
            <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
              <Flex sx={{ alignItems: "center", gap: 1 }}>
                <Text sx={{ fontSize: 11, fontWeight: "bold", color: "heading" }}>
                  {entry.agentName}
                </Text>
                <Text sx={{ fontSize: 9, color: "paragraph-secondary" }}>
                  {formatTimeAgo(entry.timestamp)}
                </Text>
              </Flex>
              <Text
                sx={{
                  fontSize: 11,
                  color:
                    entry.type === "error"
                      ? "error"
                      : entry.type === "action"
                      ? "accent"
                      : entry.type === "result"
                      ? "#22c55e"
                      : "paragraph",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {entry.message}
              </Text>
            </Flex>
          </Flex>
        ))
      )}
    </Flex>
  );
}

function FilterPill({
  label,
  isActive,
  onClick,
  color
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <Text
      onClick={onClick}
      sx={{
        fontSize: 10,
        px: "6px",
        py: "2px",
        borderRadius: 10,
        cursor: "pointer",
        fontWeight: isActive ? "bold" : "normal",
        bg: isActive ? (color ? `${color}20` : "accent") : "background",
        color: isActive ? (color || "white") : "paragraph-secondary",
        border: isActive
          ? `1px solid ${color || "var(--accent)"}`
          : "1px solid var(--border)",
        "&:hover": { borderColor: color || "var(--accent)" }
      }}
    >
      {label}
    </Text>
  );
}

function VitalPill({
  label,
  value,
  color
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Flex
      sx={{
        alignItems: "center",
        gap: "6px",
        bg: `${color}10`,
        border: `1px solid ${color}30`,
        borderRadius: 20,
        px: "10px",
        py: "4px"
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bg: color,
          boxShadow: `0 0 6px ${color}`
        }}
      />
      <Text sx={{ fontSize: 11, color, fontWeight: "bold" }}>{value}</Text>
      <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{label}</Text>
    </Flex>
  );
}

function SystemVitalsWidget() {
  const agents = useAgentStore((s) => s.agents);
  const connectionState = useOpenClawStore((s) => s.connectionState);
  const sessions = useOpenClawStore((s) => s.sessions);
  const lastConnectedAt = useOpenClawStore((s) => s.lastConnectedAt);

  const onlineCount = agents.filter(
    (a) => a.status === "running" || a.status === "idle"
  ).length;
  const activeSessions = sessions.filter((s) => s.status === "active").length;

  const uptimeStr = lastConnectedAt
    ? formatTimeAgo(lastConnectedAt).replace(" ago", "")
    : "N/A";

  const gatewayColor =
    connectionState === "connected"
      ? "#22c55e"
      : connectionState === "error"
      ? "#ef4444"
      : "#6b7280";
  const gatewayLabel =
    connectionState === "connected"
      ? "Connected"
      : connectionState === "error"
      ? "Error"
      : "Offline";

  return (
    <Flex sx={{ gap: 2, flexWrap: "wrap" }}>
      <VitalPill
        label="Agents Online"
        value={`${onlineCount}/${agents.length}`}
        color={onlineCount > 0 ? "#22c55e" : "#6b7280"}
      />
      <VitalPill label="Gateway" value={gatewayLabel} color={gatewayColor} />
      <VitalPill
        label="Active Sessions"
        value={String(activeSessions)}
        color={activeSessions > 0 ? "#3b82f6" : "#6b7280"}
      />
      <VitalPill label="Uptime" value={uptimeStr} color="#8b5cf6" />
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
      {/* Summary */}
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

      {/* Per-agent bars */}
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

function OpenClawStatusBanner() {
  const connectionState = useOpenClawStore((s) => s.connectionState);
  const sessions = useOpenClawStore((s) => s.sessions);
  const connectionError = useOpenClawStore((s) => s.connectionError);

  const isConnected = connectionState === "connected";
  const activeSessions = sessions.filter((s) => s.status === "active").length;

  return (
    <Flex
      onClick={() => navigate("/agents" as never)}
      sx={{
        alignItems: "center",
        gap: 2,
        bg: isConnected ? "#22c55e10" : "background-secondary",
        borderRadius: 8,
        p: 2,
        px: 3,
        border: isConnected
          ? "1px solid #22c55e40"
          : "1px solid var(--border)",
        cursor: "pointer",
        "&:hover": { borderColor: isConnected ? "#22c55e" : "var(--accent)" }
      }}
    >
      <svg width="18" height="18" viewBox="-15 -5 230 224" style={{ flexShrink: 0 }}>
        <polygon
          points="0,0.9 0,35.9 12.8,54.1 81.4,83.2 99.7,107.9 118.3,83.4 186.5,54.7 200,36.1 200,0 186.1,24.2 100.8,49.6 13.9,24.2"
          fill={isConnected ? "#22c55e" : "#6b7280"}
        />
        <polygon
          points="31.7,65.9 31.7,112.4 58.3,129.7 58.3,159.9 85.5,214 85.7,111.5 43.6,86.6 41.2,73.1"
          fill={isConnected ? "#22c55e" : "#6b7280"}
        />
        <polygon
          points="168.5,66.2 158.8,73.4 156.1,86.8 114.5,111.3 114.5,214 141.7,160.2 141.7,129.7 168.5,112.4"
          fill={isConnected ? "#22c55e" : "#6b7280"}
        />
      </svg>
      <Flex sx={{ flexDirection: "column", flex: 1 }}>
        <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading" }}>
          OpenClaw Gateway
        </Text>
        <Text sx={{ fontSize: 10, color: isConnected ? "#22c55e" : "paragraph-secondary" }}>
          {isConnected
            ? `Connected${activeSessions > 0 ? ` — ${activeSessions} active session${activeSessions > 1 ? "s" : ""}` : ""}`
            : connectionState === "error"
              ? `Error: ${connectionError || "Connection failed"}`
              : "Not connected — click to configure"}
        </Text>
      </Flex>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          bg: isConnected ? "#22c55e" : connectionState === "error" ? "#ef4444" : "#6b7280",
          boxShadow: isConnected ? "0 0 8px #22c55e" : "none",
          flexShrink: 0
        }}
      />
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

  // Risk: overdue tasks
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

  // Risk: unread messages older than 24h
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

  // Risk: critical tasks with no assignee
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

  // Opportunity: messages with AI draft replies ready
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

  // Opportunity: tasks completing soon (due within 24h, in progress)
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

  // Opportunity: upcoming meetings (next 2 hours)
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

// ── Developer Dashboard Cards ──

function GitStatusCard() {
  const [info, setInfo] = useState<{ branch?: string; changes: number } | null>(null);

  useEffect(() => {
    if (typeof IS_TAURI === "undefined" || !IS_TAURI) return;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const home = await invoke<string>("fs_get_home_dir");
      try {
        const repoInfo = await invoke<{ is_repo: boolean; branch: string | null }>("git_repo_info", { path: home });
        if (repoInfo.is_repo) {
          const status = await invoke<{ path: string }[]>("git_status", { path: home });
          setInfo({ branch: repoInfo.branch || undefined, changes: status.length });
        }
      } catch { /* not a repo */ }
    })().catch(console.error);
  }, []);

  if (!info) {
    return (
      <Text sx={{ fontSize: 12, color: "paragraph-secondary", fontStyle: "italic" }}>
        {typeof IS_TAURI !== "undefined" && IS_TAURI ? "Detecting repository..." : "Requires Tauri desktop"}
      </Text>
    );
  }

  return (
    <Flex sx={{ flexDirection: "column", gap: 2 }}>
      <Flex sx={{ alignItems: "center", gap: 2 }}>
        <Text sx={{ fontSize: 12, color: "#60a5fa", bg: "#60a5fa22", px: "6px", py: "2px", borderRadius: 8 }}>{info.branch}</Text>
      </Flex>
      <Text sx={{ fontSize: 12, color: info.changes > 0 ? "#eab308" : "#22c55e" }}>
        {info.changes > 0 ? `${info.changes} uncommitted change${info.changes > 1 ? "s" : ""}` : "Working tree clean"}
      </Text>
    </Flex>
  );
}

function WorkspacesCard() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (typeof IS_TAURI === "undefined" || !IS_TAURI) return;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const home = await invoke<string>("fs_get_home_dir");
      try {
        const list = await invoke<{ name: string }[]>("workspace_list", { repoPath: home });
        setCount(list.length);
      } catch { /* not a repo */ }
    })().catch(console.error);
  }, []);

  return (
    <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
      {count > 0 ? `${count} active worktree${count > 1 ? "s" : ""}` : "No active worktrees"}
    </Text>
  );
}

function ConversationsCard() {
  const [sessions, setSessions] = useState<{ tool: string; title: string | null; messages: number }[]>([]);

  useEffect(() => {
    if (typeof IS_TAURI === "undefined" || !IS_TAURI) return;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ tool: string; title: string | null; messages: number }[]>("conversations_scan", { toolFilter: null, limit: 5 });
      setSessions(result);
    })().catch(console.error);
  }, []);

  const toolColors: Record<string, string> = { "claude-code": "#f97316", cursor: "#60a5fa", gemini: "#22c55e", copilot: "#a78bfa" };

  if (sessions.length === 0) {
    return <Text sx={{ fontSize: 12, color: "paragraph-secondary", fontStyle: "italic" }}>No recent conversations</Text>;
  }

  return (
    <Flex sx={{ flexDirection: "column", gap: 1 }}>
      {sessions.slice(0, 3).map((s, i) => (
        <Flex key={i} sx={{ alignItems: "center", gap: 2, fontSize: 11 }}>
          <Text sx={{ color: toolColors[s.tool] || "paragraph-secondary", fontWeight: "bold", width: 50, flexShrink: 0 }}>{s.tool.split("-").pop()}</Text>
          <Text sx={{ color: "heading", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || "Untitled"}</Text>
          <Text sx={{ color: "paragraph-secondary", flexShrink: 0 }}>{s.messages}m</Text>
        </Flex>
      ))}
    </Flex>
  );
}

function TerminalMiniCard() {
  return (
    <Box sx={{ bg: "background", borderRadius: 4, p: 2, fontFamily: "'Cascadia Code', monospace" }}>
      <Text sx={{ fontSize: 11, color: "#22c55e", display: "block" }}>$ workstation ready</Text>
      <Text sx={{ fontSize: 11, color: "paragraph-secondary", display: "block" }}>Terminal available — click Open to launch</Text>
    </Box>
  );
}

declare const IS_TAURI: boolean | undefined;

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
