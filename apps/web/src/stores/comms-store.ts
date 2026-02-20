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

import createStore from "../common/store";
import BaseStore from "./index";
import { loadPersistedData, persistDataDebounced } from "../utils/workstation-persist";
import { registerStoreForHydration } from "../utils/workstation-hydrate";

// ── Communication Types ──

export type CommChannel = "email" | "message" | "phone";
export type CommDirection = "inbound" | "outbound";
export type CommTriageStatus = "unread" | "triaged" | "replied" | "archived" | "flagged";

export type CommParticipant = {
  name: string;
  address: string; // email, phone number, or handle
  avatar?: string;
};

export type CallSentiment = "positive" | "neutral" | "negative";

export type CommMessage = {
  id: string;
  channel: CommChannel;
  direction: CommDirection;
  triageStatus: CommTriageStatus;
  from: CommParticipant;
  to: CommParticipant[];
  subject: string;
  body: string;
  preview: string;
  timestamp: number;
  isRead: boolean;
  threadId: string | null;
  tags: string[];
  agentSummary: string | null; // AI-generated summary
  agentDraftReply: string | null; // AI-drafted response
  linkedTaskId: string | null;
  attachments: { name: string; size: number; type: string }[];
  // Call-specific fields (phone channel)
  transcript?: string;
  sentiment?: CallSentiment;
  duration?: number; // seconds
  callbackRequested?: boolean;
};

// ── Demo Communications ──

