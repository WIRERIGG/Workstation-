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

import { useState } from "react";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import {
  useStore as useAgentStore,
  Agent,
  AgentStatus,
  AgentActivityEntry
} from "../stores/agent-store";
import { useStore as useOpenClawStore } from "../stores/openclaw-store";

const STATUS_COLORS: Record<AgentStatus, string> = {
  running: "#22c55e",
  idle: "#94a3b8",
  error: "#ef4444",
  offline: "#6b7280"
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  running: "Running",
  idle: "Idle",
  error: "Error",
  offline: "Offline"
};

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <Flex
      sx={{
        alignItems: "center",
        gap: 1,
        px: 2,
        py: "2px",
        borderRadius: 12,
        bg: `${STATUS_COLORS[status]}15`,
        border: `1px solid ${STATUS_COLORS[status]}40`
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bg: STATUS_COLORS[status],
          boxShadow:
            status === "running" ? `0 0 6px ${STATUS_COLORS[status]}` : "none"
        }}
      />
      <Text
        sx={{
          fontSize: 11,
          fontWeight: "bold",
          color: STATUS_COLORS[status]
        }}
      >
        {STATUS_LABELS[status]}
      </Text>
    </Flex>
  );
}

function ActivityEntry({ entry }: { entry: AgentActivityEntry }) {
  const typeColors: Record<string, string> = {
    info: "paragraph-secondary",
    action: "accent",
    error: "error",
    result: "#22c55e"
  };

  return (
    <Flex sx={{ alignItems: "flex-start", gap: 2, py: 1 }}>
      <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
        <Text sx={{ fontSize: 12, color: typeColors[entry.type] }}>
          {entry.message}
        </Text>
        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
          {new Date(entry.timestamp).toLocaleTimeString()}
        </Text>
      </Flex>
    </Flex>
  );
}

function AgentCard({
  agent,
  isSelected,
  onSelect
}: {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const startAgent = useAgentStore((s) => s.startAgent);
  const stopAgent = useAgentStore((s) => s.stopAgent);

  return (
    <Flex
      onClick={onSelect}
      sx={{
        flexDirection: "column",
        bg: isSelected ? "hover" : "background-secondary",
        borderRadius: 8,
        p: 3,
        border: isSelected
          ? "2px solid var(--accent)"
          : "1px solid var(--border)",
        cursor: "pointer",
        gap: 2,
        "&:hover": { bg: "hover" }
      }}
    >
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <Text sx={{ fontSize: 24 }}>{agent.avatar}</Text>
          <Flex sx={{ flexDirection: "column" }}>
            <Text
              sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}
            >
              {agent.name}
            </Text>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {agent.model}
            </Text>
          </Flex>
        </Flex>
        <StatusBadge status={agent.status} />
      </Flex>

      <Text sx={{ fontSize: 12, color: "paragraph", lineHeight: 1.5 }}>
        {agent.description}
      </Text>

      <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
        {agent.capabilities.map((cap) => (
          <Text
            key={cap}
            sx={{
              fontSize: 10,
              px: "6px",
              py: "2px",
              borderRadius: 4,
              bg: "background",
              color: "paragraph-secondary",
              border: "1px solid var(--border)"
            }}
          >
            {cap}
          </Text>
        ))}
      </Flex>

      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          mt: 1
        }}
      >
        <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
          {agent.tasksCompleted} completed &middot; {agent.tasksInProgress}{" "}
          active
        </Text>
        <Flex sx={{ gap: 1 }}>
          {agent.status === "idle" || agent.status === "offline" ? (
            <Button
              variant="accent"
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                startAgent(agent.id);
              }}
            >
              Start
            </Button>
          ) : agent.status === "running" ? (
            <Button
              variant="secondary"
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                stopAgent(agent.id);
              }}
            >
              Stop
            </Button>
          ) : null}
        </Flex>
      </Flex>
    </Flex>
  );
}

