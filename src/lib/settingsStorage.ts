import { reportRendererError } from "./errorReporting";

// Settings whose loss breaks the user's setup. Chromium keeps localStorage in
// a LevelDB journal that a hard kill or a power loss can leave corrupt
// ("Corruption: checksum mismatch"); from then on Chromium drops new writes
// on every start, and these settings silently revert after each restart. So
// they live in a file the main process owns (electron/app-settings.cjs), and
// localStorage only caches them. A trailing "*" names a family of keys.
export const PERSISTENT_SETTINGS: readonly string[] = [
  "nextbrowser.theme",
  "nextbrowser.uiScale",
  "nextbrowser.uiScaleFloatingHidden",
  "activeWorkspaceId",
  "activeConversationId:*",
  "lastAgent",
  "terminalChat",
  "sidebarWidth",
  "sidebarCollapsed",
  "chatListCollapsed",
  "nextbrowser.selectedProfile.*",
  "nextbrowser.multilogin.selection.*",
  "workspaceSetupDone:*",
  "onboardingVersion",
  "onboardingComplete",
  // Account bookkeeping: losing it revives deleted workspaces, re-imports
  // archived runs, or takes the account's own cache for a foreign one.
  "cachedAccountOwnerId",
  "deletedWorkspaceIds:v1",
  "syncedWorkspaceIds:v1",
  "localProfileNamesSeen:v1:*",
];

export interface LocalStorageProbe {
  /** The probe counter that had time to reach Chromium's disk. */
  confirmed: number;
  lossReported: boolean;
}

/** What the main process returns for the settings file. */
export interface SettingsSnapshot {
  /** Entries of PERSISTENT_SETTINGS already copied over from localStorage. */
  migrated: string[];
  values: Record<string, string>;
  localStorageProbe?: LocalStorageProbe;
}

/** A change to the settings file; a null value removes the key. */
export interface SettingsUpdate {
  values?: Record<string, string | null>;
  migrated?: string[];
  localStorageProbe?: Partial<LocalStorageProbe>;
}

export interface SettingsFile {
  snapshot: SettingsSnapshot;
  update(patch: SettingsUpdate): void;
}

export interface SettingsStorageOptions {
  /** localStorage, looked up on every use (tests replace it). */
  cache: () => Storage | undefined;
  /** The settings file; without it (a browser preview) only the cache is used. */
  file?: SettingsFile;
  persistent?: readonly string[];
}

function matchesSpec(spec: string, key: string): boolean {
  return spec.endsWith("*") ? key.startsWith(spec.slice(0, -1)) : key === spec;
}

function cacheEntries(storage: Storage | undefined): Map<string, string> {
  const entries = new Map<string, string>();
  if (!storage) return entries;
  try {
    const count = storage.length;
    if (typeof count !== "number" || typeof storage.key !== "function") return entries;
    for (let index = 0; index < count; index += 1) {
      const key = storage.key(index);
      const value = key === null ? null : storage.getItem(key);
      if (key !== null && value !== null) entries.set(key, value);
    }
  } catch { /* an unreadable cache holds nothing to migrate */ }
  return entries;
}

function quietly(write: () => void): void {
  try { write(); } catch { /* the file has it; the cache is a convenience */ }
}

/**
 * A drop-in for localStorage whose persistent keys are backed by the settings
 * file. Reads of those keys come from the file's values, writes go to both.
 * On creation, keys the file has not taken over yet are migrated from
 * localStorage, so nobody loses their current settings, and the cache is
 * brought in line with the file. Every other key stays in localStorage only,
 * and behaves exactly as it did.
 */
export function createSettingsStorage({ cache, file, persistent = PERSISTENT_SETTINGS }: SettingsStorageOptions): Storage {
  const isPersistent = (key: string) => persistent.some((spec) => matchesSpec(spec, key));
  const backed = (key: string) => !!file && isPersistent(key);
  const values = new Map<string, string>(Object.entries(file?.snapshot.values ?? {}));
  let pending: Record<string, string | null> | undefined;

  // Writes in one task (switching a project sets four keys) go out together.
  function save(key: string, value: string | null): void {
    if (!file) return;
    if (!pending) {
      pending = {};
      queueMicrotask(() => {
        const changed = pending;
        pending = undefined;
        if (changed) file.update({ values: changed });
      });
    }
    pending[key] = value;
  }

  if (file) {
    const storage = cache();
    const cached = [...cacheEntries(storage)].filter(([key]) => isPersistent(key));
    const migrated = new Set(file.snapshot.migrated);
    const fresh = persistent.filter((spec) => !migrated.has(spec));
    if (fresh.length) {
      const copied: Record<string, string> = {};
      for (const [key, value] of cached) {
        if (values.has(key) || !fresh.some((spec) => matchesSpec(spec, key))) continue;
        values.set(key, value);
        copied[key] = value;
      }
      file.update({ values: copied, migrated: fresh });
    }
    // The file is the truth: a corrupt localStorage can still hold values the
    // user changed or removed since.
    const inCache = new Map(cached);
    for (const key of inCache.keys()) if (!values.has(key)) quietly(() => storage?.removeItem(key));
    for (const [key, value] of values) {
      if (isPersistent(key) && inCache.get(key) !== value) quietly(() => storage?.setItem(key, value));
    }
  }

  const keys = (): string[] => {
    const own = [...cacheEntries(cache()).keys()].filter((key) => !backed(key));
    return file ? [...own, ...[...values.keys()].filter(isPersistent)] : own;
  };

  return {
    get length() { return keys().length; },
    key: (index: number) => keys()[index] ?? null,
    getItem(key: string): string | null {
      if (backed(key)) return values.get(key) ?? null;
      return cache()?.getItem(key) ?? null;
    },
    setItem(key: string, value: string): void {
      const text = String(value);
      if (!backed(key)) {
        cache()?.setItem(key, text);
        return;
      }
      quietly(() => cache()?.setItem(key, text));
      if (values.get(key) === text) return;
      values.set(key, text);
      save(key, text);
    },
    removeItem(key: string): void {
      if (!backed(key)) {
        cache()?.removeItem(key);
        return;
      }
      quietly(() => cache()?.removeItem(key));
      if (!values.has(key)) return;
      values.delete(key);
      save(key, null);
    },
    clear(): void {
      for (const key of keys()) this.removeItem(key);
    },
  };
}

