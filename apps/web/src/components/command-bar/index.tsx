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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Input, Text } from "@theme-ui/components";
import { navigate } from "../../navigation";
import { useStore as useChatStore } from "../../stores/chat-store";
import { useStore as useOpenClawStore } from "../../stores/openclaw-store";

declare const IS_TAURI: boolean | undefined;

// ── Command Types ──

type CommandCategory =
  | "recent"
  | "navigation"
  | "git"
  | "tasks"
  | "workspaces"
  | "files"
  | "action"
  | "agent"
  | "openclaw"
  | "ai";

type Command = {
  id: string;
  label: string;
  description: string;
  category: CommandCategory;
  icon: string;
  shortcut?: string;
  action: () => void;
};

type FileResult = {
  path: string;
  name: string;
  is_dir: boolean;
};

// ── Recent Commands (localStorage) ──

const RECENT_KEY = "workstation-recent-commands";
const MAX_RECENT = 10;

function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function saveRecentId(id: string) {
  const recent = getRecentIds().filter((r) => r !== id);
  recent.unshift(id);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

// ── Tauri Invoke Helper ──

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof IS_TAURI !== "undefined" && IS_TAURI) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  throw new Error("Not in Tauri");
}

// ── Command Definitions ──

function getCommands(): Command[] {
  const openclawState = useOpenClawStore.getState();
  const isConnected = openclawState.connectionState === "connected";
  const isTauri = typeof IS_TAURI !== "undefined" && IS_TAURI;

  const commands: Command[] = [
    // Navigation
    {
      id: "nav-dashboard",
      label: "Go to Dashboard",
      description: "Mission control overview",
      category: "navigation",
      icon: "D",
      action: () => navigate("/dashboard")
    },
    {
      id: "nav-notes",
      label: "Go to Notes",
      description: "All your notes",
      category: "navigation",
      icon: "N",
      action: () => navigate("/notes")
    },
    {
      id: "nav-tasks",
      label: "Go to Tasks",
      description: "Task management",
      category: "navigation",
      icon: "T",
      action: () => navigate("/tasks")
    },
    {
      id: "nav-calendar",
      label: "Go to Calendar",
      description: "Scheduling and events",
      category: "navigation",
      icon: "C",
      action: () => navigate("/calendar")
    },
    {
      id: "nav-agents",
      label: "Go to Agents",
      description: "Agent management and OpenClaw",
      category: "navigation",
      icon: "A",
      action: () => navigate("/agents")
    },
    {
      id: "nav-spreadsheets",
      label: "Go to Spreadsheets",
      description: "Data tables and analysis",
      category: "navigation",
      icon: "S",
      action: () => navigate("/spreadsheets")
    },
    {
      id: "nav-comms",
      label: "Go to Communications",
      description: "Unified inbox",
      category: "navigation",
      icon: "M",
      action: () => navigate("/communications")
    },
    {
      id: "nav-git",
      label: "Go to Git",
      description: "Source control and version history",
      category: "navigation",
      icon: "G",
      action: () => navigate("/git")
    },
    {
      id: "nav-files",
      label: "Go to Files",
      description: "File explorer",
      category: "navigation",
      icon: "E",
      shortcut: "Ctrl+E",
      action: () => navigate("/files")
    },
    {
      id: "nav-terminal",
      label: "Go to Terminal",
      description: "Terminal sessions",
      category: "navigation",
      icon: ">",
      shortcut: "Ctrl+`",
      action: () => navigate("/terminal")
    },
    {
      id: "nav-workspaces",
      label: "Go to Workspaces",
      description: "Agent workspaces and worktrees",
      category: "navigation",
      icon: "W",
      action: () => navigate("/workspaces")
    },
    {
      id: "nav-conversations",
      label: "Go to Conversations",
      description: "AI conversation history",
      category: "navigation",
      icon: "H",
      action: () => navigate("/conversations")
    },
    {
      id: "nav-favorites",
      label: "Go to Favorites",
      description: "Starred items",
      category: "navigation",
      icon: "F",
      action: () => navigate("/favorites")
    },
    {
      id: "nav-trash",
      label: "Go to Trash",
      description: "Deleted items",
      category: "navigation",
      icon: "X",
      action: () => navigate("/trash")
    },

    // Git commands
    {
      id: "git-switch-branch",
      label: "Git: Switch Branch",
      description: "Navigate to Git panel and switch branches",
      category: "git",
      icon: "B",
      action: () => navigate("/git")
    },
    {
      id: "git-pull",
      label: "Git: Pull",
      description: "Fetch and merge from upstream",
      category: "git",
      icon: "v",
      action: () => {
        if (isTauri) {
          tauriInvoke("git_pull", { path: "." }).catch(() => {});
        }
        navigate("/git");
      }
    },
    {
      id: "git-push",
      label: "Git: Push",
      description: "Push commits to remote",
      category: "git",
      icon: "^",
      action: () => {
        if (isTauri) {
          tauriInvoke("git_push", { path: ".", forceWithLease: false }).catch(() => {});
        }
        navigate("/git");
      }
    },
    {
      id: "git-stash",
      label: "Git: Stash Changes",
      description: "Save working changes to stash stack",
      category: "git",
      icon: "S",
      action: () => {
        if (isTauri) {
          tauriInvoke("git_stash_save", { path: "." }).catch(() => {});
        }
        navigate("/git");
      }
    },
    {
      id: "git-commit",
      label: "Git: Commit",
      description: "Navigate to Git panel to commit staged changes",
      category: "git",
      icon: "C",
      action: () => navigate("/git")
    },

    // Tasks commands
    {
      id: "task-create",
      label: "Task: Create New",
      description: "Create a new task",
      category: "tasks",
      icon: "+",
      action: () => navigate("/tasks")
    },
    {
      id: "task-view-blocked",
      label: "Task: View Blocked",
      description: "Show tasks blocked by dependencies",
      category: "tasks",
      icon: "B",
      action: () => navigate("/tasks")
    },
    {
      id: "task-view-review",
      label: "Task: In Review",
      description: "Show tasks pending review",
      category: "tasks",
      icon: "R",
      action: () => navigate("/tasks")
    },

    // Workspaces commands
    {
      id: "ws-create",
      label: "Workspace: Create",
      description: "Create a new agent workspace",
      category: "workspaces",
      icon: "+",
      action: () => navigate("/workspaces")
    },
    {
      id: "ws-list",
      label: "Workspace: List Active",
      description: "View all active workspaces",
      category: "workspaces",
      icon: "W",
      action: () => navigate("/workspaces")
    },

    // Files commands
    {
      id: "files-quick-open",
      label: "Files: Quick Open",
      description: "Fuzzy find and open a file",
      category: "files",
      icon: "P",
      shortcut: "Ctrl+P",
      action: () => navigate("/files")
    },
    {
      id: "files-search",
      label: "Files: Search in Project",
      description: "Search file contents across the project",
      category: "files",
      icon: "?",
      shortcut: "Ctrl+Shift+F",
      action: () => navigate("/files")
    },

    // Agent actions
    {
      id: "agent-chat-toggle",
      label: "Toggle Agent Chat",
      description: "Open or close the agent chat panel",
      category: "agent",
      icon: "J",
      shortcut: "Ctrl+J",
      action: () => useChatStore.getState().toggle()
    },
    {
      id: "agent-chat-open",
      label: "Open Agent Chat",
      description: "Open the chat panel and focus input",
      category: "agent",
      icon: "O",
      action: () => useChatStore.getState().open()
    },
    {
      id: "agent-chat-clear",
      label: "Clear Chat History",
      description: "Clear all chat messages",
      category: "agent",
      icon: "R",
      action: () => useChatStore.getState().clearChat()
    },

    // OpenClaw
    {
      id: "openclaw-connect",
      label: isConnected ? "Disconnect OpenClaw" : "Connect to OpenClaw",
      description: isConnected
        ? "Disconnect from the OpenClaw Gateway"
        : "Connect to the OpenClaw Gateway",
      category: "openclaw",
      icon: isConnected ? "X" : "C",
      action: () => {
        if (isConnected) {
          useOpenClawStore.getState().disconnect();
        } else {
          navigate("/agents");
        }
      }
    },
    {
      id: "openclaw-settings",
      label: "OpenClaw Settings",
      description: "Configure gateway URL and auth token",
      category: "openclaw",
      icon: "G",
      action: () => navigate("/agents")
    },

    // AI Actions
    {
      id: "ai-summarize-calls",
      label: "Summarize today's calls",
      description: "AI reviews all phone calls from today and creates a summary",
      category: "ai",
      icon: "*",
      action: () => {
        useChatStore.getState().open();
        useChatStore.getState().sendMessage("Summarize today's calls — list each caller, duration, sentiment, and key takeaways.");
      }
    },
    {
      id: "ai-draft-reply",
      label: "Draft a reply to latest email",
      description: "AI drafts a response to your most recent unread email",
      category: "ai",
      icon: "*",
      action: () => {
        useChatStore.getState().open();
        useChatStore.getState().sendMessage("Draft a reply to my most recent unread email. Match my preferred communication tone.");
      }
    },
    {
      id: "ai-book-appointment",
      label: "Book an appointment",
      description: "AI finds an available slot and creates a calendar event",
      category: "ai",
      icon: "*",
      action: () => {
        useChatStore.getState().open();
        useChatStore.getState().sendMessage("Find the next available 30-minute slot on my calendar and book an appointment.");
      }
    },
    {
      id: "ai-generate-newsletter",
      label: "Generate this week's newsletter",
      description: "AI creates a newsletter draft based on recent activity",
      category: "ai",
      icon: "*",
      action: () => {
        useChatStore.getState().open();
        useChatStore.getState().sendMessage("Generate a weekly newsletter draft summarizing key business updates, completed tasks, and upcoming events.");
      }
    },
    {
      id: "ai-show-overdue",
      label: "Show overdue tasks",
      description: "List all tasks past their due date",
      category: "ai",
      icon: "*",
      action: () => navigate("/tasks")
    },
    {
      id: "ai-risk-report",
      label: "Generate risk report",
      description: "AI analyzes current alerts and creates a risk assessment",
      category: "ai",
      icon: "*",
      action: () => {
        useChatStore.getState().open();
        useChatStore.getState().sendMessage("Analyze my current tasks, communications, and calendar for risks and opportunities. Provide a brief assessment.");
      }
    }
  ];

  return commands;
}

