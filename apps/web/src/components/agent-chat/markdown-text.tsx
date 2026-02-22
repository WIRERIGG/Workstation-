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

import React from "react";
import { Box, Text } from "@theme-ui/components";

// ── Lightweight Inline Markdown Renderer ──
// Supports: **bold**, *italic*, _italic_, `code`, ```code blocks```, and line breaks.
// No external dependencies — designed for chat message rendering.

type MarkdownNode =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "code"; content: string }
  | { type: "codeblock"; content: string };

function parseInlineMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Code block (```...```)
    const codeBlockMatch = remaining.match(/^```([^`]*?)```/);
    if (codeBlockMatch) {
      nodes.push({ type: "codeblock", content: codeBlockMatch[1].trim() });
      remaining = remaining.slice(codeBlockMatch[0].length);
      continue;
    }

    // Inline code (`...`)
    const codeMatch = remaining.match(/^`([^`]+?)`/);
    if (codeMatch) {
      nodes.push({ type: "code", content: codeMatch[1] });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold (**...**)
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      nodes.push({ type: "bold", content: boldMatch[1] });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic (*...* or _..._)
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
    if (italicMatch) {
      nodes.push({ type: "italic", content: italicMatch[2] });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Regular text — consume until the next special character
    const nextSpecial = remaining.slice(1).search(/[`*_]/);
    if (nextSpecial === -1) {
      nodes.push({ type: "text", content: remaining });
      remaining = "";
    } else {
      nodes.push({
        type: "text",
        content: remaining.slice(0, nextSpecial + 1)
      });
      remaining = remaining.slice(nextSpecial + 1);
    }
  }

  return nodes;
}

function renderNodes(nodes: MarkdownNode[]): React.ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "bold":
        return (
          <Text key={i} as="strong" sx={{ fontWeight: "bold" }}>
            {node.content}
          </Text>
        );
      case "italic":
        return (
          <Text key={i} as="em" sx={{ fontStyle: "italic" }}>
            {node.content}
          </Text>
        );
      case "code":
        return (
          <Text
            key={i}
            as="code"
            sx={{
              fontFamily: "monospace",
              fontSize: "0.9em",
              bg: "var(--background-secondary)",
              px: "4px",
              py: "1px",
              borderRadius: 3,
              border: "1px solid var(--border)"
            }}
          >
            {node.content}
          </Text>
        );
      case "codeblock":
        return (
          <Box
            key={i}
            as="pre"
            sx={{
              fontFamily: "monospace",
              fontSize: 11,
              bg: "var(--background-secondary)",
              p: 2,
              borderRadius: 6,
              border: "1px solid var(--border)",
              overflow: "auto",
              my: 1,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all"
            }}
          >
            <code>{node.content}</code>
          </Box>
        );
      default:
        return <React.Fragment key={i}>{node.content}</React.Fragment>;
    }
  });
}

export function MarkdownText({ content }: { content: string }) {
  // Split by lines and render each line with inline markdown
  const lines = content.split("\n");

  return (
    <>
      {lines.map((line, lineIdx) => {
        const nodes = parseInlineMarkdown(line);
        return (
          <React.Fragment key={lineIdx}>
            {renderNodes(nodes)}
            {lineIdx < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </>
  );
}
