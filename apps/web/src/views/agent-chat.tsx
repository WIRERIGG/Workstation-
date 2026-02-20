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

import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import {
  useStore as useChatStore,
  ChatMessage
} from "../stores/chat-store";
import { useStore as useOpenClawStore } from "../stores/openclaw-store";
import { MarkdownText } from "../components/agent-chat/markdown-text";

// ── Terminal Color Palette ──

const T = {
  bg: "#0d1117",
  bgHeader: "#161b22",
  border: "#30363d",
  text: "#e2e8f0",
  textMuted: "#8b949e",
  green: "#22c55e",
  blue: "#60a5fa",
  yellow: "#eab308",
  red: "#ef4444",
  purple: "#a78bfa",
  accent: "#22c55e",
  font: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace"
} as const;

// ── Tool Color Map ──

const TOOL_COLORS: Record<string, string> = {
  Read: T.green,
  Write: T.blue,
  Edit: T.yellow,
  Bash: T.red,
  Grep: T.purple,
  Glob: T.purple,
  WebFetch: T.blue,
  WebSearch: T.blue,
  Task: T.yellow
};

function getToolColor(toolName: string): string {
  return TOOL_COLORS[toolName] || T.textMuted;
}

// ── Connection Indicator (reused logic, terminal-styled) ──

function ConnectionDot() {
  const connectionState = useOpenClawStore((s) => s.connectionState);

  const stateConfig: Record<string, { color: string; label: string }> = {
    disconnected: { color: T.textMuted, label: "Offline" },
    connecting: { color: T.yellow, label: "Connecting..." },
    authenticating: { color: T.yellow, label: "Auth..." },
    connected: { color: T.green, label: "OpenClaw" },
    error: { color: T.red, label: "Error" }
  };

  const config = stateConfig[connectionState] || stateConfig.disconnected;

  return (
    <Flex sx={{ alignItems: "center", gap: "6px" }}>
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bg: config.color,
          boxShadow:
            connectionState === "connected"
              ? `0 0 6px ${config.color}`
              : "none",
          flexShrink: 0
        }}
      />
      <Text
        sx={{
          fontSize: 11,
          color: config.color,
          fontFamily: T.font
        }}
      >
        {config.label}
      </Text>
    </Flex>
  );
}

// ── Rich Tool Call Block ──

