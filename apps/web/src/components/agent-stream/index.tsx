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

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Text } from "@theme-ui/components";
import { useStore as useAgentStore } from "../../stores/agent-store";

// ── Line Types & Colors ──

const LINE_COLORS: Record<string, string> = {
  stdout: "#e0e0e0",
  stderr: "#ef4444",
  tool_call: "#a78bfa",
  thinking: "#6b7280",
  result: "#22c55e",
  info: "#60a5fa",
  error: "#f87171"
};

// ── Agent Stream Component ──

type AgentStreamProps = {
  agentId: string;
  maxHeight?: number | string;
  compact?: boolean;
};

export function AgentStream({
  agentId,
  maxHeight = 400,
  compact = false
}: AgentStreamProps) {
  const stream = useAgentStore((s) =>
    s.agentStreams.find((st) => st.agentId === agentId)
  );
  const clearStream = useAgentStore((s) => s.clearStream);

  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const lines = stream?.lines ?? [];
  const isActive = stream?.isActive ?? false;

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  // Detect manual scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    if (!isAtBottom && !userScrolledRef.current) {
      userScrolledRef.current = true;
      setAutoScroll(false);
    }
    if (isAtBottom && userScrolledRef.current) {
      userScrolledRef.current = false;
      setAutoScroll(true);
    }
  }, []);

  const handleResume = useCallback(() => {
    setAutoScroll(true);
    userScrolledRef.current = false;
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        bg: "#0d1117",
        borderRadius: compact ? 6 : 8,
        border: "1px solid #30363d",
        overflow: "hidden",
        height: "100%"
      }}
    >
      {/* Header */}
      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1,
          bg: "#161b22",
          borderBottom: "1px solid #30363d",
          minHeight: compact ? 28 : 32
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              bg: isActive ? "#22c55e" : "#6b7280",
              boxShadow: isActive ? "0 0 6px #22c55e" : "none"
            }}
          />
          <Text
            sx={{
              fontSize: compact ? 10 : 11,
              color: "#8b949e",
              fontFamily: "monospace"
            }}
          >
            {isActive ? "LIVE" : "IDLE"} | {lines.length} lines
          </Text>
        </Flex>
        <Flex sx={{ gap: 1 }}>
          {!autoScroll && (
            <Button
              onClick={handleResume}
              sx={{
                fontSize: 9,
                py: 0,
                px: 1,
                bg: "#1f6feb",
                color: "#fff",
                border: "none",
                borderRadius: 3,
                cursor: "pointer",
                lineHeight: "16px",
                "&:hover": { bg: "#388bfd" }
              }}
            >
              Resume
            </Button>
          )}
          <Button
            onClick={() => clearStream(agentId)}
            sx={{
              fontSize: 9,
              py: 0,
              px: 1,
              bg: "transparent",
              color: "#8b949e",
              border: "1px solid #30363d",
              borderRadius: 3,
              cursor: "pointer",
              lineHeight: "16px",
              "&:hover": { bg: "#21262d", color: "#c9d1d9" }
            }}
          >
            Clear
          </Button>
        </Flex>
      </Flex>

      {/* Log Lines */}
      <Box
        ref={containerRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: "auto",
          maxHeight,
          p: 1,
          fontFamily: "monospace",
          fontSize: compact ? 10 : 11,
          lineHeight: compact ? "16px" : "18px",
          "&::-webkit-scrollbar": { width: 6 },
          "&::-webkit-scrollbar-track": { bg: "#0d1117" },
          "&::-webkit-scrollbar-thumb": {
            bg: "#30363d",
            borderRadius: 3
          }
        }}
      >
        {lines.length === 0 ? (
          <Text
            sx={{
              color: "#484f58",
              fontSize: compact ? 10 : 11,
              p: 2,
              fontStyle: "italic"
            }}
          >
            No output yet. Start an agent to see streaming output here.
          </Text>
        ) : (
          lines.map((line, i) => (
            <Flex key={`${line.timestamp}-${i}`} sx={{ gap: 1, px: 1 }}>
              <Text
                sx={{
                  color: "#484f58",
                  flexShrink: 0,
                  userSelect: "none"
                }}
              >
                {formatTime(line.timestamp)}
              </Text>
              <Text
                sx={{
                  color: LINE_COLORS[line.type] || "#e0e0e0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  flex: 1,
                  opacity: line.type === "thinking" ? 0.6 : 1
                }}
              >
                {line.content}
              </Text>
            </Flex>
          ))
        )}
      </Box>
    </Flex>
  );
}
