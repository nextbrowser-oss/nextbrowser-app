const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_API_BASE_URL = "https://api.nextbrowser.com";

function configPath({
  env = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
} = {}) {
  const nextbrowserConfigDir = typeof env.NEXTBROWSER_CONFIG_DIR === "string"
    ? env.NEXTBROWSER_CONFIG_DIR.trim()
    : "";
  if (nextbrowserConfigDir) return path.join(nextbrowserConfigDir, "config.json");
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    return path.join(localAppData, "Clawbrowser", "config.json");
  }
  return path.join(homeDir, ".config", "clawbrowser", "config.json");
}

function normalizeAPIBaseURL(raw) {
  const parsed = new URL(String(raw || DEFAULT_API_BASE_URL).trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported NextBrowser API URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Unsupported NextBrowser API URL.");
  }
  if (parsed.hostname.toLowerCase() === "app.nextbrowser.com") {
    parsed.hostname = "api.nextbrowser.com";
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

async function loadBackendConfig({
  env = process.env,
  fsApi = fs,
  homeDir = os.homedir(),
  platform = process.platform,
} = {}) {
  let payload;
  try {
    payload = JSON.parse(await fsApi.readFile(configPath({ env, homeDir, platform }), "utf8"));
  } catch {
    throw new Error("NextBrowser account configuration is unavailable.");
  }

  const apiKey = typeof payload.api_key === "string" ? payload.api_key.trim() : "";
  if (!apiKey) {
    throw new Error("NextBrowser account is not connected.");
  }

  const configuredBaseURL = env.NEXTBROWSER_DEV_API_BASE_URL
    || env.NEXTBROWSER_API_BASE_URL
    || env.CLAWBROWSER_API_BASE_URL
    || payload.api_base_url
    || payload.backend_api_base_url
    || payload.base_url
    || DEFAULT_API_BASE_URL;
  return { apiKey, baseURL: normalizeAPIBaseURL(configuredBaseURL) };
}

module.exports = { configPath, loadBackendConfig, normalizeAPIBaseURL };
