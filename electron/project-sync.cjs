const { loadBackendConfig } = require("./proxy-traffic.cjs");

const REQUEST_TIMEOUT_MS = 30_000;
// Workspaces and projects live in the same service as the cloud skill registry.
// Keep the same override and default used by nextctl's skill commands.
const DEFAULT_SKILL_SERVICE_URL = "https://core.nextbrowser.com";

function entityBackendURL(env = process.env) {
  // Entity sync and browser runtime traffic intentionally use different
  // production services. childEnv() always injects CLAWBROWSER_API_BASE_URL for
  // browser sessions, so accepting that variable here silently sends workspace
  // and Automation requests to api.nextbrowser.com instead of core.nextbrowser.com.
  const raw = String(
    env.CLAWCTL_SKILL_SERVICE
      || env.NEXTBROWSER_DEV_API_BASE_URL
      || env.NEXTBROWSER_ENTITY_API_BASE_URL
      || DEFAULT_SKILL_SERVICE_URL,
  ).trim();
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Unsupported skill service URL.");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

async function projectRequest(route, options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const { apiKey } = await loadBackendConfig(deps);
  const baseURL = entityBackendURL(deps.env);
  const { responseType = "json", jsonBody = true, timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  let response;
  try {
    response = await fetchImpl(`${baseURL}${route}`, {
      ...fetchOptions,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(fetchOptions.body && jsonBody ? { "content-type": "application/json" } : {}),
        ...(fetchOptions.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const error = new Error(`Cannot reach the NextBrowser backend at ${baseURL}. Check that the backend is running and try again.`);
    error.code = "NEXTBROWSER_BACKEND_UNAVAILABLE";
    error.cause = cause;
    throw error;
  }
  if (response.ok && responseType === "stream") return response.body;
  if (response.ok && responseType === "buffer") return Buffer.from(await response.arrayBuffer());
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!response.ok) {
    const reason = response.status === 401
      ? "Project sync failed (401). The account token is not valid for this backend."
      : body?.error || `Project sync failed (${response.status}).`;
    const error = new Error(reason);
    error.status = response.status;
    throw error;
  }
  return body;
}

function listProjects(deps) { return projectRequest("/v1/projects", {}, deps); }
function putProject(id, project, deps) {
  return projectRequest(`/v1/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(project),
  }, deps);
}
function deleteProject(id, deps) {
  return projectRequest(`/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);
}

function listWorkspaces(deps) { return projectRequest("/v1/workspaces", {}, deps); }
function putWorkspace(id, workspace, deps) {
  return projectRequest(`/v1/workspaces/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(workspace),
  }, deps);
}
function deleteWorkspace(id, deps) {
  return projectRequest(`/v1/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);
}

function normalizePersonalProxy(proxy) {
  return {
    id: String(proxy?.id || ""),
    name: String(proxy?.name || ""),
    scheme: String(proxy?.scheme || ""),
    host: String(proxy?.host || ""),
    port: Number(proxy?.port || 0),
    ...(proxy?.username ? { username: String(proxy.username) } : {}),
    hasPassword: proxy?.has_password === true,
  };
}

async function listPersonalProxies(deps) {
  const response = await projectRequest("/v1/personal-proxies", {}, deps);
  return Array.isArray(response?.proxies) ? response.proxies.map(normalizePersonalProxy) : [];
}

async function createPersonalProxy(proxy, deps) {
  const response = await projectRequest("/v1/personal-proxies", {
    method: "POST",
    body: JSON.stringify(proxy),
  }, deps);
  return normalizePersonalProxy(response);
}

function deletePersonalProxy(id, deps) {
  return projectRequest(`/v1/personal-proxies/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);
}

function resolvePersonalProxy(id, deps) {
  return projectRequest(`/v1/personal-proxies/${encodeURIComponent(id)}/credentials`, {}, deps);
}

module.exports = {
  createPersonalProxy,
  deletePersonalProxy,
  deleteProject,
  deleteWorkspace,
  entityBackendURL,
  listPersonalProxies,
  listProjects,
  listWorkspaces,
  projectRequest,
  putProject,
  putWorkspace,
  resolvePersonalProxy,
};
