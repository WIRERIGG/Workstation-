/*
This file is part of the Workstation project

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

import { useState, useEffect } from "react";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import { AppEventManager, AppEvents } from "../common/app-events";
import {
  useStore as useCommsStore,
  CommMessage,
  CommChannel,
  CommTriageStatus,
  CallSentiment
} from "../stores/comms-store";

const CHANNEL_CONFIG: Record<
  CommChannel,
  { label: string; icon: string; color: string }
> = {
  email: { label: "Email", icon: "📧", color: "#3b82f6" },
  message: { label: "Message", icon: "💬", color: "#8b5cf6" },
  phone: { label: "Phone", icon: "📞", color: "#22c55e" }
};

const TRIAGE_CONFIG: Record<
  CommTriageStatus,
  { label: string; color: string }
> = {
  unread: { label: "Unread", color: "#ef4444" },
  triaged: { label: "Triaged", color: "#f59e0b" },
  replied: { label: "Replied", color: "#22c55e" },
  archived: { label: "Archived", color: "#94a3b8" },
  flagged: { label: "Flagged", color: "#ef4444" }
};

function ChannelIcon({ channel }: { channel: CommChannel }) {
  const config = CHANNEL_CONFIG[channel];
  return (
    <Flex
      sx={{
        width: 28,
        height: 28,
        borderRadius: 6,
        bg: `${config.color}15`,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0
      }}
    >
      <Text sx={{ fontSize: 14, lineHeight: 1 }}>{config.icon}</Text>
    </Flex>
  );
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const SENTIMENT_CONFIG: Record<CallSentiment, { label: string; color: string; icon: string }> = {
  positive: { label: "Positive", color: "#22c55e", icon: "+" },
  neutral: { label: "Neutral", color: "#94a3b8", icon: "~" },
  negative: { label: "Negative", color: "#ef4444", icon: "-" }
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function SentimentBadge({ sentiment }: { sentiment: CallSentiment }) {
  const config = SENTIMENT_CONFIG[sentiment];
  return (
    <Text
      sx={{
        fontSize: 10,
        fontWeight: "bold",
        px: "5px",
        py: "1px",
        borderRadius: 10,
        bg: `${config.color}15`,
        color: config.color
      }}
    >
      {config.icon} {config.label}
    </Text>
  );
}

// ── Compose Message Form ──

function ComposeForm({ onClose }: { onClose: () => void }) {
  const addMessage = useCommsStore((s) => s.addMessage);

  const [channel, setChannel] = useState<CommChannel>("email");
  const [toName, setToName] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const channels: CommChannel[] = ["email", "message", "phone"];

  const handleSend = () => {
    if (!body.trim() || !toAddress.trim()) return;
    addMessage({
      channel,
      direction: "outbound",
      triageStatus: "replied",
      from: { name: "You", address: "you@workstation.ai" },
      to: [{ name: toName.trim() || toAddress.trim(), address: toAddress.trim() }],
      subject: subject.trim(),
      body: body.trim(),
      preview: body.trim().slice(0, 80) + (body.trim().length > 80 ? "..." : ""),
      threadId: null,
      tags: [],
      linkedTaskId: null,
      attachments: []
    });
    onClose();
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        flex: 1,
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden"
      }}
    >
      <Flex
        sx={{
          p: 3,
          borderBottom: "1px solid var(--border)",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>
          New Message
        </Text>
        <Button
          variant="secondary"
          sx={{ fontSize: 11, px: 2, py: 1 }}
          onClick={onClose}
        >
          Cancel
        </Button>
      </Flex>

      <Flex sx={{ flexDirection: "column", p: 3, gap: 2, flex: 1 }}>
        {/* Channel selector */}
        <Flex sx={{ gap: 1 }}>
          {channels.map((c) => (
            <Button
              key={c}
              variant={channel === c ? "accent" : "secondary"}
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={() => setChannel(c)}
            >
              {CHANNEL_CONFIG[c].icon} {CHANNEL_CONFIG[c].label}
            </Button>
          ))}
        </Flex>

        <Input
          placeholder="To (name)"
          value={toName}
          onChange={(e) => setToName(e.target.value)}
          sx={{ fontSize: 12 }}
        />
        <Input
          placeholder={
            channel === "email"
              ? "Email address"
              : channel === "phone"
                ? "Phone number"
                : "Handle (@username)"
          }
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
          sx={{ fontSize: 12 }}
        />
        {channel === "email" && (
          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            sx={{ fontSize: 12 }}
          />
        )}
        <textarea
          placeholder="Message body..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{
            flex: 1,
            fontSize: 13,
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--paragraph)",
            resize: "none",
            minHeight: "120px",
            fontFamily: "inherit",
            lineHeight: "1.6"
          }}
        />

        <Flex sx={{ gap: 1 }}>
          <Button
            variant="accent"
            sx={{ fontSize: 12 }}
            onClick={handleSend}
            disabled={!body.trim() || !toAddress.trim()}
          >
            Send
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}

