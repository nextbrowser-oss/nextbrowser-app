const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAutomationRun, downloadAutomationArtifact, listAutomationArtifacts, listAutomationWorkflows, putAutomationWorkflow, uploadAutomationArtifact } = require("./automation-sync.cjs");

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
