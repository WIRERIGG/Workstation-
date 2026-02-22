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

import createStore from "../common/store";
import BaseStore from "./index";
import { loadPersistedData, persistDataDebounced } from "../utils/workstation-persist";
import { registerStoreForHydration } from "../utils/workstation-hydrate";

// ── Newsletter Types ──

export type NewsletterStatus = "draft" | "scheduled" | "sent";

export type Newsletter = {
  id: string;
  title: string;
  body: string;
  status: NewsletterStatus;
  scheduledAt: number | null;
  recipientCount: number;
  createdAt: number;
  updatedAt: number;
  generatedBy: "agent" | "human";
};

// ── Demo Newsletters ──

function createDefaultNewsletters(): Newsletter[] {
  const now = Date.now();
  const day = 86400000;

  return [
    {
      id: "nl-1",
      title: "Weekly Business Update — Week 8",
      body: "Hello team,\n\nHere's your weekly roundup:\n\n**Key Wins**\n- Partnership proposal from Acme Corp received and under review\n- Q1 financial analysis 60% complete\n- Auth module refactor in code review\n\n**Upcoming**\n- Product demo scheduled for tomorrow at 2pm\n- Email integration deadline on Thursday\n\n**Action Items**\n- Review partnership proposal before Thursday call\n- Complete Q1 report by EOD tomorrow\n\nBest regards,\nYour Workstation AI",
      status: "draft",
      scheduledAt: null,
      recipientCount: 12,
      createdAt: now - 2 * day,
      updatedAt: now - 3600000,
      generatedBy: "agent"
    },
    {
      id: "nl-2",
      title: "Client Update — February 2026",
      body: "Dear valued clients,\n\nWe're excited to share our latest developments:\n\n**New Features**\n- AI-powered communication triage\n- Auto-scheduling for appointments\n- Enhanced call management\n\n**Coming Soon**\n- Multi-call management support\n- Advanced analytics dashboard\n\nThank you for your continued partnership.\n\nBest regards,\nThe Team",
      status: "scheduled",
      scheduledAt: now + 2 * day,
      recipientCount: 156,
      createdAt: now - 5 * day,
      updatedAt: now - day,
      generatedBy: "human"
    },
    {
      id: "nl-3",
      title: "Team Highlights — January Recap",
      body: "Hi everyone,\n\nJanuary was a productive month! Here's what we accomplished:\n\n- Onboarded 3 new clients\n- Resolved 47 support tickets\n- Shipped 2 major feature releases\n- Team satisfaction score: 4.6/5\n\nGreat work all around. Let's keep the momentum going into February!\n\nCheers",
      status: "sent",
      scheduledAt: now - 18 * day,
      recipientCount: 24,
      createdAt: now - 20 * day,
      updatedAt: now - 18 * day,
      generatedBy: "agent"
    }
  ];
}

// ── AI Draft Templates ──

const AI_TEMPLATES: Record<string, string> = {
  technology: "Dear subscribers,\n\nThis week in tech:\n\n**Product Updates**\n- [Feature launches and improvements]\n- [Performance optimizations]\n\n**Engineering Highlights**\n- [Technical achievements]\n- [Infrastructure updates]\n\n**Looking Ahead**\n- [Upcoming releases]\n- [Roadmap previews]\n\nStay innovative,\nThe Team",
  finance: "Dear investors and partners,\n\n**Market Insights**\n- [Key market movements]\n- [Portfolio performance highlights]\n\n**Business Updates**\n- [Revenue and growth metrics]\n- [New partnerships or deals]\n\n**Risk Assessment**\n- [Current risk factors]\n- [Mitigation strategies]\n\nBest regards,\nThe Finance Team",
  default: "Hello,\n\nHere's your latest update:\n\n**This Week's Highlights**\n- [Key accomplishments]\n- [Team wins]\n\n**Upcoming**\n- [Scheduled events]\n- [Deadlines and milestones]\n\n**Action Items**\n- [Tasks needing attention]\n- [Follow-ups required]\n\nBest regards,\nThe Team"
};

// ── Newsletter Store ──

class NewsletterStore extends BaseStore<NewsletterStore> {
  newsletters: Newsletter[] =
    loadPersistedData<Newsletter[]>("newsletters") || createDefaultNewsletters();
  selectedId: string | null = null;

  private persist = () => {
    persistDataDebounced("newsletters", this.get().newsletters);
  };

  selectNewsletter = (id: string | null) => {
    this.set((state) => {
      state.selectedId = id;
    });
  };

  createNewsletter = (title?: string) => {
    const now = Date.now();
    const id = `nl-${now}-${Math.random().toString(36).slice(2, 8)}`;
    this.set((state) => {
      state.newsletters.unshift({
        id,
        title: title || "Untitled Newsletter",
        body: "",
        status: "draft",
        scheduledAt: null,
        recipientCount: 0,
        createdAt: now,
        updatedAt: now,
        generatedBy: "human"
      });
      state.selectedId = id;
    });
    this.persist();
  };

  updateNewsletter = (id: string, updates: Partial<Newsletter>) => {
    this.set((state) => {
      const nl = state.newsletters.find((n) => n.id === id);
      if (nl) {
        Object.assign(nl, updates, { updatedAt: Date.now() });
      }
    });
    this.persist();
  };

  deleteNewsletter = (id: string) => {
    this.set((state) => {
      state.newsletters = state.newsletters.filter((n) => n.id !== id);
      if (state.selectedId === id) state.selectedId = null;
    });
    this.persist();
  };

  scheduleNewsletter = (id: string, scheduledAt: number, recipientCount: number) => {
    this.updateNewsletter(id, {
      status: "scheduled",
      scheduledAt,
      recipientCount
    });
  };

  generateDraft = (id: string, industry?: string) => {
    const template = AI_TEMPLATES[industry || ""] || AI_TEMPLATES.default;
    this.updateNewsletter(id, {
      body: template,
      generatedBy: "agent"
    });
  };

  getByStatus = (status: NewsletterStatus): Newsletter[] => {
    return this.get().newsletters.filter((n) => n.status === status);
  };
}

const [useStore, store] = createStore<NewsletterStore>(
  (set, get) => new NewsletterStore(set, get)
);

registerStoreForHydration("newsletters", (data) => {
  store.set({ newsletters: data as Newsletter[] });
}, () => store.newsletters);

export { useStore, store };
