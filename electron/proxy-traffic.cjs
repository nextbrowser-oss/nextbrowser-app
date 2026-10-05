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
    throw new Error("Unsupported Nextbrowser API URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Unsupported Nextbrowser API URL.");
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
    throw new Error("Nextbrowser account configuration is unavailable.");
  }

  const apiKey = typeof payload.api_key === "string" ? payload.api_key.trim() : "";
  if (!apiKey) {
    throw new Error("Nextbrowser account is not connected.");
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

async function sendNodeMavenInvite(deps = {}) {
  const { apiKey, baseURL } = await loadBackendConfig(deps);
  const fetchImpl = deps.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(`${baseURL}/v1/proxy/traffic/invite`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Could not reach Nextbrowser to send the NodeMaven email. Try again.");
  }
  if (!response.ok) {
    const errorBody = typeof response.json === "function" ? await response.json().catch(() => null) : null;
    if (response.status === 429) throw new Error("An invitation was sent recently. Check your email or try again in 10 minutes.");
    if (response.status === 503 && errorBody?.code === "invite_disabled") {
      throw new Error("NodeMaven invitations are not enabled yet. Use Set up account access to set your password.");
    }
    if (response.status === 404 && errorBody?.code === "invite_unavailable") {
      throw new Error("Your NodeMaven account could not be found. Contact support before purchasing traffic.");
    }
    if (response.status === 401) throw new Error("Sign in to Nextbrowser, then try sending the NodeMaven email again.");
    throw new Error("Could not send the NodeMaven email. Try again or contact support.");
  }
  const result = await response.json().catch(() => null);
  if (result?.invite_sent !== true || typeof result.email !== "string" || !Number.isInteger(result.expires_in_days) || result.expires_in_days < 1) {
    throw new Error("NodeMaven did not confirm the invitation. Try again or contact support.");
  }
  return { email: result.email, expiresInDays: result.expires_in_days };
}

module.exports = { configPath, loadBackendConfig, normalizeAPIBaseURL, sendNodeMavenInvite };
