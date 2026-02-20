/*
This file is part of the Workstation project.

Git Panel — split-pane view with three tabs: Changes, History, Stashes.
Branch management, remote ops, diff viewer, auto-refresh via fs-watch.
Uses Electron tRPC git/filesystem routers. Falls back to a placeholder in web mode.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Text, Button, Textarea, Input } from "@theme-ui/components";

declare const IS_DESKTOP_APP: boolean;

const MONO_FONT = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";

type GitStatusEntry = { path: string; status: string; staged: boolean };
type GitLogEntry = { id: string; short_id: string; message: string; author: string; email: string; time: number; time_formatted: string };
type GitDiffFile = { path: string; status: string; additions: number; deletions: number; patch: string | null };
type GitBranch = { name: string; is_head: boolean; upstream: string | null; ahead: number | null; behind: number | null };
type GitStashEntry = { index: number; message: string; time: number };
type GitCommitDetail = { id: string; message: string; author: string; email: string; time: number; files: GitDiffFile[] };

const STATUS_COLORS: Record<string, string> = {
  new: "#22c55e",
  modified: "#eab308",
  deleted: "#ef4444",
  renamed: "#60a5fa",
  conflicted: "#a78bfa"
};

const STATUS_BADGES: Record<string, string> = {
  new: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  conflicted: "C",
  unknown: "?"
};

// ── Diff text parser (converts unified diff string to GitDiffFile[]) ──

function parseDiffText(diffText: string, targetPath?: string): GitDiffFile[] {
  if (!diffText) return [];
  const files: GitDiffFile[] = [];
  const chunks = diffText.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const pathMatch = chunk.match(/a\/(.+?) b\/(.+)/);
    const filePath = pathMatch ? pathMatch[2] : "unknown";
    if (targetPath && filePath !== targetPath) continue;

    let additions = 0;
    let deletions = 0;
    const lines = chunk.split("\n");
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({
      path: filePath,
      status: "modified",
      additions,
      deletions,
      patch: "diff --git " + chunk
    });
  }
  return files;
}

// ── Diff Renderer ──

function DiffViewer({ patch, sideBySide }: { patch: string; sideBySide: boolean }) {
  const lines = patch.split("\n");

  if (!sideBySide) {
    // Unified view
    let oldLine = 0;
    let newLine = 0;
    return (
      <Box sx={{ fontSize: 12, fontFamily: MONO_FONT, lineHeight: 1.6 }}>
        {lines.map((line, i) => {
          let color: string = "heading";
          let bg = "transparent";
          let leftGutter = "";
          let rightGutter = "";

          if (line.startsWith("@@")) {
            color = "#a78bfa";
            const match = line.match(/@@ -(\d+)/);
            if (match) {
              oldLine = parseInt(match[1]) - 1;
              const match2 = line.match(/\+(\d+)/);
              if (match2) newLine = parseInt(match2[1]) - 1;
            }
            leftGutter = "...";
            rightGutter = "...";
          } else if (line.startsWith("+") && !line.startsWith("+++")) {
            newLine++;
            color = "#22c55e";
            bg = "rgba(34,197,94,0.08)";
            rightGutter = String(newLine);
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            oldLine++;
            color = "#ef4444";
            bg = "rgba(239,68,68,0.08)";
            leftGutter = String(oldLine);
          } else if (!line.startsWith("diff") && !line.startsWith("index") && !line.startsWith("---") && !line.startsWith("+++")) {
            oldLine++;
            newLine++;
            leftGutter = String(oldLine);
            rightGutter = String(newLine);
          }

          return (
            <Flex key={i} sx={{ bg, "&:hover": { bg: "hover" } }}>
              <Text sx={{ width: 40, textAlign: "right", pr: 1, color: "paragraph-secondary", fontSize: 11, userSelect: "none", flexShrink: 0 }}>{leftGutter}</Text>
              <Text sx={{ width: 40, textAlign: "right", pr: 2, color: "paragraph-secondary", fontSize: 11, userSelect: "none", flexShrink: 0, borderRight: "1px solid var(--border)" }}>{rightGutter}</Text>
              <Text sx={{ color, pl: 2, whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1 }}>{line}</Text>
            </Flex>
          );
        })}
      </Box>
    );
  }

  // Side-by-side view
  type DiffLine = { old: string; new: string; oldNum: string; newNum: string; type: "context" | "add" | "del" | "hunk" | "header" };
  const diffLines: DiffLine[] = [];
  let oLine = 0, nLine = 0;
  const adds: string[] = [];
  const dels: string[] = [];

  function flushPending() {
    const max = Math.max(adds.length, dels.length);
    for (let j = 0; j < max; j++) {
      diffLines.push({
        old: j < dels.length ? dels[j] : "",
        new: j < adds.length ? adds[j] : "",
        oldNum: j < dels.length ? String(oLine - dels.length + j + 1) : "",
        newNum: j < adds.length ? String(nLine - adds.length + j + 1) : "",
        type: j < dels.length && j < adds.length ? "del" : j < dels.length ? "del" : "add"
      });
    }
    adds.length = 0;
    dels.length = 0;
  }

  for (const line of lines) {
    if (line.startsWith("@@")) {
      flushPending();
      const match = line.match(/@@ -(\d+)/);
      if (match) oLine = parseInt(match[1]) - 1;
      const match2 = line.match(/\+(\d+)/);
      if (match2) nLine = parseInt(match2[1]) - 1;
      diffLines.push({ old: line, new: "", oldNum: "...", newNum: "...", type: "hunk" });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      nLine++;
      adds.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      oLine++;
      dels.push(line.slice(1));
    } else if (line.startsWith("diff") || line.startsWith("index") || line.startsWith("---") || line.startsWith("+++")) {
      flushPending();
      diffLines.push({ old: line, new: "", oldNum: "", newNum: "", type: "header" });
    } else {
      flushPending();
      oLine++;
      nLine++;
      diffLines.push({ old: line, new: line, oldNum: String(oLine), newNum: String(nLine), type: "context" });
    }
  }
  flushPending();

  return (
    <Flex sx={{ fontSize: 12, fontFamily: MONO_FONT, lineHeight: 1.6 }}>
      {/* Old side */}
      <Box sx={{ flex: 1, borderRight: "1px solid var(--border)" }}>
        {diffLines.map((d, i) => (
          <Flex key={i} sx={{ bg: d.type === "del" ? "rgba(239,68,68,0.08)" : "transparent" }}>
            <Text sx={{ width: 40, textAlign: "right", pr: 2, color: "paragraph-secondary", fontSize: 11, userSelect: "none", flexShrink: 0 }}>{d.oldNum}</Text>
            <Text sx={{ color: d.type === "del" ? "#ef4444" : d.type === "hunk" ? "#a78bfa" : "heading", pl: 1, whiteSpace: "pre-wrap", flex: 1 }}>{d.old}</Text>
          </Flex>
        ))}
      </Box>
      {/* New side */}
      <Box sx={{ flex: 1 }}>
        {diffLines.map((d, i) => (
          <Flex key={i} sx={{ bg: d.type === "add" ? "rgba(34,197,94,0.08)" : "transparent" }}>
            <Text sx={{ width: 40, textAlign: "right", pr: 2, color: "paragraph-secondary", fontSize: 11, userSelect: "none", flexShrink: 0 }}>{d.newNum}</Text>
            <Text sx={{ color: d.type === "add" ? "#22c55e" : d.type === "hunk" ? "#a78bfa" : "heading", pl: 1, whiteSpace: "pre-wrap", flex: 1 }}>{d.new}</Text>
          </Flex>
        ))}
      </Box>
    </Flex>
  );
}

