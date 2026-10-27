import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_STORAGE_PROBE_CONFIRM_MS,
  LOCAL_STORAGE_PROBE_KEY,
  createSettingsStorage,
  readLocalStorageProbe,
  startLocalStorageProbe,
  type SettingsSnapshot,
  type SettingsUpdate,
} from "./settingsStorage";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

/** The main process's file, applying updates the way electron/app-settings.cjs does. */
function settingsFile(initial: Partial<SettingsSnapshot> = {}) {
  const state: SettingsSnapshot = { migrated: [], values: {}, ...initial };
  const updates: SettingsUpdate[] = [];
  return {
    state,
    updates,
    open() {
      return {
        snapshot: structuredClone(state),
        update(patch: SettingsUpdate) {
          updates.push(structuredClone(patch));
          for (const [key, value] of Object.entries(patch.values ?? {})) {
            if (value === null) delete state.values[key];
            else state.values[key] = value;
          }
          for (const spec of patch.migrated ?? []) if (!state.migrated.includes(spec)) state.migrated.push(spec);
          if (patch.localStorageProbe) {
            state.localStorageProbe = { confirmed: 0, lossReported: false, ...state.localStorageProbe, ...patch.localStorageProbe };
          }
        },
      };
    },
  };
}

const PERSISTENT = ["theme", "activeWorkspaceId", "activeConversationId:*"];
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("settings storage", () => {
  it("migrates the current localStorage values into the file on first run", () => {
    const cache = memoryStorage({
      theme: "light",
      activeWorkspaceId: "work",
      "activeConversationId:claude:work": "chat-1",
      "openSkillsCategory": "my-skills",
    });
    const file = settingsFile();
    const storage = createSettingsStorage({ cache: () => cache, file: file.open(), persistent: PERSISTENT });

    expect(file.state.values).toEqual({ theme: "light", activeWorkspaceId: "work", "activeConversationId:claude:work": "chat-1" });
    expect(file.state.migrated).toEqual(PERSISTENT);
    expect(storage.getItem("activeWorkspaceId")).toBe("work");
    // A key that is not a setting stays in localStorage only.
    expect(storage.getItem("openSkillsCategory")).toBe("my-skills");
    expect(file.state.values).not.toHaveProperty("openSkillsCategory");
  });

  it("reads the settings from the file when localStorage comes back empty", () => {
    const file = settingsFile({
      migrated: [...PERSISTENT],
      values: { theme: "light", activeWorkspaceId: "work", "activeConversationId:claude:work": "chat-1" },
    });
    const cache = memoryStorage();
    const storage = createSettingsStorage({ cache: () => cache, file: file.open(), persistent: PERSISTENT });

    expect(storage.getItem("theme")).toBe("light");
    expect(storage.getItem("activeWorkspaceId")).toBe("work");
    expect(storage.getItem("activeConversationId:claude:work")).toBe("chat-1");
    // The cache is filled again, for code that still reads localStorage.
    expect(cache.getItem("activeWorkspaceId")).toBe("work");
    expect(file.updates).toEqual([]);
  });

  it("prefers the file over a localStorage that kept stale values", () => {
    const file = settingsFile({ migrated: [...PERSISTENT], values: { theme: "dark" } });
    const cache = memoryStorage({ theme: "light", activeWorkspaceId: "removed-since" });
    const storage = createSettingsStorage({ cache: () => cache, file: file.open(), persistent: PERSISTENT });

    expect(storage.getItem("theme")).toBe("dark");
    expect(storage.getItem("activeWorkspaceId")).toBeNull();
    expect(cache.getItem("theme")).toBe("dark");
    expect(cache.getItem("activeWorkspaceId")).toBeNull();
  });

  it("migrates a setting added in a later version although the file exists", () => {
    const file = settingsFile({ migrated: ["theme"], values: { theme: "dark" } });
    const cache = memoryStorage({ theme: "light", activeWorkspaceId: "work" });
    createSettingsStorage({ cache: () => cache, file: file.open(), persistent: PERSISTENT });

    expect(file.state.values).toEqual({ theme: "dark", activeWorkspaceId: "work" });
    expect(file.state.migrated).toEqual(PERSISTENT);
  });

  it("saves changes made in one task as one update, and removals as null", async () => {
    const file = settingsFile({ migrated: [...PERSISTENT], values: { theme: "dark", "activeConversationId:claude:old": "chat-0" } });
    const cache = memoryStorage();
    const storage = createSettingsStorage({ cache: () => cache, file: file.open(), persistent: PERSISTENT });

    storage.setItem("activeWorkspaceId", "work");
    storage.setItem("activeConversationId:claude:work", "chat-1");
    storage.removeItem("activeConversationId:claude:old");
    storage.setItem("theme", "dark");
    storage.setItem("draft", "kept in localStorage");
    await flush();

    expect(file.updates).toEqual([{ values: {
      activeWorkspaceId: "work",
      "activeConversationId:claude:work": "chat-1",
      "activeConversationId:claude:old": null,
    } }]);
    expect(cache.getItem("activeWorkspaceId")).toBe("work");
    expect(cache.getItem("draft")).toBe("kept in localStorage");
  });

  it("keeps the settings when localStorage refuses writes", async () => {
    const file = settingsFile({ migrated: [...PERSISTENT] });
    const broken = memoryStorage();
    broken.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    const storage = createSettingsStorage({ cache: () => broken, file: file.open(), persistent: PERSISTENT });

    storage.setItem("theme", "light");
    await flush();

    expect(storage.getItem("theme")).toBe("light");
    expect(file.state.values.theme).toBe("light");
    // Other keys fail the way localStorage itself does.
    expect(() => storage.setItem("draft", "x")).toThrow("quota");
  });

  it("lists file-backed and cache-only keys together", () => {
    const file = settingsFile({ migrated: [...PERSISTENT], values: { "activeConversationId:claude:work": "chat-1" } });
    const cache = memoryStorage({ draft: "x" });
    const storage = createSettingsStorage({ cache: () => cache, file: file.open(), persistent: PERSISTENT });

    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    expect(keys.sort()).toEqual(["activeConversationId:claude:work", "draft"]);
  });

  it("is plain localStorage without the settings file", async () => {
    const cache = memoryStorage({ theme: "light" });
    const storage = createSettingsStorage({ cache: () => cache, persistent: PERSISTENT });

    storage.setItem("activeWorkspaceId", "work");
    expect(storage.getItem("theme")).toBe("light");
    expect(cache.getItem("activeWorkspaceId")).toBe("work");
    // No localStorage at all (a test or a locked-down page) reads as empty.
    const none = createSettingsStorage({ cache: () => undefined, persistent: PERSISTENT });
    expect(none.getItem("theme")).toBeNull();
    expect(() => none.setItem("theme", "dark")).not.toThrow();
  });

  it("survives a restart over a localStorage that drops every new write", async () => {
    const file = settingsFile();
    // Before the crash: localStorage still worked and holds the old setup.
    const frozen = { theme: "light", activeWorkspaceId: "personal" };
    const first = createSettingsStorage({ cache: () => memoryStorage(frozen), file: file.open(), persistent: PERSISTENT });
    first.setItem("theme", "dark");
    first.setItem("activeWorkspaceId", "work");
    await flush();

    // Chromium threw those writes away; the next start sees the old values.
    const second = createSettingsStorage({ cache: () => memoryStorage(frozen), file: file.open(), persistent: PERSISTENT });
    expect(second.getItem("theme")).toBe("dark");
    expect(second.getItem("activeWorkspaceId")).toBe("work");
  });
});