function AgentSessions({ agentName }: { agentName: string }) {
  const connectionState = useOpenClawStore((s) => s.connectionState);
  const sessions = useOpenClawStore((s) => s.sessions);
  const spawnSession = useOpenClawStore((s) => s.spawnSession);
  const [isSpawning, setIsSpawning] = useState(false);

  const isConnected = connectionState === "connected";
  const agentSlug = agentName.toLowerCase().replace(/\s+/g, "-");
  const agentSessions = sessions.filter(
    (s) => s.agent === agentSlug
  );

  if (!isConnected) return null;

  const handleSpawn = async () => {
    setIsSpawning(true);
    try {
      await spawnSession({ agent: agentSlug });
    } catch {
      // error handled by store
    } finally {
      setIsSpawning(false);
    }
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        p: 3,
        gap: 2,
        borderBottom: "1px solid var(--border)"
      }}
    >
      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <Text
          sx={{
            fontSize: 11,
            fontWeight: "bold",
            color: "paragraph-secondary",
            textTransform: "uppercase",
            letterSpacing: "1px"
          }}
        >
          OpenClaw Sessions ({agentSessions.length})
        </Text>
        <Button
          variant="accent"
          sx={{
            fontSize: 10,
            px: 2,
            py: "2px",
            opacity: isSpawning ? 0.7 : 1
          }}
          onClick={handleSpawn}
          disabled={isSpawning}
        >
          {isSpawning ? "Spawning..." : "+ New Session"}
        </Button>
      </Flex>

      {agentSessions.map((session) => (
        <Flex
          key={session.id}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            bg: "background",
            borderRadius: 4,
            px: 2,
            py: 1,
            border: "1px solid var(--border)"
          }}
        >
          <Flex sx={{ alignItems: "center", gap: 2 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bg:
                  session.status === "active"
                    ? "#22c55e"
                    : session.status === "error"
                      ? "#ef4444"
                      : "#6b7280"
              }}
            />
            <Text
              sx={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "heading"
              }}
            >
              {session.id.slice(0, 16)}...
            </Text>
          </Flex>
          <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
            {new Date(session.createdAt).toLocaleTimeString()}
          </Text>
        </Flex>
      ))}

      {agentSessions.length === 0 && (
        <Text
          sx={{
            fontSize: 11,
            color: "paragraph-secondary",
            textAlign: "center",
            py: 1
          }}
        >
          No active sessions
        </Text>
      )}
    </Flex>
  );
}

