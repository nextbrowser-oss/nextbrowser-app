const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { acceptAutomationShare, createAutomationRun, createAutomationShare, declineAutomationShare, deleteAutomationRecording, listAutomationShares, listAutomationWorkflows, putAutomationWorkflow, revokeAutomationShare, seedAutomationExamples, updateAutomationRunStep } = require("./automation-sync.cjs");

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

test("persists deterministic step progress on the backend run", async (t) => {
  const f = await fixture(t, (_url, options) => jsonResponse(JSON.parse(options.body)));
  await updateAutomationRunStep("run/one", 3, { status: "completed", output: { count: 2 } }, f.deps);
  assert.match(f.calls[0].url, /\/v1\/automation\/runs\/run%2Fone\/steps\/3$/);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { status: "completed", output: { count: 2 } });
});

test("deletes a recording through the backend", async (t) => {
  const f = await fixture(t, () => jsonResponse({ deleted: true }));
  await deleteAutomationRecording("recording/one", f.deps);
  assert.match(f.calls[0].url, /\/v1\/automation\/recordings\/recording%2Fone$/);
  assert.equal(f.calls[0].options.method, "DELETE");
});

test("shares, accepts, declines, and revokes immutable automation copies by email", async (t) => {
  const f = await fixture(t, (url, options) => {
    if (url.includes("/accept")) return jsonResponse({ id: "copy-id", source_kind: "workflow", workspace_id: "recipient-space" }, 201);
    if (url.includes("/decline")) return { ok: true, status: 204, text: async () => "" };
    if (options.method === "POST") return jsonResponse({ id: "share-id", ...JSON.parse(options.body), status: "pending" }, 201);
    if (options.method === "DELETE") return { ok: true, status: 204, text: async () => "" };
    return jsonResponse({ shares: [{ id: "share-id", title: "Daily prices", source_kind: "workflow" }] });
  });

  assert.equal((await listAutomationShares("inbox", f.deps))[0].title, "Daily prices");
  assert.match(f.calls[0].url, /\/v1\/automation\/shares\?box=inbox$/);
  await createAutomationShare({ source_kind: "workflow", source_id: "flow-id", recipient_email: "friend@example.com" }, f.deps);
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { source_kind: "workflow", source_id: "flow-id", recipient_email: "friend@example.com" });
  assert.equal((await acceptAutomationShare("share/id", "recipient-space", {}, f.deps)).id, "copy-id");
  assert.match(f.calls[2].url, /\/shares\/share%2Fid\/accept$/);
  assert.deepEqual(JSON.parse(f.calls[2].options.body), { workspace_id: "recipient-space" });
  await declineAutomationShare("share/id", f.deps);
  assert.match(f.calls[3].url, /\/shares\/share%2Fid\/decline$/);
  assert.equal(f.calls[3].options.method, "POST");
  await revokeAutomationShare("share/id", f.deps);
  assert.equal(f.calls[4].options.method, "DELETE");
});

test("creates a missing share destination workspace and retries acceptance once", async (t) => {
  let attempts = 0;
  const f = await fixture(t, (url, options) => {
    if (url.includes("/accept")) {
      attempts += 1;
      return attempts === 1
        ? jsonResponse({ error: "workspace not found" }, 404)
        : jsonResponse({ id: "copy-id", source_kind: "workflow", workspace_id: "recipient-space" }, 201);
    }
    if (url.includes("/v1/workspaces/recipient-space")) return jsonResponse({ id: "recipient-space", revision: 1 });
    throw new Error(`Unexpected request: ${url}`);
  });

  const result = await acceptAutomationShare("share-id", "recipient-space", {
    name: "Recipient workspace",
    document: { profileNames: ["Worker"], profileToolsets: { Worker: "clawbrowser" } },
  }, f.deps);

  assert.equal(result.id, "copy-id");
  assert.equal(attempts, 2);
  assert.match(f.calls[1].url, /\/v1\/workspaces\/recipient-space$/);
  assert.deepEqual(JSON.parse(f.calls[1].options.body), {
    name: "Recipient workspace",
    document: { profileNames: ["Worker"], profileToolsets: { Worker: "clawbrowser" } },
    base_revision: 0,
  });
});

test("explains when a shared copy targets a workspace owned by another account", async (t) => {
  const f = await fixture(t, (url) => {
    if (url.includes("/accept")) return jsonResponse({ error: "workspace not found" }, 404);
    if (url.includes("/v1/workspaces/recipient-space")) return jsonResponse({ error: "workspace revision conflict" }, 409);
    if (url.endsWith("/v1/workspaces")) return jsonResponse({ workspaces: [] });
    throw new Error(`Unexpected request: ${url}`);
  });

  await assert.rejects(
    acceptAutomationShare("share-id", "recipient-space", { name: "Old account workspace", document: {} }, f.deps),
    /not available for the signed-in account/i,
  );
});

