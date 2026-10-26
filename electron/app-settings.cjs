const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// The settings the user's setup depends on: the active workspace, theme,
// zoom, chat mode and the like. The renderer used to keep them only in
// localStorage, which Chromium stores in a LevelDB journal. A hard kill or a
// power loss can leave that journal corrupt ("Corruption: checksum mismatch"),
// and from then on Chromium drops new writes on every start: the settings
// silently revert after each restart. This file, owned by the main process
// and replaced atomically, is now their source of truth; the renderer keeps
// localStorage only as a cache of it (src/lib/settingsStorage.ts).
const APP_SETTINGS_FILE = "app-settings.json";
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 1024 * 1024;

/**
 * Replaces `target` with `content` without a moment in which a reader, or a
 * crash, could leave a half-written file: the content goes to a temporary
 * file next to it, which is then renamed over the target. `durable` also
 * flushes the content to disk before the rename, so a power loss leaves the
 * old file or the new one, never an empty one.
 */
async function writeFileAtomic(target, content, { durable = false } = {}) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  if (durable) {
    const handle = await fsp.open(temp, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } else {
    await fsp.writeFile(temp, content, "utf8");
  }
  try {
    await fsp.rename(temp, target);
  } catch (error) {
    if (process.platform !== "win32") {
      await fsp.rm(temp, { force: true });
      throw error;
    }
    await fsp.rm(target, { force: true });
    await fsp.rename(temp, target);
  }
}

function validKey(key) {
  return typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH && key !== "__proto__";
}

function emptyState() {
  return { version: 1, migrated: [], values: {}, localStorageProbe: { confirmed: 0, lossReported: false } };
}

function applyProbe(state, probe) {
  if (!probe || typeof probe !== "object") return;
  if (Number.isSafeInteger(probe.confirmed) && probe.confirmed >= 0) state.localStorageProbe.confirmed = probe.confirmed;
  if (typeof probe.lossReported === "boolean") state.localStorageProbe.lossReported = probe.lossReported;
}

function applyUpdate(state, patch) {
  if (!patch || typeof patch !== "object") return;
  if (patch.values && typeof patch.values === "object") {
    for (const [key, value] of Object.entries(patch.values)) {
      if (!validKey(key)) continue;
      if (value === null) delete state.values[key];
      else if (typeof value === "string" && value.length <= MAX_VALUE_LENGTH) state.values[key] = value;
    }
  }
  if (Array.isArray(patch.migrated)) {
    for (const spec of patch.migrated) if (validKey(spec) && !state.migrated.includes(spec)) state.migrated.push(spec);
  }
  applyProbe(state, patch.localStorageProbe);
}

function parseState(raw) {
  const state = emptyState();
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return state;
  applyUpdate(state, {
    values: parsed.values,
    migrated: parsed.migrated,
    localStorageProbe: parsed.localStorageProbe,
  });
  return state;
}

/**
 * The settings file. Reads are synchronous because the renderer needs the
 * values before its first render (see the preload's readSettings). Updates
 * are merged key by key, so two windows (Ctrl+R opens the new one before it
 * closes the old one) never overwrite each other's settings, and written one
 * at a time: updates that arrive during a write go out together in the next.
 */
function createAppSettings({ file, onError = () => {} }) {
  let state;
  let lastWrite = Promise.resolve();
  let queuedWrite;

  function load() {
    if (state) return state;
    try {
      state = parseState(fs.readFileSync(file, "utf8"));
    } catch (error) {
      // An unreadable file loses nothing that localStorage cannot restore:
      // the renderer migrates its cached values into the fresh state.
      if (error?.code !== "ENOENT") onError(error);
      state = emptyState();
    }
    return state;
  }

  function snapshot() {
    const current = load();
    return {
      migrated: [...current.migrated],
      values: { ...current.values },
      localStorageProbe: { ...current.localStorageProbe },
    };
  }

  function persist() {
    if (queuedWrite) return queuedWrite;
    const write = lastWrite.then(() => {
      queuedWrite = undefined;
      return writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`, { durable: true });
    });
    queuedWrite = write;
    lastWrite = write.catch(() => undefined);
    return write;
  }

  function update(patch) {
    applyUpdate(load(), patch);
    return persist();
  }

  return { snapshot, update, flush: () => lastWrite };
}

module.exports = { APP_SETTINGS_FILE, createAppSettings, writeFileAtomic };
