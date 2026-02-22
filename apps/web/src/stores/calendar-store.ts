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

// ── Calendar Types ──

export type CalendarEventType = "meeting" | "deadline" | "reminder" | "block";

export type ConfirmationStatus = "pending" | "confirmed" | "declined";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  type: CalendarEventType;
  startTime: number;
  endTime: number;
  allDay: boolean;
  color: string;
  createdBy: "human" | "agent";
  agentId: string | null;
  linkedTaskId: string | null;
  attendees: string[];
  // Auto-booking fields
  isAutoBooked?: boolean;
  confirmationStatus?: ConfirmationStatus;
  clientName?: string;
  clientContact?: string;
};

// ── Demo Events ──

function createDefaultEvents(): CalendarEvent[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86400000;
  const hour = 3600000;
  const todayMs = today.getTime();

  return [
    {
      id: "evt-1",
      title: "Team Standup",
      description: "Daily sync with the engineering team.",
      type: "meeting",
      startTime: todayMs + 9 * hour,
      endTime: todayMs + 9.5 * hour,
      allDay: false,
      color: "#3b82f6",
      createdBy: "human",
      agentId: null,
      linkedTaskId: null,
      attendees: ["Marcus Rivera", "Lisa Park", "Dev Team"]
    },
    {
      id: "evt-2",
      title: "Partnership Call — Acme Corp",
      description: "Discuss Q2 integration proposal with Sarah Chen.",
      type: "meeting",
      startTime: todayMs + 14 * hour,
      endTime: todayMs + 15 * hour,
      allDay: false,
      color: "#f59e0b",
      createdBy: "agent",
      agentId: "agent-comms",
      linkedTaskId: "task-3",
      attendees: ["Sarah Chen"]
    },
    {
      id: "evt-3",
      title: "Q1 Report Due",
      description: "Financial analysis report deadline.",
      type: "deadline",
      startTime: todayMs + day,
      endTime: todayMs + day,
      allDay: true,
      color: "#ef4444",
      createdBy: "agent",
      agentId: "agent-taskmaster",
      linkedTaskId: "task-2",
      attendees: []
    },
    {
      id: "evt-4",
      title: "Focus Block — Deep Work",
      description: "No meetings. Reserved for focused work.",
      type: "block",
      startTime: todayMs + 10 * hour,
      endTime: todayMs + 12 * hour,
      allDay: false,
      color: "#8b5cf6",
      createdBy: "human",
      agentId: null,
      linkedTaskId: null,
      attendees: []
    },
    {
      id: "evt-5",
      title: "Product Demo Prep",
      description: "Prepare slides and demo environment.",
      type: "reminder",
      startTime: todayMs + day + 10 * hour,
      endTime: todayMs + day + 11 * hour,
      allDay: false,
      color: "#22c55e",
      createdBy: "agent",
      agentId: "agent-taskmaster",
      linkedTaskId: null,
      attendees: ["Marcus Rivera"]
    },
    {
      id: "evt-6",
      title: "Code Review Session",
      description: "Review auth module refactor with Code Agent.",
      type: "meeting",
      startTime: todayMs + 2 * day + 13 * hour,
      endTime: todayMs + 2 * day + 14 * hour,
      allDay: false,
      color: "#3b82f6",
      createdBy: "agent",
      agentId: "agent-coder",
      linkedTaskId: "task-5",
      attendees: []
    },
    {
      id: "evt-7",
      title: "Email Integration Deadline",
      description: "Comms Agent should have email API connected.",
      type: "deadline",
      startTime: todayMs + 2 * day,
      endTime: todayMs + 2 * day,
      allDay: true,
      color: "#ef4444",
      createdBy: "agent",
      agentId: "agent-orchestrator",
      linkedTaskId: "task-1",
      attendees: []
    },
    {
      id: "evt-8",
      title: "Consultation — Rivera Design",
      description: "Auto-booked: Elena Vasquez requested a follow-up consultation.",
      type: "meeting",
      startTime: todayMs + day + 15 * hour,
      endTime: todayMs + day + 16 * hour,
      allDay: false,
      color: "#22c55e",
      createdBy: "agent",
      agentId: "agent-comms",
      linkedTaskId: null,
      attendees: ["Elena Vasquez"],
      isAutoBooked: true,
      confirmationStatus: "pending",
      clientName: "Elena Vasquez",
      clientContact: "elena@riveradesign.co"
    },
    {
      id: "evt-9",
      title: "Invoice Review — David Kim",
      description: "Auto-booked: David Kim wants to discuss invoice #4821.",
      type: "meeting",
      startTime: todayMs + 2 * day + 10 * hour,
      endTime: todayMs + 2 * day + 10.5 * hour,
      allDay: false,
      color: "#f59e0b",
      createdBy: "agent",
      agentId: "agent-comms",
      linkedTaskId: null,
      attendees: ["David Kim"],
      isAutoBooked: true,
      confirmationStatus: "pending",
      clientName: "David Kim",
      clientContact: "david.kim@email.com"
    }
  ];
}

