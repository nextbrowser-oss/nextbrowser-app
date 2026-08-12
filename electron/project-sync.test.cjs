const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { listProjects, putProject } = require("./project-sync.cjs");

test("syncs projects with the private backend key", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify({ api_key: "secret", api_base_url: "https://api.test" }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => JSON.stringify(url.endsWith("/projects") ? { projects: [] } : { id: "p", revision: 1 }) };
  };
  const deps = { env: { NEXTBROWSER_CONFIG_DIR: configDir }, fetchImpl };
  await listProjects(deps);
  await putProject("p", { title: "P" }, deps);
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[1].options.body, JSON.stringify({ title: "P" }));
});
