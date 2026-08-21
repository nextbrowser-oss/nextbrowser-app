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
const deleteAutomationRecording = (id, deps) => projectRequest(`/v1/automation/recordings/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);

async function listAutomationRuns(workspaceId, deps) {
  const body = await projectRequest(`/v1/automation/runs${query(workspaceId)}`, {}, deps);
  return body?.runs || [];
}

const createAutomationRun = (run, deps) => projectRequest("/v1/automation/runs", { method: "POST", body: JSON.stringify(run) }, deps);
const updateAutomationRun = (id, update, deps) => projectRequest(`/v1/automation/runs/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(update) }, deps);

function exampleRun(id, task, title, evidence, createdAt) {
  return {
    id, task, evidence, conversationTitle: title,
    answer: { id, role: "assistant", status: "done", text: "Example completed successfully.", createdAt, toolEvents: [] },
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
  const [workflows, recordings] = await Promise.all([
    listAutomationWorkflows(workspaceId, deps), listAutomationRecordings(workspaceId, deps),
  ]);
  const now = Date.now();
  const exampleVersion = 4;
  const workflowExamples = [
    { key: "collect-products", title: "Collect mystery books from a live sandbox", domain: "books.toscrape.com", task: "Collect every mystery book across the first three pages of the Books to Scrape sandbox and return title, price, rating, availability, and URL.", capability: "scrape", actions: [{ tool: "navigate", arguments: { url: "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html" } }, { tool: "wait", arguments: { selector: "article.product_pod" } }, { tool: "extract", arguments: { container: "article.product_pod", fields: ["title", "price", "rating", "availability", "url"] } }, { tool: "click", arguments: { selector: "li.next a" } }, { tool: "wait", arguments: { selector: "article.product_pod" } }, { tool: "paginate_extract", arguments: { container: "article.product_pod", fields: ["title", "price", "rating", "availability", "url"], max_pages: 3, dedupe_by: "url" } }] },
    { key: "search-knowledge", title: "Collect tagged quotes from a live sandbox", domain: "quotes.toscrape.com", task: "Open the Quotes to Scrape love tag, collect quotes with authors and tags across all result pages, and return a deduplicated reading list.", capability: "search", actions: [{ tool: "navigate", arguments: { url: "https://quotes.toscrape.com/tag/love/" } }, { tool: "wait", arguments: { selector: "div.quote" } }, { tool: "extract", arguments: { container: "div.quote", fields: ["text", "author", "tags", "url"] } }, { tool: "click", arguments: { selector: "li.next a" } }, { tool: "wait", arguments: { selector: "div.quote" } }, { tool: "paginate_extract", arguments: { container: "div.quote", fields: ["text", "author", "tags", "url"], max_pages: 5, dedupe_by: ["text", "author"] } }] },
  ];
  let seededWorkflows = 0;
  for (const example of workflowExamples) {
    const existing = workflows.find((item) => item.recipe?.example_key === example.key || item.recipe?.demo_key === example.key || item.title === example.title);
    if (existing && Number(existing.recipe?.example_version || 0) >= exampleVersion) continue;
    await putAutomationWorkflow(workspaceId, {
      id: existing?.id || randomUUID(), ...example,
      instructions: "Execute the structured recipe first. Inspect the page and adapt selectors if its layout changed.",
      parametersSchema: { type: "object", properties: { task: { type: "string" } } },
      outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" } } },
      recipe: { version: 1, capability: example.capability, actions: example.actions, example_key: example.key, example_version: exampleVersion }, revision: existing?.revision || 0, createdAt: now, updatedAt: now,
    }, deps);
    seededWorkflows += 1;
  }
  const recordingExamples = [
    { key: "product-research", run: exampleRun(randomUUID(), "Collect mystery books across the first three pages of https://books.toscrape.com with title, price, rating, availability, and URL", "Books sandbox example", 'Called clawbrowser.navigate({"url":"https://books.toscrape.com/catalogue/category/books/mystery_3/index.html"})\n{"ok":true}\nCalled clawbrowser.wait({"selector":"article.product_pod"})\n{"ok":true}\nCalled clawbrowser.extract({"container":"article.product_pod","fields":["title","price","rating","availability","url"]})\n{"count":20,"page":1}\nCalled clawbrowser.click({"selector":"li.next a"})\n{"ok":true,"page":2}\nCalled clawbrowser.wait({"selector":"article.product_pod"})\n{"ok":true}\nCalled clawbrowser.paginate_extract({"container":"article.product_pod","fields":["title","price","rating","availability","url"],"max_pages":3,"dedupe_by":"url"})\n{"count":32,"deduplicated":true}\nReturned all mystery books from the live scraping sandbox.', now - 120_000) },
    { key: "site-search", run: exampleRun(randomUUID(), "Collect quotes tagged love across every result page of https://quotes.toscrape.com with quote text, author, tags, and URL", "Quotes sandbox example", 'Called clawbrowser.navigate({"url":"https://quotes.toscrape.com/tag/love/"})\n{"ok":true}\nCalled clawbrowser.wait({"selector":"div.quote"})\n{"ok":true}\nCalled clawbrowser.extract({"container":"div.quote","fields":["text","author","tags","url"]})\n{"count":10,"page":1}\nCalled clawbrowser.click({"selector":"li.next a"})\n{"ok":true,"page":2}\nCalled clawbrowser.wait({"selector":"div.quote"})\n{"ok":true}\nCalled clawbrowser.paginate_extract({"container":"div.quote","fields":["text","author","tags","url"],"max_pages":5,"dedupe_by":["text","author"]})\n{"count":14,"deduplicated":true}\nReturned every quote tagged love from the live scraping sandbox.', now - 60_000) },
  ];
  let seededRecordings = 0;
  for (const example of recordingExamples) {
    const existing = recordings.find((item) => item.document?.example_key === example.key || item.document?.demo_key === example.key);
    if (existing && Number(existing.document?.example_version || 0) >= exampleVersion) continue;
    await putAutomationRecording({ id: existing?.id || randomUUID(), workspace_id: workspaceId, status: "completed", document: { run: example.run, example_key: example.key, example_version: exampleVersion }, base_revision: existing?.revision || 0 }, deps);
    seededRecordings += 1;
  }
  return { seeded: { workflows: seededWorkflows, recordings: seededRecordings } };
}

module.exports = {
  createAutomationRun, deleteAutomationRecording, deleteAutomationWorkflow,
  listAutomationRecordings, listAutomationRuns, listAutomationWorkflows,
  normalizeWorkflow, putAutomationRecording, putAutomationWorkflow, updateAutomationRun,
  seedAutomationExamples,
};