function ToolCallBlock({
  toolCall
}: {
  toolCall: { toolName: string; status: string };
}) {
  const [collapsed, setCollapsed] = useState(toolCall.status !== "running");
  const color = getToolColor(toolCall.toolName);
  const isRunning = toolCall.status === "running";

  return (
    <Box
      sx={{
        borderLeft: `3px solid ${color}`,
        my: "4px",
        bg: "#161b22",
        borderRadius: "0 4px 4px 0",
        overflow: "hidden"
      }}
    >
      <Flex
        sx={{
          alignItems: "center",
          gap: 2,
          px: 2,
          py: "6px",
          cursor: "pointer",
          "&:hover": { bg: "#1c2333" }
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Text
          sx={{
            fontSize: 10,
            fontFamily: T.font,
            fontWeight: "bold",
            color: "#0d1117",
            bg: color,
            px: "6px",
            py: "1px",
            borderRadius: 3,
            textTransform: "uppercase",
            letterSpacing: "0.5px"
          }}
        >
          {toolCall.toolName}
        </Text>
        <Text sx={{ fontSize: 11, color: T.textMuted, fontFamily: T.font }}>
          {isRunning ? (
            <Text as="span" sx={{ color: T.yellow }}>
              running...
            </Text>
          ) : toolCall.status === "complete" ? (
            <Text as="span" sx={{ color: T.green }}>
              done
            </Text>
          ) : (
            <Text as="span" sx={{ color: T.red }}>
              error
            </Text>
          )}
        </Text>
        <Text
          sx={{
            fontSize: 10,
            color: T.textMuted,
            ml: "auto",
            fontFamily: T.font
          }}
        >
          {collapsed ? "+" : "-"}
        </Text>
      </Flex>
    </Box>
  );
}

// ── User Input Line ──

function UserLine({ message }: { message: ChatMessage }) {
  return (
    <Flex sx={{ px: 3, py: "4px", alignItems: "flex-start", gap: 1 }}>
      <Text
        sx={{
          color: T.green,
          fontFamily: T.font,
          fontSize: 13,
          fontWeight: "bold",
          flexShrink: 0,
          lineHeight: 1.6
        }}
      >
        {">"}
      </Text>
      <Text
        sx={{
          color: T.text,
          fontFamily: T.font,
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word"
        }}
      >
        {message.content}
      </Text>
    </Flex>
  );
}

// ── Agent Response Block ──

function AgentBlock({ message }: { message: ChatMessage }) {
  return (
    <Box
      sx={{
        px: 3,
        py: 2,
        borderBottom: `1px solid ${T.border}`,
        "&:last-of-type": { borderBottom: "none" }
      }}
    >
      {/* Agent header */}
      {message.agentName && (
        <Flex sx={{ alignItems: "center", gap: 1, mb: 1 }}>
          <Text
            sx={{
              fontSize: 12,
              fontWeight: "bold",
              color: T.blue,
              fontFamily: T.font
            }}
          >
            {message.agentName}
          </Text>
          {message.agentId === "openclaw" && (
            <Text
              sx={{
                fontSize: 11,
                color: T.textMuted,
                fontFamily: T.font
              }}
            >
              {" "}claude-opus-4-6
            </Text>
          )}
        </Flex>
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box sx={{ mb: 1 }}>
          {message.toolCalls.map((tc, i) => (
            <ToolCallBlock key={i} toolCall={tc} />
          ))}
        </Box>
      )}

      {/* Content */}
      <Box
        sx={{
          fontSize: 13,
          lineHeight: 1.6,
          color: T.text,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          "& pre": {
            bg: "#161b22",
            color: T.text,
            border: `1px solid ${T.border}`,
            borderRadius: 4,
            p: 2,
            fontFamily: T.font,
            fontSize: 12
          },
          "& code": {
            bg: "#161b22",
            color: T.text,
            fontFamily: T.font,
            fontSize: "0.9em",
            px: "4px",
            py: "1px",
            borderRadius: 3,
            border: `1px solid ${T.border}`
          }
        }}
      >
        {message.content ? (
          <MarkdownText content={message.content} />
        ) : message.isStreaming ? (
          ""
        ) : (
          "..."
        )}
        {message.isStreaming && (
          <Text
            as="span"
            sx={{
              display: "inline-block",
              color: T.green,
              fontFamily: T.font,
              fontSize: 14,
              ml: "1px",
              animation: "blink 1s steps(2) infinite"
            }}
          >
            {"▊"}
          </Text>
        )}
      </Box>

      {/* Metadata line */}
      <Flex sx={{ alignItems: "center", gap: 2, mt: "4px" }}>
        <Text sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.font }}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
          })}
        </Text>
        {message.metadata?.tokenCount && (
          <Text sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.font }}>
            {message.metadata.tokenCount} tokens
          </Text>
        )}
      </Flex>
    </Box>
  );
}

// ── System Message Line ──

function SystemLine({ message }: { message: ChatMessage }) {
  return (
    <Box sx={{ px: 3, py: "4px" }}>
      <Text
        sx={{
          fontSize: 12,
          color: T.blue,
          fontFamily: T.font,
          lineHeight: 1.6
        }}
      >
        <Text as="span" sx={{ color: T.textMuted }}>
          [system]
        </Text>{" "}
        {message.content}
      </Text>
    </Box>
  );
}

// ── Message Router ──

function MessageBlock({ message }: { message: ChatMessage }) {
  if (message.role === "user") return <UserLine message={message} />;
  if (message.role === "system") return <SystemLine message={message} />;
  return <AgentBlock message={message} />;
}

