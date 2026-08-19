const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { secureStorageAvailable } = require("./multilogin-credential.cjs");

const MANUAL_PROXY_STORE_VERSION = 1;

function boundedString(value, label, maxLength, { required = false } = {}) {
  const normalized = String(value || "").trim();
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function boundedSecret(value, label, maxLength) {
  const normalized = String(value || "");
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function normalizeProxy(value, { requireID = false } = {}) {
  const scheme = String(value?.scheme || "").trim().toLowerCase();
  if (scheme !== "http" && scheme !== "socks5") throw new Error("Proxy scheme must be HTTP or SOCKS5.");
  const port = Number(value?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Proxy port must be between 1 and 65535.");
  const host = boundedString(value?.host, "Proxy host", 512, { required: true });
  if (/\s/.test(host)) throw new Error("Proxy host cannot contain spaces.");
  const id = boundedString(value?.id, "Proxy ID", 128, { required: requireID });
  return {
    id: id || randomUUID(),
    name: boundedString(value?.name, "Proxy name", 120, { required: true }),
    scheme,
    host,
    port,
    username: boundedString(value?.username, "Proxy username", 512),
    password: boundedSecret(value?.password, "Proxy password", 16_384),
  };
}

function publicProxy(proxy) {
  return {
    id: proxy.id,
    name: proxy.name,
    scheme: proxy.scheme,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username || undefined,
    hasPassword: Boolean(proxy.password),
  };
}

function createManualProxyStore({
  safeStorage,
  filePath,
  platform = process.platform,
  fsImpl = fs,
} = {}) {
  if (!filePath) throw new Error("Manual proxy store path is required.");

  async function decryptPayload(encrypted) {
    if (typeof safeStorage?.decryptStringAsync === "function") {
      const result = await safeStorage.decryptStringAsync(encrypted);
      if (result?.isTemporarilyUnavailable) {
        throw new Error("Secure credential storage is temporarily unavailable. Unlock it and try again.");
      }
      return String(result?.result || "");
    }
    return safeStorage.decryptString(encrypted);
  }

  async function encryptPayload(content) {
    return typeof safeStorage?.encryptStringAsync === "function"
      ? await safeStorage.encryptStringAsync(content)
      : safeStorage.encryptString(content);
  }

  async function loadAll() {
    let raw;
    try {
      raw = await fsImpl.readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    if (!await secureStorageAvailable(safeStorage, platform)) {
      throw new Error("Secure credential storage is unavailable on this device.");
    }
    let wrapper;
    try {
      wrapper = JSON.parse(raw);
    } catch {
      throw new Error("The saved proxy store is invalid.");
    }
    if (wrapper?.version !== MANUAL_PROXY_STORE_VERSION || typeof wrapper?.encryptedProxies !== "string") {
      throw new Error("The saved proxy store is invalid.");
    }
    let payload;
    try {
      payload = JSON.parse(await decryptPayload(Buffer.from(wrapper.encryptedProxies, "base64")));
    } catch (error) {
      if (/temporarily unavailable/i.test(String(error?.message || error))) throw error;
      throw new Error("The saved proxies could not be unlocked.");
    }
    if (!Array.isArray(payload?.proxies)) throw new Error("The saved proxy store is invalid.");
    const seen = new Set();
    return payload.proxies.map((proxy) => normalizeProxy(proxy, { requireID: true })).filter((proxy) => {
      if (seen.has(proxy.id)) return false;
      seen.add(proxy.id);
      return true;
    });
  }

  async function saveAll(proxies) {
    if (!await secureStorageAvailable(safeStorage, platform)) {
      throw new Error("Secure credential storage is unavailable on this device.");
    }
    const encrypted = await encryptPayload(JSON.stringify({ proxies }));
    const content = `${JSON.stringify({
      version: MANUAL_PROXY_STORE_VERSION,
      encryptedProxies: encrypted.toString("base64"),
    })}\n`;
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fsImpl.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
    try {
      await fsImpl.rename(tempPath, filePath);
    } catch (error) {
      await fsImpl.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (platform !== "win32") await fsImpl.chmod(filePath, 0o600);
  }

  return {
    async list() {
      return (await loadAll()).map(publicProxy);
    },

    async save(value) {
      const proxies = await loadAll();
      const incoming = normalizeProxy(value);
      const duplicate = proxies.find((proxy) => proxy.name.toLowerCase() === incoming.name.toLowerCase());
      if (duplicate) throw new Error(`A proxy named “${incoming.name}” already exists.`);
      proxies.push(incoming);
      await saveAll(proxies);
      return publicProxy(incoming);
    },

    async remove(id) {
      const normalizedID = boundedString(id, "Proxy ID", 128, { required: true });
      const proxies = await loadAll();
      const next = proxies.filter((proxy) => proxy.id !== normalizedID);
      if (next.length === proxies.length) return false;
      await saveAll(next);
      return true;
    },

    async resolve(id) {
      const normalizedID = boundedString(id, "Proxy ID", 128, { required: true });
      const proxy = (await loadAll()).find((item) => item.id === normalizedID);
      if (!proxy) throw new Error("The selected personal proxy no longer exists.");
      return proxy;
    },
  };
}

module.exports = {
  MANUAL_PROXY_STORE_VERSION,
  createManualProxyStore,
  normalizeProxy,
  publicProxy,
};