describe("localStorage write-loss probe", () => {
  it("counts a probe that went missing after it was confirmed as lost writes", () => {
    expect(readLocalStorageProbe(null, undefined)).toEqual({ lost: false, next: 1 });
    expect(readLocalStorageProbe("4", { confirmed: 4, lossReported: false })).toEqual({ lost: false, next: 5 });
    // The last session ended before its probe was confirmed: not a loss.
    expect(readLocalStorageProbe("5", { confirmed: 4, lossReported: false })).toEqual({ lost: false, next: 6 });
    expect(readLocalStorageProbe("3", { confirmed: 4, lossReported: false })).toEqual({ lost: true, next: 5 });
    expect(readLocalStorageProbe(null, { confirmed: 4, lossReported: false })).toEqual({ lost: true, next: 5 });
  });

  it("writes the next probe, confirms it later and reports a loss once", () => {
    const file = settingsFile({ migrated: [], values: {}, localStorageProbe: { confirmed: 7, lossReported: false } });
    const report = vi.fn();
    const scheduled: Array<{ run: () => void; delay: number }> = [];
    const schedule = (run: () => void, delay: number) => scheduled.push({ run, delay });

    const stale = memoryStorage({ [LOCAL_STORAGE_PROBE_KEY]: "6" });
    startLocalStorageProbe(stale, file.open(), report, schedule);
    expect(report).toHaveBeenCalledTimes(1);
    expect(stale.getItem(LOCAL_STORAGE_PROBE_KEY)).toBe("8");
    expect(scheduled.map((entry) => entry.delay)).toEqual([LOCAL_STORAGE_PROBE_CONFIRM_MS]);
    scheduled[0].run();
    expect(file.state.localStorageProbe).toEqual({ confirmed: 8, lossReported: true });

    // Still broken on the next start: not reported again.
    startLocalStorageProbe(memoryStorage({ [LOCAL_STORAGE_PROBE_KEY]: "6" }), file.open(), report, schedule);
    expect(report).toHaveBeenCalledTimes(1);

    // Working again: the next loss is a new one.
    startLocalStorageProbe(memoryStorage({ [LOCAL_STORAGE_PROBE_KEY]: "8" }), file.open(), report, schedule);
    expect(file.state.localStorageProbe?.lossReported).toBe(false);
  });
});
