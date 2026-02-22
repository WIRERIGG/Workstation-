/*
This file is part of the Workstation project.

Terminal view with xterm.js + Electron PTY backend (via tRPC).
Enhanced: tab bar with multi-session, split view.
Falls back to the mock command-line when not running in the desktop app.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Flex, Text, Button, Input } from "@theme-ui/components";
import { useStore as useOpenClawStore } from "../stores/openclaw-store";
import { useStore as useChatStore } from "../stores/chat-store";

declare const IS_DESKTOP_APP: boolean;

const MONO_FONT = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";

const TOOL_COLORS: Record<string, string> = {
  Read: "#22c55e",
  Write: "#60a5fa",
  Edit: "#eab308",
  Bash: "#ef4444",
  Grep: "#a78bfa",
  Glob: "#a78bfa"
};

// ── Tab type ──

type TerminalTab = {
  id: string;
  ptyId: string;
  title: string;
  active: boolean;
};

// ── PTY Terminal with Tabs ──

function PtyTerminal() {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [split, setSplit] = useState(false);
  const [splitActiveTabId, setSplitActiveTabId] = useState<string | null>(null);

  // Store xterm instances keyed by tab id
  const termInstances = useRef<Map<string, { terminal: any; fitAddon: any; cleanup: () => void }>>(new Map());
  const containerRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const createTab = useCallback(async () => {
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ptyId = `pty-${tabId}`;

    const newTab: TerminalTab = { id: tabId, ptyId, title: `Terminal ${tabs.length + 1}`, active: true };
    setTabs((prev) => [...prev.map((t) => ({ ...t, active: false })), newTab]);
    setActiveTabId(tabId);

    // Initialize will happen in useEffect when containerRef is set
    return tabId;
  }, [tabs.length]);

  const [initError, setInitError] = useState<string | null>(null);

  // Initialize a terminal for a given tab when its container is ready
  const initTerminal = useCallback(async (tabId: string, container: HTMLDivElement) => {
    if (termInstances.current.has(tabId)) return;

    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    try {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      const { desktop } = await import("../common/desktop-bridge");

      await import("@xterm/xterm/css/xterm.css");

      if (!desktop) {
        throw new Error("Desktop bridge not available — PTY requires Electron");
      }

      const term = new Terminal({
        theme: {
          background: "#0d1117",
          foreground: "#e2e8f0",
          cursor: "#22c55e",
          selectionBackground: "#264f78",
          black: "#0d1117", red: "#f85149", green: "#3fb950",
          yellow: "#d29922", blue: "#58a6ff", magenta: "#bc8cff",
          cyan: "#39d353", white: "#e2e8f0"
        },
        fontFamily: MONO_FONT,
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: "bar",
        allowTransparency: true,
        scrollback: 10000
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(container);
      fitAddon.fit();

      const { id: ptyId } = await desktop.pty.spawn.mutate({
        rows: term.rows,
        cols: term.cols
      });

      // Update the tab's ptyId with the server-assigned UUID
      setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, ptyId } : t));

      const dataSubscription = desktop.pty.onData.subscribe(
        { id: ptyId },
        {
          onData(data: string) {
            term.write(data);
          }
        }
      );

      const exitSubscription = desktop.pty.onExit.subscribe(
        { id: ptyId },
        {
          onData(event: { exitCode: number; signal?: number }) {
            term.write(`\r\n\x1b[33m[Process exited with code ${event.exitCode ?? "unknown"}]\x1b[0m\r\n`);
          }
        }
      );

      term.onData((data) => {
        desktop.pty.write.mutate({ id: ptyId, data }).catch(console.error);
      });

      term.onResize(({ rows, cols }) => {
        desktop.pty.resize.mutate({ id: ptyId, cols, rows }).catch(console.error);
      });

      const resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(container);

      termInstances.current.set(tabId, {
        terminal: term,
        fitAddon,
        cleanup: () => {
          dataSubscription.unsubscribe();
          exitSubscription.unsubscribe();
          resizeObserver.disconnect();
          desktop.pty.kill.mutate({ id: ptyId }).catch(() => {});
          term.dispose();
        }
      });

      setInitError(null);
    } catch (err) {
      console.error("[PtyTerminal] initTerminal failed:", err);
      setInitError(err instanceof Error ? err.message : String(err));
    }
  }, [tabs]);

  // Create first tab on mount
  useEffect(() => {
    if (tabs.length === 0) {
      createTab();
    }
  }, []);

  // Initialize terminals when tabs change or active tab changes
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    const container = containerRefs.current.get(activeTabId!);
    if (container && !termInstances.current.has(activeTabId!)) {
      initTerminal(activeTabId!, container);
    } else if (container) {
      const inst = termInstances.current.get(activeTabId!);
      inst?.fitAddon?.fit();
    }
  }, [activeTabId, tabs, initTerminal]);

  const closeTab = useCallback(async (tabId: string) => {
    const inst = termInstances.current.get(tabId);
    if (inst) {
      inst.cleanup();
      termInstances.current.delete(tabId);
    }
    containerRefs.current.delete(tabId);

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        setActiveTabId(next[next.length - 1].id);
      } else if (next.length === 0) {
        setActiveTabId(null);
      }
      return next;
    });
  }, [activeTabId]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setTabs((prev) => prev.map((t) => ({ ...t, active: t.id === tabId })));
    // Fit the terminal when switching
    setTimeout(() => {
      const inst = termInstances.current.get(tabId);
      inst?.fitAddon?.fit();
    }, 50);
  }, []);

  const startRename = (tabId: string, currentTitle: string) => {
    setEditingTabId(tabId);
    setEditTitle(currentTitle);
  };

  const finishRename = () => {
    if (editingTabId && editTitle.trim()) {
      setTabs((prev) => prev.map((t) => t.id === editingTabId ? { ...t, title: editTitle.trim() } : t));
    }
    setEditingTabId(null);
    setEditTitle("");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [, inst] of termInstances.current) {
        inst.cleanup();
      }
      termInstances.current.clear();
    };
  }, []);

  return (
    <Flex sx={{ flexDirection: "column", height: "100%", bg: "background", overflow: "hidden" }}>
      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between", px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Text sx={{ fontSize: 13, color: "paragraph-secondary", fontFamily: MONO_FONT }}>workstation — terminal (PTY)</Text>
        <Flex sx={{ gap: 1 }}>
          <Button onClick={() => setSplit(!split)} sx={{ bg: split ? "#60a5fa22" : "transparent", border: split ? "1px solid #60a5fa" : "1px solid var(--border)", color: split ? "#60a5fa" : "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer" }}>Split</Button>
        </Flex>
      </Flex>

      {/* Tab bar */}
      <Flex sx={{ alignItems: "center", bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0, overflow: "auto", "&::-webkit-scrollbar": { height: 3 } }}>
        {tabs.map((tab) => (
          <Flex key={tab.id} onClick={() => switchTab(tab.id)} sx={{ alignItems: "center", gap: 1, px: 2, py: "5px", cursor: "pointer", bg: activeTabId === tab.id ? "background" : "transparent", borderRight: "1px solid var(--border)", "&:hover": { bg: activeTabId === tab.id ? "background" : "hover" }, minWidth: 100 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: "50%", bg: "#22c55e", boxShadow: "0 0 3px #22c55e", flexShrink: 0 }} />
            {editingTabId === tab.id ? (
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={finishRename} onKeyDown={(e) => { if (e.key === "Enter") finishRename(); }} autoFocus sx={{ bg: "transparent", border: "none", outline: "none", color: "heading", fontSize: 11, fontFamily: MONO_FONT, p: 0, width: 80, "&:focus": { outline: "none" } }} />
            ) : (
              <Text onDoubleClick={() => startRename(tab.id, tab.title)} sx={{ fontSize: 11, color: activeTabId === tab.id ? "heading" : "paragraph-secondary", fontFamily: MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{tab.title}</Text>
            )}
            <Button onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0, flexShrink: 0, "&:hover": { color: "#ef4444" } }}>x</Button>
          </Flex>
        ))}
        <Button onClick={createTab} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 14, cursor: "pointer", px: 2, py: "5px", "&:hover": { color: "#22c55e" } }}>+</Button>
      </Flex>

      {/* Error banner */}
      {initError && (
        <Flex sx={{ bg: "#ef444422", border: "1px solid #ef4444", px: 3, py: 2, mx: 2, mt: 1, borderRadius: 6, alignItems: "center", gap: 2, flexShrink: 0 }}>
          <Text sx={{ color: "#ef4444", fontSize: 12, fontFamily: MONO_FONT, flex: 1 }}>PTY Error: {initError}</Text>
          <Button onClick={() => { setInitError(null); if (activeTabId) { const c = containerRefs.current.get(activeTabId); if (c) { termInstances.current.delete(activeTabId); initTerminal(activeTabId, c); } } }} sx={{ bg: "#ef4444", color: "#fff", border: "none", fontSize: 11, px: 2, py: 1, borderRadius: 4, cursor: "pointer" }}>Retry</Button>
        </Flex>
      )}

      {/* Terminal containers */}
      <Flex sx={{ flex: 1, overflow: "hidden" }}>
        {/* Main pane */}
        <Box sx={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {tabs.map((tab) => (
            <Box key={tab.id} ref={(el: HTMLDivElement | null) => { if (el) containerRefs.current.set(tab.id, el); }} sx={{ position: "absolute", inset: 0, display: activeTabId === tab.id ? "block" : "none", "& .xterm": { height: "100%", padding: "8px" } }} />
          ))}
          {tabs.length === 0 && (
            <Flex sx={{ alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 2 }}>
              <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>No terminal tabs</Text>
              <Button onClick={createTab} sx={{ bg: "#22c55e", color: "#000", border: "none", fontSize: 12, px: 3, py: "5px", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>New Terminal</Button>
            </Flex>
          )}
        </Box>

        {/* Split pane */}
        {split && tabs.length >= 2 && (
          <Box sx={{ flex: 1, borderLeft: "1px solid var(--border)", overflow: "hidden", position: "relative" }}>
            {/* Show second tab or a selector */}
            <Flex sx={{ alignItems: "center", bg: "background-secondary", borderBottom: "1px solid var(--border)", px: 2, py: "3px" }}>
              <select value={splitActiveTabId || ""} onChange={(e) => setSplitActiveTabId(e.target.value)} style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--heading)", fontSize: 10, fontFamily: MONO_FONT, padding: "2px 6px" }}>
                <option value="">Select tab...</option>
                {tabs.filter((t) => t.id !== activeTabId).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Flex>
            <Box sx={{ flex: 1, position: "relative", height: "calc(100% - 28px)" }}>
              {splitActiveTabId && (
                <Box ref={(el: HTMLDivElement | null) => { if (el && splitActiveTabId) { const key = `split-${splitActiveTabId}`; containerRefs.current.set(key, el); } }} sx={{ position: "absolute", inset: 0, "& .xterm": { height: "100%", padding: "8px" } }} />
              )}
            </Box>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}

// ── Mock Terminal (non-Tauri fallback) ──

type TerminalLine = {
  id: number;
  type: "input" | "output" | "error" | "system" | "agent-name" | "tool-badge";
  content: string;
  color?: string;
};

let lineCounter = 0;

function createLine(type: TerminalLine["type"], content: string, color?: string): TerminalLine {
  return { id: ++lineCounter, type, content, color };
}

const WELCOME_LINES: TerminalLine[] = [
  createLine("system", "Workstation Terminal v2.0 — OpenClaw Integrated"),
  createLine("system", "Type 'help' for available commands."),
  createLine("system", "")
];

const HELP_TEXT = `Available commands:
  help              Show this help message
  clear             Clear the terminal
  echo <text>       Print text
  date              Show current date/time
  whoami            Show current user
  pwd               Show working directory
  ls                List workspace items
  agents            List active agents
  tasks             Show task summary
  history           Show command history
  env               Show environment info

OpenClaw commands:
  connect [url]     Connect to OpenClaw gateway
  disconnect        Disconnect from OpenClaw
  ask <prompt>      Send a message to the active agent
  agent <n> <msg>   Send a message to a specific agent
  status            Show OpenClaw connection status
  sessions          List OpenClaw sessions`;

function MockTerminal() {
  const [lines, setLines] = useState<TerminalLine[]>([...WELCOME_LINES]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const connectionState = useOpenClawStore((s) => s.connectionState);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const pendingAskRef = useRef(false);
  useEffect(() => {
    if (!pendingAskRef.current) return;
    const unsub = useChatStore.subscribe((state) => {
      const lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.role === "agent" && !lastMsg.isStreaming && pendingAskRef.current) {
        pendingAskRef.current = false;
        const newLines: TerminalLine[] = [];
        if (lastMsg.agentName) {
          newLines.push(createLine("agent-name", `[${lastMsg.agentName}]`, "#22c55e"));
        }
        if (lastMsg.toolCalls && lastMsg.toolCalls.length > 0) {
          for (const tc of lastMsg.toolCalls) {
            const color = TOOL_COLORS[tc.toolName] || "#8b949e";
            const statusLabel = tc.status === "complete" ? "done" : tc.status === "error" ? "err" : "...";
            newLines.push(createLine("tool-badge", `  [${tc.toolName}] ${statusLabel}`, color));
          }
        }
        if (lastMsg.content) {
          newLines.push(createLine("output", lastMsg.content));
        }
        setLines((prev) => [...prev, ...newLines]);
      }
    });
    return unsub;
  }, []);

  const executeCommand = useCallback(
    (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;
      const newLines: TerminalLine[] = [createLine("input", `$ ${trimmed}`)];
      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).join(" ");

      switch (command) {
        case "help":
          newLines.push(createLine("output", HELP_TEXT));
          break;
        case "clear":
          setLines([]);
          setInput("");
          setHistory((h) => [...h, trimmed]);
          setHistoryIndex(-1);
          return;
        case "echo":
          newLines.push(createLine("output", args || ""));
          break;
        case "date":
          newLines.push(createLine("output", new Date().toString()));
          break;
        case "whoami":
          newLines.push(createLine("output", "workstation-user"));
          break;
        case "pwd":
          newLines.push(createLine("output", "/workstation"));
          break;
        case "ls":
          newLines.push(createLine("output", "dashboard/  notes/  tasks/  calendar/  agent-chat/  agents/  spreadsheets/  communications/  files/"));
          break;
        case "agents":
          newLines.push(createLine("output", "Orchestrator  [idle]\nComms Agent   [idle]\nResearch      [idle]\nTaskMaster    [idle]\nCode Agent    [idle]"));
          break;
        case "tasks":
          newLines.push(createLine("output", "Task summary: Run 'tasks' from the Tasks view for live data."));
          break;
        case "history":
          if (history.length === 0) {
            newLines.push(createLine("output", "(no history)"));
          } else {
            newLines.push(createLine("output", history.map((h, i) => `  ${i + 1}  ${h}`).join("\n")));
          }
          break;
        case "env":
          newLines.push(createLine("output", `PLATFORM: ${navigator.platform}\nUSER_AGENT: ${navigator.userAgent}\nLANG: ${navigator.language}\nONLINE: ${navigator.onLine}`));
          break;
        case "connect": {
          const ocStore = useOpenClawStore.getState();
          if (ocStore.connectionState === "connected") {
            newLines.push(createLine("system", "Already connected to OpenClaw gateway."));
            break;
          }
          if (args) useOpenClawStore.getState().setGatewayUrl(args);
          newLines.push(createLine("system", `Connecting to ${args || ocStore.gatewayUrl}...`));
          setLines((prev) => [...prev, ...newLines]);
          setHistory((h) => [...h, trimmed]);
          setHistoryIndex(-1);
          setInput("");
          useOpenClawStore.getState().connect()
            .then(() => setLines((prev) => [...prev, createLine("system", "Connected to OpenClaw gateway.")]))
            .catch((err: Error) => setLines((prev) => [...prev, createLine("error", `Connection failed: ${err.message || "Unknown error"}`)]));
          return;
        }
        case "disconnect": {
          const ocStore = useOpenClawStore.getState();
          if (ocStore.connectionState === "disconnected") {
            newLines.push(createLine("system", "Not connected."));
            break;
          }
          useOpenClawStore.getState().disconnect();
          newLines.push(createLine("system", "Disconnected from OpenClaw gateway."));
          break;
        }
        case "ask": {
          if (!args) { newLines.push(createLine("error", "Usage: ask <prompt>")); break; }
          pendingAskRef.current = true;
          useChatStore.getState().sendMessage(args);
          newLines.push(createLine("system", "Sending to agent..."));
          break;
        }
        case "status": {
          const oc = useOpenClawStore.getState();
          newLines.push(createLine("output", [
            `Connection: ${oc.connectionState}`,
            `Gateway: ${oc.gatewayUrl}`,
            `Sessions: ${oc.sessions.length}`,
            `Active Session: ${oc.activeSessionId || "none"}`
          ].join("\n")));
          break;
        }
        default:
          newLines.push(createLine("error", `command not found: ${command}. Type 'help' for available commands.`));
      }

      setLines((prev) => [...prev, ...newLines]);
      setHistory((h) => [...h, trimmed]);
      setHistoryIndex(-1);
      setInput("");
    },
    [history]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") executeCommand(input);
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const idx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(idx);
        setInput(history[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex >= 0) {
        const idx = historyIndex + 1;
        if (idx >= history.length) { setHistoryIndex(-1); setInput(""); }
        else { setHistoryIndex(idx); setInput(history[idx]); }
      }
    } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); setLines([]); }
  };

  const lineColor = (line: TerminalLine) => {
    if (line.color) return line.color;
    switch (line.type) {
      case "input": return "#22c55e";
      case "output": return "heading";
      case "error": return "#ef4444";
      case "system": return "#60a5fa";
      default: return "paragraph-secondary";
    }
  };

  const connColor = connectionState === "connected" ? "#22c55e"
    : connectionState === "connecting" || connectionState === "authenticating" ? "#eab308"
    : connectionState === "error" ? "#ef4444" : "#8b949e";
  const connLabel = connectionState === "connected" ? "connected"
    : connectionState === "connecting" ? "connecting"
    : connectionState === "error" ? "error" : "offline";

  return (
    <Flex sx={{ flexDirection: "column", height: "100%", bg: "background", overflow: "hidden", fontFamily: MONO_FONT }} onClick={() => inputRef.current?.focus()}>
      <Flex sx={{ alignItems: "center", justifyContent: "space-between", px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>workstation — terminal</Text>
          <Flex sx={{ alignItems: "center", gap: "6px", ml: 2 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: "50%", bg: connColor, boxShadow: connectionState === "connected" ? `0 0 4px ${connColor}` : "none" }} />
            <Text sx={{ fontSize: 10, color: connColor }}>{connLabel}</Text>
          </Flex>
        </Flex>
        <Button onClick={(e) => { e.stopPropagation(); setLines([...WELCOME_LINES]); }} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer", "&:hover": { color: "heading", borderColor: "paragraph-secondary" } }}>
          Clear
        </Button>
      </Flex>

      <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto", px: 3, py: 2, "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "border", borderRadius: 3 } }}>
        {lines.map((line) => (
          <Text key={line.id} sx={{ fontSize: 13, lineHeight: 1.6, color: lineColor(line), whiteSpace: "pre-wrap", wordBreak: "break-all", display: "block", ...(line.type === "tool-badge" ? { fontWeight: "bold" } : {}) }}>
            {line.content}
          </Text>
        ))}
        <Flex sx={{ alignItems: "center", mt: 1 }}>
          <Text sx={{ fontSize: 13, color: "#22c55e", flexShrink: 0 }}>$ </Text>
          <Input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} spellCheck={false} autoComplete="off" sx={{ flex: 1, bg: "transparent", border: "none", outline: "none", color: "heading", fontSize: 13, fontFamily: "inherit", p: 0, m: 0, caretColor: "#22c55e", "&:focus": { outline: "none", boxShadow: "none" } }} />
        </Flex>
      </Box>
    </Flex>
  );
}

// ── Main Export ──

import { isDesktopRuntime } from "../utils/platform";

export default function TerminalView() {
  if (isDesktopRuntime()) return <PtyTerminal />;
  return <MockTerminal />;
}
