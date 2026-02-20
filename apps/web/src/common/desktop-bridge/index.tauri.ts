/*
This file is part of the Workstation project.

Tauri IPC bridge — drop-in replacement for the Electron tRPC bridge.
Exports the same `desktop` shape backed by @tauri-apps/api/core invoke().
*/

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppEventManager, AppEvents } from "../app-events";
import { TaskScheduler } from "../../utils/task-scheduler";

// ─── Compression ────────────────────────────────────────────

const compress = {
  gzip: {
    query: (input: { data: string; level: number }) =>
      invoke<string>("compress_gzip", input)
  },
  gunzip: {
    query: (input: string) => invoke<string>("decompress_gunzip", { data: input })
  }
};

// ─── Safe Storage ───────────────────────────────────────────
// Electron's safeStorage.encryptString returns encrypted bytes.
// We use the OS keyring (via Rust keyring crate) as a key-value store:
// encryptString stores the value and returns a base64 reference token;
// decryptString decodes the token to look up the original value.

const SAFE_STORAGE_KEY = "workstation-keystore";

const safeStorage = {
  isEncryptionAvailable: {
    query: () => invoke<boolean>("safe_storage_is_available")
  },
  encryptString: {
    query: async (input: string) => {
      await invoke<void>("safe_storage_encrypt", {
        key: SAFE_STORAGE_KEY,
        value: input
      });
      // Return a base64-encoded reference token. The consumer stores this
      // as binary (Buffer → ArrayBuffer) and later passes it back via
      // Buffer.from(ab).toString("base64") to decryptString.
      return btoa(SAFE_STORAGE_KEY);
    }
  },
  decryptString: {
    query: async (input: string) => {
      // input is base64 of the reference token bytes — decode to recover
      // the keyring key, then look up the stored value.
      const keyringKey = atob(input);
      return invoke<string>("safe_storage_decrypt", { key: keyringKey });
    }
  }
};

// ─── Window ─────────────────────────────────────────────────

const window = {
  maximize: { mutate: () => invoke<void>("window_maximize") },
  restore: { mutate: () => invoke<void>("window_restore") },
  minimize: { mutate: () => invoke<void>("window_minimize") },
  minimze: { mutate: () => invoke<void>("window_minimize") },
  close: { mutate: () => invoke<void>("window_close") },
  maximized: { query: () => invoke<boolean>("window_is_maximized") },
  fullscreen: { query: () => invoke<boolean>("window_is_fullscreen") },
  setFullscreen: {
    mutate: (fullscreen: boolean) =>
      invoke<void>("window_set_fullscreen", { fullscreen })
  },
  setAlwaysOnTop: {
    mutate: (onTop: boolean) =>
      invoke<void>("window_set_always_on_top", { onTop })
  },
  onWindowStateChanged: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("window-state-changed", (event) => {
        callbacks.onData(event.payload);
      });
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  }
};

// ─── OS Integration ─────────────────────────────────────────

const integration = {
  isFlatpak: { query: () => Promise.resolve(false) },
  isSnap: { query: () => Promise.resolve(false) },
  zoomFactor: { query: () => invoke<number>("get_zoom_factor") },
  setZoomFactor: {
    mutate: (factor: number) =>
      invoke<void>("set_zoom_factor", { factor })
  },
  privacyMode: { query: () => Promise.resolve(false) },
  setPrivacyMode: {
    mutate: ({ enabled }: { enabled: boolean }) =>
      invoke<void>("set_content_protection", { enabled })
  },
  selectDirectory: {
    query: (opts: {
      title?: string;
      buttonLabel?: string;
      defaultPath?: string;
    }) =>
      invoke<string | null>("select_directory", {
        title: opts.title,
        defaultPath: opts.defaultPath
      })
  },
  selectFile: {
    query: (opts: { title?: string; filters?: [string, string[]][] }) =>
      invoke<string | null>("select_file", {
        title: opts.title,
        filters: opts.filters
      })
  },
  saveFile: {
    mutate: (opts: { data: string; filePath: string }) =>
      invoke<void>("save_file", { path: opts.filePath, data: opts.data })
  },
  deleteFile: {
    mutate: (path: string) => invoke<void>("delete_file", { path })
  },
  resolvePath: {
    query: (opts: { filePath: string }) =>
      invoke<string>("resolve_path", { filePath: opts.filePath })
  },
  openPath: {
    mutate: (opts: { type: string; link: string }) =>
      invoke<void>("open_path", { path: opts.link })
  },
  bringToFront: { mutate: () => invoke<void>("bring_to_front") },
  restart: { mutate: () => invoke<void>("restart_app") },
  getAppDataDir: { query: () => invoke<string>("get_app_data_dir") },
  showNotification: {
    mutate: async (_opts: {
      title?: string;
      body?: string;
      silent?: boolean;
      tag?: string;
    }) => {
      // Tauri plugin notification handles this natively
      return undefined;
    }
  },
  desktopIntegration: {
    query: () => Promise.resolve({ autoStart: false })
  },
  setDesktopIntegration: {
    mutate: (_settings: any) => Promise.resolve()
  },
  customDns: { query: () => Promise.resolve(false) },
  setCustomDns: { mutate: (_v?: boolean) => Promise.resolve() },
  proxyRules: { query: () => Promise.resolve("") },
  setProxyRules: { mutate: (_v?: string) => Promise.resolve() },
  changeTheme: {
    mutate: (_opts: {
      theme: string;
      windowControlsIconColor?: string;
      backgroundColor?: string;
    }) => Promise.resolve()
  },
  onThemeChanged: {
    subscribe: (
      _: undefined,
      _callbacks: { onData: (...args: any[]) => void }
    ) => {
      return { unsubscribe: () => {} };
    }
  },
  showMenu: {
    subscribe: (
      _input: { menuItems: any[] },
      _callbacks: { onData: (...args: any[]) => void }
    ) => {
      return { unsubscribe: () => {} };
    }
  }
};

