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
  return uploadAutomationArtifactBytes(workspaceId, path.basename(filePath), await fs.readFile(filePath), deps);
}

async function uploadAutomationArtifactBytes(workspaceId, name, bytes, deps) {
  const form = new FormData();
  form.set("workspace_id", workspaceId);
  form.set("file", new Blob([bytes]), name);
  const body = await projectRequest("/v1/automation/artifacts", { method: "POST", body: form, jsonBody: false }, deps);
  return normalizeArtifact(body);
}

function demoRun(id, task, title, evidence, createdAt) {
  return {
    id, task, evidence, conversationTitle: title,
    answer: { id, role: "assistant", status: "done", text: "Demo completed successfully.", createdAt, toolEvents: [] },
  };
}

async function seedAutomationExamples(workspaceId, deps) {
  if (!workspaceId) throw new Error("A workspace is required for Automation Studio examples.");
  const [workflows, recordings, artifacts] = await Promise.all([
    listAutomationWorkflows(workspaceId, deps), listAutomationRecordings(workspaceId, deps), listAutomationArtifacts(workspaceId, deps),
  ]);
  const now = Date.now();
  const examples = [
    { key: "collect-products", title: "Collect product cards", domain: "example.com", task: "Open the product catalog and collect the visible product names and prices.", capability: "scrape", actions: [{ tool: "navigate", arguments: { url: "https://example.com/products" } }, { tool: "extract", arguments: { container: "article", fields: ["title", "price"] } }] },
    { key: "search-knowledge", title: "Search a knowledge base", domain: "example.com", task: "Search the site for the requested topic and return the best matching results.", capability: "search", actions: [{ tool: "navigate", arguments: { url: "https://example.com/search" } }, { tool: "act", arguments: { action: "type", selector: "input[type=search]", text: "browser automation" } }, { tool: "act", arguments: { action: "press", key: "Enter" } }, { tool: "extract", arguments: { container: "main", fields: ["title", "url"] } }] },
  ];
  let seededWorkflows = 0;
  for (const example of examples) {
    if (workflows.some((item) => item.recipe?.demo_key === example.key || item.title === example.title)) continue;
    await putAutomationWorkflow(workspaceId, {
      id: randomUUID(), ...example,
      instructions: "Execute the structured recipe first. Inspect the page and adapt selectors if its layout changed.",
      parametersSchema: { type: "object", properties: { task: { type: "string" } } },
      outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" } } },
      recipe: { version: 1, capability: example.capability, actions: example.actions, demo_key: example.key }, createdAt: now, updatedAt: now,
    }, deps);
    seededWorkflows += 1;
  }
  const demos = [
    { key: "product-research", run: demoRun(randomUUID(), "Collect product names and prices from https://example.com/products", "Product research demo", 'Called clawbrowser.navigate({"url":"https://example.com/products"})\nCalled clawbrowser.extract({"container":"article","fields":["title","price"]})\nFound 3 products.', now - 120_000) },
    { key: "site-search", run: demoRun(randomUUID(), "Search https://example.com for browser automation", "Site search demo", 'Called clawbrowser.navigate({"url":"https://example.com/search"})\nCalled clawbrowser.act({"action":"type","selector":"input[type=search]","text":"browser automation"})\nCalled clawbrowser.extract({"container":"main"})\nReturned 5 matching results.', now - 60_000) },
  ];
  let seededRecordings = 0;
  for (const demo of demos) {
    if (recordings.some((item) => item.document?.demo_key === demo.key)) continue;
    await putAutomationRecording({ id: randomUUID(), workspace_id: workspaceId, status: "completed", document: { run: demo.run, demo: true, demo_key: demo.key }, base_revision: 0 }, deps);
    seededRecordings += 1;
  }
  let seededArtifacts = 0;
  if (!artifacts.some((item) => item.name === "product-research-demo.csv")) {
    await uploadAutomationArtifactBytes(workspaceId, "product-research-demo.csv", Buffer.from("product,price,status\nStarter plan,$19,available\nTeam plan,$49,available\nBusiness plan,$99,available\n"), deps);
    seededArtifacts += 1;
  }
  if (!artifacts.some((item) => item.name === "automation-run-demo.json")) {
    await uploadAutomationArtifactBytes(workspaceId, "automation-run-demo.json", Buffer.from(JSON.stringify({ success: true, workflow: "Search a knowledge base", results: [{ title: "Browser automation guide", url: "https://example.com/guide" }], generated_at: new Date(now).toISOString() }, null, 2)), deps);
    seededArtifacts += 1;
  }
  return { seeded: { workflows: seededWorkflows, recordings: seededRecordings, artifacts: seededArtifacts } };
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
  seedAutomationExamples, uploadAutomationArtifact, uploadAutomationArtifactBytes,
};
