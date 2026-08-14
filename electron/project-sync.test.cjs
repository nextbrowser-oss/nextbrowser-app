const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { entityBackendURL, listProjects, listWorkspaces, putProject } = require("./project-sync.cjs");

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
  const deps = { env: { NEXTBROWSER_CONFIG_DIR: configDir, CLAWCTL_SKILL_SERVICE: "https://skills.test/" }, fetchImpl };
  await listProjects(deps);
  await putProject("p", { title: "P" }, deps);
  await listWorkspaces(deps);
  assert.equal(calls[0].url, "https://skills.test/v1/projects");
  assert.equal(calls[2].url, "https://skills.test/v1/workspaces");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
  assert.equal(calls[1].options.method, "PUT");
  assert.equal(calls[1].options.body, JSON.stringify({ title: "P" }));
});

test("uses the same default backend as cloud skills", () => {
  assert.equal(entityBackendURL({}), "https://core.nextbrowser.com");
});