// ── Status Bar ──

function StatusBar() {
  const connectionState = useOpenClawStore((s) => s.connectionState);
  const isStreaming = useOpenClawStore((s) => s.isStreaming);
  const activeToolCalls = useOpenClawStore((s) => s.activeToolCalls);
  const messages = useChatStore((s) => s.messages);

  const lastAgentMsg = [...messages]
    .reverse()
    .find((m) => m.role === "agent");

  const activeAgent = isStreaming && lastAgentMsg?.agentName
    ? lastAgentMsg.agentName
    : null;

  const lastTokenCount = lastAgentMsg?.metadata?.tokenCount;

  const stateConfig: Record<string, { color: string; label: string }> = {
    disconnected: { color: T.textMuted, label: "Offline" },
    connecting: { color: T.yellow, label: "Connecting" },
    authenticating: { color: T.yellow, label: "Auth" },
    connected: { color: T.green, label: "Connected" },
    error: { color: T.red, label: "Error" }
  };
  const config = stateConfig[connectionState] || stateConfig.disconnected;

  return (
    <Flex
      sx={{
        alignItems: "center",
        justifyContent: "space-between",
        px: 3,
        py: "4px",
        bg: T.bgHeader,
        borderTop: `1px solid ${T.border}`,
        flexShrink: 0,
        minHeight: 24
      }}
    >
      {/* Left: connection state */}
      <Flex sx={{ alignItems: "center", gap: "6px" }}>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bg: config.color,
            boxShadow:
              connectionState === "connected"
                ? `0 0 4px ${config.color}`
                : "none"
          }}
        />
        <Text sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.font }}>
          {config.label}
        </Text>
        {activeToolCalls.length > 0 && (
          <Text sx={{ fontSize: 10, color: T.yellow, fontFamily: T.font }}>
            {activeToolCalls.map((t) => t.toolName).join(", ")}
          </Text>
        )}
      </Flex>

      {/* Center: active agent */}
      {activeAgent && (
        <Text sx={{ fontSize: 10, color: T.blue, fontFamily: T.font }}>
          {activeAgent}
        </Text>
      )}

      {/* Right: token count + hint */}
      <Flex sx={{ alignItems: "center", gap: 2 }}>
        {lastTokenCount && (
          <Text sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.font }}>
            {lastTokenCount} tokens
          </Text>
        )}
        <Text sx={{ fontSize: 10, color: T.textMuted, fontFamily: T.font }}>
          Ctrl+J
        </Text>
      </Flex>
    </Flex>
  );
}

// ── Main Agent Chat View (OpenClaw Terminal Style) ──

