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

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export type Diagnostic = {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  source: "typescript" | "eslint";
  code: string;
};

export type DiagnosticsResult = {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  fileCount: number;
  duration: number;
  error: string | null;
};

type SeverityFilter = {
  error: boolean;
  warning: boolean;
  info: boolean;
};

type SourceFilter = {
  typescript: boolean;
  eslint: boolean;
};

class DiagnosticsStore extends BaseStore<DiagnosticsStore> {
  results: DiagnosticsResult | null = null;
  isRunning = false;
  severityFilter: SeverityFilter = { error: true, warning: true, info: true };
  sourceFilter: SourceFilter = { typescript: true, eslint: true };
  expandedFiles: Set<string> = new Set();
  selectedDiagnostic: Diagnostic | null = null;
  lastRunAt: number | null = null;

  setResults = (results: DiagnosticsResult | null) => {
    this.set((s) => {
      s.results = results;
      s.lastRunAt = Date.now();
      if (results) {
        // Auto-expand files with errors
        s.expandedFiles = new Set(
          results.diagnostics
            .filter((d) => d.severity === "error")
            .map((d) => d.file)
        );
      }
    });
  };

  setRunning = (running: boolean) => {
    this.set((s) => {
      s.isRunning = running;
    });
  };

  toggleSeverity = (severity: keyof SeverityFilter) => {
    this.set((s) => {
      s.severityFilter[severity] = !s.severityFilter[severity];
    });
  };

  toggleSource = (source: keyof SourceFilter) => {
    this.set((s) => {
      s.sourceFilter[source] = !s.sourceFilter[source];
    });
  };

  toggleFileExpanded = (file: string) => {
    const current = this.get().expandedFiles;
    const next = new Set(current);
    if (next.has(file)) {
      next.delete(file);
    } else {
      next.add(file);
    }
    this.set((s) => {
      s.expandedFiles = next;
    });
  };

  selectDiagnostic = (d: Diagnostic | null) => {
    this.set((s) => {
      s.selectedDiagnostic = d;
    });
  };

  collapseAll = () => {
    this.set((s) => {
      s.expandedFiles = new Set();
    });
  };

  expandAll = () => {
    const results = this.get().results;
    if (results) {
      const next = new Set(results.diagnostics.map((d) => d.file));
      this.set((s) => {
        s.expandedFiles = next;
      });
    }
  };

  clear = () => {
    this.set((s) => {
      s.results = null;
      s.isRunning = false;
      s.expandedFiles = new Set();
      s.selectedDiagnostic = null;
    });
  };
}

const [useStore, store] = createStore<DiagnosticsStore>(
  (set, get) => new DiagnosticsStore(set, get)
);

export { useStore, store };
