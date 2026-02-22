/*
This file is part of the Workstation project.

Workspaces view — git worktrees with agent assignment, list/kanban views,
create modal, 3-tab preview (output, diff, task), agent controls, merge workflow.
Uses Electron tRPC backend when running in the desktop app.
*/

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, Text, Input, Button, Textarea } from "@theme-ui/components";
import { useStore as useAgentStore } from "../stores/agent-store";
import { useStore as useTaskStore } from "../stores/task-store";

declare const IS_DESKTOP_APP: boolean;

const MONO_FONT = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";

type Workspace = {
  name: string;
  path: string;
  branch: string;
  agent: string | null;
  status: string;
};

type WorkspaceStatus = {
  name: string;
  branch: string;
  changed_files: number;
  staged_files: number;
  ahead: number;
  behind: number;
  last_commit_message: string;
  last_commit_time: number;
};

type MergeInfo = {
  diff_summary: string;
  conflicts: string[];
  pr_url: string | null;
};

type GitDiffFile = { path: string; status: string; additions: number; deletions: number; patch: string | null };
type GitBranch = { name: string; is_head: boolean; upstream: string | null; ahead: number | null; behind: number | null };

const STATUS_COLORS: Record<string, { color: string; label: string }> = {
  active: { color: "#22c55e", label: "Active" },
  locked: { color: "#eab308", label: "Locked" },
  waiting: { color: "#eab308", label: "Waiting" },
  done: { color: "#60a5fa", label: "Done" },
  paused: { color: "#8b949e", label: "Paused" },
  error: { color: "#ef4444", label: "Error" },
  idle: { color: "#8b949e", label: "Idle" }
};