export default function AgentChatView() {
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearChat = useChatStore((s) => s.clearChat);
  const connectionState = useOpenClawStore((s) => s.connectionState);
  const isStreaming = useOpenClawStore((s) => s.isStreaming);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing, isStreaming]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;
    sendMessage(trimmed);
    setInput("");
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        height: "100%",
        bg: T.bg,
        overflow: "hidden",
        fontFamily: T.font
      }}
    >
      {/* Blink animation */}
      <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>

      {/* Header */}
      <Flex
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 3,
          py: 2,
          bg: T.bgHeader,
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          {/* OpenClaw logo */}
          <Text sx={{ fontSize: 18, ml: 1 }}>
            {connectionState === "connected" ? (
              <svg
                width="18"
                height="18"
                viewBox="-15 -5 230 224"
                style={{ verticalAlign: "middle" }}
              >
                <polygon
                  points="0,0.9 0,35.9 12.8,54.1 81.4,83.2 99.7,107.9 118.3,83.4 186.5,54.7 200,36.1 200,0 186.1,24.2 100.8,49.6 13.9,24.2"
                  fill="#22c55e"
                />
                <polygon
                  points="31.7,65.9 31.7,112.4 58.3,129.7 58.3,159.9 85.5,214 85.7,111.5 43.6,86.6 41.2,73.1"
                  fill="#22c55e"
                />
                <polygon
                  points="168.5,66.2 158.8,73.4 156.1,86.8 114.5,111.3 114.5,214 141.7,160.2 141.7,129.7 168.5,112.4"
                  fill="#22c55e"
                />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="-15 -5 230 224"
                style={{ verticalAlign: "middle" }}
              >
                <polygon
                  points="0,0.9 0,35.9 12.8,54.1 81.4,83.2 99.7,107.9 118.3,83.4 186.5,54.7 200,36.1 200,0 186.1,24.2 100.8,49.6 13.9,24.2"
                  fill="#E00000"
                />
                <polygon
                  points="31.7,65.9 31.7,112.4 58.3,129.7 58.3,159.9 85.5,214 85.7,111.5 43.6,86.6 41.2,73.1"
                  fill="#E00000"
                />
                <polygon
                  points="168.5,66.2 158.8,73.4 156.1,86.8 114.5,111.3 114.5,214 141.7,160.2 141.7,129.7 168.5,112.4"
                  fill="#E00000"
                />
              </svg>
            )}
          </Text>

          <Flex sx={{ flexDirection: "column" }}>
            <Text
              sx={{
                fontSize: 13,
                color: T.textMuted,
                fontFamily: T.font
              }}
            >
              openclaw — agent chat
            </Text>
          </Flex>

          <ConnectionDot />
        </Flex>

        <Button
          onClick={clearChat}
          title="Clear chat"
          sx={{
            bg: "transparent",
            border: `1px solid ${T.border}`,
            color: T.textMuted,
            fontSize: 11,
            fontFamily: T.font,
            px: 2,
            py: 1,
            borderRadius: 6,
            cursor: "pointer",
            "&:hover": { color: T.text, borderColor: T.textMuted }
          }}
        >
          Clear
        </Button>
      </Flex>

      {/* Messages — scrollable area */}
      <Flex
        sx={{
          flex: 1,
          flexDirection: "column",
          overflow: "auto",
          py: 1,
          "&::-webkit-scrollbar": { width: 6 },
          "&::-webkit-scrollbar-thumb": {
            bg: T.border,
            borderRadius: 3
          }
        }}
      >
        {messages.map((msg) => (
          <MessageBlock key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </Flex>

      {/* Status bar */}
      <StatusBar />

      {/* Input bar */}
      <Flex
        sx={{
          px: 3,
          py: 2,
          gap: 2,
          bg: T.bgHeader,
          borderTop: `1px solid ${T.border}`,
          flexShrink: 0,
          alignItems: "center"
        }}
      >
        <Text
          sx={{
            color: T.green,
            fontFamily: T.font,
            fontSize: 14,
            fontWeight: "bold",
            flexShrink: 0
          }}
        >
          {">"}
        </Text>
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            connectionState === "connected"
              ? "Type a message..."
              : "Type a message..."
          }
          disabled={isProcessing}
          spellCheck={false}
          autoComplete="off"
          sx={{
            flex: 1,
            bg: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: 4,
            color: T.text,
            fontSize: 13,
            fontFamily: T.font,
            px: 2,
            py: "6px",
            caretColor: T.green,
            "&:focus": {
              outline: "none",
              borderColor: T.green,
              boxShadow: `0 0 0 1px ${T.green}33`
            },
            "&::placeholder": { color: T.textMuted }
          }}
        />
        <Button
          onClick={handleSend}
          disabled={isProcessing}
          sx={{
            bg: T.green,
            color: "#0d1117",
            fontSize: 12,
            fontFamily: T.font,
            fontWeight: "bold",
            px: 3,
            py: "6px",
            borderRadius: 4,
            border: "none",
            cursor: isProcessing ? "not-allowed" : "pointer",
            opacity: isProcessing ? 0.5 : 1,
            "&:hover": { bg: "#16a34a" }
          }}
        >
          Send
        </Button>
      </Flex>
    </Flex>
  );
}
