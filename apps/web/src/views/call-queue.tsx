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

import { useEffect } from "react";
import { Box, Button, Flex, Text } from "@theme-ui/components";
import {
  useStore as useCallQueueStore,
  QueuedCall,
  CallStatus,
  CallPriority
} from "../stores/call-queue-store";
import { useStore as useAgentStore } from "../stores/agent-store";

const STATUS_CONFIG: Record<CallStatus, { label: string; color: string }> = {
  waiting: { label: "Waiting", color: "#f59e0b" },
  active: { label: "Active", color: "#22c55e" },
  completed: { label: "Done", color: "#6b7280" },
  missed: { label: "Missed", color: "#ef4444" }
};

const PRIORITY_CONFIG: Record<CallPriority, { label: string; color: string }> =
  {
    high: { label: "HIGH", color: "#ef4444" },
    medium: { label: "MED", color: "#f59e0b" },
    low: { label: "LOW", color: "#6b7280" }
  };

function formatWaitTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}m ${sec}s`;
}

function StatCard({
  label,
  value,
  color
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <Flex
      sx={{
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        px: 3,
        py: 2,
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        flex: 1,
        minWidth: 100
      }}
    >
      <Text
        sx={{
          fontSize: 22,
          fontWeight: "bold",
          color: color || "heading"
        }}
      >
        {value}
      </Text>
      <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>{label}</Text>
    </Flex>
  );
}

function CallRow({
  call,
  onPickUp,
  onTransfer,
  onComplete,
  onMiss
}: {
  call: QueuedCall;
  onPickUp: () => void;
  onTransfer: () => void;
  onComplete: () => void;
  onMiss: () => void;
}) {
  const statusConfig = STATUS_CONFIG[call.status];
  const priorityConfig = PRIORITY_CONFIG[call.priority];
  const isActionable =
    call.status === "waiting" || call.status === "active";

  return (
    <Flex
      sx={{
        alignItems: "center",
        gap: 2,
        px: 3,
        py: 2,
        borderBottom: "1px solid var(--border)",
        "&:hover": { bg: "hover" },
        opacity: isActionable ? 1 : 0.6
      }}
    >
      {/* Priority */}
      <Text
        sx={{
          fontSize: 9,
          fontWeight: "bold",
          px: "5px",
          py: "1px",
          borderRadius: 4,
          bg: `${priorityConfig.color}15`,
          color: priorityConfig.color,
          flexShrink: 0,
          width: 36,
          textAlign: "center"
        }}
      >
        {priorityConfig.label}
      </Text>

      {/* Status */}
      <Flex sx={{ flexShrink: 0, width: 70, alignItems: "center", gap: 1 }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bg: statusConfig.color,
            flexShrink: 0,
            animation:
              call.status === "waiting"
                ? "pulse 2s ease-in-out infinite"
                : undefined
          }}
        />
        <Text
          sx={{ fontSize: 11, fontWeight: "bold", color: statusConfig.color }}
        >
          {statusConfig.label}
        </Text>
      </Flex>

      {/* Caller Info */}
      <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Text
          sx={{
            fontSize: 13,
            fontWeight: "bold",
            color: "heading",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {call.callerName}
        </Text>
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
            {call.callerPhone}
          </Text>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
            &middot;
          </Text>
          <Text
            sx={{
              fontSize: 11,
              color: "paragraph-secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {call.reason}
          </Text>
        </Flex>
      </Flex>

      {/* Wait Time */}
      <Text
        sx={{
          fontSize: 13,
          fontWeight: "bold",
          fontFamily: "monospace",
          color:
            call.waitTime > 180
              ? "#ef4444"
              : call.waitTime > 60
              ? "#f59e0b"
              : "paragraph",
          flexShrink: 0,
          width: 65,
          textAlign: "right"
        }}
      >
        {isActionable ? formatWaitTime(call.waitTime) : "--"}
      </Text>

      {/* Agent */}
      <Text
        sx={{
          fontSize: 11,
          color: call.assignedAgent ? "#22c55e" : "paragraph-secondary",
          flexShrink: 0,
          width: 80,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {call.assignedAgent
          ? call.assignedAgent.replace("agent-", "")
          : "Unassigned"}
      </Text>

      {/* Actions */}
      <Flex sx={{ gap: 1, flexShrink: 0 }}>
        {call.status === "waiting" && (
          <Button
            variant="accent"
            sx={{ fontSize: 10, px: "8px", py: "3px" }}
            onClick={onPickUp}
          >
            Pick Up
          </Button>
        )}
        {call.status === "active" && (
          <>
            <Button
              variant="secondary"
              sx={{ fontSize: 10, px: "8px", py: "3px" }}
              onClick={onTransfer}
            >
              Transfer
            </Button>
            <Button
              variant="accent"
              sx={{ fontSize: 10, px: "8px", py: "3px" }}
              onClick={onComplete}
            >
              Complete
            </Button>
          </>
        )}
        {call.status === "waiting" && (
          <Button
            variant="secondary"
            sx={{ fontSize: 10, px: "8px", py: "3px", color: "#ef4444" }}
            onClick={onMiss}
          >
            Dismiss
          </Button>
        )}
      </Flex>
    </Flex>
  );
}

function CallQueueView() {
  const calls = useCallQueueStore((s) => s.calls);
  const pickUpCall = useCallQueueStore((s) => s.pickUpCall);
  const transferCall = useCallQueueStore((s) => s.transferCall);
  const completeCall = useCallQueueStore((s) => s.completeCall);
  const missCall = useCallQueueStore((s) => s.missCall);
  const tickWaitTimes = useCallQueueStore((s) => s.tickWaitTimes);
  const addToQueue = useCallQueueStore((s) => s.addToQueue);
  const agents = useAgentStore((s) => s.agents);

  // Live tick every second
  useEffect(() => {
    const interval = setInterval(tickWaitTimes, 1000);
    return () => clearInterval(interval);
  }, [tickWaitTimes]);

  const stats = useCallQueueStore.getState().getQueueStats();

  const waiting = calls.filter((c) => c.status === "waiting");
  const active = calls.filter((c) => c.status === "active");
  const recent = calls.filter(
    (c) => c.status === "completed" || c.status === "missed"
  );

  const handleTransfer = (callId: string) => {
    const commsAgent = agents.find((a) => a.id === "agent-comms");
    if (commsAgent) {
      transferCall(callId, commsAgent.id);
    }
  };

  const handleAddDemo = () => {
    const names = [
      "Maria Santos",
      "Alex Chen",
      "Sarah Johnson",
      "Tom Wilson",
      "Priya Patel"
    ];
    const reasons = [
      "Product inquiry",
      "Support request",
      "Scheduling question",
      "Follow-up call",
      "Partnership discussion"
    ];
    const priorities: CallPriority[] = ["high", "medium", "low"];
    addToQueue({
      callerName: names[Math.floor(Math.random() * names.length)],
      callerPhone: `+1-555-0${Math.floor(Math.random() * 900 + 100)}`,
      reason: reasons[Math.floor(Math.random() * reasons.length)],
      priority: priorities[Math.floor(Math.random() * priorities.length)],
      assignedAgent: null
    });
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
      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Flex sx={{ flexDirection: "column" }}>
          <Text variant="heading" sx={{ fontSize: 22 }}>
            Call Queue
          </Text>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
            {stats.callsWaiting} waiting &middot; {stats.active} active &middot;{" "}
            {stats.missedToday} missed today
          </Text>
        </Flex>
        <Button
          variant="accent"
          sx={{ fontSize: 12, px: 2, py: 1 }}
          onClick={handleAddDemo}
        >
          + Simulate Call
        </Button>
      </Flex>

      {/* Stats Bar */}
      <Flex sx={{ gap: 2 }}>
        <StatCard
          label="Calls Waiting"
          value={stats.callsWaiting}
          color={stats.callsWaiting > 3 ? "#ef4444" : "#f59e0b"}
        />
        <StatCard
          label="Avg Wait"
          value={formatWaitTime(stats.avgWaitTime)}
          color={stats.avgWaitTime > 120 ? "#ef4444" : undefined}
        />
        <StatCard
          label="Longest Wait"
          value={formatWaitTime(stats.longestWait)}
          color={stats.longestWait > 180 ? "#ef4444" : undefined}
        />
        <StatCard label="Active Calls" value={stats.active} color="#22c55e" />
        <StatCard
          label="Missed Today"
          value={stats.missedToday}
          color={stats.missedToday > 0 ? "#ef4444" : undefined}
        />
      </Flex>

      {/* Queue Table */}
      <Flex
        sx={{
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          bg: "background-secondary",
          borderRadius: 8,
          border: "1px solid var(--border)"
        }}
      >
        {/* Table Header */}
        <Flex
          sx={{
            alignItems: "center",
            gap: 2,
            px: 3,
            py: 2,
            borderBottom: "1px solid var(--border)",
            bg: "background"
          }}
        >
          <Text
            sx={{
              fontSize: 10,
              fontWeight: "bold",
              color: "paragraph-secondary",
              width: 36,
              textAlign: "center"
            }}
          >
            PRI
          </Text>
          <Text
            sx={{
              fontSize: 10,
              fontWeight: "bold",
              color: "paragraph-secondary",
              width: 70
            }}
          >
            STATUS
          </Text>
          <Text
            sx={{
              fontSize: 10,
              fontWeight: "bold",
              color: "paragraph-secondary",
              flex: 1
            }}
          >
            CALLER
          </Text>
          <Text
            sx={{
              fontSize: 10,
              fontWeight: "bold",
              color: "paragraph-secondary",
              width: 65,
              textAlign: "right"
            }}
          >
            WAIT
          </Text>
          <Text
            sx={{
              fontSize: 10,
              fontWeight: "bold",
              color: "paragraph-secondary",
              width: 80,
              textAlign: "center"
            }}
          >
            AGENT
          </Text>
          <Text
            sx={{
              fontSize: 10,
              fontWeight: "bold",
              color: "paragraph-secondary",
              width: 130,
              textAlign: "right"
            }}
          >
            ACTIONS
          </Text>
        </Flex>

        {/* Table Body */}
        <Flex sx={{ flexDirection: "column", flex: 1, overflow: "auto" }}>
          {/* Waiting calls first, then active, then recent */}
          {waiting.length === 0 && active.length === 0 && recent.length === 0 ? (
            <Flex
              sx={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Text sx={{ color: "paragraph-secondary", fontSize: 14 }}>
                No calls in queue
              </Text>
            </Flex>
          ) : (
            <>
              {waiting
                .sort(
                  (a, b) =>
                    (a.priority === "high" ? 0 : a.priority === "medium" ? 1 : 2) -
                    (b.priority === "high" ? 0 : b.priority === "medium" ? 1 : 2)
                )
                .map((call) => (
                  <CallRow
                    key={call.id}
                    call={call}
                    onPickUp={() => pickUpCall(call.id)}
                    onTransfer={() => handleTransfer(call.id)}
                    onComplete={() => completeCall(call.id)}
                    onMiss={() => missCall(call.id)}
                  />
                ))}
              {active.map((call) => (
                <CallRow
                  key={call.id}
                  call={call}
                  onPickUp={() => pickUpCall(call.id)}
                  onTransfer={() => handleTransfer(call.id)}
                  onComplete={() => completeCall(call.id)}
                  onMiss={() => missCall(call.id)}
                />
              ))}
              {recent.length > 0 && (
                <>
                  <Flex
                    sx={{
                      px: 3,
                      py: 1,
                      bg: "background",
                      borderBottom: "1px solid var(--border)"
                    }}
                  >
                    <Text
                      sx={{
                        fontSize: 10,
                        fontWeight: "bold",
                        color: "paragraph-secondary",
                        textTransform: "uppercase",
                        letterSpacing: "1px"
                      }}
                    >
                      Recent
                    </Text>
                  </Flex>
                  {recent.slice(0, 10).map((call) => (
                    <CallRow
                      key={call.id}
                      call={call}
                      onPickUp={() => pickUpCall(call.id)}
                      onTransfer={() => handleTransfer(call.id)}
                      onComplete={() => completeCall(call.id)}
                      onMiss={() => missCall(call.id)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}

export default CallQueueView;
