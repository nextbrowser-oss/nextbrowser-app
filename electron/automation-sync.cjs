const fs = require("node:fs/promises");
const { createReadStream, createWriteStream } = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
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
const deleteAutomationRecording = (id, deps) => projectRequest(`/v1/automation/recordings/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);

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
    expiresAt: item.expires_at ? Date.parse(item.expires_at) : undefined,
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
  if (stat.size > 1024 * 1024 * 1024) throw new Error(`${path.basename(filePath)} is larger than 1 GiB.`);
  const boundary = `----NextBrowser${randomBytes(16).toString("hex")}`;
  const name = path.basename(filePath);
  const safeName = name.replace(/["\r\n]/g, "-");
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="workspace_id"\r\n\r\n${workspaceId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Readable.from((async function* () { yield head; for await (const chunk of createReadStream(filePath)) yield chunk; yield tail; })());
  const response = await projectRequest("/v1/automation/artifacts", {
    method: "POST", body, duplex: "half", jsonBody: false, timeoutMs: 30 * 60_000,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(head.length + stat.size + tail.length) },
  }, deps);
  return normalizeArtifact(response);
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

const seedAutomationPromises = new Map();

function seedAutomationExamples(workspaceId, deps) {
  if (!workspaceId) throw new Error("A workspace is required for Automation Studio examples.");
  const current = seedAutomationPromises.get(workspaceId);
  if (current) return current;
  const promise = seedAutomationExamplesOnce(workspaceId, deps).finally(() => seedAutomationPromises.delete(workspaceId));
  seedAutomationPromises.set(workspaceId, promise);
  return promise;
}

async function seedAutomationExamplesOnce(workspaceId, deps) {
  const [workflows, recordings, artifacts] = await Promise.all([
    listAutomationWorkflows(workspaceId, deps), listAutomationRecordings(workspaceId, deps), listAutomationArtifacts(workspaceId, deps),
  ]);
  const now = Date.now();
  const demoVersion = 2;
  const examples = [
    { key: "collect-products", title: "Collect and compare product cards", domain: "example.com", task: "Open the product catalog, select laptops, sort by price, collect product details across multiple pages, and return a comparison table.", capability: "scrape", actions: [{ tool: "navigate", arguments: { url: "https://example.com/products" } }, { tool: "act", arguments: { action: "click", selector: "[data-category=laptops]" } }, { tool: "act", arguments: { action: "click", selector: "[data-sort=price-asc]" } }, { tool: "extract", arguments: { container: "article.product", fields: ["title", "price", "rating", "availability", "url"] } }, { tool: "act", arguments: { action: "click", selector: "a[rel=next]" } }, { tool: "paginate_extract", arguments: { container: "article.product", fields: ["title", "price", "rating", "availability", "url"], max_pages: 3, dedupe_by: "url" } }] },
    { key: "search-knowledge", title: "Research a knowledge base", domain: "example.com", task: "Search the knowledge base for browser automation, filter to guides, inspect the most relevant results, and return a deduplicated reading list.", capability: "search", actions: [{ tool: "navigate", arguments: { url: "https://example.com/search" } }, { tool: "act", arguments: { action: "type", selector: "input[type=search]", text: "browser automation" } }, { tool: "act", arguments: { action: "press", key: "Enter" } }, { tool: "act", arguments: { action: "click", selector: "[data-filter=guides]" } }, { tool: "extract", arguments: { container: "main article", fields: ["title", "summary", "author", "updated", "url"] } }, { tool: "paginate_extract", arguments: { container: "main article", fields: ["title", "summary", "author", "updated", "url"], max_pages: 3, dedupe_by: "url" } }] },
  ];
  let seededWorkflows = 0;
  for (const example of examples) {
    const existing = workflows.find((item) => item.recipe?.demo_key === example.key || item.title === example.title);
    if (existing && Number(existing.recipe?.demo_version || 0) >= demoVersion) continue;
    await putAutomationWorkflow(workspaceId, {
      id: existing?.id || randomUUID(), ...example,
      instructions: "Execute the structured recipe first. Inspect the page and adapt selectors if its layout changed.",
      parametersSchema: { type: "object", properties: { task: { type: "string" } } },
      outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" } } },
      recipe: { version: 1, capability: example.capability, actions: example.actions, demo_key: example.key, demo_version: demoVersion }, revision: existing?.revision || 0, createdAt: now, updatedAt: now,
    }, deps);
    seededWorkflows += 1;
  }
  const demos = [
    { key: "product-research", run: demoRun(randomUUID(), "Compare available laptops across the first three pages of https://example.com/products and return a price-sorted shortlist with ratings and links", "Product comparison demo", 'Called clawbrowser.navigate({"url":"https://example.com/products"})\nOpened the product catalog successfully.\nCalled clawbrowser.act({"action":"click","selector":"[data-category=laptops]"})\n{"ok":true,"selected":"Laptops"}\nCalled clawbrowser.act({"action":"click","selector":"[data-sort=price-asc]"})\n{"ok":true,"sort":"Price: low to high"}\nCalled clawbrowser.extract({"container":"article.product","fields":["title","price","rating","availability","url"]})\n{"count":12,"page":1}\nCalled clawbrowser.act({"action":"click","selector":"a[rel=next]"})\n{"ok":true,"page":2}\nCalled clawbrowser.extract({"container":"article.product","fields":["title","price","rating","availability","url"]})\n{"count":12,"page":2}\nCalled clawbrowser.paginate_extract({"container":"article.product","fields":["title","price","rating","availability","url"],"max_pages":3,"dedupe_by":"url"})\n{"count":31,"deduplicated":true}\nCompared 31 products and returned the 8 best available laptops.', now - 120_000) },
    { key: "site-search", run: demoRun(randomUUID(), "Research browser automation guides on https://example.com, filter to recently updated guides, inspect multiple result pages, and return a deduplicated reading list", "Knowledge-base research demo", 'Called clawbrowser.navigate({"url":"https://example.com/search"})\nOpened the knowledge-base search.\nCalled clawbrowser.act({"action":"type","selector":"input[type=search]","text":"browser automation"})\n{"ok":true}\nCalled clawbrowser.act({"action":"press","key":"Enter"})\n{"ok":true,"navigation":true}\nCalled clawbrowser.act({"action":"click","selector":"[data-filter=guides]"})\n{"ok":true,"filter":"Guides"}\nCalled clawbrowser.extract({"container":"main article","fields":["title","summary","author","updated","url"]})\n{"count":10,"page":1}\nCalled clawbrowser.act({"action":"click","selector":"a[rel=next]"})\n{"ok":true,"page":2}\nCalled clawbrowser.extract({"container":"main article","fields":["title","summary","author","updated","url"]})\n{"count":10,"page":2}\nCalled clawbrowser.paginate_extract({"container":"main article","fields":["title","summary","author","updated","url"],"max_pages":3,"dedupe_by":"url"})\n{"count":24,"deduplicated":true}\nReturned 24 unique guides, ranked by relevance and update date.', now - 60_000) },
  ];
  let seededRecordings = 0;
  for (const demo of demos) {
    const existing = recordings.find((item) => item.document?.demo_key === demo.key);
    if (existing && Number(existing.document?.demo_version || 0) >= demoVersion) continue;
    await putAutomationRecording({ id: existing?.id || randomUUID(), workspace_id: workspaceId, status: "completed", document: { run: demo.run, demo: true, demo_key: demo.key, demo_version: demoVersion }, base_revision: existing?.revision || 0 }, deps);
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
  const body = await projectRequest(`/v1/automation/artifacts/${encodeURIComponent(id)}/content`, { responseType: "stream", timeoutMs: 30 * 60_000 }, deps);
  if (!body) throw new Error("Artifact download returned an empty response.");
  await pipeline(Readable.fromWeb(body), createWriteStream(targetPath, { mode: 0o600 }));
}

const deleteAutomationArtifact = (id, deps) => projectRequest(`/v1/automation/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);

module.exports = {
  createAutomationRun, deleteAutomationArtifact, deleteAutomationRecording, deleteAutomationWorkflow, downloadAutomationArtifact,
  listAutomationArtifacts, listAutomationRecordings, listAutomationRuns, listAutomationWorkflows,
  normalizeArtifact, normalizeWorkflow, putAutomationRecording, putAutomationWorkflow, updateAutomationRun,
  seedAutomationExamples, uploadAutomationArtifact, uploadAutomationArtifactBytes,
};