// ── Calendar Store ──

export type CalendarViewMode = "week" | "day" | "month";

class CalendarStore extends BaseStore<CalendarStore> {
  events: CalendarEvent[] = loadPersistedData<CalendarEvent[]>("calendar-events") || createDefaultEvents();
  selectedDate: number = Date.now();
  viewMode: CalendarViewMode = "week";
  selectedEventId: string | null = null;

  private persistEvents = () => {
    persistDataDebounced("calendar-events", this.get().events);
  };

  refresh = () => {
    this.set((state) => {
      state.events = [...state.events];
    });
  };

  setSelectedDate = (date: number) => {
    this.set((state) => {
      state.selectedDate = date;
    });
  };

  setViewMode = (mode: CalendarViewMode) => {
    this.set((state) => {
      state.viewMode = mode;
    });
  };

  selectEvent = (id: string | null) => {
    this.set((state) => {
      state.selectedEventId = id;
    });
  };

  getEventsForDay = (date: Date): CalendarEvent[] => {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayEnd = dayStart + 86400000;
    return this.get().events.filter(
      (e) =>
        (e.startTime >= dayStart && e.startTime < dayEnd) ||
        (e.allDay && e.startTime >= dayStart && e.startTime < dayEnd)
    );
  };

  getEventsForWeek = (startOfWeek: Date): CalendarEvent[] => {
    const weekStart = startOfWeek.getTime();
    const weekEnd = weekStart + 7 * 86400000;
    return this.get().events.filter(
      (e) => e.startTime >= weekStart && e.startTime < weekEnd
    );
  };

  addEvent = (event: Omit<CalendarEvent, "id">) => {
    this.set((state) => {
      state.events.push({
        ...event,
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
    });
    this.persistEvents();
  };

  updateEvent = (eventId: string, updates: Partial<CalendarEvent>) => {
    this.set((state) => {
      const event = state.events.find((e) => e.id === eventId);
      if (event) {
        Object.assign(event, updates);
      }
    });
    this.persistEvents();
  };

  deleteEvent = (eventId: string) => {
    this.set((state) => {
      state.events = state.events.filter((e) => e.id !== eventId);
      if (state.selectedEventId === eventId) {
        state.selectedEventId = null;
      }
    });
    this.persistEvents();
  };

  getTodayEvents = (): CalendarEvent[] => {
    const now = new Date();
    return this.getEventsForDay(now);
  };

  // ── Auto-Booking ──

  autoBookAppointment = (params: {
    title: string;
    description: string;
    startTime: number;
    endTime: number;
    clientName: string;
    clientContact: string;
    agentId?: string;
  }) => {
    this.addEvent({
      title: params.title,
      description: params.description,
      type: "meeting",
      startTime: params.startTime,
      endTime: params.endTime,
      allDay: false,
      color: "#22c55e",
      createdBy: "agent",
      agentId: params.agentId || "agent-comms",
      linkedTaskId: null,
      attendees: [params.clientName],
      isAutoBooked: true,
      confirmationStatus: "pending",
      clientName: params.clientName,
      clientContact: params.clientContact
    });
  };

  confirmAppointment = (eventId: string) => {
    this.updateEvent(eventId, { confirmationStatus: "confirmed" });
  };

  declineAppointment = (eventId: string) => {
    this.updateEvent(eventId, { confirmationStatus: "declined" });
  };

  getAutoBookedEvents = (): CalendarEvent[] => {
    return this.get().events.filter((e) => e.isAutoBooked);
  };

  getPendingAutoBooked = (): CalendarEvent[] => {
    return this.get().events.filter(
      (e) => e.isAutoBooked && e.confirmationStatus === "pending"
    );
  };
}

const [useStore, store] = createStore<CalendarStore>(
  (set, get) => new CalendarStore(set, get)
);

registerStoreForHydration("calendar-events", (data) => {
  store.set({ events: data as CalendarEvent[] });
}, () => store.events);

export { useStore, store };
