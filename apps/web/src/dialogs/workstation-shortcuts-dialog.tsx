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

import { Flex, Text } from "@theme-ui/components";
import { DialogManager } from "../common/dialog-manager";
import Dialog from "../components/dialog";
import { WORKSTATION_SHORTCUTS, WorkstationShortcut } from "../common/workstation-keymap";

function groupByCategory(
  shortcuts: WorkstationShortcut[]
): { category: string; shortcuts: WorkstationShortcut[] }[] {
  const groups: Record<string, WorkstationShortcut[]> = {};
  for (const s of shortcuts) {
    if (!groups[s.category]) groups[s.category] = [];
    groups[s.category].push(s);
  }
  return Object.entries(groups).map(([category, shortcuts]) => ({
    category,
    shortcuts
  }));
}

function formatShortcutKey(key: string): string {
  return key
    .split("+")
    .map((k) => {
      switch (k.toLowerCase()) {
        case "shift":
          return "Shift";
        case "/":
          return "?";
        case "escape":
          return "Esc";
        default:
          return k.toUpperCase();
      }
    })
    .join(" + ");
}

export const WorkstationShortcutsDialog = DialogManager.register(
  function WorkstationShortcutsDialog(props) {
    const groups = groupByCategory(WORKSTATION_SHORTCUTS);

    return (
      <Dialog
        isOpen={true}
        title={"Workstation Shortcuts"}
        width={500}
        onClose={() => props.onClose(false)}
      >
        <Flex
          sx={{
            flexDirection: "column",
            mt: 2,
            gap: 1
          }}
        >
          {groups.map((group) => (
            <Flex key={group.category} sx={{ flexDirection: "column" }}>
              <Text
                variant="subtitle"
                sx={{
                  borderBottom: "1px solid var(--border)",
                  mb: 1,
                  pb: 1
                }}
              >
                {group.category}
              </Text>
              {group.shortcuts.map((shortcut) => (
                <Flex
                  key={shortcut.keys}
                  sx={{
                    mb: 2,
                    flexDirection: "row",
                    justifyContent: "space-between"
                  }}
                >
                  <Text variant="body">{shortcut.description}</Text>
                  <Flex sx={{ gap: 1 }}>
                    {shortcut.keys.split("+").map((k) => (
                      <Text
                        key={k}
                        as="code"
                        sx={{
                          bg: "background",
                          color: "paragraph",
                          px: 1,
                          borderRadius: 5,
                          fontSize: "body",
                          border: "1px solid var(--border)"
                        }}
                      >
                        {formatShortcutKey(k)}
                      </Text>
                    ))}
                  </Flex>
                </Flex>
              ))}
            </Flex>
          ))}
        </Flex>
      </Dialog>
    );
  }
);
