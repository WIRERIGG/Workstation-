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

import { useState } from "react";
import { Box, Button, Flex, Input, Text } from "@theme-ui/components";
import {
  useStore as useNewsletterStore,
  Newsletter,
  NewsletterStatus
} from "../stores/newsletter-store";
import { useStore as useBrandingStore } from "../stores/branding-store";

const STATUS_CONFIG: Record<NewsletterStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#f59e0b" },
  scheduled: { label: "Scheduled", color: "#3b82f6" },
  sent: { label: "Sent", color: "#22c55e" }
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NewsletterCard({
  newsletter,
  isSelected,
  onSelect
}: {
  newsletter: Newsletter;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const statusConfig = STATUS_CONFIG[newsletter.status];

  return (
    <Flex
      onClick={onSelect}
      sx={{
        flexDirection: "column",
        gap: 1,
        p: 2,
        borderRadius: 6,
        cursor: "pointer",
        bg: isSelected ? "hover" : "transparent",
        border: isSelected ? "1px solid var(--accent)" : "1px solid transparent",
        "&:hover": { bg: "hover" }
      }}
    >
      <Flex sx={{ alignItems: "center", gap: 1 }}>
        <Text
          sx={{
            fontSize: 12,
            fontWeight: "bold",
            color: "heading",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {newsletter.title}
        </Text>
        <Text
          sx={{
            fontSize: 9,
            fontWeight: "bold",
            px: "5px",
            py: "1px",
            borderRadius: 10,
            bg: `${statusConfig.color}15`,
            color: statusConfig.color,
            flexShrink: 0
          }}
        >
          {statusConfig.label}
        </Text>
      </Flex>
      <Flex sx={{ alignItems: "center", gap: 1 }}>
        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
          {newsletter.recipientCount} recipients
        </Text>
        <Text sx={{ fontSize: 10, color: "paragraph-secondary" }}>
          &middot; Updated {formatTimeAgo(newsletter.updatedAt)}
        </Text>
        {newsletter.generatedBy === "agent" && (
          <Text sx={{ fontSize: 10, color: "#f59e0b" }}>🤖</Text>
        )}
      </Flex>
    </Flex>
  );
}

function NewsletterEditor({ newsletter }: { newsletter: Newsletter }) {
  const updateNewsletter = useNewsletterStore((s) => s.updateNewsletter);
  const deleteNewsletter = useNewsletterStore((s) => s.deleteNewsletter);
  const scheduleNewsletter = useNewsletterStore((s) => s.scheduleNewsletter);
  const generateDraft = useNewsletterStore((s) => s.generateDraft);
  const branding = useBrandingStore((s) => s.branding);

  const [title, setTitle] = useState(newsletter.title);
  const [body, setBody] = useState(newsletter.body);
  const [recipientCount, setRecipientCount] = useState(
    String(newsletter.recipientCount || 50)
  );

  const isDraft = newsletter.status === "draft";

  const handleSave = () => {
    updateNewsletter(newsletter.id, {
      title: title.trim() || newsletter.title,
      body: body.trim()
    });
  };

  const handleGenerate = () => {
    generateDraft(newsletter.id, branding.industry);
    // Refresh local state
    const updated = useNewsletterStore.getState().newsletters.find(
      (n) => n.id === newsletter.id
    );
    if (updated) setBody(updated.body);
  };

  const handleSchedule = () => {
    handleSave();
    const scheduledAt = Date.now() + 86400000; // Tomorrow
    scheduleNewsletter(
      newsletter.id,
      scheduledAt,
      parseInt(recipientCount) || 50
    );
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
          p: 3,
          borderBottom: "1px solid var(--border)",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2
        }}
      >
        <Flex sx={{ alignItems: "center", gap: 2, flex: 1 }}>
          <Text
            sx={{
              fontSize: 9,
              fontWeight: "bold",
              px: "5px",
              py: "1px",
              borderRadius: 10,
              bg: `${STATUS_CONFIG[newsletter.status].color}15`,
              color: STATUS_CONFIG[newsletter.status].color
            }}
          >
            {STATUS_CONFIG[newsletter.status].label}
          </Text>
          {newsletter.scheduledAt && (
            <Text sx={{ fontSize: 11, color: "paragraph-secondary" }}>
              {newsletter.status === "sent" ? "Sent" : "Scheduled"}{" "}
              {formatDate(newsletter.scheduledAt)}
            </Text>
          )}
        </Flex>
        <Flex sx={{ gap: 1, flexShrink: 0 }}>
          {isDraft && (
            <Button
              variant="secondary"
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={handleGenerate}
            >
              🤖 AI Generate
            </Button>
          )}
          {isDraft && (
            <Button
              variant="accent"
              sx={{ fontSize: 11, px: 2, py: 1 }}
              onClick={handleSave}
            >
              Save Draft
            </Button>
          )}
          <Button
            variant="secondary"
            sx={{ fontSize: 11, px: 2, py: 1, color: "#ef4444" }}
            onClick={() => deleteNewsletter(newsletter.id)}
          >
            Delete
          </Button>
        </Flex>
      </Flex>

      {/* Editor */}
      <Flex sx={{ flexDirection: "column", flex: 1, overflow: "auto", p: 3, gap: 2 }}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Newsletter title"
          disabled={!isDraft}
          sx={{ fontSize: 16, fontWeight: "bold", border: isDraft ? undefined : "none" }}
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your newsletter content here..."
          disabled={!isDraft}
          style={{
            flex: 1,
            fontSize: 13,
            padding: "12px",
            borderRadius: "6px",
            border: isDraft ? "1px solid var(--border)" : "none",
            background: isDraft ? "var(--background)" : "transparent",
            color: "var(--paragraph)",
            resize: "none",
            minHeight: "300px",
            fontFamily: "inherit",
            lineHeight: "1.7"
          }}
        />

        {/* Schedule Section */}
        {isDraft && (
          <Flex
            sx={{
              p: 2,
              borderRadius: 6,
              border: "1px solid var(--border)",
              bg: "background",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2
            }}
          >
            <Flex sx={{ alignItems: "center", gap: 2 }}>
              <Text sx={{ fontSize: 12, color: "paragraph-secondary" }}>
                Recipients:
              </Text>
              <Input
                type="number"
                value={recipientCount}
                onChange={(e) => setRecipientCount(e.target.value)}
                sx={{ width: 80, fontSize: 12 }}
              />
            </Flex>
            <Button
              variant="accent"
              sx={{ fontSize: 12 }}
              onClick={handleSchedule}
              disabled={!body.trim()}
            >
              Schedule for Tomorrow
            </Button>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}

function NewslettersView() {
  const newsletters = useNewsletterStore((s) => s.newsletters);
  const selectedId = useNewsletterStore((s) => s.selectedId);
  const selectNewsletter = useNewsletterStore((s) => s.selectNewsletter);
  const createNewsletter = useNewsletterStore((s) => s.createNewsletter);

  const selected = newsletters.find((n) => n.id === selectedId);

  const sorted = [...newsletters].sort((a, b) => b.updatedAt - a.updatedAt);

  const stats = {
    drafts: newsletters.filter((n) => n.status === "draft").length,
    scheduled: newsletters.filter((n) => n.status === "scheduled").length,
    sent: newsletters.filter((n) => n.status === "sent").length
  };

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
            Newsletters
          </Text>
          <Text sx={{ fontSize: 13, color: "paragraph-secondary" }}>
            {stats.drafts} drafts &middot; {stats.scheduled} scheduled &middot;{" "}
            {stats.sent} sent
          </Text>
        </Flex>
        <Button
          variant="accent"
          sx={{ fontSize: 12, px: 2, py: 1 }}
          onClick={() => createNewsletter()}
        >
          + New Newsletter
        </Button>
      </Flex>

      {/* Content */}
      <Flex sx={{ flex: 1, gap: 3, minHeight: 0 }}>
        {/* List Panel */}
        <Flex
          sx={{
            flexDirection: "column",
            width: "35%",
            overflow: "auto",
            bg: "background-secondary",
            borderRadius: 8,
            border: "1px solid var(--border)",
            py: 1
          }}
        >
          {sorted.length === 0 ? (
            <Flex
              sx={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Text sx={{ color: "paragraph-secondary", fontSize: 13 }}>
                No newsletters yet
              </Text>
            </Flex>
          ) : (
            sorted.map((nl) => (
              <NewsletterCard
                key={nl.id}
                newsletter={nl}
                isSelected={selectedId === nl.id}
                onSelect={() =>
                  selectNewsletter(selectedId === nl.id ? null : nl.id)
                }
              />
            ))
          )}
        </Flex>

        {/* Editor Panel */}
        {selected ? (
          <NewsletterEditor key={selected.id} newsletter={selected} />
        ) : (
          <Flex
            sx={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              bg: "background-secondary",
              borderRadius: 8,
              border: "1px solid var(--border)"
            }}
          >
            <Flex sx={{ flexDirection: "column", alignItems: "center", gap: 2 }}>
              <Text sx={{ fontSize: 32 }}>📰</Text>
              <Text sx={{ fontSize: 14, color: "paragraph-secondary" }}>
                Select a newsletter to edit or create a new one
              </Text>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}

export default NewslettersView;