function createDefaultComms(): CommMessage[] {
  const now = Date.now();
  const hour = 3600000;
  const day = 86400000;

  return [
    {
      id: "comm-1",
      channel: "email",
      direction: "inbound",
      triageStatus: "triaged",
      from: { name: "Sarah Chen", address: "sarah.chen@acmecorp.com" },
      to: [{ name: "You", address: "you@workstation.ai" }],
      subject: "Partnership Proposal — Q2 Integration",
      body: "Hi,\n\nI wanted to follow up on our conversation from last week about the potential integration between our platforms. We've prepared a detailed proposal that outlines the technical requirements, timeline, and revenue sharing model.\n\nWould you be available for a call this Thursday to discuss?\n\nBest,\nSarah",
      preview: "Following up on partnership discussion. Proposal ready for review...",
      timestamp: now - 2 * hour,
      isRead: false,
      threadId: "thread-1",
      tags: ["partnerships", "high-priority"],
      agentSummary:
        "Partnership proposal from Acme Corp for Q2 integration. They have a technical spec ready. Requesting a Thursday call.",
      agentDraftReply:
        "Hi Sarah,\n\nThank you for putting this together. I'd be happy to review the proposal and discuss on Thursday. Could you send over the technical spec in advance so I can prepare some questions?\n\nLooking forward to it.\n\nBest regards",
      linkedTaskId: "task-3",
      attachments: [
        { name: "partnership-proposal-v2.pdf", size: 245000, type: "application/pdf" }
      ]
    },
    {
      id: "comm-2",
      channel: "email",
      direction: "inbound",
      triageStatus: "unread",
      from: { name: "Dev Team CI", address: "ci@github.com" },
      to: [{ name: "You", address: "you@workstation.ai" }],
      subject: "[Build] Pipeline failed — auth-module #247",
      body: "Build #247 failed on branch feature/auth-refactor.\n\nFailed step: Unit Tests\nError: 3 test failures in auth.test.ts\n\nView details: https://github.com/...",
      preview: "Build #247 failed on auth-refactor branch. 3 test failures...",
      timestamp: now - 4 * hour,
      isRead: false,
      threadId: null,
      tags: ["ci", "build-failure"],
      agentSummary:
        "CI build failure on auth module. 3 unit tests failing. Likely related to the refactor PR that Code Agent is reviewing.",
      agentDraftReply: null,
      linkedTaskId: "task-5",
      attachments: []
    },
    {
      id: "comm-3",
      channel: "message",
      direction: "inbound",
      triageStatus: "unread",
      from: { name: "Marcus Rivera", address: "@marcus" },
      to: [{ name: "You", address: "@you" }],
      subject: "",
      body: "Hey, quick question — are we still on for the product demo tomorrow at 2pm? I need to prep the slide deck.",
      preview: "Quick question about tomorrow's product demo at 2pm...",
      timestamp: now - hour,
      isRead: false,
      threadId: "thread-3",
      tags: ["team", "scheduling"],
      agentSummary: "Marcus asking about product demo confirmation for tomorrow 2pm.",
      agentDraftReply: "Yes, still on for 2pm! I'll send the agenda beforehand.",
      linkedTaskId: null,
      attachments: []
    },
    {
      id: "comm-4",
      channel: "phone",
      direction: "inbound",
      triageStatus: "unread",
      from: { name: "James Wright", address: "+1-555-0142" },
      to: [{ name: "You", address: "+1-555-0100" }],
      subject: "Missed call",
      body: "Voicemail transcription: 'Hi, this is James from the accounting firm. Just calling to confirm we received the documents you sent last Friday. Please call back at your convenience.'",
      preview: "Voicemail from James at accounting firm. Confirming document receipt...",
      timestamp: now - 6 * hour,
      isRead: false,
      threadId: null,
      tags: ["accounting", "follow-up"],
      agentSummary:
        "Missed call from accounting firm. Voicemail confirms document receipt. Low priority — informational only.",
      agentDraftReply: null,
      linkedTaskId: null,
      attachments: [],
      transcript: "James: Hi, this is James from the accounting firm. Just calling to confirm we received the documents you sent last Friday. Everything looks to be in order. If you have any questions about the quarterly filing, please call back at your convenience. Thanks!",
      sentiment: "neutral",
      duration: 47,
      callbackRequested: true
    },
    {
      id: "comm-6",
      channel: "phone",
      direction: "inbound",
      triageStatus: "triaged",
      from: { name: "Elena Vasquez", address: "+1-555-0198" },
      to: [{ name: "You", address: "+1-555-0100" }],
      subject: "Client onboarding call",
      body: "20-minute onboarding call with new client Elena Vasquez from Rivera Design. Discussed project scope, timeline, and deliverables.",
      preview: "Onboarding call with Elena Vasquez — project scope discussion...",
      timestamp: now - 3 * hour,
      isRead: true,
      threadId: null,
      tags: ["client", "onboarding"],
      agentSummary:
        "Productive onboarding call. Client is enthusiastic about the project. Key deliverables agreed: brand guidelines by March 1, website mockup by March 15.",
      agentDraftReply: null,
      linkedTaskId: null,
      attachments: [],
      transcript: "You: Thanks for joining, Elena. Let's walk through the project scope.\nElena: Sounds great. We're really excited to get started.\nYou: Perfect. So the first deliverable will be the brand guidelines. We're targeting March 1st for that.\nElena: That timeline works for us. What about the website mockups?\nYou: We're planning March 15th for the initial mockups. We'll do two rounds of revisions after that.\nElena: Excellent. The team will be thrilled. This is exactly what we were hoping for.\nYou: Great. I'll send over a summary email with all the details after this call.\nElena: Perfect. Looking forward to working together!",
      sentiment: "positive",
      duration: 1215
    },
    {
      id: "comm-7",
      channel: "phone",
      direction: "inbound",
      triageStatus: "unread",
      from: { name: "David Kim", address: "+1-555-0177" },
      to: [{ name: "You", address: "+1-555-0100" }],
      subject: "Billing dispute follow-up",
      body: "David Kim called regarding invoice #4821. Unhappy about the additional charges on last month's bill.",
      preview: "Billing dispute — David Kim unhappy about invoice #4821 charges...",
      timestamp: now - 8 * hour,
      isRead: false,
      threadId: null,
      tags: ["billing", "dispute", "urgent"],
      agentSummary:
        "Escalation risk. Client is frustrated about unexpected charges on invoice #4821. Needs immediate follow-up to prevent churn.",
      agentDraftReply: null,
      linkedTaskId: null,
      attachments: [],
      transcript: "David: Hi, I'm calling about invoice #4821. There are charges on here I wasn't expecting.\nYou: I understand your concern, David. Can you tell me which charges seem off?\nDavid: The 'platform maintenance' fee — $350. That wasn't in our original agreement.\nYou: Let me look into that. I want to make sure this is resolved properly.\nDavid: I'd appreciate that. Honestly, if these kinds of surprises keep happening, we may need to reconsider the arrangement.\nYou: I completely understand. Let me review the contract and get back to you today with an explanation or a credit. Would that work?\nDavid: Yes, today would be good. Thank you.",
      sentiment: "negative",
      duration: 342,
      callbackRequested: true
    },
    {
      id: "comm-5",
      channel: "email",
      direction: "outbound",
      triageStatus: "replied",
      from: { name: "You", address: "you@workstation.ai" },
      to: [{ name: "Lisa Park", address: "lisa@designstudio.co" }],
      subject: "Re: Updated brand assets",
      body: "Thanks Lisa, these look great. I've shared them with the team.\n\nOne small request — could you also export the icon set in SVG format? We need vector versions for the web app.",
      preview: "Brand assets look great. Requesting SVG icon exports...",
      timestamp: now - day,
      isRead: true,
      threadId: "thread-5",
      tags: ["design", "branding"],
      agentSummary: null,
      agentDraftReply: null,
      linkedTaskId: null,
      attachments: []
    }
  ];
}

// ── Comms Store ──

class CommsStore extends BaseStore<CommsStore> {
  messages: CommMessage[] = loadPersistedData<CommMessage[]>("comms-messages") || createDefaultComms();
  selectedMessageId: string | null = null;
  filterChannel: CommChannel | "all" = "all";
  filterStatus: CommTriageStatus | "all" = "all";
  isLoading = false;