// Chromium does not tell the app that its localStorage database is corrupt:
// the LevelDB error only reaches Chromium's own log. What the app can see is
// the effect. Every start writes the next value of a counter to localStorage;
// once Chromium has had time to commit it (it does so within seconds), the
// settings file records it as confirmed. A start that then finds an older
// counter in localStorage knows localStorage dropped writes.
export const LOCAL_STORAGE_PROBE_KEY = "nextbrowser.localStorageProbe";
export const LOCAL_STORAGE_PROBE_CONFIRM_MS = 30_000;

export function readLocalStorageProbe(
  observed: string | null,
  probe: LocalStorageProbe | undefined,
): { lost: boolean; next: number } {
  const seen = Number(observed);
  const counter = Number.isSafeInteger(seen) && seen > 0 ? seen : 0;
  const confirmed = probe?.confirmed ?? 0;
  return { lost: confirmed > 0 && counter < confirmed, next: Math.max(counter, confirmed) + 1 };
}

/** Reports a localStorage that loses writes once, not on every start. */
export function startLocalStorageProbe(
  storage: Storage | undefined,
  file: SettingsFile,
  reportLoss: () => void,
  schedule: (run: () => void, delayMs: number) => unknown = setTimeout,
): void {
  if (!storage) return;
  let observed: string | null;
  try {
    observed = storage.getItem(LOCAL_STORAGE_PROBE_KEY);
  } catch {
    return;
  }
  const probe = file.snapshot.localStorageProbe;
  const { lost, next } = readLocalStorageProbe(observed, probe);
  if (lost && !probe?.lossReported) {
    reportLoss();
    file.update({ localStorageProbe: { lossReported: true } });
  } else if (!lost && probe?.lossReported) {
    file.update({ localStorageProbe: { lossReported: false } });
  }
  try {
    storage.setItem(LOCAL_STORAGE_PROBE_KEY, String(next));
  } catch {
    return;
  }
  schedule(() => file.update({ localStorageProbe: { confirmed: next } }), LOCAL_STORAGE_PROBE_CONFIRM_MS);
}

function reportLocalStorageLoss(): void {
  const error = new Error("localStorage lost writes that had time to reach the disk; its Chromium database is likely corrupt. Settings are read from the settings file instead.");
  error.name = "LocalStorageWriteLoss";
  console.warn(`[settings] ${error.message}`);
  reportRendererError("exception", error, { storage: "local_storage" });
}

function isSnapshot(value: unknown): value is SettingsSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<SettingsSnapshot>;
  return Array.isArray(snapshot.migrated) && !!snapshot.values && typeof snapshot.values === "object";
}

function localStorageCache(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function settingsFileFromBridge(): SettingsFile | undefined {
  const desktop = typeof window === "undefined" ? undefined : window.nextbrowser;
  if (typeof desktop?.readSettings !== "function" || typeof desktop.updateSettings !== "function") return undefined;
  let snapshot: unknown;
  try {
    snapshot = desktop.readSettings();
  } catch {
    return undefined;
  }
  if (!isSnapshot(snapshot)) return undefined;
  return {
    snapshot,
    update: (patch) => {
      try {
        desktop.updateSettings?.(patch);
      } catch (error) {
        console.warn("[settings] could not save settings", error);
      }
    },
  };
}

const settingsFile = settingsFileFromBridge();

/** Use instead of localStorage for any key; see PERSISTENT_SETTINGS. */
export const settingsStorage: Storage = createSettingsStorage({ cache: localStorageCache, file: settingsFile });

if (settingsFile) startLocalStorageProbe(localStorageCache(), settingsFile, reportLocalStorageLoss);
