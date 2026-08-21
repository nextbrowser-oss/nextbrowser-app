const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAutomationRun, downloadAutomationArtifact, listAutomationArtifacts, listAutomationWorkflows, putAutomationWorkflow, seedAutomationExamples, uploadAutomationArtifact } = require("./automation-sync.cjs");

async function fixture(t, responder) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "automation-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  await fs.mkdir(configDir);
  await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify({ api_key: "secret" }));
  const calls = [];
  return { root, calls, deps: { env: { NEXTBROWSER_CONFIG_DIR: configDir, CLAWCTL_SKILL_SERVICE: "https://core.test" }, fetchImpl: async (url, options) => { calls.push({ url, options }); return responder(url, options); } } };
}
const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test("maps workflows and sends their optimistic revision", async (t) => {
  const backend = { id: "w", title: "Login", domain: "example.com", task: "Log in", instructions: "Do it", capability: "form", parameters_schema: {}, output_schema: {}, recipe: { version: 1, capability: "form", actions: [{ tool: "navigate", arguments: { url: "https://example.com" } }] }, revision: 4, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
  const f = await fixture(t, (_url, options) => jsonResponse(options.method === "PUT" ? { ...backend, revision: 5 } : { workflows: [backend] }));
  const listed = await listAutomationWorkflows("space id", f.deps);
  assert.equal(listed[0].actions[0].tool, "navigate");
  assert.match(f.calls[0].url, /workspace_id=space%20id$/);
  assert.equal((await putAutomationWorkflow("space id", listed[0], f.deps)).revision, 5);
  assert.equal(JSON.parse(f.calls[1].options.body).base_revision, 4);
  assert.equal(f.calls[1].options.headers.authorization, "Bearer secret");
});

test("creates a backend-owned queued run", async (t) => {
  const f = await fixture(t, (_url, options) => jsonResponse({ ...JSON.parse(options.body), status: "queued" }));
  assert.equal((await createAutomationRun({ id: "run", workspace_id: "space", workflow_id: "flow", input: {} }, f.deps)).status, "queued");
});

test("uploads multipart without overriding its boundary", async (t) => {
  const f = await fixture(t, (_url, options) => {
    assert.ok(options.body instanceof FormData);
    assert.equal(options.headers["content-type"], undefined);
    return jsonResponse({ id: "a", name: "report.txt", size: 5, content_type: "text/plain", sha256: "abc", created_at: "2026-01-01T00:00:00Z" });
  });
  const file = path.join(f.root, "report.txt");
  await fs.writeFile(file, "hello");
  assert.equal((await uploadAutomationArtifact("space", file, f.deps)).extension, "txt");
});

test("rejects files above 30 MiB before fetching", async (t) => {
  const f = await fixture(t, () => { throw new Error("must not fetch"); });
  const file = path.join(f.root, "large.bin");
  await fs.writeFile(file, Buffer.alloc(30 * 1024 * 1024 + 1));
  await assert.rejects(uploadAutomationArtifact("space", file, f.deps), /larger than 30 MiB/);
  assert.equal(f.calls.length, 0);
});

test("round-trips downloaded bytes and normalizes artifact metadata", async (t) => {
  const f = await fixture(t, (url) => url.endsWith("/content") ? { ok: true, arrayBuffer: async () => Uint8Array.from([0, 1, 2, 255]).buffer } : jsonResponse({ artifacts: [{ id: "a", name: "data.bin", size: 4, content_type: "application/octet-stream", sha256: "hash", created_at: "2026-01-01T00:00:00Z" }] }));
  assert.equal((await listAutomationArtifacts("space", f.deps))[0].extension, "bin");
  const target = path.join(f.root, "download.bin");
  await downloadAutomationArtifact("a", target, f.deps);
  assert.deepEqual(await fs.readFile(target), Buffer.from([0, 1, 2, 255]));
});

test("seeds exactly two successful examples for every empty Automation Studio section", async (t) => {
  const created = { workflows: [], recordings: [], artifacts: [] };
  const f = await fixture(t, async (url, options) => {
    if (options.method === "PUT" && url.includes("/workflows/")) {
      const body = JSON.parse(options.body); created.workflows.push(body);
      return jsonResponse({ id: url.split("/").pop(), ...body, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    if (options.method === "PUT" && url.includes("/recordings/")) {
      const body = JSON.parse(options.body); created.recordings.push(body);
      return jsonResponse({ id: url.split("/").pop(), ...body, revision: 1, updated_at: new Date().toISOString() });
    }
    if (options.method === "POST" && url.endsWith("/artifacts")) {
      const name = options.body.get("file").name; created.artifacts.push(name);
      return jsonResponse({ id: name, name, size: 10, content_type: "text/plain", sha256: "hash", created_at: new Date().toISOString() });
    }
    if (url.includes("/workflows")) return jsonResponse({ workflows: [] });
    if (url.includes("/recordings")) return jsonResponse({ recordings: [] });
    if (url.includes("/artifacts")) return jsonResponse({ artifacts: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.deepEqual((await seedAutomationExamples("space", f.deps)).seeded, { workflows: 2, recordings: 2, artifacts: 2 });
  assert.equal(created.workflows.length, 2);
  assert.ok(created.workflows.every((item) => item.recipe.actions.length >= 2));
  assert.equal(created.recordings.length, 2);
  assert.ok(created.recordings.every((item) => item.status === "completed" && item.document.demo === true));
  assert.deepEqual(created.artifacts.sort(), ["automation-run-demo.json", "product-research-demo.csv"]);
});

test("does not duplicate examples when their demo markers already exist", async (t) => {
  const f = await fixture(t, (url, options) => {
    assert.equal(options.method, undefined);
    if (url.includes("/workflows")) return jsonResponse({ workflows: ["collect-products", "search-knowledge"].map((key) => ({ id: key, title: key, task: "x", recipe: { actions: [], demo_key: key }, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) });
    if (url.includes("/recordings")) return jsonResponse({ recordings: ["product-research", "site-search"].map((key) => ({ id: key, document: { demo_key: key } })) });
    return jsonResponse({ artifacts: ["product-research-demo.csv", "automation-run-demo.json"].map((name) => ({ id: name, name, size: 1, created_at: new Date().toISOString() })) });
  });
  assert.deepEqual((await seedAutomationExamples("space", f.deps)).seeded, { workflows: 0, recordings: 0, artifacts: 0 });
  assert.equal(f.calls.length, 3);
});
