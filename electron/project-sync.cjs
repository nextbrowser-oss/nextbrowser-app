const { loadBackendConfig } = require("./proxy-traffic.cjs");

const REQUEST_TIMEOUT_MS = 30_000;

async function projectRequest(route, options = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const { apiKey, baseURL } = await loadBackendConfig(deps);
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

module.exports = { deleteProject, listProjects, projectRequest, putProject };
