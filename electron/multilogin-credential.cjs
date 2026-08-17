const fs = require("node:fs/promises");
const path = require("node:path");

const MULTILOGIN_AUTOMATION_TOKEN_URL = "https://api.multilogin.com/workspace/automation_token?expiration_period=no_exp";
const MULTILOGIN_REQUEST_TIMEOUT_MS = 20_000;
const MULTILOGIN_CREDENTIAL_VERSION = 1;

function normalizeBearerToken(value) {
  let token = String(value || "").trim();
  token = token.replace(/^Bearer\s+/i, "").trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim();
  }
  if (!token) throw new Error("Paste the bearer token from Multilogin.");
  if (token.length > 16_384 || /\s/.test(token)) throw new Error("The Multilogin bearer token has an invalid format.");
  return token;
}

function automationTokenFromResponse(body) {
  const candidates = [
    body?.data?.token,
    body?.data?.automation_token,
    body?.token,
    body?.automation_token,
  ];
  const token = candidates.find((value) => typeof value === "string" && value.trim());
  if (!token) throw new Error("Multilogin did not return an automation token.");
  return token.trim();
}

function exchangeError(status) {
  if (status === 401) return new Error("The bearer token expired. Copy a fresh token from Multilogin and try again.");
  if (status === 403) return new Error("This Multilogin account cannot create automation tokens.");
  if (status === 400) return new Error("Multilogin rejected the no-expiration token request.");
  return new Error(`Multilogin token request failed (${status}).`);
}

async function exchangeAutomationToken({
  bearerToken,
  fetchImpl = globalThis.fetch,
  endpoint = MULTILOGIN_AUTOMATION_TOKEN_URL,
  timeoutMs = MULTILOGIN_REQUEST_TIMEOUT_MS,
} = {}) {
  const token = normalizeBearerToken(bearerToken);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw exchangeError(response.status);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("Multilogin returned an invalid token response.");
    }
    return automationTokenFromResponse(body);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Multilogin token request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function secureStorageAvailable(safeStorage, platform = process.platform) {
  if (typeof safeStorage?.isAsyncEncryptionAvailable === "function") {
    try {
      return await safeStorage.isAsyncEncryptionAvailable();
    } catch {
      return false;
    }
  }
  if (!safeStorage?.isEncryptionAvailable?.()) return false;
  if (platform !== "linux") return true;
  try {
    return safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  } catch {
    return false;
  }
}

async function requireSecureStorage(safeStorage, platform) {
  if (!await secureStorageAvailable(safeStorage, platform)) {
    throw new Error("Secure credential storage is unavailable on this device.");
  }
}

function createMultiloginCredentialStore({
  safeStorage,
  filePath,
  platform = process.platform,
  fsImpl = fs,
} = {}) {
  if (!filePath) throw new Error("Multilogin credential path is required.");

  return {
    async available() {
      return secureStorageAvailable(safeStorage, platform);
    },

    async load() {
      let raw;
      try {
        raw = await fsImpl.readFile(filePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return "";
        throw error;
      }
      await requireSecureStorage(safeStorage, platform);
      const payload = JSON.parse(raw);
      if (payload?.version !== MULTILOGIN_CREDENTIAL_VERSION || typeof payload?.encryptedToken !== "string") {
        throw new Error("The saved Multilogin credential is invalid.");
      }
      const encrypted = Buffer.from(payload.encryptedToken, "base64");
      if (typeof safeStorage.decryptStringAsync === "function") {
        const decrypted = await safeStorage.decryptStringAsync(encrypted);
        if (decrypted?.isTemporarilyUnavailable) {
          throw new Error("Secure credential storage is temporarily unavailable. Unlock it and try again.");
        }
        const token = String(decrypted?.result || "").trim();
        if (!token) throw new Error("The saved Multilogin credential could not be unlocked. Reconnect Multilogin.");
        return token;
      }
      const token = safeStorage.decryptString(encrypted).trim();
      if (!token) throw new Error("The saved Multilogin credential could not be unlocked. Reconnect Multilogin.");
      return token;
    },

    async save(token) {
      await requireSecureStorage(safeStorage, platform);
      const normalized = String(token || "").trim();
      if (!normalized) throw new Error("Multilogin automation token is empty.");
      const encrypted = typeof safeStorage.encryptStringAsync === "function"
        ? await safeStorage.encryptStringAsync(normalized)
        : safeStorage.encryptString(normalized);
      const encryptedToken = encrypted.toString("base64");
      const payload = `${JSON.stringify({ version: MULTILOGIN_CREDENTIAL_VERSION, encryptedToken })}\n`;
      const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      await fsImpl.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await fsImpl.writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
      try {
        await fsImpl.rename(tempPath, filePath);
      } catch (error) {
        await fsImpl.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
      if (platform !== "win32") await fsImpl.chmod(filePath, 0o600);
    },

    async clear() {
      await fsImpl.rm(filePath, { force: true });
    },
  };
}

module.exports = {
  MULTILOGIN_AUTOMATION_TOKEN_URL,
  automationTokenFromResponse,
  createMultiloginCredentialStore,
  exchangeAutomationToken,
  normalizeBearerToken,
  secureStorageAvailable,
};
