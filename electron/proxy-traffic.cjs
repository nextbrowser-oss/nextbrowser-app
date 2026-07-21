const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_API_BASE_URL = "https://api.clawbrowser.ai";
const PROXY_TRAFFIC_TOP_UP_PATH = "/v1/proxy/traffic/top-up";
const PROXY_TRAFFIC_REQUEST_TIMEOUT_MS = 30_000;

function configPath({
  env = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
} = {}) {
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
  if (parsed.hostname.toLowerCase() === "app.clawbrowser.ai") {
    parsed.hostname = "api.clawbrowser.ai";
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

  const configuredBaseURL = env.CLAWBROWSER_API_BASE_URL
    || payload.api_base_url
    || payload.backend_api_base_url
    || payload.base_url
    || DEFAULT_API_BASE_URL;
  return { apiKey, baseURL: normalizeAPIBaseURL(configuredBaseURL) };
}

async function topUpProxyTraffic(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const { apiKey, baseURL } = await loadBackendConfig(options);
  let response;
  try {
    response = await fetchImpl(`${baseURL}${PROXY_TRAFFIC_TOP_UP_PATH}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(PROXY_TRAFFIC_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("NextBrowser proxy traffic service is unavailable.");
  }

  if (!response.ok) {
    throw new Error(`NextBrowser proxy traffic request failed (${response.status}).`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("NextBrowser proxy traffic response is invalid.");
  }
  if (!payload || typeof payload !== "object" || typeof payload.used_bytes !== "number" || typeof payload.state !== "string") {
    throw new Error("NextBrowser proxy traffic response is incomplete.");
  }
  return payload;
}

module.exports = { configPath, loadBackendConfig, normalizeAPIBaseURL, topUpProxyTraffic };