function WorkspacesReal() {
  const [repoPath, setRepoPath] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsStatuses, setWsStatuses] = useState<Record<string, WorkspaceStatus>>({});
  const [selectedWs, setSelectedWs] = useState<Workspace | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [previewTab, setPreviewTab] = useState<"output" | "diff" | "task">("output");

  // Create form state
  const [newName, setNewName] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newAgent, setNewAgent] = useState("");
  const [newTaskId, setNewTaskId] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [branches, setBranches] = useState<GitBranch[]>([]);

  // Preview state
  const [wsDiff, setWsDiff] = useState<GitDiffFile[]>([]);
  const [mergeInfo, setMergeInfo] = useState<MergeInfo | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);

  // Agent output stream (simulated)
  const [agentOutput, setAgentOutput] = useState<{ timestamp: number; type: string; content: string }[]>([]);

  const agents = useAgentStore((s) => s.agents);
  const tasks = useTaskStore((s) => s.tasks);

  useEffect(() => {
    (async () => {
      const { desktop } = await import("../common/desktop-bridge");
      const home = await desktop.filesystem.homeDir.query();
      setRepoPath(home);
    })().catch(console.error);
  }, []);

  const refresh = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const { desktop } = await import("../common/desktop-bridge");
      // Workspace router not yet implemented; use git.branches for branch list
      const brResult = await desktop.git.branches.query({ cwd: repoPath });
      const branchAll = (brResult as any).all || [];
      const currentBrName = (brResult as any).current || "";
      const branchEntries: GitBranch[] = branchAll.map((name: string) => ({
        name,
        is_head: name === currentBrName,
        upstream: null,
        ahead: null,
        behind: null
      }));
      setBranches(branchEntries);

      // TODO: Replace with desktop.workspaces.list.query({ repoPath })
      // when a workspaces tRPC router is implemented
      setWorkspaces([]);
      setWsStatuses({});
    } catch (e) {
      console.error("Workspace list error:", e);
      setWorkspaces([]);
    }
    setLoading(false);
  }, [repoPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = useCallback(async () => {
    if (!repoPath || !newName.trim()) return;
    try {
      // TODO: Replace with desktop.workspaces.create.mutate when workspaces tRPC router is implemented
      console.warn("Workspace creation not yet available via tRPC");
      if (newTaskId) {
        useTaskStore.getState().linkBranch(newTaskId, `workspace/${newName.trim()}`);
      }
      setNewName("");
      setNewBranch("");
      setNewAgent("");
      setNewTaskId("");
      setNewPrompt("");
      setShowCreate(false);
      refresh();
    } catch (e) {
      console.error("Workspace create error:", e);
    }
  }, [repoPath, newName, newBranch, newAgent, newTaskId, refresh]);

  const handleDelete = useCallback(async (name: string) => {
    if (!repoPath) return;
    try {
      // TODO: Replace with desktop.workspaces.delete.mutate when workspaces tRPC router is implemented
      console.warn("Workspace deletion not yet available via tRPC");
      if (selectedWs?.name === name) setSelectedWs(null);
      refresh();
    } catch (e) {
      console.error("Workspace delete error:", e);
    }
  }, [repoPath, refresh, selectedWs]);

  const handleAssignAgent = useCallback(async (wsName: string, agentId: string) => {
    if (!repoPath) return;
    try {
      // TODO: Replace with desktop.workspaces.assignAgent.mutate when workspaces tRPC router is implemented
      setWorkspaces((prev) => prev.map((ws) => ws.name === wsName ? { ...ws, agent: agentId } : ws));
    } catch (e) {
      console.error("Agent assign error:", e);
    }
  }, [repoPath]);

  const handleSelectWorkspace = useCallback(async (ws: Workspace) => {
    setSelectedWs(ws);
    setPreviewTab("output");
    // Load diff for workspace
    try {
      const { desktop } = await import("../common/desktop-bridge");
      const diffText = await desktop.git.diff.query({ cwd: ws.path });
      // Parse unified diff text into GitDiffFile entries
      const files: GitDiffFile[] = [];
      if (diffText) {
        const chunks = (diffText as string).split(/^diff --git /m).filter(Boolean);
        for (const chunk of chunks) {
          const pathMatch = chunk.match(/a\/(.+?) b\/(.+)/);
          const filePath = pathMatch ? pathMatch[2] : "unknown";
          let additions = 0, deletions = 0;
          for (const line of chunk.split("\n")) {
            if (line.startsWith("+") && !line.startsWith("+++")) additions++;
            else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
          }
          files.push({ path: filePath, status: "modified", additions, deletions, patch: "diff --git " + chunk });
        }
      }
      setWsDiff(files);
    } catch {
      setWsDiff([]);
    }
  }, []);

  const handleMerge = useCallback(async () => {
    if (!repoPath || !selectedWs) return;
    try {
      // TODO: Replace with desktop.workspaces.mergeInfo.query when workspaces tRPC router is implemented
      console.warn("Workspace merge info not yet available via tRPC");
    } catch (e) {
      console.error("Merge info error:", e);
    }
  }, [repoPath, selectedWs]);

  const executeMerge = useCallback(async () => {
    if (!repoPath || !selectedWs) return;
    try {
      // TODO: Replace with desktop.workspaces.delete.mutate when workspaces tRPC router is implemented
      console.warn("Workspace merge/delete not yet available via tRPC");
      setSelectedWs(null);
      setShowMerge(false);
      setMergeInfo(null);
      refresh();
    } catch (e) {
      console.error("Merge execute error:", e);
    }
  }, [repoPath, selectedWs, refresh]);

  // Group workspaces by status for kanban
  const kanbanGroups = useMemo(() => {
    const groups: Record<string, Workspace[]> = { active: [], waiting: [], done: [], paused: [], error: [] };
    for (const ws of workspaces) {
      const key = ws.status in groups ? ws.status : "active";
      groups[key].push(ws);
    }
    return groups;
  }, [workspaces]);

  const linkedTask = selectedWs?.agent
    ? tasks.find((t) => t.gitBranch?.includes(selectedWs.name))
    : null;

  function relativeTime(ts: number) {
    if (!ts) return "";
    const diff = (Date.now() / 1000) - ts;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  return (
    <Flex sx={{ flexDirection: "column", height: "100%", bg: "background", fontFamily: MONO_FONT, overflow: "hidden" }}>
      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between", px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>Workspaces</Text>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>({workspaces.length} worktrees)</Text>
        </Flex>
        <Flex sx={{ gap: 1 }}>
          <Button onClick={() => setViewMode(viewMode === "list" ? "kanban" : "list")} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer" }}>
            {viewMode === "list" ? "Kanban" : "List"}
          </Button>
          <Button onClick={() => setShowCreate(!showCreate)} sx={{ bg: "#22c55e", color: "#000", border: "none", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>+ New</Button>
          <Button onClick={refresh} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer" }}>Refresh</Button>
        </Flex>
      </Flex>

      {/* Create Modal */}
      {showCreate && (
        <Box sx={{ px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)" }}>
          <Flex sx={{ gap: 2, flexWrap: "wrap", mb: 2 }}>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Workspace name..." sx={{ flex: "1 1 200px", bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 12, fontFamily: MONO_FONT, px: 2, py: "5px", "&:focus": { outline: "none", borderColor: "#60a5fa" }, "&::placeholder": { color: "paragraph-secondary" } }} />
            <Box sx={{ flex: "1 1 200px", position: "relative" }}>
              <select value={newBranch} onChange={(e) => setNewBranch(e.target.value)} style={{ width: "100%", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--heading)", fontSize: 12, fontFamily: MONO_FONT, padding: "5px 8px" }}>
                <option value="">Base branch (default: HEAD)...</option>
                {branches.map((b) => <option key={b.name} value={b.name}>{b.name}{b.is_head ? " (HEAD)" : ""}</option>)}
              </select>
            </Box>
          </Flex>
          <Flex sx={{ gap: 2, flexWrap: "wrap", mb: 2 }}>
            <Box sx={{ flex: "1 1 200px" }}>
              <select value={newAgent} onChange={(e) => setNewAgent(e.target.value)} style={{ width: "100%", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--heading)", fontSize: 12, fontFamily: MONO_FONT, padding: "5px 8px" }}>
                <option value="">Assign agent (optional)...</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
              </select>
            </Box>
            <Box sx={{ flex: "1 1 200px" }}>
              <select value={newTaskId} onChange={(e) => setNewTaskId(e.target.value)} style={{ width: "100%", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--heading)", fontSize: 12, fontFamily: MONO_FONT, padding: "5px 8px" }}>
                <option value="">Link task (optional)...</option>
                {tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Box>
          </Flex>
          <Textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="Agent prompt template (use {{taskTitle}}, {{taskBody}})..." rows={2} sx={{ width: "100%", bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 11, fontFamily: MONO_FONT, px: 2, py: "4px", resize: "vertical", mb: 2, "&:focus": { outline: "none", borderColor: "#60a5fa" }, "&::placeholder": { color: "paragraph-secondary" } }} />
          <Flex sx={{ gap: 2, justifyContent: "flex-end" }}>
            <Button onClick={() => setShowCreate(false)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 3, py: "5px", borderRadius: 4, cursor: "pointer" }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()} sx={{ bg: "#22c55e", color: "#000", border: "none", fontSize: 11, px: 3, py: "5px", borderRadius: 4, cursor: "pointer", fontWeight: "bold", opacity: newName.trim() ? 1 : 0.5 }}>Create Workspace</Button>
          </Flex>
        </Box>
      )}

      {/* Content */}
      <Flex sx={{ flex: 1, overflow: "hidden" }}>
        {/* Left: workspace list/kanban */}
        <Box sx={{ width: selectedWs ? "45%" : "100%", overflow: "auto", borderRight: selectedWs ? "1px solid var(--border)" : "none", p: 3, "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
          {loading && <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>Loading...</Text>}
          {workspaces.length === 0 && !loading && (
            <Flex sx={{ flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 2 }}>
              <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>No git worktrees found</Text>
              <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>Create a workspace to start parallel development with agents.</Text>
            </Flex>
          )}

          {viewMode === "list" ? (
            <Flex sx={{ flexDirection: "column", gap: 2 }}>
              {workspaces.map((ws) => {
                const sc = STATUS_COLORS[ws.status] || STATUS_COLORS.idle;
                const wsSt = wsStatuses[ws.name];
                const isSelected = selectedWs?.name === ws.name;
                return (
                  <Box key={ws.name} onClick={() => handleSelectWorkspace(ws)} sx={{ bg: isSelected ? "background-selected" : "background-secondary", border: `1px solid ${isSelected ? "#60a5fa" : "var(--border)"}`, borderRadius: 8, p: 3, cursor: "pointer", "&:hover": { borderColor: "#60a5fa" } }}>
                    <Flex sx={{ alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                      <Flex sx={{ alignItems: "center", gap: 2 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bg: sc.color, boxShadow: `0 0 4px ${sc.color}` }} />
                        <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>{ws.name}</Text>
                      </Flex>
                      <Button onClick={(e) => { e.stopPropagation(); handleDelete(ws.name); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", cursor: "pointer", fontSize: 12, p: 0, "&:hover": { color: "#ef4444" } }}>x</Button>
                    </Flex>
                    <Flex sx={{ alignItems: "center", gap: 2, mb: 1, flexWrap: "wrap" }}>
                      <Text sx={{ fontSize: 11, color: "#60a5fa", bg: "#60a5fa22", px: "6px", py: "2px", borderRadius: 8 }}>{ws.branch}</Text>
                      {wsSt && wsSt.ahead > 0 && <Text sx={{ fontSize: 10, color: "#22c55e" }}>&#8593;{wsSt.ahead}</Text>}
                      {wsSt && wsSt.behind > 0 && <Text sx={{ fontSize: 10, color: "#ef4444" }}>&#8595;{wsSt.behind}</Text>}
                      {wsSt && wsSt.changed_files > 0 && <Text sx={{ fontSize: 10, color: "#eab308" }}>{wsSt.changed_files} changed</Text>}
                      {wsSt && wsSt.staged_files > 0 && <Text sx={{ fontSize: 10, color: "#22c55e" }}>{wsSt.staged_files} staged</Text>}
                      <Text sx={{ fontSize: 10, color: sc.color }}>{sc.label}</Text>
                    </Flex>
                    {ws.agent && (
                      <Text sx={{ fontSize: 10, color: "#a78bfa" }}>
                        Agent: {agents.find((a) => a.id === ws.agent)?.name || ws.agent}
                      </Text>
                    )}
                    {wsSt?.last_commit_message && (
                      <Text sx={{ fontSize: 10, color: "paragraph-secondary", mt: 1, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Last: {wsSt.last_commit_message.split("\n")[0]} · {relativeTime(wsSt.last_commit_time)}
                      </Text>
                    )}
                  </Box>
                );
              })}
            </Flex>
          ) : (
            /* Kanban view */
            <Flex sx={{ gap: 2, overflow: "auto" }}>
              {Object.entries(kanbanGroups).map(([status, wsList]) => {
                const sc = STATUS_COLORS[status] || STATUS_COLORS.idle;
                return (
                  <Box key={status} sx={{ minWidth: 200, flex: "1 0 200px" }}>
                    <Flex sx={{ alignItems: "center", gap: 1, mb: 2 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: "50%", bg: sc.color }} />
                      <Text sx={{ fontSize: 11, fontWeight: "bold", color: "heading", textTransform: "capitalize" }}>{sc.label}</Text>
                      <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>({wsList.length})</Text>
                    </Flex>
                    {wsList.map((ws) => (
                      <Box key={ws.name} onClick={() => handleSelectWorkspace(ws)} sx={{ bg: "background-secondary", border: "1px solid var(--border)", borderRadius: 6, p: 2, mb: 1, cursor: "pointer", "&:hover": { borderColor: "#60a5fa" } }}>
                        <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading", mb: 1, display: "block" }}>{ws.name}</Text>
                        <Text sx={{ fontSize: 10, color: "#60a5fa" }}>{ws.branch}</Text>
                      </Box>
                    ))}
                  </Box>
                );
              })}
            </Flex>
          )}
        </Box>

        {/* Right: 3-tab preview */}
        {selectedWs && (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Preview header */}
            <Flex sx={{ px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <Flex sx={{ alignItems: "center", gap: 2 }}>
                <Text sx={{ fontSize: 13, fontWeight: "bold", color: "heading" }}>{selectedWs.name}</Text>
                <Text sx={{ fontSize: 10, color: "#60a5fa" }}>{selectedWs.branch}</Text>
              </Flex>
              <Flex sx={{ gap: 1 }}>
                <Button onClick={handleMerge} sx={{ bg: "transparent", border: "1px solid #22c55e", color: "#22c55e", fontSize: 10, px: 2, py: "2px", borderRadius: 4, cursor: "pointer", "&:hover": { bg: "#22c55e22" } }}>Merge</Button>
                {/* Agent assign */}
                <Box sx={{ position: "relative" }}>
                  <select value={selectedWs.agent || ""} onChange={(e) => handleAssignAgent(selectedWs.name, e.target.value)} style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--heading)", fontSize: 10, fontFamily: MONO_FONT, padding: "2px 6px" }}>
                    <option value="">No agent</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Box>
                <Button onClick={() => setSelectedWs(null)} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", cursor: "pointer", p: 0, "&:hover": { color: "heading" } }}>x</Button>
              </Flex>
            </Flex>

            {/* Preview tabs */}
            <Flex sx={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              {(["output", "diff", "task"] as const).map((tab) => (
                <Button key={tab} onClick={() => setPreviewTab(tab)} sx={{ bg: previewTab === tab ? "hover" : "transparent", color: previewTab === tab ? "heading" : "paragraph-secondary", border: "none", borderBottom: previewTab === tab ? "2px solid #60a5fa" : "2px solid transparent", px: 3, py: "6px", fontSize: 11, cursor: "pointer", textTransform: "capitalize" }}>
                  {tab}
                </Button>
              ))}
            </Flex>

            {/* Preview content */}
            <Box sx={{ flex: 1, overflow: "auto", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
              {previewTab === "output" && (
                <Box sx={{ p: 2, bg: "#000", minHeight: "100%", fontFamily: MONO_FONT }}>
                  {agentOutput.length === 0 ? (
                    <Flex sx={{ alignItems: "center", justifyContent: "center", height: 200, flexDirection: "column", gap: 2 }}>
                      <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>No agent output yet</Text>
                      <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>Start an agent to see real-time output here</Text>
                    </Flex>
                  ) : (
                    agentOutput.map((line, i) => {
                      const color = line.type === "stderr" ? "#ef4444" : line.type === "tool" ? "#a78bfa" : line.type === "thinking" ? "paragraph-secondary" : line.type === "result" ? "#22c55e" : "heading";
                      return (
                        <Text key={i} sx={{ fontSize: 11, color, display: "block", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                          <Text as="span" sx={{ color: "paragraph-secondary", fontSize: 9, mr: 1 }}>{new Date(line.timestamp).toLocaleTimeString()}</Text>
                          {line.content}
                        </Text>
                      );
                    })
                  )}
                </Box>
              )}

              {previewTab === "diff" && (
                <Box>
                  <Flex sx={{ px: 3, py: 1, bg: "background-secondary", borderBottom: "1px solid var(--border)", alignItems: "center", justifyContent: "space-between" }}>
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{wsDiff.length} files changed</Text>
                    <Button onClick={() => setSideBySide(!sideBySide)} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0 }}>
                      {sideBySide ? "Unified" : "Side-by-side"}
                    </Button>
                  </Flex>
                  {wsDiff.length === 0 && (
                    <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary" }}>No changes in workspace</Text>
                  )}
                  {wsDiff.map((file) => (
                    <Box key={file.path} sx={{ borderBottom: "1px solid var(--border)" }}>
                      <Flex sx={{ px: 3, py: "5px", bg: "background-secondary", alignItems: "center", gap: 2 }}>
                        <Text sx={{ fontSize: 11, color: "heading", flex: 1 }}>{file.path}</Text>
                        <Text sx={{ fontSize: 10, color: "#22c55e" }}>+{file.additions}</Text>
                        <Text sx={{ fontSize: 10, color: "#ef4444" }}>-{file.deletions}</Text>
                      </Flex>
                      {file.patch && (
                        <Box sx={{ fontSize: 11, fontFamily: MONO_FONT }}>
                          {file.patch.split("\n").map((line, i) => {
                            let color: string = "heading";
                            let bg = "transparent";
                            if (line.startsWith("+") && !line.startsWith("+++")) { color = "#22c55e"; bg = "rgba(34,197,94,0.08)"; }
                            else if (line.startsWith("-") && !line.startsWith("---")) { color = "#ef4444"; bg = "rgba(239,68,68,0.08)"; }
                            else if (line.startsWith("@@")) { color = "#a78bfa"; }
                            return <Text key={i} sx={{ color, bg, display: "block", px: 2, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{line}</Text>;
                          })}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {previewTab === "task" && (
                <Box sx={{ p: 3 }}>
                  {linkedTask ? (
                    <>
                      <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading", mb: 2, display: "block" }}>{linkedTask.title}</Text>
                      <Text sx={{ fontSize: 12, color: "paragraph-secondary", mb: 2, display: "block" }}>{linkedTask.description}</Text>
                      {linkedTask.contextHandoff && (
                        <Box sx={{ mb: 2 }}>
                          <Text sx={{ fontSize: 11, fontWeight: "bold", color: "heading", mb: 1, display: "block" }}>Context Handoff</Text>
                          {linkedTask.contextHandoff.done.length > 0 && (
                            <Box sx={{ mb: 1 }}>
                              <Text sx={{ fontSize: 10, color: "#22c55e", fontWeight: "bold" }}>Done:</Text>
                              {linkedTask.contextHandoff.done.map((item, i) => (
                                <Text key={i} sx={{ fontSize: 11, color: "heading", pl: 2, display: "block" }}>- {item}</Text>
                              ))}
                            </Box>
                          )}
                          {linkedTask.contextHandoff.remaining.length > 0 && (
                            <Box sx={{ mb: 1 }}>
                              <Text sx={{ fontSize: 10, color: "#eab308", fontWeight: "bold" }}>Remaining:</Text>
                              {linkedTask.contextHandoff.remaining.map((item, i) => (
                                <Text key={i} sx={{ fontSize: 11, color: "heading", pl: 2, display: "block" }}>- {item}</Text>
                              ))}
                            </Box>
                          )}
                          {linkedTask.contextHandoff.decisions.length > 0 && (
                            <Box sx={{ mb: 1 }}>
                              <Text sx={{ fontSize: 10, color: "#60a5fa", fontWeight: "bold" }}>Decisions:</Text>
                              {linkedTask.contextHandoff.decisions.map((item, i) => (
                                <Text key={i} sx={{ fontSize: 11, color: "heading", pl: 2, display: "block" }}>- {item}</Text>
                              ))}
                            </Box>
                          )}
                          {linkedTask.contextHandoff.uncertainties.length > 0 && (
                            <Box>
                              <Text sx={{ fontSize: 10, color: "#ef4444", fontWeight: "bold" }}>Uncertainties:</Text>
                              {linkedTask.contextHandoff.uncertainties.map((item, i) => (
                                <Text key={i} sx={{ fontSize: 11, color: "heading", pl: 2, display: "block" }}>- {item}</Text>
                              ))}
                            </Box>
                          )}
                        </Box>
                      )}
                      {linkedTask.activityLog.length > 0 && (
                        <Box>
                          <Text sx={{ fontSize: 11, fontWeight: "bold", color: "heading", mb: 1, display: "block" }}>Activity</Text>
                          {linkedTask.activityLog.slice(-10).map((entry) => (
                            <Flex key={entry.id} sx={{ gap: 1, mb: 1, fontSize: 10, color: "paragraph-secondary" }}>
                              <Text sx={{ color: "paragraph-secondary" }}>{new Date(entry.timestamp).toLocaleTimeString()}</Text>
                              <Text sx={{ color: "heading" }}>{entry.content}</Text>
                            </Flex>
                          ))}
                        </Box>
                      )}
                    </>
                  ) : (
                    <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>No task linked to this workspace</Text>
                  )}
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Flex>

      {/* Merge confirmation modal */}
      {showMerge && mergeInfo && (
        <Box sx={{ position: "fixed", inset: 0, bg: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowMerge(false)}>
          <Box onClick={(e) => e.stopPropagation()} sx={{ bg: "background-secondary", border: "1px solid var(--border)", borderRadius: 8, p: 4, maxWidth: 500, width: "90%" }}>
            <Text sx={{ fontSize: 14, color: "heading", fontWeight: "bold", mb: 2, display: "block" }}>Merge Workspace</Text>
            <Text sx={{ fontSize: 12, color: "paragraph-secondary", mb: 2, display: "block" }}>{mergeInfo.diff_summary}</Text>
            {mergeInfo.conflicts.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Text sx={{ fontSize: 11, color: "#ef4444", fontWeight: "bold", mb: 1, display: "block" }}>Conflicts ({mergeInfo.conflicts.length}):</Text>
                {mergeInfo.conflicts.map((c) => (
                  <Text key={c} sx={{ fontSize: 11, color: "#ef4444", pl: 2, display: "block" }}>{c}</Text>
                ))}
              </Box>
            )}
            <Flex sx={{ gap: 2, justifyContent: "flex-end" }}>
              <Button onClick={() => setShowMerge(false)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 12, px: 3, py: "5px", borderRadius: 6, cursor: "pointer" }}>Cancel</Button>
              <Button onClick={executeMerge} disabled={mergeInfo.conflicts.length > 0} sx={{ bg: "#22c55e", color: "#000", border: "none", fontSize: 12, px: 3, py: "5px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", opacity: mergeInfo.conflicts.length > 0 ? 0.5 : 1 }}>
                Merge &amp; Cleanup
              </Button>
            </Flex>
          </Box>
        </Box>
      )}
    </Flex>
  );
}

function WorkspacesPlaceholder() {
  return (
    <Flex sx={{ height: "100%", alignItems: "center", justifyContent: "center", bg: "background" }}>
      <Box sx={{ textAlign: "center" }}>
        <Text sx={{ fontSize: 48, display: "block", mb: 3 }}>Workspaces</Text>
        <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>Git worktree management requires the desktop app.</Text>
      </Box>
    </Flex>
  );
}

export default function WorkspacesView() {
  if (IS_DESKTOP_APP) return <WorkspacesReal />;
  return <WorkspacesPlaceholder />;
}
