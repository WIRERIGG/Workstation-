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

// ── Workstation Backend Hydration ──
// On desktop, loads authoritative data from the Electron main process
// and patches Zustand stores. Seeds backend from localStorage on first run.

type HydrationSetter = (data: unknown) => void;
type HydrationGetter = () => unknown;

const registry = new Map<string, { setter: HydrationSetter; getter: HydrationGetter }>();

/**
 * Register a store field for backend hydration.
 * Call once after createStore(), before hydrateFromBackend() runs.
 * @param getter — returns current store data (used to seed backend with defaults on first run)
 */
export function registerStoreForHydration(
  key: string,
  setter: HydrationSetter,
  getter: HydrationGetter
) {
  registry.set(key, { setter, getter });
}

/**
 * Load all workstation data from Electron backend and patch stores.
 * If backend is empty for a key but localStorage has data, seed the backend
 * (one-time migration from localStorage-only to dual storage).
 */
export async function hydrateFromBackend(): Promise<void> {
  if (!IS_DESKTOP_APP) return;

  const PREFIX = "workstation:";

  try {
    const { desktop } = await import("../common/desktop-bridge");
    if (!desktop) return;

    const backendData = await desktop.workstationData.loadAll.query();

    for (const [key, { setter, getter }] of registry) {
      const backendValue = backendData[key];

      if (backendValue != null) {
        // Backend has data — it's authoritative, patch the store
        setter(backendValue);
        // Update localStorage cache (direct write — no IPC write-back to avoid double-write)
        try {
          localStorage.setItem(PREFIX + key, JSON.stringify(backendValue));
        } catch {
          // localStorage full or unavailable
        }
      } else {
        // Backend empty — seed from localStorage or current store defaults
        let dataToSeed: unknown = null;
        try {
          const raw = localStorage.getItem(PREFIX + key);
          if (raw) dataToSeed = JSON.parse(raw);
        } catch {
          // localStorage corrupted
        }
        // If localStorage also empty, use current store state (defaults)
        if (dataToSeed == null) {
          dataToSeed = getter();
        }
        if (dataToSeed != null) {
          // Persist to both backend and localStorage
          desktop.workstationData.save
            .mutate({ key, data: dataToSeed })
            .catch(console.error);
          try {
            localStorage.setItem(PREFIX + key, JSON.stringify(dataToSeed));
          } catch {
            // ignore
          }
        }
      }
    }
  } catch (e) {
    console.error("Workstation hydration failed:", e);
  }
}
