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
import { Note } from "@workstation/core";
import { db } from "../common/database";
import { WorkstationModule } from "../utils/workstation-module";
import { Platform } from "react-native";

let timer: NodeJS.Timeout;
export const NotePreviewWidget = {
  updateNotes: () => {
    if (Platform.OS !== "android") return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const noteIds = await WorkstationModule.getWidgetNotes();
      for (const id of noteIds) {
        const newNote = await db.notes.note(id);
        if (!newNote) continue;

        WorkstationModule.updateWidgetNote(id, JSON.stringify(newNote));
      }
    }, 500);
  },
  updateNote: async (id: string, note: Note) => {
    if (Platform.OS !== "android") return;
    if (id && (await WorkstationModule.hasWidgetNote(id))) {
      WorkstationModule.updateWidgetNote(id, JSON.stringify(note));
    }
  }
};