// ─── Updater ────────────────────────────────────────────────

const updater = {
  autoUpdates: { query: () => Promise.resolve(true) },
  releaseTrack: { query: () => Promise.resolve("stable") },
  toggleAutoUpdates: {
    mutate: (_opts: { enabled: boolean }) => Promise.resolve()
  },
  changeReleaseTrack: {
    mutate: (_opts: { track: string }) => Promise.resolve()
  },
  check: { mutate: () => invoke<any>("check_for_update") },
  download: {
    mutate: () => invoke<void>("download_and_install_update")
  },
  install: { mutate: () => invoke<void>("download_and_install_update") },
  onChecking: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("update-checking", () =>
        callbacks.onData()
      );
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  },
  onAvailable: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("update-available", (event) =>
        callbacks.onData(event.payload)
      );
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  },
  onDownloaded: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("update-downloaded", (event) =>
        callbacks.onData(event.payload)
      );
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  },
  onDownloadProgress: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("update-download-progress", (event) =>
        callbacks.onData(event.payload)
      );
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  },
  onNotAvailable: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("update-not-available", (event) =>
        callbacks.onData(event.payload)
      );
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  },
  onError: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("update-error", (event) =>
        callbacks.onData(event.payload)
      );
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  }
};

// ─── Spell Checker (stub — Tauri doesn't have built-in spellcheck) ──

const spellChecker = {
  isEnabled: { query: () => Promise.resolve(false) },
  languages: { query: () => Promise.resolve([]) },
  enabledLanguages: { query: () => Promise.resolve([]) },
  setLanguages: { mutate: (_codes: string[]) => Promise.resolve() },
  toggle: { mutate: (_opts: { enabled: boolean }) => Promise.resolve() },
  words: { query: () => Promise.resolve([]) },
  deleteWord: { mutate: (_word: string) => Promise.resolve() }
};

// ─── Bridge (IPC event bridge) ──────────────────────────────

const bridge = {
  onCreateItem: {
    subscribe: (
      _: undefined,
      callbacks: { onData: (...args: any[]) => void }
    ) => {
      const unlisten = listen("create-item", (event) =>
        callbacks.onData(event.payload)
      );
      return { unsubscribe: () => unlisten.then((fn) => fn()) };
    }
  }
};

// ─── Workstation Data ───────────────────────────────────────

const workstationData = {
  load: {
    query: (input: { key: string }) =>
      invoke<unknown>("ws_data_load", input)
  },
  save: {
    mutate: (input: { key: string; data: unknown }) =>
      invoke<void>("ws_data_save", input)
  },
  remove: {
    mutate: (input: { key: string }) =>
      invoke<void>("ws_data_remove", input)
  },
  loadAll: {
    query: () => invoke<Record<string, unknown>>("ws_data_load_all")
  }
};

// ─── Assembled desktop object ───────────────────────────────

export const desktop = {
  compress,
  integration,
  spellChecker,
  updater,
  bridge,
  safeStorage,
  window,
  workstationData
};

// ─── Event listeners (matches Electron bridge behavior) ─────

attachListeners();
function attachListeners() {
  listen("update-checking", () => {
    AppEventManager.publish(AppEvents.checkingForUpdate);
  });

  listen("update-available", (event) => {
    AppEventManager.publish(AppEvents.updateAvailable, event.payload);
  });

  listen("update-downloaded", (event) => {
    AppEventManager.publish(
      AppEvents.updateDownloadCompleted,
      event.payload
    );
  });

  listen("update-download-progress", (event) => {
    AppEventManager.publish(
      AppEvents.updateDownloadProgress,
      event.payload
    );
  });

  listen("update-not-available", (event) => {
    AppEventManager.publish(AppEvents.updateNotAvailable, event.payload);
  });

  listen("update-error", (event) => {
    AppEventManager.publish(AppEvents.updateError, event.payload);
  });

  TaskScheduler.register("updateCheck", "0 0 */12 * * * *", () => {
    invoke("check_for_update").catch(console.error);
  });
}

// ─── createWritableStream ───────────────────────────────────

export async function createWritableStream(path: string) {
  const resolvedPath = await invoke<string>("resolve_path", {
    filePath: path
  });
  if (!resolvedPath) throw new Error("invalid path.");

  // Use Tauri FS plugin to write
  const { writeFile } = await import("@tauri-apps/plugin-fs");

  return new WritableStream({
    async write(chunk: Uint8Array | string) {
      const data =
        typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      await writeFile(resolvedPath, data);
    }
  });
}