test("seeds exactly two successful backend examples for recordings and workflows", async (t) => {
  const created = { workflows: [], recordings: [] };
  const f = await fixture(t, async (url, options) => {
    if (options.method === "PUT" && url.includes("/workflows/")) {
      const body = JSON.parse(options.body); created.workflows.push(body);
      return jsonResponse({ id: url.split("/").pop(), ...body, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    if (options.method === "PUT" && url.includes("/recordings/")) {
      const body = JSON.parse(options.body); created.recordings.push(body);
      return jsonResponse({ id: url.split("/").pop(), ...body, revision: 1, updated_at: new Date().toISOString() });
    }
    if (url.includes("/workflows")) return jsonResponse({ workflows: [] });
    if (url.includes("/recordings")) return jsonResponse({ recordings: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.deepEqual((await seedAutomationExamples("space", f.deps)).seeded, { workflows: 2, recordings: 2 });
  assert.equal(created.workflows.length, 2);
  assert.ok(created.workflows.every((item) => item.recipe.actions.length >= 2));
  assert.deepEqual(created.workflows.map((item) => item.domain).sort(), ["books.toscrape.com", "quotes.toscrape.com"]);
  assert.ok(created.workflows.every((item) => !JSON.stringify(item).includes("example.com")));
  assert.ok(created.workflows.every((item) => item.recipe.example_key && item.recipe.example_version === 5 && !("demo_key" in item.recipe)));
  assert.ok(created.workflows.every((item) => item.recipe.actions.filter((action) => ["extract", "paginate_extract"].includes(action.tool)).every((action) => !Array.isArray(action.arguments.fields))));
  assert.equal(created.recordings.length, 2);
  assert.ok(created.recordings.every((item) => item.status === "completed" && item.document.example_key && item.document.example_version === 5 && !("demo" in item.document)));
});

test("does not duplicate examples when their internal example markers already exist", async (t) => {
  const f = await fixture(t, (url, options) => {
    assert.equal(options.method, undefined);
    if (url.includes("/workflows")) return jsonResponse({ workflows: ["collect-products", "search-knowledge"].map((key) => ({ id: key, title: key, task: "x", recipe: { actions: [], example_key: key, example_version: 5 }, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) });
    if (url.includes("/recordings")) return jsonResponse({ recordings: ["product-research", "site-search"].map((key) => ({ id: key, document: { example_key: key, example_version: 5 } })) });
    throw new Error(`Unexpected request: ${url}`);
  });
  assert.deepEqual((await seedAutomationExamples("space", f.deps)).seeded, { workflows: 0, recordings: 0 });
  assert.equal(f.calls.length, 2);
});

test("migrates legacy demo markers without creating duplicate entities", async (t) => {
  const updated = { workflows: [], recordings: [] };
  const legacyWorkflow = { id: "legacy-workflow", title: "Collect mystery books from a live sandbox", task: "old", recipe: { actions: [], demo_key: "collect-products", demo_version: 3 }, revision: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const currentWorkflow = { id: "current-workflow", title: "current", task: "current", recipe: { actions: [], example_key: "search-knowledge", example_version: 5 }, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const legacyRecording = { id: "legacy-recording", document: { demo: true, demo_key: "product-research", demo_version: 3 }, revision: 2 };
  const currentRecording = { id: "current-recording", document: { example_key: "site-search", example_version: 5 }, revision: 1 };
  const f = await fixture(t, (url, options) => {
    if (options.method === "PUT" && url.includes("/workflows/")) {
      const body = JSON.parse(options.body); updated.workflows.push({ id: decodeURIComponent(url.split("/").pop()), ...body });
      return jsonResponse({ ...body, revision: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    if (options.method === "PUT" && url.includes("/recordings/")) {
      const body = JSON.parse(options.body); updated.recordings.push(body);
      return jsonResponse({ ...body, revision: 3, updated_at: new Date().toISOString() });
    }
    if (url.includes("/workflows")) return jsonResponse({ workflows: [legacyWorkflow, currentWorkflow] });
    if (url.includes("/recordings")) return jsonResponse({ recordings: [legacyRecording, currentRecording] });
    throw new Error(`Unexpected request: ${url}`);
  });

  assert.deepEqual((await seedAutomationExamples("legacy-space", f.deps)).seeded, { workflows: 1, recordings: 1 });
  assert.equal(updated.workflows[0].id, legacyWorkflow.id);
  assert.equal(updated.workflows[0].recipe.example_key, "collect-products");
  assert.ok(!("demo_key" in updated.workflows[0].recipe));
  assert.equal(updated.recordings[0].id, legacyRecording.id);
  assert.equal(updated.recordings[0].document.example_key, "product-research");
  assert.ok(!("demo" in updated.recordings[0].document));
  assert.ok(!("demo_key" in updated.recordings[0].document));
});

test("coalesces concurrent seed requests for the same workspace", async (t) => {
  const f = await fixture(t, (url) => {
    if (url.includes("/workflows")) return jsonResponse({ workflows: [] });
    if (url.includes("/recordings")) return jsonResponse({ recordings: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  const first = seedAutomationExamples("shared-space", f.deps);
  const second = seedAutomationExamples("shared-space", f.deps);
  assert.strictEqual(first, second);
  assert.deepEqual((await first).seeded, { workflows: 2, recordings: 2 });
  assert.equal(f.calls.filter((call) => call.options.method === undefined).length, 2);
});