  private persistMessages = () => {
    persistDataDebounced("comms-messages", this.get().messages);
  };

  refresh = () => {
    this.set((state) => {
      state.messages = [...state.messages];
    });
  };

  selectMessage = (id: string | null) => {
    this.set((state) => {
      state.selectedMessageId = id;
      if (id) {
        const msg = state.messages.find((m) => m.id === id);
        if (msg) msg.isRead = true;
      }
    });
  };

  setFilterChannel = (channel: CommChannel | "all") => {
    this.set((state) => {
      state.filterChannel = channel;
    });
  };

  setFilterStatus = (status: CommTriageStatus | "all") => {
    this.set((state) => {
      state.filterStatus = status;
    });
  };

  getFilteredMessages = (): CommMessage[] => {
    const state = this.get();
    return state.messages
      .filter((m) => {
        if (state.filterChannel !== "all" && m.channel !== state.filterChannel)
          return false;
        if (state.filterStatus !== "all" && m.triageStatus !== state.filterStatus)
          return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  };

  markAsRead = (id: string) => {
    this.set((state) => {
      const msg = state.messages.find((m) => m.id === id);
      if (msg) msg.isRead = true;
    });
    this.persistMessages();
  };

  updateTriageStatus = (id: string, status: CommTriageStatus) => {
    this.set((state) => {
      const msg = state.messages.find((m) => m.id === id);
      if (msg) msg.triageStatus = status;
    });
    this.persistMessages();
  };

  archiveMessage = (id: string) => {
    this.set((state) => {
      const msg = state.messages.find((m) => m.id === id);
      if (msg) msg.triageStatus = "archived";
    });
    this.persistMessages();
  };

  flagMessage = (id: string) => {
    this.set((state) => {
      const msg = state.messages.find((m) => m.id === id);
      if (msg) msg.triageStatus = "flagged";
    });
    this.persistMessages();
  };

  addMessage = (
    msg: Omit<CommMessage, "id" | "timestamp" | "isRead" | "agentSummary" | "agentDraftReply">
  ) => {
    const now = Date.now();
    this.set((state) => {
      state.messages.unshift({
        ...msg,
        id: `comm-${now}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: now,
        isRead: msg.direction === "outbound",
        agentSummary: null,
        agentDraftReply: null
      });
    });
    this.persistMessages();
  };

  deleteMessage = (id: string) => {
    this.set((state) => {
      state.messages = state.messages.filter((m) => m.id !== id);
      if (state.selectedMessageId === id) {
        state.selectedMessageId = null;
      }
    });
    this.persistMessages();
  };

  updateDraftReply = (id: string, draft: string | null) => {
    this.set((state) => {
      const msg = state.messages.find((m) => m.id === id);
      if (msg) msg.agentDraftReply = draft;
    });
    this.persistMessages();
  };

  sendReply = (id: string, replyBody: string) => {
    const state = this.get();
    const original = state.messages.find((m) => m.id === id);
    if (!original) return;

    // Mark original as replied
    this.updateTriageStatus(id, "replied");

    // Create outbound reply message
    this.addMessage({
      channel: original.channel,
      direction: "outbound",
      triageStatus: "replied",
      from: original.to[0] || { name: "You", address: "you@workstation.ai" },
      to: [original.from],
      subject: original.subject ? `Re: ${original.subject}` : "",
      body: replyBody,
      preview: replyBody.slice(0, 80) + (replyBody.length > 80 ? "..." : ""),
      threadId: original.threadId || original.id,
      tags: original.tags,
      linkedTaskId: original.linkedTaskId,
      attachments: []
    });
  };

  markAsUnread = (id: string) => {
    this.set((state) => {
      const msg = state.messages.find((m) => m.id === id);
      if (msg) {
        msg.isRead = false;
        msg.triageStatus = "unread";
      }
    });
    this.persistMessages();
  };

  getUnreadCount = (): number => {
    return this.get().messages.filter((m) => !m.isRead).length;
  };

  getCountByChannel = (): Record<CommChannel, number> => {
    const msgs = this.get().messages.filter((m) => !m.isRead);
    return {
      email: msgs.filter((m) => m.channel === "email").length,
      message: msgs.filter((m) => m.channel === "message").length,
      phone: msgs.filter((m) => m.channel === "phone").length
    };
  };

  getStats = () => {
    const msgs = this.get().messages;
    return {
      total: msgs.length,
      unread: msgs.filter((m) => !m.isRead).length,
      flagged: msgs.filter((m) => m.triageStatus === "flagged").length,
      triaged: msgs.filter((m) => m.triageStatus === "triaged").length,
      withDrafts: msgs.filter((m) => m.agentDraftReply !== null).length
    };
  };
}

const [useStore, store] = createStore<CommsStore>(
  (set, get) => new CommsStore(set, get)
);

registerStoreForHydration("comms-messages", (data) => {
  store.set({ messages: data as CommMessage[] });
}, () => store.messages);

export { useStore, store };
