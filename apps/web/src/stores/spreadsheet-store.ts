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
import { loadPersistedData, persistDataDebounced } from "../utils/workstation-persist";
import { registerStoreForHydration } from "../utils/workstation-hydrate";

// ── Spreadsheet Types ──

export type CellValue = string | number | null;

export type Spreadsheet = {
  id: string;
  name: string;
  description: string;
  columns: string[];
  rows: CellValue[][];
  createdAt: number;
  updatedAt: number;
  createdBy: "human" | "agent";
  agentId: string | null;
};

// ── Demo Spreadsheets ──

function createDefaultSpreadsheets(): Spreadsheet[] {
  const now = Date.now();
  const day = 86400000;

  return [
    {
      id: "sheet-1",
      name: "Q1 Revenue Tracker",
      description: "Monthly revenue by product line",
      columns: ["Month", "Product A", "Product B", "Product C", "Total"],
      rows: [
        ["January", 45000, 32000, 18000, 95000],
        ["February", 48000, 35000, 21000, 104000],
        ["March", 52000, 38000, 24000, 114000],
        ["Q1 Total", 145000, 105000, 63000, 313000]
      ],
      createdAt: now - 30 * day,
      updatedAt: now - 2 * day,
      createdBy: "human",
      agentId: null
    },
    {
      id: "sheet-2",
      name: "Agent Performance Metrics",
      description: "Weekly agent activity and efficiency scores",
      columns: [
        "Agent",
        "Tasks Completed",
        "Avg Response (s)",
        "Accuracy %",
        "Status"
      ],
      rows: [
        ["Orchestrator", 47, 1.2, 98, "Active"],
        ["Comms Agent", 23, 3.4, 95, "Active"],
        ["Research Agent", 15, 8.7, 92, "Active"],
        ["TaskMaster", 31, 2.1, 97, "Active"],
        ["Code Agent", 8, 12.3, 89, "Offline"]
      ],
      createdAt: now - 7 * day,
      updatedAt: now - day,
      createdBy: "agent",
      agentId: "agent-orchestrator"
    },
    {
      id: "sheet-3",
      name: "Contact Directory",
      description: "Key business contacts and communication log",
      columns: ["Name", "Company", "Email", "Last Contact", "Notes"],
      rows: [
        [
          "Sarah Chen",
          "Acme Corp",
          "sarah.chen@acmecorp.com",
          "2 days ago",
          "Partnership proposal"
        ],
        [
          "Marcus Rivera",
          "Internal",
          "marcus@team.com",
          "Today",
          "Product demo prep"
        ],
        [
          "Lisa Park",
          "Design Studio",
          "lisa@designstudio.co",
          "1 day ago",
          "Brand assets"
        ],
        [
          "James (Accounting)",
          "External",
          "+1-555-0142",
          "6 hours ago",
          "Document receipt confirmation"
        ]
      ],
      createdAt: now - 14 * day,
      updatedAt: now,
      createdBy: "agent",
      agentId: "agent-comms"
    }
  ];
}

// ── Spreadsheet Store ──

class SpreadsheetStore extends BaseStore<SpreadsheetStore> {
  spreadsheets: Spreadsheet[] = loadPersistedData<Spreadsheet[]>("spreadsheets") || createDefaultSpreadsheets();
  selectedSheetId: string | null = null;
  editingCell: { row: number; col: number } | null = null;

  refresh = () => {
    this.set((state) => {
      state.spreadsheets = [...state.spreadsheets];
    });
  };

  private persistSheets = () => {
    persistDataDebounced("spreadsheets", this.get().spreadsheets);
  };

  selectSheet = (id: string | null) => {
    this.set((state) => {
      state.selectedSheetId = id;
      state.editingCell = null;
    });
  };

  setEditingCell = (cell: { row: number; col: number } | null) => {
    this.set((state) => {
      state.editingCell = cell;
    });
  };

  updateCell = (sheetId: string, row: number, col: number, value: CellValue) => {
    this.set((state) => {
      const sheet = state.spreadsheets.find((s) => s.id === sheetId);
      if (sheet && sheet.rows[row]) {
        sheet.rows[row][col] = value;
        sheet.updatedAt = Date.now();
      }
    });
    this.persistSheets();
  };

  addRow = (sheetId: string) => {
    this.set((state) => {
      const sheet = state.spreadsheets.find((s) => s.id === sheetId);
      if (sheet) {
        sheet.rows.push(new Array(sheet.columns.length).fill(null));
        sheet.updatedAt = Date.now();
      }
    });
    this.persistSheets();
  };

  deleteRow = (sheetId: string, rowIndex: number) => {
    this.set((state) => {
      const sheet = state.spreadsheets.find((s) => s.id === sheetId);
      if (sheet && sheet.rows[rowIndex]) {
        sheet.rows.splice(rowIndex, 1);
        sheet.updatedAt = Date.now();
      }
    });
    this.persistSheets();
  };

  addColumn = (sheetId: string, name: string) => {
    this.set((state) => {
      const sheet = state.spreadsheets.find((s) => s.id === sheetId);
      if (sheet) {
        sheet.columns.push(name);
        for (const row of sheet.rows) {
          row.push(null);
        }
        sheet.updatedAt = Date.now();
      }
    });
    this.persistSheets();
  };

  deleteColumn = (sheetId: string, colIndex: number) => {
    this.set((state) => {
      const sheet = state.spreadsheets.find((s) => s.id === sheetId);
      if (sheet && sheet.columns[colIndex]) {
        sheet.columns.splice(colIndex, 1);
        for (const row of sheet.rows) {
          row.splice(colIndex, 1);
        }
        sheet.updatedAt = Date.now();
      }
    });
    this.persistSheets();
  };

  addSpreadsheet = (name: string, description: string, columns: string[]) => {
    const now = Date.now();
    this.set((state) => {
      state.spreadsheets.push({
        id: `sheet-${now}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        description,
        columns,
        rows: [],
        createdAt: now,
        updatedAt: now,
        createdBy: "human",
        agentId: null
      });
    });
    this.persistSheets();
  };

  deleteSpreadsheet = (sheetId: string) => {
    this.set((state) => {
      state.spreadsheets = state.spreadsheets.filter((s) => s.id !== sheetId);
      if (state.selectedSheetId === sheetId) {
        state.selectedSheetId = null;
      }
    });
    this.persistSheets();
  };

  renameSpreadsheet = (sheetId: string, name: string) => {
    this.set((state) => {
      const sheet = state.spreadsheets.find((s) => s.id === sheetId);
      if (sheet) {
        sheet.name = name;
        sheet.updatedAt = Date.now();
      }
    });
    this.persistSheets();
  };
}

const [useStore, store] = createStore<SpreadsheetStore>(
  (set, get) => new SpreadsheetStore(set, get)
);

registerStoreForHydration("spreadsheets", (data) => {
  store.set({ spreadsheets: data as Spreadsheet[] });
}, () => store.spreadsheets);

export { useStore, store };
