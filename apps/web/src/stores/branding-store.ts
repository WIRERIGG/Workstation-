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
import { loadPersistedData, persistData, clearPersistedData } from "../utils/workstation-persist";
import { registerStoreForHydration } from "../utils/workstation-hydrate";

// ── Branding Types ──

export type Industry =
  | "technology"
  | "finance"
  | "healthcare"
  | "retail"
  | "consulting"
  | "real-estate"
  | "legal"
  | "marketing"
  | "education"
  | "other";

export type TeamSize = "solo" | "2-5" | "6-20" | "21-50" | "50+";

export type EmailVolume = "low" | "medium" | "high" | "very-high";
export type CallVolume = "none" | "low" | "medium" | "high";

export type PreferredTone =
  | "professional"
  | "friendly"
  | "casual"
  | "formal"
  | "concise";

export type PrimaryGoal =
  | "productivity"
  | "client-management"
  | "team-coordination"
  | "sales"
  | "support"
  | "general";

export type BrandingData = {
  businessName: string;
  industry: Industry;
  teamSize: TeamSize;
  logo: string; // data URL or empty
  primaryColor: string;
  preferredTone: PreferredTone;
  primaryGoal: PrimaryGoal;
  emailVolume: EmailVolume;
  callVolume: CallVolume;
  wantsAutoScheduling: boolean;
  wantsNewsletters: boolean;
  wantsCallbacks: boolean;
  wantsMultiCall: boolean;
  isOnboarded: boolean;
};

const DEFAULT_BRANDING: BrandingData = {
  businessName: "Workstation",
  industry: "technology",
  teamSize: "solo",
  logo: "",
  primaryColor: "#E00000",
  preferredTone: "professional",
  primaryGoal: "productivity",
  emailVolume: "medium",
  callVolume: "low",
  wantsAutoScheduling: false,
  wantsNewsletters: false,
  wantsCallbacks: false,
  wantsMultiCall: false,
  isOnboarded: false
};

function loadBranding(): BrandingData {
  const saved = loadPersistedData<BrandingData>("branding");
  return saved ? { ...DEFAULT_BRANDING, ...saved } : { ...DEFAULT_BRANDING };
}

// ── Branding Store ──

class BrandingStore extends BaseStore<BrandingStore> {
  branding: BrandingData = loadBranding();

  private persist = () => {
    persistData("branding", this.get().branding);
  };

  completeOnboarding = (data: Omit<BrandingData, "isOnboarded">) => {
    this.set((state) => {
      state.branding = { ...data, isOnboarded: true };
    });
    this.persist();
  };

  updateBranding = (partial: Partial<BrandingData>) => {
    this.set((state) => {
      Object.assign(state.branding, partial);
    });
    this.persist();
  };

  resetBranding = () => {
    this.set((state) => {
      state.branding = { ...DEFAULT_BRANDING };
    });
    clearPersistedData("branding");
  };
}

const [useStore, store] = createStore<BrandingStore>(
  (set, get) => new BrandingStore(set, get)
);

registerStoreForHydration("branding", (data) => {
  store.set({ branding: data as BrandingData });
}, () => store.branding);

export { useStore, store };
