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

// ── Workstation Data Persistence ──
// Simple localStorage-based persistence for workstation module data.
// Saves specified fields from Zustand stores and restores them on page load.

const PREFIX = "workstation:";

export function loadPersistedData<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // Corrupted data — clear it
    localStorage.removeItem(PREFIX + key);
  }
  return null;
}

export function persistData(key: string, data: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silently fail
  }

  // Write-through to Electron backend (fire-and-forget)
  if (IS_DESKTOP_APP) {
    import("../common/desktop-bridge").then(({ desktop }) => {
      desktop?.workstationData.save.mutate({ key, data }).catch(console.error);
    });
  }
}

export function clearPersistedData(key: string) {
  localStorage.removeItem(PREFIX + key);

  if (IS_DESKTOP_APP) {
    import("../common/desktop-bridge").then(({ desktop }) => {
      desktop?.workstationData.remove.mutate({ key }).catch(console.error);
    });
  }
}

// Debounced persistence — prevents excessive writes during rapid updates
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function persistDataDebounced(
  key: string,
  data: unknown,
  delay = 500
) {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      persistData(key, data);
      timers.delete(key);
    }, delay)
  );
}
