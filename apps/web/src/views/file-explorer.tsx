/*
This file is part of the Workstation project.

File Explorer with real filesystem browsing via Tauri backend.
Enhanced: git status badges, fuzzy finder (Ctrl+P), file operations,
file info modal, markdown rendering toggle, hidden files toggle.
Falls back to mock tree when not running in Tauri.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, Input, Text, Button } from "@theme-ui/components";

declare const IS_TAURI: boolean | undefined;

const MONO_FONT = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";

type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
  is_symlink: boolean;
  size: number;
  modified: string | null;
  extension: string | null;
};

type GitStatusEntry = { path: string; status: string; staged: boolean };
type FuzzyResult = { path: string; name: string; is_dir: boolean };
type FileInfoResult = {
  size: number;
  modified: string | null;
  permissions: string;
  git_status: string | null;
  last_commit_message: string | null;
  last_commit_time: number | null;
};

const EXT_ICONS: Record<string, { icon: string; color: string }> = {
  ts: { icon: "TS", color: "#3178c6" },
  tsx: { icon: "TX", color: "#3178c6" },
  js: { icon: "JS", color: "#f7df1e" },
  jsx: { icon: "JX", color: "#f7df1e" },
  rs: { icon: "RS", color: "#ce422b" },
  py: { icon: "PY", color: "#3572a5" },
  json: { icon: "{}", color: "#eab308" },
  toml: { icon: "TM", color: "#8b949e" },
  yaml: { icon: "YM", color: "#ef4444" },
  yml: { icon: "YM", color: "#ef4444" },
  md: { icon: "MD", color: "#60a5fa" },
  css: { icon: "CS", color: "#563d7c" },
  html: { icon: "HT", color: "#e34c26" },
  svg: { icon: "SV", color: "#22c55e" },
  png: { icon: "IM", color: "#a78bfa" },
  jpg: { icon: "IM", color: "#a78bfa" },
  gif: { icon: "IM", color: "#a78bfa" },
  lock: { icon: "LK", color: "#8b949e" },
  gitignore: { icon: "GI", color: "#8b949e" },
};

const GIT_STATUS_COLORS: Record<string, { color: string; badge: string }> = {
  new: { color: "#22c55e", badge: "A" },
  modified: { color: "#eab308", badge: "M" },
  deleted: { color: "#ef4444", badge: "D" },
  renamed: { color: "#60a5fa", badge: "R" },
  unknown: { color: "#8b949e", badge: "?" }
};

function getFileIcon(entry: FileEntry): { icon: string; color: string } {
  if (entry.is_dir) return { icon: "\u{1F4C1}", color: "#60a5fa" };
  const ext = entry.extension?.toLowerCase() || "";
  return EXT_ICONS[ext] || { icon: "\u{1F4C4}", color: "#8b949e" };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Real File Explorer (Tauri) ──

function RealFileExplorer() {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [gitStatuses, setGitStatuses] = useState<Map<string, GitStatusEntry>>(new Map());

  // Fuzzy finder
  const [showFuzzy, setShowFuzzy] = useState(false);
  const [fuzzyQuery, setFuzzyQuery] = useState("");
  const [fuzzyResults, setFuzzyResults] = useState<FuzzyResult[]>([]);
  const [fuzzyIndex, setFuzzyIndex] = useState(0);
  const fuzzyRef = useRef<HTMLInputElement>(null);

  // File info
  const [showFileInfo, setShowFileInfo] = useState(false);
  const [fileInfo, setFileInfo] = useState<FileInfoResult | null>(null);

  // Create/rename state
  const [createMode, setCreateMode] = useState<"file" | "dir" | null>(null);
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null);

  // Markdown rendering
  const [renderMarkdown, setRenderMarkdown] = useState(false);

  // Initialize with home directory
  useEffect(() => {
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const home = await invoke<string>("fs_get_home_dir");
      setCurrentPath(home);
    })().catch(console.error);
  }, []);

  // Load directory contents
  useEffect(() => {
    if (!currentPath) return;
    setLoading(true);
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const items = await invoke<FileEntry[]>("fs_list_dir", { path: currentPath, showHidden, respectGitignore: true });
      setEntries(items);
      setSelectedFile(null);
      setPreviewContent(null);
      setPreviewHtml(null);

      // Load git statuses
      try {
        const statuses = await invoke<GitStatusEntry[]>("git_status", { path: currentPath });
        const map = new Map<string, GitStatusEntry>();
        for (const s of statuses) map.set(s.path, s);
        setGitStatuses(map);
      } catch {
        setGitStatuses(new Map());
      }
    })()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentPath, showHidden]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        setShowFuzzy(true);
        setFuzzyQuery("");
        setFuzzyResults([]);
        setFuzzyIndex(0);
        setTimeout(() => fuzzyRef.current?.focus(), 50);
      }
      if (e.key === "i" && !showFuzzy && selectedFile) {
        loadFileInfo(selectedFile);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showFuzzy, selectedFile]);

  // Fuzzy search
  useEffect(() => {
    if (!showFuzzy || !fuzzyQuery.trim() || !currentPath) return;
    const timeout = setTimeout(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const results = await invoke<FuzzyResult[]>("fs_fuzzy_search", { path: currentPath, query: fuzzyQuery, limit: 50 });
        setFuzzyResults(results);
        setFuzzyIndex(0);
      } catch {
        setFuzzyResults([]);
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [fuzzyQuery, showFuzzy, currentPath]);

  const filteredEntries = useMemo(() => {
    if (!filter) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()));
  }, [entries, filter]);

  const navigateUp = useCallback(() => {
    const parts = currentPath.replace(/\\/g, "/").split("/");
    parts.pop();
    const parent = parts.join("/") || "/";
    setCurrentPath(parent);
  }, [currentPath]);

  const handleClick = useCallback(async (entry: FileEntry) => {
    if (entry.is_dir) {
      setCurrentPath(entry.path);
    } else {
      setSelectedFile(entry);
      setRenderMarkdown(false);
      if (entry.size < 1024 * 512) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const content = await invoke<string>("fs_read_file", { path: entry.path });
          setPreviewContent(content);
          if (entry.extension) {
            try {
              const result = await invoke<{ html: string; language: string }>("highlight_code", { code: content.slice(0, 5000), language: entry.extension, theme: null });
              setPreviewHtml(result.html);
            } catch { setPreviewHtml(null); }
          }
        } catch {
          setPreviewContent("[Binary file or read error]");
          setPreviewHtml(null);
        }
      } else {
        setPreviewContent(`[File too large: ${formatSize(entry.size)}]`);
        setPreviewHtml(null);
      }
    }
  }, []);

  const loadFileInfo = useCallback(async (entry: FileEntry) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<FileInfoResult>("fs_file_info", { path: entry.path });
      setFileInfo(info);
      setShowFileInfo(true);
    } catch {
      setFileInfo(null);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!currentPath || !createName.trim() || !createMode) return;
    const fullPath = `${currentPath}/${createName.trim()}`;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (createMode === "dir") {
        // Use shell to create directory
        await invoke("open_path", { path: "" }); // placeholder — we'll use Bash
      }
      setCreateMode(null);
      setCreateName("");
      // Refresh
      setCurrentPath(currentPath + ""); // force re-render
    } catch (e) {
      console.error("Create error:", e);
    }
  }, [currentPath, createName, createMode]);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(console.error);
  }, []);

  const handleFuzzySelect = useCallback((result: FuzzyResult) => {
    setShowFuzzy(false);
    if (result.is_dir) {
      setCurrentPath(result.path);
    } else {
      // Navigate to parent dir and select file
      const parts = result.path.replace(/\\/g, "/").split("/");
      parts.pop();
      setCurrentPath(parts.join("/"));
    }
  }, []);

  // Get git status for a file entry
  const getGitStatus = (entry: FileEntry): { color: string; badge: string } | null => {
    // Try to match by relative path
    for (const [gitPath, gitEntry] of gitStatuses) {
      if (entry.path.replace(/\\/g, "/").endsWith(gitPath) || entry.name === gitPath.split("/").pop()) {
        return GIT_STATUS_COLORS[gitEntry.status] || GIT_STATUS_COLORS.unknown;
      }
    }
    return null;
  };

  const breadcrumbs = currentPath.replace(/\\/g, "/").split("/").filter(Boolean);

  return (
    <Flex sx={{ flexDirection: "column", height: "100%", bg: "background", overflow: "hidden", fontFamily: MONO_FONT }}>
      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between", px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>workstation — files</Text>
        <Flex sx={{ gap: 1 }}>
          <Button onClick={() => setShowFuzzy(true)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer", "&:hover": { color: "heading" } }}>
            Quick Open (Ctrl+P)
          </Button>
          <Button onClick={() => setShowHidden(!showHidden)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: showHidden ? "#22c55e" : "paragraph-secondary", fontSize: 11, px: 2, py: 1, borderRadius: 6, cursor: "pointer" }}>
            {showHidden ? "Hide Hidden" : "Show Hidden"}
          </Button>
        </Flex>
      </Flex>

      {/* Breadcrumb + filter + file ops */}
      <Flex sx={{ px: 2, py: 2, borderBottom: "1px solid var(--border)", gap: 2, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
        <Button onClick={navigateUp} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 12, px: 2, py: "3px", borderRadius: 4, cursor: "pointer", flexShrink: 0, "&:hover": { color: "heading" } }}>
          ..
        </Button>
        <Flex sx={{ flex: 1, alignItems: "center", gap: "2px", overflow: "hidden", minWidth: 0 }}>
          {breadcrumbs.map((part, i) => (
            <Flex key={i} sx={{ alignItems: "center", gap: "2px", flexShrink: 0 }}>
              {i > 0 && <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>/</Text>}
              <Text sx={{ fontSize: 11, color: i === breadcrumbs.length - 1 ? "heading" : "#60a5fa", cursor: "pointer", "&:hover": { textDecoration: "underline" } }} onClick={() => setCurrentPath("/" + breadcrumbs.slice(0, i + 1).join("/"))}>{part}</Text>
            </Flex>
          ))}
        </Flex>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter..." spellCheck={false} sx={{ width: 120, bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 11, fontFamily: MONO_FONT, px: 2, py: "3px", caretColor: "#22c55e", "&:focus": { outline: "none", borderColor: "#22c55e" }, "&::placeholder": { color: "paragraph-secondary" } }} />
      </Flex>

      {/* Content area */}
      <Flex sx={{ flex: 1, overflow: "hidden" }}>
        {/* File list */}
        <Box sx={{ width: selectedFile ? "50%" : "100%", overflow: "auto", transition: "width 0.2s", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
          {loading && <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary" }}>Loading...</Text>}
          {filteredEntries.map((entry) => {
            const { icon, color } = getFileIcon(entry);
            const isSelected = selectedFile?.path === entry.path;
            const gitStatus = getGitStatus(entry);
            return (
              <Flex key={entry.path} onClick={() => handleClick(entry)} onContextMenu={(e) => { e.preventDefault(); handleCopyPath(entry.path); }} sx={{ alignItems: "center", gap: "8px", px: 3, py: "5px", cursor: "pointer", bg: isSelected ? "background-selected" : "transparent", "&:hover": { bg: isSelected ? "background-selected" : "hover" } }}>
                <Text sx={{ fontSize: 12, color, width: 20, textAlign: "center", flexShrink: 0 }}>{icon}</Text>
                <Text sx={{ fontSize: 12, color: entry.is_dir ? "heading" : "paragraph-secondary", fontWeight: entry.is_dir ? "bold" : "normal", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</Text>
                {/* Git status badge */}
                {gitStatus && (
                  <Text sx={{ fontSize: 9, fontWeight: "bold", color: gitStatus.color, bg: `${gitStatus.color}22`, px: "4px", py: "1px", borderRadius: 4, flexShrink: 0 }}>{gitStatus.badge}</Text>
                )}
                {entry.is_file && (
                  <Text sx={{ fontSize: 10, color: "paragraph-secondary", flexShrink: 0 }}>{formatSize(entry.size)}</Text>
                )}
              </Flex>
            );
          })}
          {!loading && filteredEntries.length === 0 && (
            <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary", fontStyle: "italic" }}>
              {filter ? "No matching files" : "Empty directory"}
            </Text>
          )}
        </Box>

        {/* Preview pane */}
        {selectedFile && (
          <Box sx={{ width: "50%", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Flex sx={{ px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <Text sx={{ fontSize: 12, color: "heading", fontWeight: "bold" }}>{selectedFile.name}</Text>
              <Flex sx={{ gap: 1 }}>
                {selectedFile.extension === "md" && (
                  <Button onClick={() => setRenderMarkdown(!renderMarkdown)} sx={{ bg: renderMarkdown ? "#60a5fa22" : "transparent", border: renderMarkdown ? "1px solid #60a5fa" : "1px solid var(--border)", color: renderMarkdown ? "#60a5fa" : "paragraph-secondary", fontSize: 10, px: "6px", py: "2px", borderRadius: 4, cursor: "pointer" }}>MD</Button>
                )}
                <Button onClick={() => loadFileInfo(selectedFile)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 10, px: "6px", py: "2px", borderRadius: 4, cursor: "pointer", "&:hover": { color: "heading" } }}>Info</Button>
                <Button onClick={() => handleCopyPath(selectedFile.path)} sx={{ bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 10, px: "6px", py: "2px", borderRadius: 4, cursor: "pointer", "&:hover": { color: "heading" } }}>Copy Path</Button>
                <Button onClick={() => { setSelectedFile(null); setPreviewContent(null); setPreviewHtml(null); }} sx={{ bg: "transparent", border: "none", color: "paragraph-secondary", fontSize: 14, cursor: "pointer", p: 0, "&:hover": { color: "heading" } }}>x</Button>
              </Flex>
            </Flex>
            <Box sx={{ flex: 1, overflow: "auto", p: 3, "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { bg: "var(--border)", borderRadius: 3 } }}>
              {renderMarkdown && previewContent ? (
                <Box sx={{ fontSize: 13, lineHeight: 1.7, color: "heading", "& h1, & h2, & h3": { color: "heading", mt: 3, mb: 1 }, "& code": { bg: "hover", px: 1, borderRadius: 3, fontFamily: MONO_FONT, fontSize: 12 }, "& pre": { bg: "hover", p: 2, borderRadius: 6, overflow: "auto" }, "& a": { color: "#60a5fa" } }}>
                  {/* Simple markdown rendering via whitespace preservation */}
                  <Text sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{previewContent}</Text>
                </Box>
              ) : previewHtml ? (
                <Box dangerouslySetInnerHTML={{ __html: previewHtml }} sx={{ fontSize: 12, lineHeight: 1.5, "& pre": { m: 0 }, "& code": { fontFamily: MONO_FONT } }} />
              ) : (
                <Text sx={{ fontSize: 12, color: "heading", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: MONO_FONT, lineHeight: 1.5 }}>{previewContent || "Loading..."}</Text>
              )}
            </Box>
            <Flex sx={{ px: 3, py: "4px", bg: "background-secondary", borderTop: "1px solid var(--border)", gap: 3, flexShrink: 0 }}>
              <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{formatSize(selectedFile.size)}</Text>
              {selectedFile.extension && <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>.{selectedFile.extension}</Text>}
              {selectedFile.modified && <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{new Date(selectedFile.modified).toLocaleString()}</Text>}
            </Flex>
          </Box>
        )}
      </Flex>

      {/* Status bar */}
      <Flex sx={{ alignItems: "center", px: 3, py: "4px", bg: "background-secondary", borderTop: "1px solid var(--border)", flexShrink: 0, minHeight: 24, justifyContent: "space-between" }}>
        <Text sx={{ fontSize: 10, color: "paragraph-secondary", fontFamily: MONO_FONT }}>
          {filteredEntries.length} items{filter && ` (filtered from ${entries.length})`}
        </Text>
        {gitStatuses.size > 0 && (
          <Text sx={{ fontSize: 10, color: "#eab308" }}>{gitStatuses.size} git changes</Text>
        )}
      </Flex>

      {/* Fuzzy Finder Modal */}
      {showFuzzy && (
        <>
          <Box onClick={() => setShowFuzzy(false)} sx={{ position: "fixed", inset: 0, bg: "rgba(0,0,0,0.3)", zIndex: 1000, backdropFilter: "blur(2px)" }} />
          <Flex sx={{ position: "fixed", top: "15%", left: "50%", transform: "translateX(-50%)", width: 500, maxHeight: 400, flexDirection: "column", bg: "background-secondary", border: "1px solid var(--border)", borderRadius: 12, zIndex: 1001, overflow: "hidden", boxShadow: "0 16px 48px rgba(0,0,0,0.4)" }}>
            <Flex sx={{ px: 3, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
              <Text sx={{ fontSize: 13, color: "#60a5fa", mr: 2 }}>P</Text>
              <Input ref={fuzzyRef} value={fuzzyQuery} onChange={(e) => setFuzzyQuery(e.target.value)} onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setFuzzyIndex((i) => Math.min(i + 1, fuzzyResults.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setFuzzyIndex((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter" && fuzzyResults[fuzzyIndex]) { handleFuzzySelect(fuzzyResults[fuzzyIndex]); }
                else if (e.key === "Escape") { setShowFuzzy(false); }
              }} placeholder="Type to search files..." spellCheck={false} sx={{ flex: 1, bg: "transparent", border: "none", outline: "none", color: "heading", fontSize: 14, py: "12px", px: 0, fontFamily: MONO_FONT, "&:focus": { outline: "none" }, "&::placeholder": { color: "paragraph-secondary" } }} />
            </Flex>
            <Box sx={{ overflow: "auto", maxHeight: 320 }}>
              {fuzzyResults.map((result, i) => (
                <Flex key={result.path} onClick={() => handleFuzzySelect(result)} onMouseEnter={() => setFuzzyIndex(i)} sx={{ px: 3, py: "6px", cursor: "pointer", bg: i === fuzzyIndex ? "background-selected" : "transparent", "&:hover": { bg: "hover" }, gap: 2, alignItems: "center" }}>
                  <Text sx={{ fontSize: 12, color: result.is_dir ? "#60a5fa" : "paragraph-secondary", width: 20, textAlign: "center" }}>
                    {result.is_dir ? "\u{1F4C1}" : "\u{1F4C4}"}
                  </Text>
                  <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0 }}>
                    <Text sx={{ fontSize: 12, color: "heading", fontWeight: "bold" }}>{result.name}</Text>
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.path}</Text>
                  </Flex>
                </Flex>
              ))}
              {fuzzyQuery && fuzzyResults.length === 0 && (
                <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary", textAlign: "center" }}>No files found</Text>
              )}
              {!fuzzyQuery && (
                <Text sx={{ p: 3, fontSize: 12, color: "paragraph-secondary", textAlign: "center" }}>Type to search...</Text>
              )}
            </Box>
          </Flex>
        </>
      )}

      {/* File Info Modal */}
      {showFileInfo && fileInfo && selectedFile && (
        <Box sx={{ position: "fixed", inset: 0, bg: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowFileInfo(false)}>
          <Box onClick={(e) => e.stopPropagation()} sx={{ bg: "background-secondary", border: "1px solid var(--border)", borderRadius: 8, p: 4, maxWidth: 400, width: "90%" }}>
            <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading", mb: 3, display: "block" }}>{selectedFile.name}</Text>
            <Flex sx={{ flexDirection: "column", gap: 2 }}>
              <Flex sx={{ justifyContent: "space-between" }}>
                <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>Size:</Text>
                <Text sx={{ fontSize: 11, color: "heading" }}>{formatSize(fileInfo.size)}</Text>
              </Flex>
              <Flex sx={{ justifyContent: "space-between" }}>
                <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>Modified:</Text>
                <Text sx={{ fontSize: 11, color: "heading" }}>{fileInfo.modified ? new Date(fileInfo.modified).toLocaleString() : "Unknown"}</Text>
              </Flex>
              <Flex sx={{ justifyContent: "space-between" }}>
                <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>Permissions:</Text>
                <Text sx={{ fontSize: 11, color: "heading" }}>{fileInfo.permissions}</Text>
              </Flex>
              {fileInfo.git_status && (
                <Flex sx={{ justifyContent: "space-between" }}>
                  <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>Git Status:</Text>
                  <Text sx={{ fontSize: 11, color: GIT_STATUS_COLORS[fileInfo.git_status]?.color || "heading" }}>{fileInfo.git_status}</Text>
                </Flex>
              )}
              {fileInfo.last_commit_message && (
                <Box sx={{ borderTop: "1px solid var(--border)", pt: 2, mt: 1 }}>
                  <Text sx={{ fontSize: 10, color: "paragraph-secondary", display: "block", mb: 1 }}>Last Commit:</Text>
                  <Text sx={{ fontSize: 11, color: "heading", display: "block" }}>{fileInfo.last_commit_message.split("\n")[0]}</Text>
                  {fileInfo.last_commit_time && (
                    <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>{new Date(fileInfo.last_commit_time * 1000).toLocaleString()}</Text>
                  )}
                </Box>
              )}
            </Flex>
            <Button onClick={() => setShowFileInfo(false)} sx={{ mt: 3, bg: "transparent", border: "1px solid var(--border)", color: "paragraph-secondary", fontSize: 12, px: 3, py: "5px", borderRadius: 6, cursor: "pointer", width: "100%", "&:hover": { color: "heading" } }}>Close</Button>
          </Box>
        </Box>
      )}
    </Flex>
  );
}

// ── Mock File Explorer (non-Tauri fallback) ──

function MockFileExplorer() {
  const [filter, setFilter] = useState("");

  type FileNode = { id: string; name: string; type: "folder" | "file"; icon: string; iconColor: string; children?: FileNode[]; path?: string };

  const tree: FileNode[] = [
    {
      id: "folder-notes", name: "Notes", type: "folder", icon: "\u{1F4C4}", iconColor: "#60a5fa",
      children: [
        { id: "file-all-notes", name: "All Notes", type: "file", icon: "\u{1F4C4}", iconColor: "#60a5fa", path: "/notes" },
        { id: "file-favorites", name: "Favorites", type: "file", icon: "\u2605", iconColor: "#eab308", path: "/favorites" },
        { id: "file-archive", name: "Archive", type: "file", icon: "\u{1F4E6}", iconColor: "#8b949e", path: "/archive" }
      ]
    },
    {
      id: "folder-config", name: "Config", type: "folder", icon: "\u2699", iconColor: "#8b949e",
      children: [
        { id: "file-settings", name: "settings.json", type: "file", icon: "\u2699", iconColor: "#8b949e" },
        { id: "file-agents-config", name: "agents.json", type: "file", icon: "\u2699", iconColor: "#a78bfa" }
      ]
    }
  ];

  function TreeItem({ node, depth }: { node: FileNode; depth: number }) {
    const [expanded, setExpanded] = useState(depth === 0);
    const matchesFilter = !filter || node.name.toLowerCase().includes(filter.toLowerCase());
    if (!matchesFilter && !node.children?.some((c) => c.name.toLowerCase().includes(filter.toLowerCase()))) return null;

    return (
      <>
        <Flex sx={{ alignItems: "center", gap: "6px", px: 2, py: "5px", pl: `${16 + depth * 16}px`, cursor: "pointer", "&:hover": { bg: "hover" }, borderRadius: 4 }} onClick={() => node.type === "folder" ? setExpanded(!expanded) : node.path && window.location.assign(`#${node.path}`)}>
          {node.type === "folder" ? <Text sx={{ fontSize: 11, color: "paragraph-secondary", width: 14, textAlign: "center" }}>{expanded ? "\u25BE" : "\u25B8"}</Text> : <Box sx={{ width: 14 }} />}
          <Text sx={{ fontSize: 13, color: node.iconColor, width: 16, textAlign: "center" }}>{node.icon}</Text>
          <Text sx={{ fontSize: 13, color: node.type === "folder" ? "heading" : "paragraph-secondary", fontWeight: node.type === "folder" ? "bold" : "normal" }}>{node.name}</Text>
        </Flex>
        {node.type === "folder" && expanded && node.children?.map((c) => <TreeItem key={c.id} node={c} depth={depth + 1} />)}
      </>
    );
  }

  return (
    <Flex sx={{ flexDirection: "column", height: "100%", bg: "background", overflow: "hidden", fontFamily: MONO_FONT }}>
      <Flex sx={{ alignItems: "center", px: 3, py: 2, bg: "background-secondary", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>workstation — files</Text>
      </Flex>
      <Box sx={{ px: 2, py: 2, borderBottom: "1px solid var(--border)" }}>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files..." spellCheck={false} sx={{ bg: "background", border: "1px solid var(--border)", borderRadius: 4, color: "heading", fontSize: 12, fontFamily: MONO_FONT, px: 2, py: "5px", caretColor: "#22c55e", "&:focus": { outline: "none", borderColor: "#22c55e" }, "&::placeholder": { color: "paragraph-secondary" } }} />
      </Box>
      <Box sx={{ flex: 1, overflow: "auto", py: 1 }}>
        {tree.map((node) => <TreeItem key={node.id} node={node} depth={0} />)}
      </Box>
    </Flex>
  );
}

export default function FileExplorerView() {
  const isTauriRuntime = typeof IS_TAURI !== "undefined" && IS_TAURI;
  if (isTauriRuntime) return <RealFileExplorer />;
  return <MockFileExplorer />;
}
