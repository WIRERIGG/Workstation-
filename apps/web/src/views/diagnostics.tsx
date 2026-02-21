/*
This file is part of the Workstation project.

Diagnostics — error/warning/info panel showing TypeScript + ESLint diagnostics.
Runs tsc --noEmit and eslint, groups results by file, filterable by severity and source.
*/

import { useCallback, useEffect, useState } from "react";
import { Box, Flex, Text, Button } from "@theme-ui/components";
import { isDesktopRuntime } from "../utils/platform";
import {
  useStore as useDiagnosticsStore,
  type Diagnostic,
  type DiagnosticSeverity
} from "../stores/diagnostics-store";

const MONO_FONT =
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace";

const SEVERITY_ICONS: Record<DiagnosticSeverity, string> = {
  error: "✕",
  warning: "⚠",
  info: "ℹ",
  hint: "💡"
};

const SEVERITY_COLORS: Record<DiagnosticSeverity, string> = {
  error: "#ef4444",
  warning: "#f59e0b",
  info: "#60a5fa",
  hint: "#a78bfa"
};

const SOURCE_LABELS: Record<string, string> = {
  typescript: "TS",
  eslint: "ESL"
};

// ── Severity filter pill ──

function SeverityPill({
  severity,
  count,
  active,
  onClick
}: {
  severity: DiagnosticSeverity;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      sx={{
        bg: active ? `${SEVERITY_COLORS[severity]}22` : "transparent",
        color: active ? SEVERITY_COLORS[severity] : "paragraph-secondary",
        border: "1px solid",
        borderColor: active ? SEVERITY_COLORS[severity] : "var(--border)",
        fontSize: 11,
        px: "8px",
        py: "2px",
        borderRadius: 12,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 1,
        "&:hover": { borderColor: SEVERITY_COLORS[severity] }
      }}
    >
      <span>{SEVERITY_ICONS[severity]}</span>
      <span>
        {count} {severity}
        {count !== 1 ? "s" : ""}
      </span>
    </Button>
  );
}

// ── Single diagnostic row ──

function DiagnosticRow({
  diagnostic,
  selected,
  onSelect
}: {
  diagnostic: Diagnostic;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Flex
      onClick={onSelect}
      sx={{
        px: 2,
        py: "3px",
        cursor: "pointer",
        alignItems: "flex-start",
        gap: 1,
        borderRadius: 3,
        bg: selected ? "hover" : "transparent",
        "&:hover": { bg: "hover" }
      }}
    >
      <Text
        sx={{
          color: SEVERITY_COLORS[diagnostic.severity],
          fontSize: 11,
          width: 14,
          textAlign: "center",
          flexShrink: 0,
          mt: "1px"
        }}
      >
        {SEVERITY_ICONS[diagnostic.severity]}
      </Text>
      <Text
        sx={{
          color: "#6b7280",
          fontSize: 11,
          fontFamily: MONO_FONT,
          minWidth: 45,
          flexShrink: 0,
          mt: "1px"
        }}
      >
        {diagnostic.line}:{diagnostic.column}
      </Text>
      <Text
        sx={{
          color: "paragraph",
          fontSize: 12,
          fontFamily: MONO_FONT,
          flex: 1,
          wordBreak: "break-word"
        }}
      >
        {diagnostic.message}
      </Text>
      <Text
        sx={{
          color: "paragraph-secondary",
          fontSize: 10,
          fontFamily: MONO_FONT,
          bg: "background-secondary",
          px: "4px",
          py: "1px",
          borderRadius: 3,
          flexShrink: 0,
          mt: "1px"
        }}
      >
        {SOURCE_LABELS[diagnostic.source]} {diagnostic.code}
      </Text>
    </Flex>
  );
}

// ── File group ──

