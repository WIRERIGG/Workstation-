/*
This file is part of the Workstation project.

Code Search — project-wide code search using ripgrep (desktop) or Node.js fallback.
Supports regex, case sensitivity, whole word, file type filtering.
Results grouped by file with syntax-highlighted context lines.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Flex, Text, Button, Input } from "@theme-ui/components";
import { isDesktopRuntime } from "../utils/platform";
import {
  useStore as useCodeSearchStore,
  type SearchMatch
} from "../stores/code-search-store";

const MONO_FONT =
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";

const SEVERITY_COLORS = {
  match: "#f59e0b",
  file: "#60a5fa",
  line: "#6b7280"
};

// ── Highlight matched text in a line ──

function HighlightedLine({
  text,
  query,
  isRegex,
  caseSensitive
}: {
  text: string;
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
}) {
  if (!query) return <>{text}</>;

  try {
    const pattern = isRegex
      ? new RegExp(`(${query})`, caseSensitive ? "g" : "gi")
      : new RegExp(
          `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
          caseSensitive ? "g" : "gi"
        );

    const parts = text.split(pattern);
    // Use a non-global regex for per-part matching to avoid lastIndex bugs
    const testPattern = isRegex
      ? new RegExp(`^${query}$`, caseSensitive ? "" : "i")
      : new RegExp(
          `^${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          caseSensitive ? "" : "i"
        );
    return (
      <>
        {parts.map((part, i) =>
          testPattern.test(part) ? (
            <Text
              key={i}
              as="span"
              sx={{
                bg: "#f59e0b33",
                color: "#f59e0b",
                borderRadius: 2,
                px: "2px"
              }}
            >
              {part}
            </Text>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

// ── Toggle button for search options ──

function ToggleBtn({
  label,
  active,
  onClick,
  title
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <Button
      onClick={onClick}
      title={title}
      sx={{
        bg: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "paragraph-secondary",
        border: "1px solid",
        borderColor: active ? "var(--accent)" : "var(--border)",
        fontSize: 11,
        fontFamily: MONO_FONT,
        px: "6px",
        py: "2px",
        minWidth: 24,
        borderRadius: 3,
        cursor: "pointer",
        lineHeight: 1.2,
        "&:hover": { borderColor: "var(--accent)" }
      }}
    >
      {label}
    </Button>
  );
}

// ── File result group ──

function FileGroup({
  file,
  matches,
  expanded,
  onToggle,
  query,
  isRegex,
  caseSensitive
}: {
  file: string;
  matches: SearchMatch[];
  expanded: boolean;
  onToggle: () => void;
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
}) {
  const fileName = file.split("/").pop() || file;
  const dirPath = file.includes("/")
    ? file.substring(0, file.lastIndexOf("/"))
    : "";

  return (
    <Box sx={{ mb: 1 }}>
      <Flex
        onClick={onToggle}
        sx={{
          px: 2,
          py: "4px",
          cursor: "pointer",
          alignItems: "center",
          gap: 1,
          bg: "background-secondary",
          borderRadius: 4,
          "&:hover": { bg: "hover" }
        }}
      >
        <Text
          sx={{
            fontSize: 11,
            color: "paragraph-secondary",
            fontFamily: MONO_FONT
          }}
        >
          {expanded ? "▼" : "▶"}
        </Text>
        <Text
          sx={{
            fontSize: 12,
            fontWeight: "bold",
            color: SEVERITY_COLORS.file
          }}
        >
          {fileName}
        </Text>
        <Text sx={{ fontSize: 11, color: "paragraph-secondary", flex: 1 }}>
          {dirPath}
        </Text>
        <Text
          sx={{
            fontSize: 10,
            color: "paragraph-secondary",
            bg: "background",
            px: "6px",
            py: "1px",
            borderRadius: 8,
            fontFamily: MONO_FONT
          }}
        >
          {matches.length}
        </Text>
      </Flex>

      {expanded && (
        <Box sx={{ pl: 3, borderLeft: "2px solid var(--border)", ml: 2 }}>
          {matches.map((m, i) => (
            <Flex
              key={`${m.line}-${i}`}
              sx={{
                py: "2px",
                px: 1,
                gap: 1,
                alignItems: "flex-start",
                fontSize: 12,
                fontFamily: MONO_FONT,
                "&:hover": { bg: "hover" },
                borderRadius: 2
              }}
            >
              <Text
                sx={{
                  color: SEVERITY_COLORS.line,
                  minWidth: 40,
                  textAlign: "right",
                  flexShrink: 0,
                  userSelect: "none",
                  fontSize: 11
                }}
              >
                {m.line}
              </Text>
              <Text
                sx={{
                  color: "paragraph",
                  whiteSpace: "pre",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1
                }}
              >
                <HighlightedLine
                  text={m.text}
                  query={query}
                  isRegex={isRegex}
                  caseSensitive={caseSensitive}
                />
              </Text>
            </Flex>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Main Code Search view (desktop) ──

function CodeSearchReal() {
  const query = useCodeSearchStore((s) => s.query);
  const isRegex = useCodeSearchStore((s) => s.isRegex);
  const caseSensitive = useCodeSearchStore((s) => s.caseSensitive);
  const wholeWord = useCodeSearchStore((s) => s.wholeWord);
  const includeGlob = useCodeSearchStore((s) => s.includeGlob);
  const excludeGlob = useCodeSearchStore((s) => s.excludeGlob);
  const results = useCodeSearchStore((s) => s.results);
  const isSearching = useCodeSearchStore((s) => s.isSearching);
  const expandedFiles = useCodeSearchStore((s) => s.expandedFiles);

  const inputRef = useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [cwd, setCwd] = useState<string | null>(null);

  // Resolve project directory on mount (same pattern as git-panel)
  useEffect(() => {
    (async () => {
      const { desktop } = await import("../common/desktop-bridge");
      if (!desktop) return;
      const home = await desktop.filesystem.homeDir.query();
      setCwd(home);
    })().catch(console.error);
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(async () => {
    const state = useCodeSearchStore.getState();
    const q = state.query.trim();
    if (!q || !cwd) return;

    state.setSearching(true);
    try {
      const { desktop } = await import("../common/desktop-bridge");
      if (!desktop) throw new Error("Desktop bridge not available");

      const result = await desktop.codeSearch.search.query({
        cwd,
        query: q,
        isRegex: state.isRegex,
        caseSensitive: state.caseSensitive,
        wholeWord: state.wholeWord,
        includeGlob: state.includeGlob,
        excludeGlob: state.excludeGlob,
        maxResults: 500,
        contextLines: 0
      });
      state.setResults(result);
    } catch (err) {
      console.error("[CodeSearch] search failed:", err);
      state.setResults({
        matches: [],
        fileCount: 0,
        matchCount: 0,
        truncated: false,
        duration: 0,
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      useCodeSearchStore.getState().setSearching(false);
    }
  }, [cwd]);

  // Group matches by file
  const fileGroups = results
    ? Object.entries(
        results.matches.reduce(
          (acc, m) => {
            if (!acc[m.file]) acc[m.file] = [];
            acc[m.file].push(m);
            return acc;
          },
          {} as Record<string, SearchMatch[]>
        )
      ).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <Flex
      sx={{
        flexDirection: "column",
        height: "100%",
        bg: "background",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3,
          py: 2,
          bg: "background-secondary",
          borderBottom: "1px solid var(--border)"
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2, mb: 2 }}>
          <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>
            Code Search
          </Text>
          {results && !isSearching && (
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {results.matchCount} results in {results.fileCount} files (
              {results.duration}ms)
              {results.truncated && " — truncated"}
            </Text>
          )}
        </Flex>

        {/* Search bar */}
        <Flex sx={{ gap: 1, alignItems: "center" }}>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => useCodeSearchStore.getState().setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            placeholder="Search code..."
            sx={{
              flex: 1,
              fontSize: 13,
              fontFamily: MONO_FONT,
              py: "5px",
              px: 2,
              border: "1px solid var(--border)",
              borderRadius: 4,
              bg: "background",
              color: "paragraph",
              "&:focus": { borderColor: "var(--accent)", outline: "none" }
            }}
          />
          <ToggleBtn
            label=".*"
            active={isRegex}
            onClick={() => useCodeSearchStore.getState().toggleRegex()}
            title="Use Regular Expression"
          />
          <ToggleBtn
            label="Aa"
            active={caseSensitive}
            onClick={() => useCodeSearchStore.getState().toggleCaseSensitive()}
            title="Match Case"
          />
          <ToggleBtn
            label='""'
            active={wholeWord}
            onClick={() => useCodeSearchStore.getState().toggleWholeWord()}
            title="Match Whole Word"
          />
          <Button
            onClick={() => setShowFilters(!showFilters)}
            sx={{
              bg: showFilters ? "var(--accent)" : "transparent",
              color: showFilters ? "#fff" : "paragraph-secondary",
              border: "1px solid var(--border)",
              fontSize: 11,
              px: "6px",
              py: "2px",
              borderRadius: 3,
              cursor: "pointer"
            }}
            title="Toggle file filters"
          >
            ⚙
          </Button>
          <Button
            onClick={runSearch}
            disabled={isSearching || !query.trim()}
            sx={{
              bg: "var(--accent)",
              color: "#fff",
              border: "none",
              fontSize: 12,
              px: 3,
              py: "5px",
              borderRadius: 4,
              cursor: "pointer",
              opacity: isSearching || !query.trim() ? 0.5 : 1
            }}
          >
            {isSearching ? "..." : "Search"}
          </Button>
        </Flex>

        {/* File filters */}
        {showFilters && (
          <Flex sx={{ gap: 2, mt: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Text sx={{ fontSize: 10, color: "paragraph-secondary", mb: 1 }}>
                Include (e.g. *.ts, *.tsx)
              </Text>
              <Input
                value={includeGlob}
                onChange={(e) => useCodeSearchStore.getState().setIncludeGlob(e.target.value)}
                placeholder="*.ts, *.tsx"
                sx={{
                  fontSize: 11,
                  fontFamily: MONO_FONT,
                  py: "3px",
                  px: 1,
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  bg: "background"
                }}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Text sx={{ fontSize: 10, color: "paragraph-secondary", mb: 1 }}>
                Exclude (e.g. node_modules, dist)
              </Text>
              <Input
                value={excludeGlob}
                onChange={(e) => useCodeSearchStore.getState().setExcludeGlob(e.target.value)}
                placeholder="node_modules, dist"
                sx={{
                  fontSize: 11,
                  fontFamily: MONO_FONT,
                  py: "3px",
                  px: 1,
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  bg: "background"
                }}
              />
            </Box>
          </Flex>
        )}
      </Box>

      {/* Results */}
      <Box sx={{ flex: 1, overflow: "auto", px: 2, py: 1 }}>
        {results?.error && (
          <Flex
            sx={{
              bg: "#ef444422",
              border: "1px solid #ef4444",
              px: 3,
              py: 2,
              borderRadius: 6,
              mb: 2
            }}
          >
            <Text
              sx={{ color: "#ef4444", fontSize: 12, fontFamily: MONO_FONT }}
            >
              {results.error}
            </Text>
          </Flex>
        )}

        {isSearching && (
          <Flex
            sx={{
              justifyContent: "center",
              alignItems: "center",
              py: 4
            }}
          >
            <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
              Searching...
            </Text>
          </Flex>
        )}

        {!isSearching && results && results.matchCount === 0 && !results.error && (
          <Flex
            sx={{
              justifyContent: "center",
              alignItems: "center",
              py: 4
            }}
          >
            <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
              No results found
            </Text>
          </Flex>
        )}

        {!isSearching && !results && (
          <Flex
            sx={{
              justifyContent: "center",
              alignItems: "center",
              py: 6,
              flexDirection: "column",
              gap: 2
            }}
          >
            <Text sx={{ fontSize: 24, opacity: 0.3 }}>&#128269;</Text>
            <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
              Search your project files
            </Text>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              Ctrl+Shift+F
            </Text>
          </Flex>
        )}

        {/* File groups */}
        {fileGroups.length > 0 && (
          <Box>
            <Flex sx={{ justifyContent: "flex-end", gap: 1, mb: 1 }}>
              <Button
                onClick={() => useCodeSearchStore.getState().expandAll()}
                sx={{
                  bg: "transparent",
                  color: "paragraph-secondary",
                  border: "none",
                  fontSize: 10,
                  cursor: "pointer",
                  p: "2px 4px",
                  "&:hover": { color: "paragraph" }
                }}
              >
                Expand All
              </Button>
              <Button
                onClick={() => useCodeSearchStore.getState().collapseAll()}
                sx={{
                  bg: "transparent",
                  color: "paragraph-secondary",
                  border: "none",
                  fontSize: 10,
                  cursor: "pointer",
                  p: "2px 4px",
                  "&:hover": { color: "paragraph" }
                }}
              >
                Collapse All
              </Button>
            </Flex>
            {fileGroups.map(([file, matches]) => (
              <FileGroup
                key={file}
                file={file}
                matches={matches}
                expanded={expandedFiles.has(file)}
                onToggle={() => useCodeSearchStore.getState().toggleFileExpanded(file)}
                query={query}
                isRegex={isRegex}
                caseSensitive={caseSensitive}
              />
            ))}
          </Box>
        )}
      </Box>
    </Flex>
  );
}

// ── Placeholder for web mode ──

function CodeSearchPlaceholder() {
  return (
    <Flex
      sx={{
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        bg: "background"
      }}
    >
      <Box sx={{ textAlign: "center" }}>
        <Text sx={{ fontSize: 24, mb: 2, opacity: 0.3 }}>&#128269;</Text>
        <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>
          Code Search requires the desktop app.
        </Text>
      </Box>
    </Flex>
  );
}

export default function CodeSearchView() {
  if (isDesktopRuntime()) return <CodeSearchReal />;
  return <CodeSearchPlaceholder />;
}
