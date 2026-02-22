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

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  renameSync
} from "fs";
import { app } from "electron";
import { join } from "path";

const directory = join(app.getPath("userData"), "workstation");
mkdirSync(directory, { recursive: true });

function filePath(key: string): string {
  return join(directory, `${key}.json`);
}

class WorkstationStorage {
  static load<T>(key: string): T | null {
    try {
      const json = readFileSync(filePath(key), "utf-8");
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }

  static save(key: string, data: unknown): void {
    const target = filePath(key);
    const tmp = target + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, target);
    } catch (e) {
      console.error(`WorkstationStorage.save(${key}) failed:`, e);
      // Clean up temp file if rename failed
      try {
        unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
  }

  static remove(key: string): void {
    try {
      unlinkSync(filePath(key));
    } catch {
      // File doesn't exist — that's fine
    }
  }

  static loadAll(keys: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const data = this.load(key);
      if (data !== null) {
        result[key] = data;
      }
    }
    return result;
  }
}

export { WorkstationStorage };