function AgentMemorySection({ agent }: { agent: Agent }) {
  const updateAgentMemory = useAgentStore((s) => s.updateAgentMemory);
  const deleteAgentMemory = useAgentStore((s) => s.deleteAgentMemory);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const memoryEntries = Object.entries(agent.memory);

  const handleSave = (key: string) => {
    if (editValue.trim()) {
      updateAgentMemory(agent.id, key, editValue.trim());
    }
    setEditingKey(null);
  };

  const handleAdd = () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (key && value) {
      updateAgentMemory(agent.id, key, value);
      setNewKey("");
      setNewValue("");
    }
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        p: 3,
        gap: 2,
        borderBottom: "1px solid var(--border)"
      }}
    >
      <Text
        sx={{
          fontSize: 11,
          fontWeight: "bold",
          color: "paragraph-secondary",
          textTransform: "uppercase",
          letterSpacing: "1px"
        }}
      >
        Agent Memory ({memoryEntries.length})
      </Text>

      {memoryEntries.map(([key, value]) => (
        <Flex
          key={key}
          sx={{
            alignItems: "center",
            gap: 2,
            bg: "background",
            borderRadius: 4,
            px: 2,
            py: 1,
            border: "1px solid var(--border)"
          }}
        >
          <Text
            sx={{
              fontSize: 11,
              fontFamily: "monospace",
              color: "accent",
              fontWeight: "bold",
              minWidth: 80,
              flexShrink: 0
            }}
          >
            {key}
          </Text>
          {editingKey === key ? (
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSave(key)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave(key);
                if (e.key === "Escape") setEditingKey(null);
              }}
              autoFocus
              sx={{
                flex: 1,
                fontSize: 11,
                border: "1px solid var(--accent)",
                borderRadius: 4,
                px: 1,
                py: 0,
                fontFamily: "monospace"
              }}
            />
          ) : (
            <Text
              onClick={() => {
                setEditingKey(key);
                setEditValue(value);
              }}
              sx={{
                flex: 1,
                fontSize: 11,
                fontFamily: "monospace",
                color: "heading",
                cursor: "text",
                "&:hover": { textDecoration: "underline" }
              }}
            >
              {value}
            </Text>
          )}
          <Button
            variant="secondary"
            sx={{
              fontSize: 10,
              px: 1,
              py: 0,
              color: "#ef4444",
              bg: "transparent",
              flexShrink: 0
            }}
            onClick={() => deleteAgentMemory(agent.id, key)}
            title="Delete"
          >
            x
          </Button>
        </Flex>
      ))}

      {/* Add new entry */}
      <Flex sx={{ gap: 1 }}>
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="key"
          sx={{
            width: 100,
            fontSize: 11,
            border: "1px solid var(--border)",
            borderRadius: 4,
            px: 1,
            py: "2px",
            fontFamily: "monospace",
            "&:focus": { borderColor: "var(--accent)", outline: "none" }
          }}
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="value"
          sx={{
            flex: 1,
            fontSize: 11,
            border: "1px solid var(--border)",
            borderRadius: 4,
            px: 1,
            py: "2px",
            fontFamily: "monospace",
            "&:focus": { borderColor: "var(--accent)", outline: "none" }
          }}
        />
        <Button
          variant="secondary"
          sx={{ fontSize: 10, px: 2, py: "2px" }}
          onClick={handleAdd}
          disabled={!newKey.trim() || !newValue.trim()}
        >
          Add
        </Button>
      </Flex>
    </Flex>
  );
}

