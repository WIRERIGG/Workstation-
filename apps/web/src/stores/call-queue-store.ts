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

// ── Call Queue Types ──

export type CallStatus = "waiting" | "active" | "completed" | "missed";
export type CallPriority = "high" | "medium" | "low";

export type QueuedCall = {
  id: string;
  callerName: string;
  callerPhone: string;
  waitTime: number; // seconds
  reason: string;
  priority: CallPriority;
  assignedAgent: string | null;
  status: CallStatus;
  enteredAt: number; // timestamp
  completedAt: number | null;
};

// ── Demo Queue ──

function createDefaultQueue(): QueuedCall[] {
  const now = Date.now();

  return [
    {
      id: "call-1",
      callerName: "Elena Vasquez",
      callerPhone: "+1-555-0198",
      waitTime: 245,
      reason: "Follow-up on project consultation",
      priority: "high",
      assignedAgent: null,
      status: "waiting",
      enteredAt: now - 245000,
      completedAt: null
    },
    {
      id: "call-2",
      callerName: "David Kim",
      callerPhone: "+1-555-0177",
      waitTime: 180,
      reason: "Billing inquiry — invoice #4821",
      priority: "high",
      assignedAgent: null,
      status: "waiting",
      enteredAt: now - 180000,
      completedAt: null
    },
    {
      id: "call-3",
      callerName: "Rachel Torres",
      callerPhone: "+1-555-0234",
      waitTime: 95,
      reason: "New service inquiry",
      priority: "medium",
      assignedAgent: "agent-comms",
      status: "active",
      enteredAt: now - 95000,
      completedAt: null
    },
    {
      id: "call-4",
      callerName: "James Wright",
      callerPhone: "+1-555-0142",
      waitTime: 45,
      reason: "Document confirmation callback",
      priority: "low",
      assignedAgent: null,
      status: "waiting",
      enteredAt: now - 45000,
      completedAt: null
    },
    {
      id: "call-5",
      callerName: "Lisa Park",
      callerPhone: "+1-555-0305",
      waitTime: 320,
      reason: "Design assets review",
      priority: "medium",
      assignedAgent: null,
      status: "missed",
      enteredAt: now - 3600000,
      completedAt: now - 3280000
    }
  ];
}

// ── Call Queue Store ──

class CallQueueStore extends BaseStore<CallQueueStore> {
  calls: QueuedCall[] = loadPersistedData<QueuedCall[]>("call-queue") || createDefaultQueue();

  private persist = () => {
    persistDataDebounced("call-queue", this.get().calls);
  };

  addToQueue = (call: Omit<QueuedCall, "id" | "waitTime" | "enteredAt" | "completedAt" | "status">) => {
    const now = Date.now();
    this.set((state) => {
      state.calls.unshift({
        ...call,
        id: `call-${now}-${Math.random().toString(36).slice(2, 8)}`,
        waitTime: 0,
        status: "waiting",
        enteredAt: now,
        completedAt: null
      });
    });
    this.persist();
  };

  pickUpCall = (callId: string, agentId?: string) => {
    this.set((state) => {
      const call = state.calls.find((c) => c.id === callId);
      if (call) {
        call.status = "active";
        call.assignedAgent = agentId || null;
      }
    });
    this.persist();
  };

  transferCall = (callId: string, agentId: string) => {
    this.set((state) => {
      const call = state.calls.find((c) => c.id === callId);
      if (call) {
        call.assignedAgent = agentId;
      }
    });
    this.persist();
  };

  completeCall = (callId: string) => {
    this.set((state) => {
      const call = state.calls.find((c) => c.id === callId);
      if (call) {
        call.status = "completed";
        call.completedAt = Date.now();
      }
    });
    this.persist();
  };

  missCall = (callId: string) => {
    this.set((state) => {
      const call = state.calls.find((c) => c.id === callId);
      if (call) {
        call.status = "missed";
        call.completedAt = Date.now();
      }
    });
    this.persist();
  };

  tickWaitTimes = () => {
    this.set((state) => {
      const now = Date.now();
      for (const call of state.calls) {
        if (call.status === "waiting" || call.status === "active") {
          call.waitTime = Math.floor((now - call.enteredAt) / 1000);
        }
      }
    });
  };

  getQueueStats = () => {
    const calls = this.get().calls;
    const waiting = calls.filter((c) => c.status === "waiting");
    const avgWait = waiting.length > 0
      ? Math.round(waiting.reduce((sum, c) => sum + c.waitTime, 0) / waiting.length)
      : 0;
    const longestWait = waiting.length > 0
      ? Math.max(...waiting.map((c) => c.waitTime))
      : 0;
    const missedToday = calls.filter((c) => {
      if (c.status !== "missed") return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return c.completedAt && c.completedAt >= today.getTime();
    }).length;

    return {
      callsWaiting: waiting.length,
      avgWaitTime: avgWait,
      longestWait,
      missedToday,
      active: calls.filter((c) => c.status === "active").length
    };
  };
}

const [useStore, store] = createStore<CallQueueStore>(
  (set, get) => new CallQueueStore(set, get)
);

registerStoreForHydration("call-queue", (data) => {
  store.set({ calls: data as QueuedCall[] });
}, () => store.calls);

export { useStore, store };