// ── Main Git Panel ──

function GitPanelReal() {
  const [repoPath, setRepoPath] = useState("");
  const [statusEntries, setStatusEntries] = useState<GitStatusEntry[]>([]);
  const [logEntries, setLogEntries] = useState<GitLogEntry[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitDiffFile | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<GitCommitDetail | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [activeTab, setActiveTab] = useState<"changes" | "history" | "stashes">("changes");
  const [loading, setLoading] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyLimit, setHistoryLimit] = useState(50);
  const [stashMessage, setStashMessage] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-detect repo
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
      const [statusResult, logResult, brResult] = await Promise.all([
        desktop.git.status.query({ cwd: repoPath }),
        desktop.git.log.query({ cwd: repoPath, maxCount: historyLimit }),
        desktop.git.branches.query({ cwd: repoPath })
      ]);

      // Map simple-git StatusResult to our GitStatusEntry[]
      const entries: GitStatusEntry[] = [];
      for (const f of (statusResult as any).staged || []) {
        entries.push({ path: f, status: "modified", staged: true });
      }
      for (const f of (statusResult as any).created || []) {
        entries.push({ path: f, status: "new", staged: true });
      }
      for (const f of (statusResult as any).deleted || []) {
        entries.push({ path: f, status: "deleted", staged: true });
      }
      for (const f of (statusResult as any).renamed || []) {
        entries.push({ path: typeof f === "object" ? f.to : f, status: "renamed", staged: true });
      }
      for (const f of (statusResult as any).modified || []) {
        if (!entries.some((e) => e.path === f && e.staged)) {
          entries.push({ path: f, status: "modified", staged: false });
        }
      }
      for (const f of (statusResult as any).not_added || []) {
        entries.push({ path: f, status: "new", staged: false });
      }
      for (const f of (statusResult as any).conflicted || []) {
        entries.push({ path: f, status: "conflicted", staged: false });
      }
      setStatusEntries(entries);

      // Map simple-git LogResult to our GitLogEntry[]
      const logAll = (logResult as any).all || [];
      const logEntries: GitLogEntry[] = logAll.map((entry: any) => ({
        id: entry.hash,
        short_id: entry.hash?.slice(0, 7) || "",
        message: entry.message || "",
        author: entry.author_name || "",
        email: entry.author_email || "",
        time: entry.date ? Math.floor(new Date(entry.date).getTime() / 1000) : 0,
        time_formatted: entry.date || ""
      }));
      setLogEntries(logEntries);

      // Map simple-git BranchSummary to our GitBranch[]
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

      // Stash not available in simple-git tRPC router, set empty
      setStashes([]);
    } catch (e) {
      console.error("Git refresh error:", e);
    }
    setLoading(false);
  }, [repoPath, historyLimit]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh via filesystem watch on .git dir
  useEffect(() => {
    if (!repoPath || !autoRefresh) return;
    let subscription: { unsubscribe: () => void } | undefined;

    (async () => {
      try {
        const { desktop } = await import("../common/desktop-bridge");
        const gitDir = repoPath.replace(/\\/g, "/") + "/.git";
        subscription = desktop.filesystem.watch.subscribe(
          { path: gitDir },
          {
            onData() {
              if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
              refreshTimerRef.current = setTimeout(refresh, 500);
            }
          }
        );
      } catch {
        // fs-watch not available
      }
    })();

    return () => { subscription?.unsubscribe(); };
  }, [repoPath, autoRefresh, refresh]);

  // ── Handlers ──

  const handleFileClick = useCallback(async (entry: GitStatusEntry) => {
    if (!repoPath) return;
    setSelectedCommit(null);
    try {
      const { desktop } = await import("../common/desktop-bridge");
      const diffText = await desktop.git.diff.query({ cwd: repoPath, staged: entry.staged });
      // Parse the unified diff text into GitDiffFile entries
      const diffs = parseDiffText(diffText as string, entry.path);
      const match = diffs.find((d) => d.path === entry.path);
      setSelectedFile(match || null);
    } catch (e) {
      console.error("Diff error:", e);
    }
  }, [repoPath]);

  const handleStage = useCallback(async (files: string[]) => {
    if (!repoPath) return;
    const { desktop } = await import("../common/desktop-bridge");
    await desktop.git.add.mutate({ cwd: repoPath, files });
    refresh();
  }, [repoPath, refresh]);

  const handleUnstage = useCallback(async (files: string[]) => {
    if (!repoPath) return;
    // simple-git reset to unstage: use checkout to restore index
    // The git router doesn't have a dedicated unstage, so we refresh after add
    // TODO: Add an unstage endpoint to the git tRPC router
    console.warn("Unstage not yet available via tRPC — refresh to see current state");
    refresh();
  }, [repoPath, refresh]);

  const handleCommit = useCallback(async () => {
    if (!repoPath || !commitMsg.trim()) return;
    const { desktop } = await import("../common/desktop-bridge");
    await desktop.git.commit.mutate({ cwd: repoPath, message: commitMsg });
    setCommitMsg("");
    refresh();
  }, [repoPath, commitMsg, refresh]);

  const handleDiscard = useCallback(async (filePath: string) => {
    if (!repoPath) return;
    // Discard via checkout: use checkout to restore the file
    const { desktop } = await import("../common/desktop-bridge");
    await desktop.git.checkout.mutate({ cwd: repoPath, branch: filePath });
    setConfirmDiscard(null);
    setSelectedFile(null);
    refresh();
  }, [repoPath, refresh]);

  const handleCheckoutBranch = useCallback(async (branch: string) => {
    if (!repoPath) return;
    const { desktop } = await import("../common/desktop-bridge");
    await desktop.git.checkout.mutate({ cwd: repoPath, branch });
    setShowBranchPicker(false);
    refresh();
  }, [repoPath, refresh]);

  const handleCreateBranch = useCallback(async () => {
    if (!repoPath || !newBranchName.trim()) return;
    const { desktop } = await import("../common/desktop-bridge");
    await desktop.git.checkout.mutate({ cwd: repoPath, branch: newBranchName.trim() });
    setNewBranchName("");
    setShowBranchPicker(false);
    refresh();
  }, [repoPath, newBranchName, refresh]);

  const handleDeleteBranch = useCallback(async (branch: string) => {
    if (!repoPath) return;
    // Delete branch not available in current tRPC router
    console.warn("Branch deletion not yet available via tRPC");
    refresh();
  }, [repoPath, refresh]);

  const handlePull = useCallback(async () => {
    if (!repoPath) return;
    // Pull not available in current tRPC router
    console.warn("Git pull not yet available via tRPC");
    refresh();
  }, [repoPath, refresh]);

  const handlePush = useCallback(async (forceWithLease = false) => {
    if (!repoPath) return;
    // Push not available in current tRPC router
    console.warn("Git push not yet available via tRPC");
    refresh();
  }, [repoPath, refresh]);

  const handleShowCommit = useCallback(async (commitId: string) => {
    if (!repoPath) return;
    setSelectedFile(null);
    try {
      // Show commit detail: get the diff for this commit
      // TODO: Add a showCommit endpoint to the git tRPC router
      const entry = logEntries.find((e) => e.id === commitId);
      if (entry) {
        setSelectedCommit({
          id: entry.id,
          message: entry.message,
          author: entry.author,
          email: entry.email,
          time: entry.time,
          files: []
        });
      }
    } catch (e) {
      console.error("Show commit error:", e);
    }
  }, [repoPath, logEntries]);

  const handleCopyCommitMarkdown = useCallback((detail: GitCommitDetail) => {
    const totalAdds = detail.files.reduce((s, f) => s + f.additions, 0);
    const totalDels = detail.files.reduce((s, f) => s + f.deletions, 0);
    const md = [
      `## ${detail.message.split("\n")[0]}`,
      "",
      `- **Commit**: \`${detail.id.slice(0, 12)}\``,
      `- **Author**: ${detail.author} <${detail.email}>`,
      `- **Date**: ${new Date(detail.time * 1000).toLocaleString()}`,
      `- **Stats**: +${totalAdds} -${totalDels} across ${detail.files.length} files`,
      "",
      "### Files",
      ...detail.files.map((f) => `- \`${f.path}\` (+${f.additions}/-${f.deletions})`)
    ].join("\n");
    navigator.clipboard.writeText(md).catch(console.error);
  }, []);

  const handleStashSave = useCallback(async () => {
    // Stash not available in current tRPC router
    console.warn("Git stash not yet available via tRPC");
    setStashMessage("");
    refresh();
  }, [stashMessage, refresh]);

  const handleStashApply = useCallback(async (index: number) => {
    console.warn("Git stash apply not yet available via tRPC");
    refresh();
  }, [refresh]);

  const handleStashPop = useCallback(async (index: number) => {
    console.warn("Git stash pop not yet available via tRPC");
    refresh();
  }, [refresh]);

  const handleStashDrop = useCallback(async (index: number) => {
    console.warn("Git stash drop not yet available via tRPC");
    refresh();
  }, [refresh]);

  // ── Computed values ──

  const currentBranch = branches.find((b) => b.is_head);
  const stagedFiles = statusEntries.filter((e) => e.staged);
  const unstagedFiles = statusEntries.filter((e) => !e.staged);
  const stagedAdds = useMemo(() => stagedFiles.length, [stagedFiles]);

  const filteredLog = useMemo(() => {
    if (!historySearch.trim()) return logEntries;
    const q = historySearch.toLowerCase();
    return logEntries.filter(
      (e) => e.message.toLowerCase().includes(q) || e.author.toLowerCase().includes(q)
    );
  }, [logEntries, historySearch]);

  const hasRightPane = selectedFile || selectedCommit;

  // ── Relative time helper ──
  function relativeTime(ts: number) {
    const diff = (Date.now() / 1000) - ts;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(ts * 1000).toLocaleDateString();
  }

  return (
    <Flex sx={{ flexDirection: "column", height: "100%", bg: "background", fontFamily: MONO_FONT, overflow: "hidden" }}>
      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between", px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0, gap: 2 }}>
        <Flex sx={{ alignItems: "center", gap: 2, flex: 1, minWidth: 0 }}>
          <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading", flexShrink: 0 }}>Git</Text>
          {/* Branch switcher */}
          <Box sx={{ position: "relative" }}>
            <Button onClick={() => setShowBranchPicker(!showBranchPicker)} sx={{ bg: "hover", border: "1px solid var(--border)", color: "#60a5fa", fontSize: 11, px: 2, py: "3px", borderRadius: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 1 }}>
              {currentBranch?.name || "detached"}
              {currentBranch?.ahead ? <Text sx={{ fontSize: 10, color: "#22c55e" }}>&#8593;{currentBranch.ahead}</Text> : null}
              {currentBranch?.behind ? <Text sx={{ fontSize: 10, color: "#ef4444" }}>&#8595;{currentBranch.behind}</Text> : null}
              <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>&#9662;</Text>
            </Button>
            {showBranchPicker && (
              <Box sx={{ position: "absolute", top: "100%", left: 0, mt: 1, bg: "background-secondary", border: "1px solid var(--border)", borderRadius: 8, minWidth: 220, zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden" }}>
                <Box sx={{ p: 2, borderBottom: "1px solid var(--border)" }}>
                  <Flex sx={{ gap: 1 }}>
                    <Input value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} placeholder="New branch..." sx={{ flex: 1, bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 11, fontFamily: MONO_FONT, px: 2, py: "3px", "&:focus": { outline: "none", borderColor: "#60a5fa" }, "&::placeholder": { color: "paragraph-secondary" } }} />
                    <Button onClick={handleCreateBranch} disabled={!newBranchName.trim()} sx={{ bg: "#22c55e", color: "#000", border: "none", fontSize: 10, px: 2, py: "3px", borderRadius: 4, cursor: "pointer", fontWeight: "bold", opacity: newBranchName.trim() ? 1 : 0.5 }}>+</Button>
                  </Flex>
                </Box>
                <Box sx={{ maxHeight: 200, overflow: "auto" }}>
                  {branches.map((b) => (
                    <Flex key={b.name} sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: "4px", cursor: "pointer", bg: b.is_head ? "background-selected" : "transparent", "&:hover": { bg: "hover" } }}>
                      <Text onClick={() => handleCheckoutBranch(b.name)} sx={{ fontSize: 11, color: b.is_head ? "#60a5fa" : "heading", flex: 1 }}>{b.name}</Text>
                      {!b.is_head && (
                        <Button onClick={(e) => { e.stopPropagation(); handleDeleteBranch(b.name); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0, "&:hover": { color: "#ef4444" } }}>x</Button>
                      )}
                    </Flex>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        </Flex>
        <Flex sx={{ gap: 1, flexShrink: 0 }}>
          <Button onClick={handlePull} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer", "&:hover": { color: "heading", borderColor: "#60a5fa" } }}>Pull</Button>
          <Button onClick={() => handlePush(false)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer", "&:hover": { color: "heading", borderColor: "#22c55e" } }}>Push</Button>
          <Button onClick={() => setAutoRefresh(!autoRefresh)} sx={{ bg: autoRefresh ? "#22c55e22" : "transparent", border: `1px solid ${autoRefresh ? "#22c55e" : "var(--border)"}`, color: autoRefresh ? "#22c55e" : "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer" }}>Auto</Button>
          <Button onClick={refresh} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer", "&:hover": { color: "heading" } }}>Refresh</Button>
        </Flex>
      </Flex>

      {/* Tabs */}
      <Flex sx={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {(["changes", "history", "stashes"] as const).map((tab) => {
          const count = tab === "changes" ? statusEntries.length : tab === "history" ? filteredLog.length : stashes.length;
          return (
            <Button key={tab} onClick={() => { setActiveTab(tab); setSelectedFile(null); setSelectedCommit(null); }} sx={{ bg: activeTab === tab ? "hover" : "transparent", color: activeTab === tab ? "heading" : "paragraph-secondary", border: "none", borderBottom: activeTab === tab ? "2px solid #60a5fa" : "2px solid transparent", px: 3, py: 2, fontSize: 12, cursor: "pointer", textTransform: "capitalize" }}>
              {tab} ({count})
            </Button>
          );
        })}
        {/* View toggle for diff */}
        {hasRightPane && (
          <Button onClick={() => setSideBySide(!sideBySide)} sx={{ ml: "auto", bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", px: 2, "&:hover": { color: "heading" } }}>
            {sideBySide ? "Unified" : "Side-by-side"}
          </Button>
        )}
      </Flex>

      {/* Content */}
      <Flex sx={{ flex: 1, overflow: "hidden" }}>
        {/* Left panel */}
        <Box sx={{ width: hasRightPane ? "40%" : "100%", overflow: "auto", borderRight: hasRightPane ? "1px solid var(--border)" : "none", transition: "width 0.2s", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
          {activeTab === "changes" && (
            <>
              {/* Staged */}
              {stagedFiles.length > 0 && (
                <Box>
                  <Flex sx={{ px: 3, py: "6px", bg: "background-secondary", alignItems: "center", justifyContent: "space-between" }}>
                    <Text sx={{ fontSize: 11, color: "#22c55e", fontWeight: "bold" }}>STAGED ({stagedFiles.length})</Text>
                    <Button onClick={() => handleUnstage(stagedFiles.map((f) => f.path))} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0, "&:hover": { color: "heading" } }}>Unstage All</Button>
                  </Flex>
                  {stagedFiles.map((entry) => (
                    <Flex key={entry.path} sx={{ px: 3, py: "4px", cursor: "pointer", "&:hover": { bg: "hover" }, alignItems: "center", gap: 2 }}>
                      <Text sx={{ fontSize: 10, color: STATUS_COLORS[entry.status] || "paragraph-secondary", fontWeight: "bold", width: 14, textAlign: "center", flexShrink: 0 }}>
                        {STATUS_BADGES[entry.status] || "?"}
                      </Text>
                      <Text onClick={() => handleFileClick(entry)} sx={{ fontSize: 12, color: "heading", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{entry.path}</Text>
                      <Button onClick={(e) => { e.stopPropagation(); handleUnstage([entry.path]); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0, flexShrink: 0, "&:hover": { color: "#eab308" } }}>-</Button>
                    </Flex>
                  ))}
                </Box>
              )}

              {/* Unstaged */}
              {unstagedFiles.length > 0 && (
                <Box>
                  <Flex sx={{ px: 3, py: "6px", bg: "background-secondary", alignItems: "center", justifyContent: "space-between" }}>
                    <Text sx={{ fontSize: 11, color: "#eab308", fontWeight: "bold" }}>CHANGES ({unstagedFiles.length})</Text>
                    <Button onClick={() => handleStage(unstagedFiles.map((f) => f.path))} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0, "&:hover": { color: "heading" } }}>Stage All</Button>
                  </Flex>
                  {unstagedFiles.map((entry) => (
                    <Flex key={entry.path} sx={{ px: 3, py: "4px", cursor: "pointer", "&:hover": { bg: "hover" }, alignItems: "center", gap: 2 }}>
                      <Text sx={{ fontSize: 10, color: STATUS_COLORS[entry.status] || "paragraph-secondary", fontWeight: "bold", width: 14, textAlign: "center", flexShrink: 0 }}>
                        {STATUS_BADGES[entry.status] || "?"}
                      </Text>
                      <Text onClick={() => handleFileClick(entry)} sx={{ fontSize: 12, color: "heading", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>{entry.path}</Text>
                      <Flex sx={{ gap: 1, flexShrink: 0 }}>
                        <Button onClick={(e) => { e.stopPropagation(); handleStage([entry.path]); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0, "&:hover": { color: "#22c55e" } }}>+</Button>
                        <Button onClick={(e) => { e.stopPropagation(); setConfirmDiscard(entry.path); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 10, cursor: "pointer", p: 0, "&:hover": { color: "#ef4444" } }}>x</Button>
                      </Flex>
                    </Flex>
                  ))}
                </Box>
              )}

              {statusEntries.length === 0 && !loading && (
                <Flex sx={{ p: 4, flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <Text sx={{ fontSize: 13, color: "#22c55e" }}>Working tree clean</Text>
                  <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>No changes to commit</Text>
                </Flex>
              )}

              {/* Commit box */}
              {stagedFiles.length > 0 && (
                <Box sx={{ p: 3, borderTop: "1px solid var(--border)" }}>
                  <Text sx={{ fontSize: 10, color: "paragraph-secondary", mb: 1, display: "block" }}>
                    {stagedAdds} file{stagedAdds > 1 ? "s" : ""} staged
                  </Text>
                  <Textarea value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message..." rows={3} sx={{ width: "100%", bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 12, fontFamily: MONO_FONT, p: 2, resize: "vertical", "&:focus": { outline: "none", borderColor: "#60a5fa" }, "&::placeholder": { color: "paragraph-secondary" } }} />
                  <Button onClick={handleCommit} disabled={!commitMsg.trim()} sx={{ mt: 2, bg: "#22c55e", color: "#000", border: "none", px: 3, py: "6px", borderRadius: 6, fontSize: 12, fontWeight: "bold", cursor: "pointer", opacity: commitMsg.trim() ? 1 : 0.5, width: "100%", "&:hover": { opacity: 0.9 } }}>
                    Commit
                  </Button>
                </Box>
              )}

              {/* Discard confirmation */}
              {confirmDiscard && (
                <Box sx={{ position: "fixed", inset: 0, bg: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setConfirmDiscard(null)}>
                  <Box onClick={(e) => e.stopPropagation()} sx={{ bg: "background-secondary", border: "1px solid var(--border)", borderRadius: 8, p: 4, maxWidth: 400 }}>
                    <Text sx={{ fontSize: 14, color: "heading", fontWeight: "bold", mb: 2, display: "block" }}>Discard changes?</Text>
                    <Text sx={{ fontSize: 12, color: "paragraph-secondary", mb: 3, display: "block" }}>This will permanently discard changes to: {confirmDiscard}</Text>
                    <Flex sx={{ gap: 2, justifyContent: "flex-end" }}>
                      <Button onClick={() => setConfirmDiscard(null)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 12, px: 3, py: "5px", borderRadius: 6, cursor: "pointer" }}>Cancel</Button>
                      <Button onClick={() => handleDiscard(confirmDiscard)} sx={{ bg: "#ef4444", color: "#fff", border: "none", fontSize: 12, px: 3, py: "5px", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>Discard</Button>
                    </Flex>
                  </Box>
                </Box>
              )}
            </>
          )}

          {activeTab === "history" && (
            <>
              {/* Search bar */}
              <Box sx={{ px: 3, py: 2, borderBottom: "1px solid var(--border)" }}>
                <Input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Search commits..." spellCheck={false} sx={{ width: "100%", bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 11, fontFamily: MONO_FONT, px: 2, py: "4px", caretColor: "#22c55e", "&:focus": { outline: "none", borderColor: "#60a5fa" }, "&::placeholder": { color: "paragraph-secondary" } }} />
              </Box>
              {filteredLog.map((entry) => (
                <Flex key={entry.id} onClick={() => handleShowCommit(entry.id)} sx={{ px: 3, py: 2, borderBottom: "1px solid var(--border)", cursor: "pointer", bg: selectedCommit?.id === entry.id ? "background-selected" : "transparent", "&:hover": { bg: selectedCommit?.id === entry.id ? "background-selected" : "hover" } }}>
                  <Text sx={{ fontSize: 11, color: "#eab308", fontFamily: MONO_FONT, width: 56, flexShrink: 0 }}>{entry.short_id}</Text>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Text sx={{ fontSize: 12, color: "heading", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{entry.message.split("\n")[0]}</Text>
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{entry.author} · {relativeTime(entry.time)}</Text>
                  </Box>
                </Flex>
              ))}
              {filteredLog.length === historyLimit && (
                <Button onClick={() => setHistoryLimit((l) => l + 50)} sx={{ display: "block", width: "100%", bg: "transparent", border: "none", color: "#60a5fa", fontSize: 11, py: 2, cursor: "pointer", "&:hover": { bg: "hover" } }}>
                  Load more...
                </Button>
              )}
            </>
          )}

          {activeTab === "stashes" && (
            <>
              {/* Stash save */}
              <Box sx={{ px: 3, py: 2, borderBottom: "1px solid var(--border)" }}>
                <Flex sx={{ gap: 1 }}>
                  <Input value={stashMessage} onChange={(e) => setStashMessage(e.target.value)} placeholder="Stash message (optional)..." sx={{ flex: 1, bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 11, fontFamily: MONO_FONT, px: 2, py: "4px", "&:focus": { outline: "none", borderColor: "#60a5fa" }, "&::placeholder": { color: "paragraph-secondary" } }} />
                  <Button onClick={handleStashSave} sx={{ bg: "#60a5fa", color: "#000", border: "none", fontSize: 11, px: 2, py: "4px", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}>Save Stash</Button>
                </Flex>
              </Box>
              {stashes.length === 0 && (
                <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary", fontStyle: "italic" }}>No stashes</Text>
              )}
              {stashes.map((stash) => (
                <Flex key={stash.index} sx={{ px: 3, py: 2, borderBottom: "1px solid var(--border)", alignItems: "center", gap: 2, "&:hover": { bg: "hover" } }}>
                  <Text sx={{ fontSize: 11, color: "#a78bfa", fontWeight: "bold", width: 20, flexShrink: 0 }}>@{stash.index}</Text>
                  <Text sx={{ fontSize: 12, color: "heading", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stash.message}</Text>
                  <Flex sx={{ gap: 1, flexShrink: 0 }}>
                    <Button onClick={() => handleStashApply(stash.index)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "#22c55e", fontSize: 10, px: "6px", py: "2px", borderRadius: 4, cursor: "pointer" }}>Apply</Button>
                    <Button onClick={() => handleStashPop(stash.index)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "#60a5fa", fontSize: 10, px: "6px", py: "2px", borderRadius: 4, cursor: "pointer" }}>Pop</Button>
                    <Button onClick={() => handleStashDrop(stash.index)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "#ef4444", fontSize: 10, px: "6px", py: "2px", borderRadius: 4, cursor: "pointer" }}>Drop</Button>
                  </Flex>
                </Flex>
              ))}
            </>
          )}
        </Box>

        {/* Right panel: diff viewer */}
        {selectedFile && (
          <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
            <Flex sx={{ px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 1, flexShrink: 0 }}>
              <Flex sx={{ alignItems: "center", gap: 2 }}>
                <Text sx={{ fontSize: 12, fontWeight: "bold", color: "heading" }}>{selectedFile.path}</Text>
                {/* Stat bar */}
                <Flex sx={{ gap: 1, alignItems: "center" }}>
                  <Text sx={{ fontSize: 10, color: "#22c55e" }}>+{selectedFile.additions}</Text>
                  <Text sx={{ fontSize: 10, color: "#ef4444" }}>-{selectedFile.deletions}</Text>
                  <Box sx={{ width: 60, height: 4, bg: "var(--border)", borderRadius: 2, overflow: "hidden", display: "flex" }}>
                    <Box sx={{ width: `${(selectedFile.additions / Math.max(selectedFile.additions + selectedFile.deletions, 1)) * 100}%`, bg: "#22c55e", height: "100%" }} />
                    <Box sx={{ width: `${(selectedFile.deletions / Math.max(selectedFile.additions + selectedFile.deletions, 1)) * 100}%`, bg: "#ef4444", height: "100%" }} />
                  </Box>
                </Flex>
              </Flex>
              <Button onClick={() => setSelectedFile(null)} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", cursor: "pointer", p: 0, "&:hover": { color: "heading" } }}>x</Button>
            </Flex>
            <Box sx={{ flex: 1, overflow: "auto", p: 0 }}>
              {selectedFile.patch ? (
                <DiffViewer patch={selectedFile.patch} sideBySide={sideBySide} />
              ) : (
                <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary" }}>No diff available (new or binary file)</Text>
              )}
            </Box>
          </Box>
        )}

        {/* Right panel: commit detail */}
        {selectedCommit && (
          <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
            <Flex sx={{ px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 1, flexShrink: 0 }}>
              <Text sx={{ fontSize: 12, fontWeight: "bold", color: "#eab308" }}>{selectedCommit.id.slice(0, 12)}</Text>
              <Flex sx={{ gap: 1 }}>
                <Button onClick={() => handleCopyCommitMarkdown(selectedCommit)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 10, px: 2, py: "2px", borderRadius: 4, cursor: "pointer", "&:hover": { color: "heading" } }}>Copy MD</Button>
                <Button onClick={() => setSelectedCommit(null)} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", cursor: "pointer", p: 0, "&:hover": { color: "heading" } }}>x</Button>
              </Flex>
            </Flex>
            {/* Commit metadata */}
            <Box sx={{ px: 3, py: 2, borderBottom: "1px solid var(--border)", bg: "background" }}>
              <Text sx={{ fontSize: 13, color: "heading", fontWeight: "bold", display: "block", mb: 1 }}>{selectedCommit.message.split("\n")[0]}</Text>
              {selectedCommit.message.includes("\n") && (
                <Text sx={{ fontSize: 11, color: "paragraph-secondary", whiteSpace: "pre-wrap", display: "block", mb: 1 }}>{selectedCommit.message.split("\n").slice(1).join("\n")}</Text>
              )}
              <Flex sx={{ gap: 3, mt: 1 }}>
                <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{selectedCommit.author} &lt;{selectedCommit.email}&gt;</Text>
                <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{new Date(selectedCommit.time * 1000).toLocaleString()}</Text>
              </Flex>
              <Text sx={{ fontSize: 10, color: "paragraph-secondary", mt: 1, display: "block", fontFamily: MONO_FONT }}>{selectedCommit.id}</Text>
            </Box>
            {/* Per-file diffs */}
            <Box sx={{ flex: 1, overflow: "auto" }}>
              {selectedCommit.files.map((file) => (
                <Box key={file.path} sx={{ borderBottom: "1px solid var(--border)" }}>
                  <Flex sx={{ px: 3, py: "6px", bg: "background-secondary", alignItems: "center", gap: 2 }}>
                    <Text sx={{ fontSize: 10, color: STATUS_COLORS[file.status] || "paragraph-secondary", fontWeight: "bold" }}>{file.status[0].toUpperCase()}</Text>
                    <Text sx={{ fontSize: 11, color: "heading", flex: 1 }}>{file.path}</Text>
                    <Text sx={{ fontSize: 10, color: "#22c55e" }}>+{file.additions}</Text>
                    <Text sx={{ fontSize: 10, color: "#ef4444" }}>-{file.deletions}</Text>
                  </Flex>
                  {file.patch && (
                    <DiffViewer patch={file.patch} sideBySide={sideBySide} />
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}

function GitPanelPlaceholder() {
  return (
    <Flex sx={{ height: "100%", alignItems: "center", justifyContent: "center", bg: "background" }}>
      <Box sx={{ textAlign: "center" }}>
        <Text sx={{ fontSize: 48, display: "block", mb: 3 }}>Git</Text>
        <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>Git panel requires the desktop app.</Text>
        <Text sx={{ fontSize: 12, color: "paragraph-secondary", mt: 1 }}>Run the Electron desktop build to enable real git operations.</Text>
      </Box>
    </Flex>
  );
}

export default function GitPanel() {
  if (IS_DESKTOP_APP) return <GitPanelReal />;
  return <GitPanelPlaceholder />;
}