function FileGroup({
  file,
  diagnostics,
  expanded,
  onToggle,
  selectedDiagnostic,
  onSelectDiagnostic
}: {
  file: string;
  diagnostics: Diagnostic[];
  expanded: boolean;
  onToggle: () => void;
  selectedDiagnostic: Diagnostic | null;
  onSelectDiagnostic: (d: Diagnostic) => void;
}) {
  const fileName = file.split("/").pop() || file;
  const dirPath = file.includes("/")
    ? file.substring(0, file.lastIndexOf("/"))
    : "";
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warnCount = diagnostics.filter((d) => d.severity === "warning").length;

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
            color: errorCount > 0 ? SEVERITY_COLORS.error : "#60a5fa"
          }}
        >
          {fileName}
        </Text>
        <Text sx={{ fontSize: 11, color: "paragraph-secondary", flex: 1 }}>
          {dirPath}
        </Text>
        {errorCount > 0 && (
          <Text
            sx={{
              fontSize: 10,
              color: SEVERITY_COLORS.error,
              bg: `${SEVERITY_COLORS.error}22`,
              px: "5px",
              py: "1px",
              borderRadius: 8,
              fontFamily: MONO_FONT
            }}
          >
            {errorCount}E
          </Text>
        )}
        {warnCount > 0 && (
          <Text
            sx={{
              fontSize: 10,
              color: SEVERITY_COLORS.warning,
              bg: `${SEVERITY_COLORS.warning}22`,
              px: "5px",
              py: "1px",
              borderRadius: 8,
              fontFamily: MONO_FONT
            }}
          >
            {warnCount}W
          </Text>
        )}
      </Flex>

      {expanded && (
        <Box sx={{ pl: 2, borderLeft: "2px solid var(--border)", ml: 2 }}>
          {diagnostics.map((d, i) => (
            <DiagnosticRow
              key={`${d.line}-${d.column}-${i}`}
              diagnostic={d}
              selected={
                selectedDiagnostic?.file === d.file &&
                selectedDiagnostic?.line === d.line &&
                selectedDiagnostic?.column === d.column
              }
              onSelect={() => onSelectDiagnostic(d)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Main Diagnostics view (desktop) ──

function DiagnosticsReal() {
  const results = useDiagnosticsStore((s) => s.results);
  const isRunning = useDiagnosticsStore((s) => s.isRunning);
  const severityFilter = useDiagnosticsStore((s) => s.severityFilter);
  const sourceFilter = useDiagnosticsStore((s) => s.sourceFilter);
  const expandedFiles = useDiagnosticsStore((s) => s.expandedFiles);
  const selectedDiagnostic = useDiagnosticsStore((s) => s.selectedDiagnostic);
  const lastRunAt = useDiagnosticsStore((s) => s.lastRunAt);

  const [activeTab, setActiveTab] = useState<"all" | "tsc" | "eslint">("all");
  const [cwd, setCwd] = useState<string | null>(null);

  // Resolve project directory on mount
  useEffect(() => {
    (async () => {
      const { desktop } = await import("../common/desktop-bridge");
      if (!desktop) return;
      const home = await desktop.filesystem.homeDir.query();
      setCwd(home);
    })().catch(console.error);
  }, []);

  const runDiagnostics = useCallback(
    async (mode: "all" | "tsc" | "eslint") => {
      if (!cwd) return;
      const state = useDiagnosticsStore.getState();
      state.setRunning(true);
      try {
        const { desktop } = await import("../common/desktop-bridge");
        if (!desktop) throw new Error("Desktop bridge not available");

        let result;

        if (mode === "tsc") {
          result = await desktop.diagnostics.runTsc.query({ cwd });
        } else if (mode === "eslint") {
          result = await desktop.diagnostics.runEslint.query({ cwd });
        } else {
          result = await desktop.diagnostics.runAll.query({ cwd });
        }

        state.setResults(result);
      } catch (err) {
        console.error("[Diagnostics] run failed:", err);
        useDiagnosticsStore.getState().setResults({
          diagnostics: [],
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          fileCount: 0,
          duration: 0,
          error: err instanceof Error ? err.message : String(err)
        });
      } finally {
        useDiagnosticsStore.getState().setRunning(false);
      }
    },
    [cwd]
  );

  // Filter diagnostics
  const filtered = results
    ? results.diagnostics.filter(
        (d) =>
          severityFilter[d.severity as keyof typeof severityFilter] !== false &&
          sourceFilter[d.source as keyof typeof sourceFilter] !== false
      )
    : [];

  // Group by file
  const fileGroups = Object.entries(
    filtered.reduce(
      (acc, d) => {
        if (!acc[d.file]) acc[d.file] = [];
        acc[d.file].push(d);
        return acc;
      },
      {} as Record<string, Diagnostic[]>
    )
  ).sort(([a], [b]) => a.localeCompare(b));

  const timeAgo = lastRunAt
    ? `${Math.round((Date.now() - lastRunAt) / 1000)}s ago`
    : null;

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
            Diagnostics
          </Text>
          {results && !isRunning && (
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {results.diagnostics.length} problems in {results.fileCount} files
              ({results.duration}ms)
              {timeAgo && ` — ${timeAgo}`}
            </Text>
          )}
        </Flex>

        {/* Action bar */}
        <Flex sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          {/* Run buttons */}
          <Flex sx={{ gap: 1 }}>
            {(["all", "tsc", "eslint"] as const).map((tab) => (
              <Button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  runDiagnostics(tab);
                }}
                disabled={isRunning}
                sx={{
                  bg:
                    activeTab === tab ? "var(--accent)" : "background",
                  color: activeTab === tab ? "#fff" : "paragraph",
                  border: "1px solid",
                  borderColor:
                    activeTab === tab ? "var(--accent)" : "var(--border)",
                  fontSize: 11,
                  px: 2,
                  py: "3px",
                  borderRadius: 4,
                  cursor: isRunning ? "not-allowed" : "pointer",
                  opacity: isRunning ? 0.6 : 1,
                  textTransform: "uppercase",
                  fontWeight: activeTab === tab ? "bold" : "normal"
                }}
              >
                {tab === "all"
                  ? "Run All"
                  : tab === "tsc"
                    ? "TypeScript"
                    : "ESLint"}
              </Button>
            ))}
          </Flex>

          <Box sx={{ flex: 1 }} />

          {/* Severity filters */}
          {results && (
            <Flex sx={{ gap: 1 }}>
              <SeverityPill
                severity="error"
                count={results.errorCount}
                active={severityFilter.error}
                onClick={() => useDiagnosticsStore.getState().toggleSeverity("error")}
              />
              <SeverityPill
                severity="warning"
                count={results.warningCount}
                active={severityFilter.warning}
                onClick={() => useDiagnosticsStore.getState().toggleSeverity("warning")}
              />
              <SeverityPill
                severity="info"
                count={results.infoCount}
                active={severityFilter.info}
                onClick={() => useDiagnosticsStore.getState().toggleSeverity("info")}
              />
            </Flex>
          )}
        </Flex>
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

        {isRunning && (
          <Flex
            sx={{
              justifyContent: "center",
              alignItems: "center",
              py: 4,
              flexDirection: "column",
              gap: 2
            }}
          >
            <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
              Running diagnostics...
            </Text>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              This may take a moment for large projects
            </Text>
          </Flex>
        )}

        {!isRunning && !results && (
          <Flex
            sx={{
              justifyContent: "center",
              alignItems: "center",
              py: 6,
              flexDirection: "column",
              gap: 2
            }}
          >
            <Text sx={{ fontSize: 24, opacity: 0.3 }}>&#9888;</Text>
            <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
              Run diagnostics to check for errors and warnings
            </Text>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              TypeScript type checking + ESLint
            </Text>
          </Flex>
        )}

        {!isRunning &&
          results &&
          filtered.length === 0 &&
          !results.error && (
            <Flex
              sx={{
                justifyContent: "center",
                alignItems: "center",
                py: 4,
                flexDirection: "column",
                gap: 1
              }}
            >
              <Text sx={{ fontSize: 24 }}>&#10003;</Text>
              <Text sx={{ fontSize: 13, color: "#22c55e" }}>
                No problems found!
              </Text>
            </Flex>
          )}

        {/* File groups */}
        {fileGroups.length > 0 && (
          <Box>
            <Flex sx={{ justifyContent: "flex-end", gap: 1, mb: 1 }}>
              <Button
                onClick={() => useDiagnosticsStore.getState().expandAll()}
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
                onClick={() => useDiagnosticsStore.getState().collapseAll()}
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
            {fileGroups.map(([file, diagnostics]) => (
              <FileGroup
                key={file}
                file={file}
                diagnostics={diagnostics}
                expanded={expandedFiles.has(file)}
                onToggle={() => useDiagnosticsStore.getState().toggleFileExpanded(file)}
                selectedDiagnostic={selectedDiagnostic}
                onSelectDiagnostic={(d) => useDiagnosticsStore.getState().selectDiagnostic(d)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Flex>
  );
}

// ── Placeholder for web mode ──

function DiagnosticsPlaceholder() {
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
        <Text sx={{ fontSize: 24, mb: 2, opacity: 0.3 }}>&#9888;</Text>
        <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>
          Diagnostics requires the desktop app.
        </Text>
      </Box>
    </Flex>
  );
}

export default function DiagnosticsView() {
  if (isDesktopRuntime()) return <DiagnosticsReal />;
  return <DiagnosticsPlaceholder />;
}
