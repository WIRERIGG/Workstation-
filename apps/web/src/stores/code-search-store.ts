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

export type SearchMatch = {
  file: string;
  line: number;
  column: number;
  text: string;
  beforeContext: string[];
  afterContext: string[];
};

export type SearchResult = {
  matches: SearchMatch[];
  fileCount: number;
  matchCount: number;
  truncated: boolean;
  duration: number;
  error: string | null;
};

class CodeSearchStore extends BaseStore<CodeSearchStore> {
  query = "";
  isRegex = false;
  caseSensitive = false;
  wholeWord = false;
  includeGlob = "";
  excludeGlob = "";
  results: SearchResult | null = null;
  isSearching = false;
  expandedFiles: Set<string> = new Set();

  setQuery = (query: string) => {
    this.set((s) => {
      s.query = query;
    });
  };

  toggleRegex = () => {
    this.set((s) => {
      s.isRegex = !s.isRegex;
    });
  };

  toggleCaseSensitive = () => {
    this.set((s) => {
      s.caseSensitive = !s.caseSensitive;
    });
  };

  toggleWholeWord = () => {
    this.set((s) => {
      s.wholeWord = !s.wholeWord;
    });
  };

  setIncludeGlob = (glob: string) => {
    this.set((s) => {
      s.includeGlob = glob;
    });
  };

  setExcludeGlob = (glob: string) => {
    this.set((s) => {
      s.excludeGlob = glob;
    });
  };

  setResults = (results: SearchResult | null) => {
    this.set((s) => {
      s.results = results;
      if (results) {
        // Auto-expand all files on search
        s.expandedFiles = new Set(
          [...new Set(results.matches.map((m) => m.file))]
        );
      }
    });
  };

  setSearching = (searching: boolean) => {
    this.set((s) => {
      s.isSearching = searching;
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

  collapseAll = () => {
    this.set((s) => {
      s.expandedFiles = new Set();
    });
  };

  expandAll = () => {
    const results = this.get().results;
    if (results) {
      const next = new Set(results.matches.map((m) => m.file));
      this.set((s) => {
        s.expandedFiles = next;
      });
    }
  };

  clear = () => {
    this.set((s) => {
      s.query = "";
      s.results = null;
      s.isSearching = false;
      s.expandedFiles = new Set();
    });
  };
}

const [useStore, store] = createStore<CodeSearchStore>(
  (set, get) => new CodeSearchStore(set, get)
);

export { useStore, store };