// ── Message Row ──

function MessageRow({
  message,
  isSelected,
  onSelect
}: {
  message: CommMessage;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Flex
      onClick={onSelect}
      sx={{
        alignItems: "flex-start",
        gap: 2,
        py: 2,
        px: 3,
        borderRadius: 6,
        bg: isSelected ? "hover" : "transparent",
        border: isSelected ? "1px solid var(--accent)" : "1px solid transparent",
        cursor: "pointer",
        "&:hover": { bg: "hover" }
      }}
    >
      <ChannelIcon channel={message.channel} />

      <Flex sx={{ flexDirection: "column", flex: 1, minWidth: 0, gap: "2px" }}>
        <Flex sx={{ alignItems: "center", gap: 1 }}>
          <Text
            sx={{
              fontSize: 13,
              fontWeight: message.isRead ? "normal" : "bold",
              color: message.isRead ? "paragraph" : "heading",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {message.direction === "outbound" ? `To: ${message.to[0]?.name || ""}` : message.from.name}
          </Text>
          <Text sx={{ fontSize: 11, color: "paragraph-secondary", flexShrink: 0 }}>
            {formatTimeAgo(message.timestamp)}
          </Text>
        </Flex>

        {message.subject && (
          <Text
            sx={{
              fontSize: 12,
              fontWeight: message.isRead ? "normal" : "bold",
              color: message.isRead ? "paragraph-secondary" : "heading",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {message.subject}
          </Text>
        )}

        <Text
          sx={{
            fontSize: 12,
            color: "paragraph-secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {message.preview}
        </Text>

        <Flex sx={{ alignItems: "center", gap: 1, mt: "2px" }}>
          {!message.isRead && (
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bg: "#3b82f6",
                flexShrink: 0
              }}
            />
          )}
          <Text
            sx={{
              fontSize: 10,
              color: TRIAGE_CONFIG[message.triageStatus].color
            }}
          >
            {TRIAGE_CONFIG[message.triageStatus].label}
          </Text>
          {message.agentSummary && (
            <Text sx={{ fontSize: 10, color: "#f59e0b" }}>🤖 AI triaged</Text>
          )}
          {message.agentDraftReply && (
            <Text sx={{ fontSize: 10, color: "#22c55e" }}>✏️ Draft ready</Text>
          )}
          {message.direction === "outbound" && (
            <Text sx={{ fontSize: 10, color: "#3b82f6" }}>↗ Sent</Text>
          )}
          {message.attachments.length > 0 && (
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
              📎 {message.attachments.length}
            </Text>
          )}
          {message.channel === "phone" && message.sentiment && (
            <SentimentBadge sentiment={message.sentiment} />
          )}
          {message.channel === "phone" && message.duration !== undefined && (
            <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
              {formatDuration(message.duration)}
            </Text>
          )}
          {message.callbackRequested && (
            <Text
              sx={{
                fontSize: 10,
                fontWeight: "bold",
                px: "5px",
                py: "1px",
                borderRadius: 10,
                bg: "#f59e0b15",
                color: "#f59e0b"
              }}
            >
              Callback
            </Text>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
}

// ── Message Detail ──

function MessageDetail({ message }: { message: CommMessage }) {
  const updateTriageStatus = useCommsStore((s) => s.updateTriageStatus);
  const archiveMessage = useCommsStore((s) => s.archiveMessage);
  const flagMessage = useCommsStore((s) => s.flagMessage);
  const deleteMessage = useCommsStore((s) => s.deleteMessage);
  const sendReply = useCommsStore((s) => s.sendReply);
  const updateDraftReply = useCommsStore((s) => s.updateDraftReply);
  const markAsUnread = useCommsStore((s) => s.markAsUnread);
  const selectMessage = useCommsStore((s) => s.selectMessage);

  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState(message.agentDraftReply || "");
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftText, setDraftText] = useState(message.agentDraftReply || "");
  const [showTranscript, setShowTranscript] = useState(false);

  const handleSendReply = () => {
    if (!replyText.trim()) return;
    sendReply(message.id, replyText.trim());
    setShowReply(false);
    setReplyText("");
  };

  const handleSaveDraft = () => {
    updateDraftReply(message.id, draftText.trim() || null);
    setEditingDraft(false);
  };

  const handleUseDraft = () => {
    setReplyText(message.agentDraftReply || "");
    setShowReply(true);
  };

  return (
    <Flex
      sx={{
        flexDirection: "column",
        flex: 1,
        bg: "background-secondary",
        borderRadius: 8,
        border: "1px solid var(--border)",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <Flex
        sx={{
          flexDirection: "column",
          p: 3,
          gap: 2,
          borderBottom: "1px solid var(--border)"
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2 }}>
          <ChannelIcon channel={message.channel} />
          <Flex sx={{ flexDirection: "column", flex: 1 }}>
            <Text sx={{ fontSize: 14, fontWeight: "bold", color: "heading" }}>
              {message.direction === "outbound"
                ? `To: ${message.to[0]?.name || message.to[0]?.address || ""}`
                : message.from.name}
            </Text>
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {message.direction === "outbound"
                ? message.to[0]?.address
                : message.from.address}{" "}
              &middot; {new Date(message.timestamp).toLocaleString()}
            </Text>
          </Flex>
          <Flex sx={{ gap: 1, flexWrap: "wrap" }}>
            {message.direction === "inbound" && (
              <Button
                variant="accent"
                sx={{ fontSize: 11, px: 2, py: 1 }}
                onClick={() => setShowReply(!showReply)}
              >
                {showReply ? "Cancel" : "Reply"}
              </Button>
            )}
            <Button
              variant="secondary"
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={() => archiveMessage(message.id)}
            >
              Archive
            </Button>
            <Button
              variant="secondary"
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={() =>
                message.triageStatus === "flagged"
                  ? updateTriageStatus(message.id, "triaged")
                  : flagMessage(message.id)
              }
            >
              {message.triageStatus === "flagged" ? "Unflag" : "Flag"}
            </Button>
            {message.isRead && (
              <Button
                variant="secondary"
                sx={{ fontSize: 11, px: 2, py: 1 }}
                onClick={() => markAsUnread(message.id)}
              >
                Mark Unread
              </Button>
            )}
            <Button
              variant="secondary"
              sx={{ fontSize: 11, px: 2, py: 1, color: "#ef4444" }}
              onClick={() => {
                deleteMessage(message.id);
              }}
            >
              Delete
            </Button>
          </Flex>
        </Flex>

        {message.subject && (
          <Text sx={{ fontSize: 16, fontWeight: "bold", color: "heading" }}>
            {message.subject}
          </Text>
        )}

        {message.to.length > 0 && message.direction === "inbound" && (
          <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
            To: {message.to.map((p) => p.name || p.address).join(", ")}
          </Text>
        )}

        {/* Phone call metadata bar */}
        {message.channel === "phone" && (message.sentiment || message.duration !== undefined || message.callbackRequested) && (
          <Flex sx={{ alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            {message.sentiment && <SentimentBadge sentiment={message.sentiment} />}
            {message.duration !== undefined && (
              <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
                Duration: {formatDuration(message.duration)}
              </Text>
            )}
            {message.callbackRequested && (
              <Text
                sx={{
                  fontSize: 10,
                  fontWeight: "bold",
                  px: "6px",
                  py: "2px",
                  borderRadius: 10,
                  bg: "#f59e0b15",
                  color: "#f59e0b",
                  border: "1px solid #f59e0b30"
                }}
              >
                Callback Requested
              </Text>
            )}
            {message.transcript && (
              <Text
                onClick={() => setShowTranscript(!showTranscript)}
                sx={{
                  fontSize: 10,
                  color: "accent",
                  cursor: "pointer",
                  "&:hover": { textDecoration: "underline" }
                }}
              >
                {showTranscript ? "Hide Transcript" : "View Transcript"}
              </Text>
            )}
          </Flex>
        )}
      </Flex>

      {/* Body */}
      <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
        {/* AI Summary */}
        {message.agentSummary && (
          <Flex
            sx={{
              flexDirection: "column",
              mb: 3,
              p: 2,
              borderRadius: 6,
              bg: "#f59e0b10",
              border: "1px solid #f59e0b30"
            }}
          >
            <Flex sx={{ alignItems: "center", gap: 1, mb: 1 }}>
              <Text sx={{ fontSize: 12 }}>🤖</Text>
              <Text
                sx={{
                  fontSize: 11,
                  fontWeight: "bold",
                  color: "#f59e0b",
                  textTransform: "uppercase"
                }}
              >
                Agent Summary
              </Text>
            </Flex>
            <Text sx={{ fontSize: 12, color: "paragraph", lineHeight: 1.5 }}>
              {message.agentSummary}
            </Text>
          </Flex>
        )}

        {/* Message body */}
        <Text
          sx={{
            fontSize: 13,
            color: "paragraph",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap"
          }}
        >
          {message.body}
        </Text>

        {/* Call Transcript */}
        {message.channel === "phone" && message.transcript && showTranscript && (
          <Flex
            sx={{
              flexDirection: "column",
              mt: 3,
              p: 2,
              borderRadius: 6,
              bg: "#3b82f610",
              border: "1px solid #3b82f630"
            }}
          >
            <Flex sx={{ alignItems: "center", gap: 1, mb: 2 }}>
              <Text sx={{ fontSize: 12 }}>📝</Text>
              <Text
                sx={{
                  fontSize: 11,
                  fontWeight: "bold",
                  color: "#3b82f6",
                  textTransform: "uppercase"
                }}
              >
                Call Transcript
              </Text>
              {message.duration !== undefined && (
                <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                  ({formatDuration(message.duration)})
                </Text>
              )}
            </Flex>
            <Box
              sx={{
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 1.8,
                whiteSpace: "pre-wrap",
                color: "paragraph",
                maxHeight: 300,
                overflow: "auto"
              }}
            >
              {message.transcript.split("\n").map((line, i) => {
                const colonIdx = line.indexOf(":");
                if (colonIdx === -1) return <Text key={i}>{line}</Text>;
                const speaker = line.slice(0, colonIdx);
                const speech = line.slice(colonIdx + 1);
                return (
                  <Text key={i} sx={{ mb: 1 }}>
                    <Text as="span" sx={{ fontWeight: "bold", color: "heading" }}>
                      {speaker}:
                    </Text>
                    {speech}
                  </Text>
                );
              })}
            </Box>
          </Flex>
        )}

        {/* Attachments */}
        {message.attachments.length > 0 && (
          <Flex sx={{ flexDirection: "column", mt: 3, gap: 1 }}>
            <Text
              sx={{
                fontSize: 11,
                fontWeight: "bold",
                color: "paragraph-secondary",
                textTransform: "uppercase"
              }}
            >
              Attachments
            </Text>
            {message.attachments.map((att, i) => (
              <Flex
                key={i}
                sx={{
                  alignItems: "center",
                  gap: 2,
                  p: 2,
                  borderRadius: 4,
                  bg: "background",
                  border: "1px solid var(--border)"
                }}
              >
                <Text sx={{ fontSize: 14 }}>📎</Text>
                <Flex sx={{ flexDirection: "column" }}>
                  <Text sx={{ fontSize: 12, color: "heading" }}>{att.name}</Text>
                  <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
                    {(att.size / 1024).toFixed(0)} KB
                  </Text>
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}

        {/* Draft Reply */}
        {message.agentDraftReply && !editingDraft && (
          <Flex
            sx={{
              flexDirection: "column",
              mt: 3,
              p: 2,
              borderRadius: 6,
              bg: "#22c55e10",
              border: "1px solid #22c55e30"
            }}
          >
            <Flex sx={{ alignItems: "center", gap: 1, mb: 1 }}>
              <Text sx={{ fontSize: 12 }}>✏️</Text>
              <Text
                sx={{
                  fontSize: 11,
                  fontWeight: "bold",
                  color: "#22c55e",
                  textTransform: "uppercase"
                }}
              >
                Agent Draft Reply
              </Text>
            </Flex>
            <Text
              sx={{
                fontSize: 12,
                color: "paragraph",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap"
              }}
            >
              {message.agentDraftReply}
            </Text>
            <Flex sx={{ gap: 1, mt: 2 }}>
              <Button
                variant="accent"
                sx={{ fontSize: 11, px: 2, py: 1 }}
                onClick={handleUseDraft}
              >
                Use as Reply
              </Button>
              <Button
                variant="secondary"
                sx={{ fontSize: 11, px: 2, py: 1 }}
                onClick={() => {
                  setDraftText(message.agentDraftReply || "");
                  setEditingDraft(true);
                }}
              >
                Edit Draft
              </Button>
            </Flex>
          </Flex>
        )}

        {/* Editing Draft */}
        {editingDraft && (
          <Flex
            sx={{
              flexDirection: "column",
              mt: 3,
              p: 2,
              borderRadius: 6,
              bg: "#22c55e10",
              border: "1px solid #22c55e30",
              gap: 2
            }}
          >
            <Text
              sx={{
                fontSize: 11,
                fontWeight: "bold",
                color: "#22c55e",
                textTransform: "uppercase"
              }}
            >
              Edit Draft Reply
            </Text>
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              style={{
                fontSize: 12,
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--paragraph)",
                resize: "vertical",
                minHeight: "80px",
                fontFamily: "inherit",
                lineHeight: "1.6"
              }}
            />
            <Flex sx={{ gap: 1 }}>
              <Button
                variant="accent"
                sx={{ fontSize: 11, px: 2, py: 1 }}
                onClick={handleSaveDraft}
              >
                Save Draft
              </Button>
              <Button
                variant="secondary"
                sx={{ fontSize: 11, px: 2, py: 1 }}
                onClick={() => setEditingDraft(false)}
              >
                Cancel
              </Button>
            </Flex>
          </Flex>
        )}

        {/* Reply Box */}
        {showReply && (
          <Flex
            sx={{
              flexDirection: "column",
              mt: 3,
              p: 2,
              borderRadius: 6,
              border: "1px solid var(--accent)",
              bg: "background",
              gap: 2
            }}
          >
            <Text
              sx={{
                fontSize: 11,
                fontWeight: "bold",
                color: "accent",
                textTransform: "uppercase"
              }}
            >
              Reply to {message.from.name}
            </Text>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write your reply..."
              autoFocus
              style={{
                fontSize: 13,
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--paragraph)",
                resize: "vertical",
                minHeight: "100px",
                fontFamily: "inherit",
                lineHeight: "1.6"
              }}
            />
            <Flex sx={{ gap: 1 }}>
              <Button
                variant="accent"
                sx={{ fontSize: 12 }}
                onClick={handleSendReply}
                disabled={!replyText.trim()}
              >
                Send Reply
              </Button>
              <Button
                variant="secondary"
                sx={{ fontSize: 12 }}
                onClick={() => setShowReply(false)}
              >
                Cancel
              </Button>
            </Flex>
          </Flex>
        )}
      </Box>
    </Flex>
  );
}

// ── Main View ──

function CommunicationsView() {
  const messages = useCommsStore((s) => s.messages);
  const selectedMessageId = useCommsStore((s) => s.selectedMessageId);
  const selectMessage = useCommsStore((s) => s.selectMessage);
  const filterChannel = useCommsStore((s) => s.filterChannel);
  const setFilterChannel = useCommsStore((s) => s.setFilterChannel);

  const [showCompose, setShowCompose] = useState(false);

  // Listen for dashboard quick-compose event
  useEffect(() => {
    const sub = AppEventManager.subscribe(AppEvents.composeMessage, () => {
      setShowCompose(true);
    });
    return () => sub.unsubscribe();
  }, []);

  const selectedMessage = messages.find((m) => m.id === selectedMessageId);

  const filteredMessages = (
    filterChannel === "all"
      ? messages
      : messages.filter((m) => m.channel === filterChannel)
  ).sort((a, b) => b.timestamp - a.timestamp);

  const unread = messages.filter((m) => !m.isRead).length;
  const channelCounts = {
    email: messages.filter((m) => m.channel === "email" && !m.isRead).length,
    message: messages.filter((m) => m.channel === "message" && !m.isRead).length,
    phone: messages.filter((m) => m.channel === "phone" && !m.isRead).length
  };

  const channelFilters: (CommChannel | "all")[] = [
    "all",
    "email",
    "message",
    "phone"
  ];

  return (
    <Flex
      sx={{
        flex: 1,
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        p: 3,
        gap: 3
      }}
    >
      {/* Header */}
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Flex sx={{ flexDirection: "column" }}>
          <Text variant="heading" sx={{ fontSize: 22 }}>
            Communications
          </Text>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
            {unread} unread &middot; {messages.length} total
          </Text>
        </Flex>
        <Button
          variant="accent"
          sx={{ fontSize: 12, px: 2, py: 1 }}
          onClick={() => {
            setShowCompose(!showCompose);
            if (!showCompose) selectMessage(null);
          }}
        >
          {showCompose ? "Cancel" : "+ Compose"}
        </Button>
      </Flex>

      {/* Channel Filters */}
      <Flex sx={{ gap: 1 }}>
        {channelFilters.map((channel) => {
          const count =
            channel === "all"
              ? unread
              : channelCounts[channel];
          return (
            <Button
              key={channel}
              variant={filterChannel === channel ? "accent" : "secondary"}
              sx={{ fontSize: 11, px: 2, py: 1, borderRadius: 4, gap: 1 }}
              onClick={() => setFilterChannel(channel)}
            >
              {channel === "all" ? "All" : CHANNEL_CONFIG[channel].icon}{" "}
              {channel === "all" ? "All" : CHANNEL_CONFIG[channel].label}
              {count > 0 && (
                <Text
                  as="span"
                  sx={{
                    ml: 1,
                    fontSize: 10,
                    bg:
                      filterChannel === channel
                        ? "rgba(255,255,255,0.2)"
                        : "error",
                    color: filterChannel === channel ? "inherit" : "white",
                    borderRadius: 10,
                    px: "5px",
                    py: "1px"
                  }}
                >
                  {count}
                </Text>
              )}
            </Button>
          );
        })}
      </Flex>

      {/* Content */}
      <Flex sx={{ flex: 1, gap: 3, minHeight: 0 }}>
        {/* Message List */}
        <Flex
          sx={{
            flexDirection: "column",
            width: selectedMessage || showCompose ? "40%" : "100%",
            overflow: "auto",
            bg: "background-secondary",
            borderRadius: 8,
            border: "1px solid var(--border)",
            py: 1
          }}
        >
          {filteredMessages.length === 0 ? (
            <Flex
              sx={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              <Text sx={{ color: "paragraph-secondary", fontSize: 13 }}>
                No messages
              </Text>
            </Flex>
          ) : (
            filteredMessages.map((msg) => (
              <MessageRow
                key={msg.id}
                message={msg}
                isSelected={selectedMessageId === msg.id}
                onSelect={() => {
                  setShowCompose(false);
                  selectMessage(
                    selectedMessageId === msg.id ? null : msg.id
                  );
                }}
              />
            ))
          )}
        </Flex>

        {/* Detail Panel or Compose */}
        {showCompose && <ComposeForm onClose={() => setShowCompose(false)} />}
        {!showCompose && selectedMessage && (
          <MessageDetail message={selectedMessage} />
        )}
      </Flex>
    </Flex>
  );
}

export default CommunicationsView;
