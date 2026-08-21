const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { projectRequest } = require("./project-sync.cjs");

const query = (workspaceId) => `?workspace_id=${encodeURIComponent(workspaceId)}`;

function normalizeWorkflow(item) {
  const recipe = item.recipe || { version: 1, capability: item.capability || "other", actions: [] };
  return {
    id: item.id, title: item.title, domain: item.domain, task: item.task,
    instructions: item.instructions, capability: item.capability || "other",
    parametersSchema: item.parameters_schema || {}, outputSchema: item.output_schema || {},
    recipe, actions: Array.isArray(recipe.actions) ? recipe.actions : [], revision: item.revision,
    createdAt: Date.parse(item.created_at), updatedAt: Date.parse(item.updated_at),
  };
}

async function listAutomationWorkflows(workspaceId, deps) {
  const body = await projectRequest(`/v1/automation/workflows${query(workspaceId)}`, {}, deps);
  return (body?.workflows || []).map(normalizeWorkflow);
}

async function putAutomationWorkflow(workspaceId, workflow, deps) {
  const body = await projectRequest(`/v1/automation/workflows/${encodeURIComponent(workflow.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      workspace_id: workspaceId, title: workflow.title, domain: workflow.domain, task: workflow.task,
      instructions: workflow.instructions, capability: workflow.capability,
      parameters_schema: workflow.parametersSchema || {}, output_schema: workflow.outputSchema || {},
      recipe: { ...workflow.recipe, actions: workflow.actions }, base_revision: workflow.revision || 0,
    }),
  }, deps);
  return normalizeWorkflow(body);
}

const deleteAutomationWorkflow = (id, deps) => projectRequest(`/v1/automation/workflows/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);

async function listAutomationRecordings(workspaceId, deps) {
  const body = await projectRequest(`/v1/automation/recordings${query(workspaceId)}`, {}, deps);
  return body?.recordings || [];
}

const putAutomationRecording = (recording, deps) => projectRequest(`/v1/automation/recordings/${encodeURIComponent(recording.id)}`, {
  method: "PUT", body: JSON.stringify(recording),
}, deps);

async function listAutomationRuns(workspaceId, deps) {
  const body = await projectRequest(`/v1/automation/runs${query(workspaceId)}`, {}, deps);
  return body?.runs || [];
}

const createAutomationRun = (run, deps) => projectRequest("/v1/automation/runs", { method: "POST", body: JSON.stringify(run) }, deps);
const updateAutomationRun = (id, update, deps) => projectRequest(`/v1/automation/runs/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(update) }, deps);

function normalizeArtifact(item) {
  return {
    id: item.id, name: item.name, size: item.size, contentType: item.content_type,
    sha256: item.sha256, runId: item.run_id, createdAt: Date.parse(item.created_at),
    extension: path.extname(item.name).replace(/^\./, "").toLowerCase(),
  };
}

async function listAutomationArtifacts(workspaceId, deps) {
  const body = await projectRequest(`/v1/automation/artifacts${query(workspaceId)}`, {}, deps);
  return (body?.artifacts || []).map(normalizeArtifact);
}

async function uploadAutomationArtifact(workspaceId, filePath, deps) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`${path.basename(filePath)} is not a regular file.`);
  if (stat.size > 30 * 1024 * 1024) throw new Error(`${path.basename(filePath)} is larger than 30 MiB.`);
  const form = new FormData();
  form.set("workspace_id", workspaceId);
  form.set("file", new Blob([await fs.readFile(filePath)]), path.basename(filePath));
  const body = await projectRequest("/v1/automation/artifacts", { method: "POST", body: form, jsonBody: false }, deps);
  return normalizeArtifact(body);
}

async function downloadAutomationArtifact(id, targetPath, deps) {
  const body = await projectRequest(`/v1/automation/artifacts/${encodeURIComponent(id)}/content`, { responseType: "buffer" }, deps);
  await fs.writeFile(targetPath, body, { mode: 0o600 });
}

const deleteAutomationArtifact = (id, deps) => projectRequest(`/v1/automation/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);

module.exports = {
  createAutomationRun, deleteAutomationArtifact, deleteAutomationWorkflow, downloadAutomationArtifact,
  listAutomationArtifacts, listAutomationRecordings, listAutomationRuns, listAutomationWorkflows,
  normalizeArtifact, normalizeWorkflow, putAutomationRecording, putAutomationWorkflow, updateAutomationRun,
  uploadAutomationArtifact,
};
