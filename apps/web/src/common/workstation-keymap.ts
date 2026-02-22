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

import hotkeys from "hotkeys-js";
import { navigate } from "../navigation";
import { WorkstationShortcutsDialog } from "../dialogs/workstation-shortcuts-dialog";

function isInInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tagName = el.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

export type WorkstationShortcut = {
  keys: string;
  description: string;
  category: string;
};

export const WORKSTATION_SHORTCUTS: WorkstationShortcut[] = [
  { keys: "1", description: "Go to Dashboard", category: "Navigation" },
  { keys: "2", description: "Go to Notes", category: "Navigation" },
  { keys: "3", description: "Go to Tasks", category: "Navigation" },
  { keys: "4", description: "Go to Calendar", category: "Navigation" },
  { keys: "5", description: "Go to Agents", category: "Navigation" },
  { keys: "6", description: "Go to Communications", category: "Navigation" },
  { keys: "shift+/", description: "Show keyboard shortcuts", category: "General" },
  { keys: "escape", description: "Deselect active panels", category: "General" }
];

const NAV_ROUTES = [
  "/dashboard",
  "/notes",
  "/tasks",
  "/calendar",
  "/agents",
  "/communications"
] as const;

export function registerWorkstationKeyMap() {
  // Number keys 1-6 for navigation
  NAV_ROUTES.forEach((route, index) => {
    hotkeys(String(index + 1), (e) => {
      if (isInInput()) return;
      e.preventDefault();
      navigate(route as never);
    });
  });

  // ? (shift+/) for shortcuts help
  hotkeys("shift+/", (e) => {
    if (isInInput()) return;
    e.preventDefault();
    WorkstationShortcutsDialog.show({});
  });

  // Escape to deselect (blur active element)
  hotkeys("escape", (e) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    e.preventDefault();
  });
}
