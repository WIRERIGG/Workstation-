/*
This file is part of the Workstation project.

Conversations view — AI session timeline with stats, date grouping,
flow/turn views, export, pagination, and per-session analytics.
Aggregates conversation data from Claude Code, Cursor, Gemini CLI, etc.
Uses Electron tRPC backend when running in the desktop app.
*/

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, Text, Input, Button } from "@theme-ui/components";

declare const IS_DESKTOP_APP: boolean;

const MONO_FONT = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";

type ConversationSession = {
  id: string;
  tool: string;
  title: string | null;
  project: string | null;
  started_at: string;
  messages: number;
  tokens: number | null;
  cost: number | null;
  path: string;
};

type ConversationMessage = {
  role: string;
  content: string;
  timestamp: string | null;
  tool_use: string | null;
};

type ConversationStats = {
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  total_cost: number;
  by_tool: { tool: string; sessions: number; messages: number; tokens: number; cost: number }[];
};

const TOOL_ICONS: Record<string, { label: string; color: string }> = {
  "claude-code": { label: "Claude", color: "#f97316" },
  cursor: { label: "Cursor", color: "#60a5fa" },
  gemini: { label: "Gemini", color: "#22c55e" },
  copilot: { label: "Copilot", color: "#a78bfa" },
  unknown: { label: "Unknown", color: "#8b949e" }
};

