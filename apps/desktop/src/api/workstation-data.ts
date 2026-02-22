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

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { WorkstationStorage } from "../utils/workstation-storage";

const t = initTRPC.create();

const STORE_KEYS = [
  "tasks",
  "calendar-events",
  "spreadsheets",
  "comms-messages",
  "call-queue",
  "newsletters",
  "branding",
  "openclaw-settings"
] as const;

const StoreKey = z.enum(STORE_KEYS);

export const workstationDataRouter = t.router({
  load: t.procedure
    .input(z.object({ key: StoreKey }))
    .query(({ input }) => {
      return WorkstationStorage.load(input.key);
    }),

  save: t.procedure
    .input(z.object({ key: StoreKey, data: z.unknown() }))
    .mutation(({ input }) => {
      WorkstationStorage.save(input.key, input.data);
    }),

  remove: t.procedure
    .input(z.object({ key: StoreKey }))
    .mutation(({ input }) => {
      WorkstationStorage.remove(input.key);
    }),

  loadAll: t.procedure.query(() => {
    return WorkstationStorage.loadAll([...STORE_KEYS]);
  })
});