function AgentDetailPanel({ agent }: { agent: Agent }) {
  return (
    <Flex
      sx={{
        flexDirection: "column",
        flex: 1,
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <Flex
        sx={{
          alignItems: "center",
          gap: 2,
          p: 3,
          borderBottom: "1px solid var(--border)"
        }}
      >
        <Text sx={{ fontSize: 28 }}>{agent.avatar}</Text>
        <Flex sx={{ flexDirection: "column", flex: 1 }}>
          <Text
            sx={{ fontSize: 16, fontWeight: "bold", color: "heading" }}
          >
            {agent.name}
          </Text>
          <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
            {agent.model} &middot; Last active{" "}
            {new Date(agent.lastActiveAt).toLocaleString()}
          </Text>
        </Flex>
        <StatusBadge status={agent.status} />
      </Flex>

      {/* Config */}
      <Flex
        sx={{
          p: 3,
          gap: 3,
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap"
        }}
      >
        {Object.entries(agent.config).map(([key, value]) => (
          <Flex key={key} sx={{ flexDirection: "column" }}>
            <Text
              sx={{
                fontSize: 10,
                color: "paragraph-secondary",
                textTransform: "uppercase"
              }}
            >
              {key.replace(/([A-Z])/g, " $1").trim()}
            </Text>
            <Text
              sx={{ fontSize: 13, color: "heading", fontWeight: "bold" }}
            >
              {String(value)}
            </Text>
          </Flex>
        ))}
      </Flex>

      {/* Agent Memory */}
      <AgentMemorySection agent={agent} />

      {/* OpenClaw Sessions */}
      <AgentSessions agentName={agent.name} />

      {/* Activity Log */}
      <Flex sx={{ flexDirection: "column", flex: 1, overflow: "hidden" }}>
        <Text
          sx={{
            fontSize: 11,
            fontWeight: "bold",
            color: "paragraph-secondary",
            textTransform: "uppercase",
            letterSpacing: "1px",
            p: 3,
            pb: 1
          }}
        >
          Activity Log
        </Text>
        <Box sx={{ flex: 1, overflow: "auto", px: 3, pb: 3 }}>
          {agent.activity.map((entry) => (
            <ActivityEntry key={entry.id} entry={entry} />
          ))}
        </Box>
      </Flex>
    </Flex>
  );
}

// ── OpenClaw Connection Panel ──

function OpenClawConnectionPanel() {
  const connectionState = useOpenClawStore((s) => s.connectionState);
  const gatewayUrl = useOpenClawStore((s) => s.gatewayUrl);
  const authToken = useOpenClawStore((s) => s.authToken);
  const connectionError = useOpenClawStore((s) => s.connectionError);
  const lastConnectedAt = useOpenClawStore((s) => s.lastConnectedAt);
  const sessions = useOpenClawStore((s) => s.sessions);
  const setGatewayUrl = useOpenClawStore((s) => s.setGatewayUrl);
  const setAuthToken = useOpenClawStore((s) => s.setAuthToken);
  const connect = useOpenClawStore((s) => s.connect);
  const disconnect = useOpenClawStore((s) => s.disconnect);

  const [isConnecting, setIsConnecting] = useState(false);
  const [localUrl, setLocalUrl] = useState(gatewayUrl);
  const [localToken, setLocalToken] = useState(authToken);
  const [showToken, setShowToken] = useState(false);

  const handleConnect = async () => {
    setGatewayUrl(localUrl);
    setAuthToken(localToken);
    setIsConnecting(true);
    try {
      await connect();
    } catch {
      // Error is stored in the store
    } finally {
      setIsConnecting(false);
    }
  };

  const isConnected = connectionState === "connected";

  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "background-secondary",
        borderRadius: 8,
        border: isConnected
          ? "1px solid #22c55e40"
          : "1px solid var(--border)",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          p: 3,
          borderBottom: "1px solid var(--border)"
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <svg
            width="20"
            height="20"
            viewBox="-15 -5 230 224"
            style={{ flexShrink: 0 }}
          >
            <polygon
              points="0,0.9 0,35.9 12.8,54.1 81.4,83.2 99.7,107.9 118.3,83.4 186.5,54.7 200,36.1 200,0 186.1,24.2 100.8,49.6 13.9,24.2"
              fill={isConnected ? "#22c55e" : "#E00000"}
            />
            <polygon
              points="31.7,65.9 31.7,112.4 58.3,129.7 58.3,159.9 85.5,214 85.7,111.5 43.6,86.6 41.2,73.1"
              fill={isConnected ? "#22c55e" : "#E00000"}
            />
            <polygon
              points="168.5,66.2 158.8,73.4 156.1,86.8 114.5,111.3 114.5,214 141.7,160.2 141.7,129.7 168.5,112.4"
              fill={isConnected ? "#22c55e" : "#E00000"}
            />
          </svg>
          <Flex sx={{ flexDirection: "column" }}>
            <Text
              sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}
            >
              OpenClaw Gateway
            </Text>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {isConnected
                ? `Connected since ${new Date(lastConnectedAt!).toLocaleTimeString()}`
                : connectionState === "connecting" ||
                    connectionState === "authenticating"
                  ? "Connecting..."
                  : "Not connected"}
            </Text>
          </Flex>
        </Flex>
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bg: isConnected
                ? "#22c55e"
                : connectionState === "error"
                  ? "#ef4444"
                  : "#6b7280",
              boxShadow: isConnected ? "0 0 8px #22c55e" : "none"
            }}
          />
        </Flex>
      </Flex>

      {/* Connection Form */}
      <Flex sx={{ flexDirection: "column", p: 3, gap: 2 }}>
        <Flex sx={{ flexDirection: "column", gap: 1 }}>
          <Text
            sx={{
              fontSize: 11,
              fontWeight: "bold",
              color: "paragraph-secondary"
            }}
          >
            Gateway URL
          </Text>
          <Input
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            disabled={isConnected || isConnecting}
            placeholder="ws://127.0.0.1:18789"
            sx={{
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: 6,
              px: 2,
              py: 1,
              bg: "background",
              fontFamily: "monospace"
            }}
          />
        </Flex>

        <Flex sx={{ flexDirection: "column", gap: 1 }}>
          <Flex
            sx={{
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <Text
              sx={{
                fontSize: 11,
                fontWeight: "bold",
                color: "paragraph-secondary"
              }}
            >
              Auth Token
            </Text>
            <Button
              variant="secondary"
              sx={{
                fontSize: 10,
                px: 1,
                py: 0,
                bg: "transparent",
                color: "paragraph-secondary"
              }}
              onClick={() => setShowToken(!showToken)}
            >
              {showToken ? "Hide" : "Show"}
            </Button>
          </Flex>
          <Input
            value={localToken}
            onChange={(e) => setLocalToken(e.target.value)}
            disabled={isConnected || isConnecting}
            type={showToken ? "text" : "password"}
            placeholder="Enter auth token (optional)"
            sx={{
              fontSize: 12,
              border: "1px solid var(--border)",
              borderRadius: 6,
              px: 2,
              py: 1,
              bg: "background",
              fontFamily: "monospace"
            }}
          />
        </Flex>

        {connectionError && (
          <Text sx={{ fontSize: 11, color: "#ef4444" }}>
            {connectionError}
          </Text>
        )}

        <Flex sx={{ gap: 2 }}>
          {isConnected ? (
            <Button
              variant="secondary"
              sx={{ fontSize: 12, px: 3, py: 1, flex: 1 }}
              onClick={disconnect}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="accent"
              sx={{
                fontSize: 12,
                px: 3,
                py: 1,
                flex: 1,
                opacity: isConnecting ? 0.7 : 1
              }}
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          )}
        </Flex>

        {/* Active Sessions */}
        {isConnected && sessions.length > 0 && (
          <Flex sx={{ flexDirection: "column", gap: 1, mt: 1 }}>
            <Text
              sx={{
                fontSize: 10,
                fontWeight: "bold",
                color: "paragraph-secondary",
                textTransform: "uppercase"
              }}
            >
              Active Sessions ({sessions.length})
            </Text>
            {sessions.map((session) => (
              <Flex
                key={session.id}
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  bg: "background",
                  borderRadius: 4,
                  px: 2,
                  py: 1,
                  border: "1px solid var(--border)"
                }}
              >
                <Text
                  sx={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "heading"
                  }}
                >
                  {session.id.slice(0, 12)}...
                </Text>
                <Flex sx={{ alignItems: "center", gap: 1 }}>
                  {session.agent && (
                    <Text
                      sx={{
                        fontSize: 10,
                        color: "paragraph-secondary"
                      }}
                    >
                      {session.agent}
                    </Text>
                  )}
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bg:
                        session.status === "active"
                          ? "#22c55e"
                          : session.status === "error"
                            ? "#ef4444"
                            : "#6b7280"
                    }}
                  />
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}

// ── Main Agents View ──

function AgentsView() {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const activeCount = agents.filter((a) => a.status === "running").length;
  const idleCount = agents.filter((a) => a.status === "idle").length;

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
      <Flex
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Flex sx={{ flexDirection: "column" }}>
          <Text variant="heading" sx={{ fontSize: 22 }}>
            Agents
          </Text>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
            {activeCount} active &middot; {idleCount} idle &middot;{" "}
            {agents.length} total
          </Text>
        </Flex>
      </Flex>

      {/* OpenClaw Connection Panel */}
      <OpenClawConnectionPanel />

      {/* Main content */}
      <Flex sx={{ flex: 1, gap: 3, minHeight: 0 }}>
        {/* Agent List */}
        <Flex
          sx={{
            flexDirection: "column",
            width: selectedAgent ? "40%" : "100%",
            gap: 2,
            overflow: "auto"
          }}
        >
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={selectedAgentId === agent.id}
              onSelect={() =>
                selectAgent(
                  selectedAgentId === agent.id ? null : agent.id
                )
              }
            />
          ))}
        </Flex>

        {/* Detail Panel */}
        {selectedAgent && <AgentDetailPanel agent={selectedAgent} />}
      </Flex>
    </Flex>
  );
}

export default AgentsView;
