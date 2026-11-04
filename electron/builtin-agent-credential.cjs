const fs = require("node:fs/promises");
const path = require("node:path");
const { secureStorageAvailable } = require("./multilogin-credential.cjs");
const { userError } = require("./user-error.cjs");

// The API keys of the built-in Nextbrowser agent's providers, one per
// provider, encrypted with Electron safeStorage in a file only the main
// process reads. The renderer only ever learns whether a key is saved.
const BUILTIN_AGENT_KEYS_VERSION = 1;
const KEY_MAX_LENGTH = 4096;
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,31}$/;

function normalizeApiKey(value) {
  let key = String(value || "").trim().replace(/^Bearer\s+/i, "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  if (!key) throw userError("Paste the API key.");
  if (key.length > KEY_MAX_LENGTH || /\s/.test(key)) throw userError("This API key has an invalid format. Copy it again from the provider.");
  return key;
}

function providerId(value) {
  const id = String(value || "");
  if (!PROVIDER_ID.test(id)) throw userError("Unknown provider.");
  return id;
}

function createBuiltinAgentKeyStore({ safeStorage, filePath, platform = process.platform, fsImpl = fs } = {}) {
  if (!filePath) throw new Error("The built-in agent key path is required.");

  async function readPayload() {
    let raw;
    try {
      raw = await fsImpl.readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return { version: BUILTIN_AGENT_KEYS_VERSION, keys: {} };
      throw error;
    }
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = undefined; }
    if (payload?.version !== BUILTIN_AGENT_KEYS_VERSION || !payload.keys || typeof payload.keys !== "object") {
      // An unreadable file holds nothing usable; the next save replaces it.
      return { version: BUILTIN_AGENT_KEYS_VERSION, keys: {} };
    }
    return payload;
  }

  async function writePayload(payload) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fsImpl.writeFile(tempPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await fsImpl.rename(tempPath, filePath);
    } catch (error) {
      await fsImpl.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (platform !== "win32") await fsImpl.chmod(filePath, 0o600);
  }

  async function requireSecureStorage() {
    if (!await secureStorageAvailable(safeStorage, platform)) {
      throw userError("Secure key storage is unavailable on this computer, so Nextbrowser cannot save the key.");
    }
  }

  return {
    available: () => secureStorageAvailable(safeStorage, platform),

    /** Which providers have a saved key; nothing is decrypted. */
    async saved() {
      const payload = await readPayload();
      return Object.fromEntries(Object.entries(payload.keys)
        .filter(([id, value]) => PROVIDER_ID.test(id) && typeof value === "string" && value)
        .map(([id]) => [id, true]));
    },

    /** The provider's key, or "" when none is saved. */
    async load(provider) {
      const id = providerId(provider);
      const payload = await readPayload();
      const encrypted = payload.keys[id];
      if (typeof encrypted !== "string" || !encrypted) return "";
      await requireSecureStorage();
      const buffer = Buffer.from(encrypted, "base64");
      if (typeof safeStorage.decryptStringAsync === "function") {
        const decrypted = await safeStorage.decryptStringAsync(buffer);
        if (decrypted?.isTemporarilyUnavailable) throw userError("Secure key storage is locked. Unlock it and try again.");
        return String(decrypted?.result || "").trim();
      }
      return String(safeStorage.decryptString(buffer) || "").trim();
    },

    async save(provider, key) {
      const id = providerId(provider);
      const normalized = normalizeApiKey(key);
      await requireSecureStorage();
      const encrypted = typeof safeStorage.encryptStringAsync === "function"
        ? await safeStorage.encryptStringAsync(normalized)
        : safeStorage.encryptString(normalized);
      const payload = await readPayload();
      payload.keys = { ...payload.keys, [id]: Buffer.from(encrypted).toString("base64") };
      await writePayload(payload);
    },

    async clear(provider) {
      const id = providerId(provider);
      const payload = await readPayload();
      if (!(id in payload.keys)) return;
      const { [id]: _removed, ...rest } = payload.keys;
      payload.keys = rest;
      if (Object.keys(rest).length) await writePayload(payload);
      else await fsImpl.rm(filePath, { force: true });
    },
  };
}

module.exports = {
  createBuiltinAgentKeyStore,
  normalizeApiKey,
};