const TOOL_COLORS: Record<string, string> = {
  Read: "#22c55e",
  Write: "#60a5fa",
  Edit: "#eab308",
  Bash: "#ef4444",
  Grep: "#a78bfa",
  Glob: "#a78bfa",
  Task: "#f97316",
  WebFetch: "#60a5fa",
  WebSearch: "#22c55e"
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

// ── Date grouping ──

function getDateGroup(dateStr: string): string {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "This Week";
  if (date >= monthAgo) return "This Month";
  return "Older";
}

function ConversationsReal() {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ConversationSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [search, setSearch] = useState("");
  const [toolFilter, setToolFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ConversationStats | null>(null);
  const [viewMode, setViewMode] = useState<"flow" | "turn">("flow");
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [expandedToolUse, setExpandedToolUse] = useState<Set<number>>(new Set());
  const [pageSize] = useState(50);
  const [loadedCount, setLoadedCount] = useState(50);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Load stats
  // TODO: Add a conversations tRPC router to the Electron backend
  // For now, conversations data is loaded via desktop.workstationData if available
  useEffect(() => {
    (async () => {
      try {
        const { desktop } = await import("../common/desktop-bridge");
        // Conversations router not yet implemented in Electron tRPC backend
        // When added, this would be: desktop.conversations.stats.query({ toolFilter })
        void desktop; // suppress unused variable warning
      } catch {
        // stats not available
      }
    })();
  }, [toolFilter]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { desktop } = await import("../common/desktop-bridge");
      // TODO: Replace with desktop.conversations.scan.query / desktop.conversations.search.query
      // when the conversations tRPC router is implemented
      void desktop;
      setSessions([]);
    } catch (e) {
      console.error("Failed to load conversations:", e);
    }
    setLoading(false);
  }, [search, toolFilter, loadedCount]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const loadSession = useCallback(async (session: ConversationSession) => {
    setSelectedSession(session);
    setExpandedMessages(new Set());
    setExpandedToolUse(new Set());
    try {
      const { desktop } = await import("../common/desktop-bridge");
      // TODO: Replace with desktop.conversations.getSession.query({ path: session.path })
      void desktop;
      setMessages([]);
    } catch (e) {
      console.error("Failed to load session:", e);
      setMessages([]);
    }
  }, []);

  const handleExport = useCallback(async () => {
    if (!selectedSession) return;
    try {
      const { desktop } = await import("../common/desktop-bridge");
      // TODO: Replace with desktop.conversations.export.query({ path: selectedSession.path })
      void desktop;
      console.warn("Conversations export not yet available via tRPC");
    } catch (e) {
      console.error("Export error:", e);
    }
  }, [selectedSession]);

  const toggleExpand = (idx: number) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleToolUse = (idx: number) => {
    setExpandedToolUse((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Group sessions by date
  const groupedSessions = useMemo(() => {
    const groups: Record<string, ConversationSession[]> = {};
    for (const s of sessions) {
      const group = getDateGroup(s.started_at);
      if (!groups[group]) groups[group] = [];
      groups[group].push(s);
    }
    return groups;
  }, [sessions]);

  // Analytics for selected session
  const sessionAnalytics = useMemo(() => {
    if (!messages.length) return null;
    const toolCounts: Record<string, number> = {};
    const roleCounts: Record<string, number> = {};
    let totalChars = 0;

    for (const msg of messages) {
      roleCounts[msg.role] = (roleCounts[msg.role] || 0) + 1;
      totalChars += msg.content.length;
      if (msg.tool_use) {
        toolCounts[msg.tool_use] = (toolCounts[msg.tool_use] || 0) + 1;
      }
    }

    return { toolCounts, roleCounts, totalChars };
  }, [messages]);

  // Turn view: group user-assistant pairs
  const turns = useMemo(() => {
    const result: { user: ConversationMessage | null; assistant: ConversationMessage | null; tools: ConversationMessage[] }[] = [];
    let current: { user: ConversationMessage | null; assistant: ConversationMessage | null; tools: ConversationMessage[] } = { user: null, assistant: null, tools: [] };

    for (const msg of messages) {
      if (msg.role === "user") {
        if (current.user || current.assistant) {
          result.push(current);
          current = { user: null, assistant: null, tools: [] };
        }
        current.user = msg;
      } else if (msg.role === "assistant") {
        current.assistant = msg;
        if (msg.tool_use) {
          current.tools.push(msg);
        }
      }
    }
    if (current.user || current.assistant) result.push(current);
    return result;
  }, [messages]);

  const tools = Object.keys(TOOL_ICONS).filter((k) => k !== "unknown");

  return (
    <Flex sx={{ flexDirection: "column", height: "100%", bg: "background", fontFamily: MONO_FONT, overflow: "hidden" }}>
      {/* Stats Header */}
      {stats && (
        <Flex sx={{ alignItems: "center", px: 3, py: "6px", bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0, gap: 3, flexWrap: "wrap" }}>
          <Flex sx={{ gap: 2, alignItems: "center" }}>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>Sessions:</Text>
            <Text sx={{ fontSize: 11, color: "heading", fontWeight: "bold" }}>{stats.total_sessions}</Text>
          </Flex>
          <Flex sx={{ gap: 2, alignItems: "center" }}>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>Messages:</Text>
            <Text sx={{ fontSize: 11, color: "heading", fontWeight: "bold" }}>{stats.total_messages.toLocaleString()}</Text>
          </Flex>
          <Flex sx={{ gap: 2, alignItems: "center" }}>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>Tokens:</Text>
            <Text sx={{ fontSize: 11, color: "heading", fontWeight: "bold" }}>{formatTokens(stats.total_tokens)}</Text>
          </Flex>
          <Flex sx={{ gap: 2, alignItems: "center" }}>
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>Cost:</Text>
            <Text sx={{ fontSize: 11, color: "heading", fontWeight: "bold" }}>{formatCost(stats.total_cost)}</Text>
          </Flex>
          {stats.by_tool.map((bt) => {
            const info = TOOL_ICONS[bt.tool] || TOOL_ICONS.unknown;
            return (
              <Text key={bt.tool} sx={{ fontSize: 9, color: info.color, bg: `${info.color}22`, px: "5px", py: "1px", borderRadius: 8, fontWeight: "bold" }}>
                {info.label}: {bt.sessions}
              </Text>
            );
          })}
        </Flex>
      )}

      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between", px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>Conversations</Text>
        <Flex sx={{ gap: 1 }}>
          <Button onClick={() => setToolFilter(null)} sx={{ bg: !toolFilter ? "background-selected" : "transparent", border: "1px solid var(--border)", color: !toolFilter ? "heading" : "paragraph-secondary", fontSize: 10, px: 2, py: "2px", borderRadius: 12, cursor: "pointer" }}>All</Button>
          {tools.map((tool) => {
            const info = TOOL_ICONS[tool];
            return (
              <Button key={tool} onClick={() => setToolFilter(tool === toolFilter ? null : tool)} sx={{ bg: toolFilter === tool ? "background-selected" : "transparent", border: "1px solid var(--border)", color: toolFilter === tool ? info.color : "paragraph-secondary", fontSize: 10, px: 2, py: "2px", borderRadius: 12, cursor: "pointer" }}>
                {info.label}
              </Button>
            );
          })}
        </Flex>
      </Flex>

      {/* Search */}
      <Box sx={{ px: 3, py: 2, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations..." spellCheck={false} sx={{ bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 12, fontFamily: MONO_FONT, px: 2, py: "5px", width: "100%", caretColor: "#22c55e", "&:focus": { outline: "none", borderColor: "#60a5fa" }, "&::placeholder": { color: "paragraph-secondary" } }} />
      </Box>

      {/* Content */}
      <Flex sx={{ flex: 1, overflow: "hidden" }}>
        {/* Session list */}
        <Box sx={{ width: selectedSession ? "40%" : "100%", overflow: "auto", borderRight: selectedSession ? "1px solid var(--border)" : "none", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
          {loading && <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary" }}>Scanning...</Text>}
          {Object.entries(groupedSessions).map(([group, groupSessions]) => (
            <Box key={group}>
              <Text sx={{ fontSize: 10, fontWeight: "bold", color: "paragraph-secondary", textTransform: "uppercase", letterSpacing: "1px", px: 3, pt: 2, pb: 1 }}>{group}</Text>
              {groupSessions.map((session) => {
                const tool = TOOL_ICONS[session.tool] || TOOL_ICONS.unknown;
                const isSelected = selectedSession?.id === session.id && selectedSession?.path === session.path;
                return (
                  <Flex key={session.id + session.path} onClick={() => loadSession(session)} sx={{ px: 3, py: 2, cursor: "pointer", bg: isSelected ? "background-selected" : "transparent", "&:hover": { bg: isSelected ? "background-selected" : "hover" }, borderBottom: "1px solid var(--border)", gap: 2 }}>
                    <Box sx={{ flexShrink: 0 }}>
                      <Text sx={{ fontSize: 10, color: tool.color, bg: `${tool.color}22`, px: "6px", py: "2px", borderRadius: 8, fontWeight: "bold" }}>{tool.label}</Text>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Text sx={{ fontSize: 12, color: "heading", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {session.title || session.id}
                      </Text>
                      <Flex sx={{ gap: 2, mt: "2px", flexWrap: "wrap" }}>
                        {session.project && <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{session.project}</Text>}
                        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{session.messages} msgs</Text>
                        {session.tokens != null && <Text sx={{ fontSize: 10, color: "#60a5fa" }}>{formatTokens(session.tokens)}</Text>}
                        {session.cost != null && session.cost > 0 && <Text sx={{ fontSize: 10, color: "#22c55e" }}>{formatCost(session.cost)}</Text>}
                      </Flex>
                    </Box>
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary", flexShrink: 0 }}>
                      {session.started_at ? new Date(session.started_at).toLocaleDateString() : ""}
                    </Text>
                  </Flex>
                );
              })}
            </Box>
          ))}
          {/* Load more */}
          {sessions.length >= loadedCount && (
            <Button onClick={() => setLoadedCount((c) => c + pageSize)} sx={{ display: "block", width: "100%", bg: "transparent", border: "none", color: "#60a5fa", fontSize: 11, py: 2, cursor: "pointer", "&:hover": { bg: "hover" } }}>
              Load more...
            </Button>
          )}
          {!loading && sessions.length === 0 && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>No conversations found</Text>
              <Text sx={{ fontSize: 11, color: "paragraph-secondary", mt: 1, display: "block" }}>
                Conversations from Claude Code, Cursor, and Gemini CLI will appear here.
              </Text>
            </Box>
          )}
        </Box>

        {/* Message detail */}
        {selectedSession && (
          <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
            {/* Detail header */}
            <Flex sx={{ px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 1, flexShrink: 0 }}>
              <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{selectedSession.title || selectedSession.id}</Text>
              <Flex sx={{ gap: 1, flexShrink: 0 }}>
                <Button onClick={() => setViewMode(viewMode === "flow" ? "turn" : "flow")} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 10, px: 2, py: "2px", borderRadius: 4, cursor: "pointer" }}>
                  {viewMode === "flow" ? "Turn View" : "Flow View"}
                </Button>
                <Button onClick={handleExport} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 10, px: 2, py: "2px", borderRadius: 4, cursor: "pointer", "&:hover": { color: "#22c55e" } }}>Export MD</Button>
                <Button onClick={() => setShowAnalytics(!showAnalytics)} sx={{ bg: showAnalytics ? "#a78bfa22" : "transparent", border: showAnalytics ? "1px solid #a78bfa" : "1px solid var(--border)", color: showAnalytics ? "#a78bfa" : "paragraph-secondary", fontSize: 10, px: 2, py: "2px", borderRadius: 4, cursor: "pointer" }}>Analytics</Button>
                <Button onClick={() => { setSelectedSession(null); setMessages([]); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", cursor: "pointer", p: 0 }}>x</Button>
              </Flex>
            </Flex>

            {/* Messages */}
            <Box sx={{ flex: 1, overflow: "auto" }}>
              {viewMode === "flow" ? (
                // Flow View
                messages.map((msg, i) => {
                  const isExpanded = expandedMessages.has(i);
                  const isToolExpanded = expandedToolUse.has(i);
                  const isLong = msg.content.length > 2000;
                  return (
                    <Box key={i} sx={{ px: 3, py: 2, borderBottom: "1px solid var(--border)" }}>
                      <Flex sx={{ gap: 2, mb: 1, alignItems: "center" }}>
                        <Text sx={{ fontSize: 10, fontWeight: "bold", color: msg.role === "user" ? "#60a5fa" : msg.role === "assistant" ? "#22c55e" : "paragraph-secondary", textTransform: "uppercase" }}>
                          {msg.role}
                        </Text>
                        {msg.tool_use && (
                          <Button onClick={() => toggleToolUse(i)} sx={{ bg: "transparent", border: "none", p: 0, cursor: "pointer" }}>
                            <Text sx={{ fontSize: 10, color: TOOL_COLORS[msg.tool_use] || "#a78bfa", bg: `${TOOL_COLORS[msg.tool_use] || "#a78bfa"}22`, px: "4px", py: "1px", borderRadius: 4 }}>{msg.tool_use}</Text>
                          </Button>
                        )}
                        {msg.timestamp && <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{new Date(msg.timestamp).toLocaleTimeString()}</Text>}
                      </Flex>
                      {/* Collapsible tool use content */}
                      {msg.tool_use && !isToolExpanded && (
                        <Text sx={{ fontSize: 11, color: "paragraph-secondary", fontStyle: "italic", cursor: "pointer" }} onClick={() => toggleToolUse(i)}>
                          [Click to expand tool output]
                        </Text>
                      )}
                      {(!msg.tool_use || isToolExpanded) && (
                        <Text sx={{ fontSize: 12, color: "heading", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5, maxHeight: isExpanded || !isLong ? "none" : 200, overflow: "hidden" }}>
                          {isExpanded ? msg.content : msg.content.slice(0, 2000)}
                          {!isExpanded && isLong ? "..." : ""}
                        </Text>
                      )}
                      {isLong && (
                        <Button onClick={() => toggleExpand(i)} sx={{ bg: "transparent", border: "none", color: "#60a5fa", fontSize: 10, cursor: "pointer", p: 0, mt: 1 }}>
                          {isExpanded ? "Show less" : `Show more (${msg.content.length.toLocaleString()} chars)`}
                        </Button>
                      )}
                    </Box>
                  );
                })
              ) : (
                // Turn View
                turns.map((turn, i) => {
                  const isExpanded = expandedMessages.has(i);
                  return (
                    <Box key={i} sx={{ borderBottom: "1px solid var(--border)" }}>
                      <Flex onClick={() => toggleExpand(i)} sx={{ px: 3, py: 2, cursor: "pointer", "&:hover": { bg: "hover" }, alignItems: "center", gap: 2 }}>
                        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{isExpanded ? "▾" : "▸"}</Text>
                        <Text sx={{ fontSize: 12, color: "#60a5fa", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {turn.user?.content.slice(0, 100) || "(no prompt)"}
                        </Text>
                        {turn.tools.length > 0 && (
                          <Text sx={{ fontSize: 9, color: "#a78bfa", bg: "#a78bfa22", px: "4px", py: "1px", borderRadius: 4 }}>{turn.tools.length} tools</Text>
                        )}
                        <Text sx={{ fontSize: 10, color: "paragraph-secondary", flexShrink: 0 }}>
                          {turn.assistant?.content.length ? `${(turn.assistant.content.length / 1000).toFixed(1)}k chars` : ""}
                        </Text>
                      </Flex>
                      {isExpanded && (
                        <Box sx={{ px: 3, pb: 2 }}>
                          {turn.user && (
                            <Box sx={{ mb: 2, pl: 2, borderLeft: "2px solid #60a5fa" }}>
                              <Text sx={{ fontSize: 10, color: "#60a5fa", fontWeight: "bold", mb: 1, display: "block" }}>USER</Text>
                              <Text sx={{ fontSize: 12, color: "heading", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{turn.user.content}</Text>
                            </Box>
                          )}
                          {turn.assistant && (
                            <Box sx={{ pl: 2, borderLeft: "2px solid #22c55e" }}>
                              <Text sx={{ fontSize: 10, color: "#22c55e", fontWeight: "bold", mb: 1, display: "block" }}>ASSISTANT</Text>
                              <Text sx={{ fontSize: 12, color: "heading", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{turn.assistant.content}</Text>
                            </Box>
                          )}
                        </Box>
                      )}
                    </Box>
                  );
                })
              )}
              {messages.length === 0 && (
                <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary" }}>Loading messages...</Text>
              )}
            </Box>

            {/* Analytics panel */}
            {showAnalytics && sessionAnalytics && (
              <Box sx={{ borderTop: "1px solid var(--border)", bg: "background-secondary", px: 3, py: 2, flexShrink: 0 }}>
                <Text sx={{ fontSize: 11, fontWeight: "bold", color: "heading", mb: 1, display: "block" }}>Session Analytics</Text>
                <Flex sx={{ gap: 3, flexWrap: "wrap", mb: 1 }}>
                  {Object.entries(sessionAnalytics.roleCounts).map(([role, count]) => (
                    <Flex key={role} sx={{ gap: 1, alignItems: "center" }}>
                      <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{role}:</Text>
                      <Text sx={{ fontSize: 10, color: "heading", fontWeight: "bold" }}>{count}</Text>
                    </Flex>
                  ))}
                  <Flex sx={{ gap: 1, alignItems: "center" }}>
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>total chars:</Text>
                    <Text sx={{ fontSize: 10, color: "heading", fontWeight: "bold" }}>{sessionAnalytics.totalChars.toLocaleString()}</Text>
                  </Flex>
                </Flex>
                {Object.keys(sessionAnalytics.toolCounts).length > 0 && (
                  <>
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary", mb: 1, display: "block" }}>Tool Invocations:</Text>
                    <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
                      {Object.entries(sessionAnalytics.toolCounts).map(([tool, count]) => (
                        <Text key={tool} sx={{ fontSize: 9, color: TOOL_COLORS[tool] || "#8b949e", bg: `${TOOL_COLORS[tool] || "#8b949e"}22`, px: "4px", py: "1px", borderRadius: 4 }}>
                          {tool}: {count}
                        </Text>
                      ))}
                    </Flex>
                  </>
                )}
              </Box>
            )}
          </Box>
        )}
      </Flex>
    </Flex>
  );
}

function ConversationsPlaceholder() {
  return (
    <Flex sx={{ height: "100%", alignItems: "center", justifyContent: "center", bg: "background" }}>
      <Box sx={{ textAlign: "center" }}>
        <Text sx={{ fontSize: 48, display: "block", mb: 3 }}>AI Conversations</Text>
        <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>Conversation aggregation requires the desktop app.</Text>
      </Box>
    </Flex>
  );
}

export default function ConversationsView() {
  if (IS_DESKTOP_APP) return <ConversationsReal />;
  return <ConversationsPlaceholder />;
}