// ── Fuzzy Match ──

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ── Category Labels ──

const CATEGORY_LABELS: Record<string, string> = {
  recent: "Recent",
  navigation: "Navigation",
  git: "Git",
  tasks: "Tasks",
  workspaces: "Workspaces",
  files: "Files",
  action: "Actions",
  agent: "Agent",
  openclaw: "OpenClaw",
  ai: "Ask DeskAI"
};

// ── Category Priority (render order) ──

const CATEGORY_ORDER: CommandCategory[] = [
  "recent",
  "navigation",
  "git",
  "tasks",
  "workspaces",
  "files",
  "action",
  "agent",
  "openclaw",
  "ai"
];

// ── Command Bar Component ──

export function CommandBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [isFileMode, setIsFileMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Detect file search mode: query starts with ">"
  const fileQuery = query.startsWith(">") ? query.slice(1).trim() : "";
  const inFileMode = query.startsWith(">");

  // Get commands fresh each time the bar opens
  const commands = useMemo(() => (isOpen ? getCommands() : []), [isOpen]);

  // Build recent commands when no query
  const recentIds = useMemo(() => (isOpen ? getRecentIds() : []), [isOpen]);

  const filtered = useMemo(() => {
    if (inFileMode) return []; // File mode — commands hidden

    const base = !query.trim() ? commands : commands.filter(
      (cmd) =>
        fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.description)
    );

    // Inject recent category for no-query state
    if (!query.trim() && recentIds.length > 0) {
      const recentCmds: Command[] = [];
      for (const rid of recentIds) {
        const found = base.find((c) => c.id === rid);
        if (found) {
          recentCmds.push({ ...found, category: "recent" });
        }
      }
      return [...recentCmds, ...base];
    }

    return base;
  }, [commands, query, inFileMode, recentIds]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of filtered) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category].push(cmd);
    }
    // Sort by category order
    const ordered: [string, Command[]][] = [];
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]) ordered.push([cat, groups[cat]]);
    }
    return ordered;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    if (inFileMode) return []; // Keyboard nav uses fileResults in file mode
    return filtered;
  }, [filtered, inFileMode]);

  // File fuzzy search (debounced)
  useEffect(() => {
    if (!inFileMode || !fileQuery) {
      setFileResults([]);
      setIsFileMode(false);
      return;
    }
    setIsFileMode(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await tauriInvoke<FileResult[]>("fs_fuzzy_search", {
          path: ".",
          query: fileQuery,
          limit: 50
        });
        setFileResults(results);
        setSelectedIndex(0);
      } catch {
        // Not in Tauri or command failed — show empty
        setFileResults([]);
      }
    }, 150);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [inFileMode, fileQuery]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      saveRecentId(cmd.id);
      setIsOpen(false);
      setQuery("");
      setSelectedIndex(0);
      setFileResults([]);
      setTimeout(() => cmd.action(), 50);
    },
    []
  );

  const openFileResult = useCallback(
    (file: FileResult) => {
      setIsOpen(false);
      setQuery("");
      setSelectedIndex(0);
      setFileResults([]);
      setTimeout(() => navigate("/files"), 50);
    },
    []
  );

  // Global Ctrl+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => {
          if (!prev) {
            setQuery("");
            setSelectedIndex(0);
            setFileResults([]);
          }
          return !prev;
        });
      }
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
        setQuery("");
        setFileResults([]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    const listLen = isFileMode ? fileResults.length : flatList.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, listLen - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isFileMode) {
        const file = fileResults[selectedIndex];
        if (file) openFileResult(file);
      } else {
        const cmd = flatList[selectedIndex];
        if (cmd) {
          executeCommand(cmd);
        } else if (query.trim().length > 0) {
          const text = query.trim();
          setIsOpen(false);
          setQuery("");
          setSelectedIndex(0);
          setTimeout(() => {
            useChatStore.getState().open();
            useChatStore.getState().sendMessage(text);
          }, 50);
        }
      }
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <Box
        onClick={() => {
          setIsOpen(false);
          setQuery("");
          setFileResults([]);
        }}
        sx={{
          position: "fixed",
          inset: 0,
          bg: "rgba(0,0,0,0.3)",
          zIndex: 1000,
          backdropFilter: "blur(2px)"
        }}
      />

      {/* Command Palette */}
      <Flex
        sx={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 560,
          maxHeight: 460,
          flexDirection: "column",
          bg: "background",
          borderRadius: 12,
          border: "1px solid var(--border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
          zIndex: 1001,
          overflow: "hidden"
        }}
      >
        {/* Search Input */}
        <Flex
          sx={{
            alignItems: "center",
            px: 3,
            borderBottom: "1px solid var(--border)"
          }}
        >
          <Text sx={{ fontSize: 14, color: isFileMode ? "#22c55e" : "accent", mr: 2, fontFamily: "monospace" }}>
            {isFileMode ? ">" : "*"}
          </Text>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={isFileMode ? "Search files by name..." : "Ask DeskAI, type a command, or > to search files..."}
            sx={{
              flex: 1,
              fontSize: 14,
              border: "none",
              outline: "none",
              bg: "transparent",
              py: "12px",
              px: 0,
              "&:focus": { outline: "none" }
            }}
          />
          <Flex sx={{ gap: 1, alignItems: "center" }}>
            {!isFileMode && (
              <Text
                sx={{
                  fontSize: 9,
                  color: "paragraph-secondary",
                  bg: "background-secondary",
                  px: "4px",
                  py: "2px",
                  borderRadius: 3,
                  fontFamily: "monospace",
                  cursor: "pointer",
                  "&:hover": { color: "heading" }
                }}
                onClick={() => setQuery(">")}
                title="Switch to file search"
              >
                &gt; files
              </Text>
            )}
            <Text
              sx={{
                fontSize: 10,
                color: "paragraph-secondary",
                bg: "background-secondary",
                px: 1,
                py: "2px",
                borderRadius: 3,
                fontFamily: "monospace"
              }}
            >
              ESC
            </Text>
          </Flex>
        </Flex>

        {/* Results */}
        <Box ref={listRef} sx={{ overflow: "auto", maxHeight: 380 }}>
          {isFileMode ? (
            // ── File Search Results ──
            fileResults.length === 0 ? (
              <Flex
                sx={{
                  p: 4,
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
                  {fileQuery
                    ? "No files found"
                    : "Type a filename to search..."}
                </Text>
              </Flex>
            ) : (
              <>
                <Text
                  sx={{
                    fontSize: 10,
                    fontWeight: "bold",
                    color: "paragraph-secondary",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                    px: 3,
                    pt: 2,
                    pb: 1
                  }}
                >
                  Files ({fileResults.length})
                </Text>
                {fileResults.map((file, i) => {
                  const isSelected = i === selectedIndex;
                  return (
                    <Flex
                      key={file.path}
                      data-index={i}
                      onClick={() => openFileResult(file)}
                      onMouseEnter={() => setSelectedIndex(i)}
                      sx={{
                        alignItems: "center",
                        gap: 2,
                        px: 3,
                        py: "6px",
                        cursor: "pointer",
                        bg: isSelected ? "hover" : "transparent",
                        "&:hover": { bg: "hover" }
                      }}
                    >
                      <Text
                        sx={{
                          fontSize: 12,
                          fontFamily: "monospace",
                          color: file.is_dir ? "#60a5fa" : "#e0e0e0",
                          width: 16,
                          textAlign: "center"
                        }}
                      >
                        {file.is_dir ? "D" : "F"}
                      </Text>
                      <Flex
                        sx={{
                          flexDirection: "column",
                          flex: 1,
                          minWidth: 0
                        }}
                      >
                        <Text
                          sx={{
                            fontSize: 13,
                            color: "heading",
                            fontWeight: isSelected ? "bold" : "normal"
                          }}
                        >
                          {file.name}
                        </Text>
                        <Text
                          sx={{
                            fontSize: 10,
                            color: "paragraph-secondary",
                            fontFamily: "monospace",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}
                        >
                          {file.path}
                        </Text>
                      </Flex>
                    </Flex>
                  );
                })}
              </>
            )
          ) : flatList.length === 0 && query.trim().length > 0 ? (
            // ── No commands matched → AI fallback ──
            <Flex
              onClick={() => {
                const text = query.trim();
                setIsOpen(false);
                setQuery("");
                setTimeout(() => {
                  useChatStore.getState().open();
                  useChatStore.getState().sendMessage(text);
                }, 50);
              }}
              sx={{
                p: 3,
                alignItems: "center",
                gap: 2,
                cursor: "pointer",
                "&:hover": { bg: "hover" }
              }}
            >
              <Text sx={{ fontSize: 14, color: "accent", fontFamily: "monospace" }}>*</Text>
              <Flex sx={{ flexDirection: "column" }}>
                <Text sx={{ fontSize: 13, color: "heading" }}>
                  Ask DeskAI: &quot;{query.trim()}&quot;
                </Text>
                <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
                  Send this to the AI agent for a conversational response
                </Text>
              </Flex>
            </Flex>
          ) : flatList.length === 0 ? (
            <Flex
              sx={{
                p: 4,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
                No commands found
              </Text>
            </Flex>
          ) : (
            // ── Grouped Command Results ──
            grouped.map(([category, cmds]) => (
              <Box key={category}>
                <Text
                  sx={{
                    fontSize: 10,
                    fontWeight: "bold",
                    color: "paragraph-secondary",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                    px: 3,
                    pt: 2,
                    pb: 1
                  }}
                >
                  {CATEGORY_LABELS[category] || category}
                </Text>
                {cmds.map((cmd) => {
                  const globalIdx = flatList.indexOf(cmd);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <Flex
                      key={cmd.id + "-" + category}
                      data-index={globalIdx}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      sx={{
                        alignItems: "center",
                        gap: 2,
                        px: 3,
                        py: "8px",
                        cursor: "pointer",
                        bg: isSelected ? "hover" : "transparent",
                        "&:hover": { bg: "hover" }
                      }}
                    >
                      <Flex
                        sx={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          bg: "background-secondary",
                          border: "1px solid var(--border)",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0
                        }}
                      >
                        <Text
                          sx={{
                            fontSize: 11,
                            fontWeight: "bold",
                            color: "heading",
                            fontFamily: "monospace"
                          }}
                        >
                          {cmd.icon}
                        </Text>
                      </Flex>
                      <Flex
                        sx={{
                          flexDirection: "column",
                          flex: 1,
                          minWidth: 0
                        }}
                      >
                        <Text
                          sx={{
                            fontSize: 13,
                            color: "heading",
                            fontWeight: isSelected ? "bold" : "normal"
                          }}
                        >
                          {cmd.label}
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
                          {cmd.description}
                        </Text>
                      </Flex>
                      {cmd.shortcut && (
                        <Text
                          sx={{
                            fontSize: 10,
                            color: "paragraph-secondary",
                            bg: "background-secondary",
                            px: 1,
                            py: "2px",
                            borderRadius: 3,
                            fontFamily: "monospace",
                            flexShrink: 0
                          }}
                        >
                          {cmd.shortcut}
                        </Text>
                      )}
                    </Flex>
                  );
                })}
              </Box>
            ))
          )}
        </Box>
      </Flex>
    </>
  );
}
