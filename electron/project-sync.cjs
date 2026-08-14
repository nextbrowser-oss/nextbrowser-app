const { loadBackendConfig } = require("./proxy-traffic.cjs");

const REQUEST_TIMEOUT_MS = 30_000;
// Workspaces and projects live in the same service as the cloud skill registry.
// Keep the same override and default used by nextctl's skill commands.
const DEFAULT_SKILL_SERVICE_URL = "https://core.nextbrowser.com";

function entityBackendURL(env = process.env) {
  const raw = String(env.CLAWCTL_SKILL_SERVICE || DEFAULT_SKILL_SERVICE_URL).trim();
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
  const response = await fetchImpl(`${baseURL}${route}`, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!response.ok) {
    const error = new Error(body?.error || `Project sync failed (${response.status}).`);
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

module.exports = { deleteProject, deleteWorkspace, entityBackendURL, listProjects, listWorkspaces, projectRequest, putProject, putWorkspace };
