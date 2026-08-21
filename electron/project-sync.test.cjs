const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createPersonalProxy,
  deletePersonalProxy,
  entityBackendURL,
  listPersonalProxies,
  listProjects,
  listWorkspaces,
  putProject,
  resolvePersonalProxy,
} = require("./project-sync.cjs");

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

test("moves entity sync with an app API override", () => {
  assert.equal(
    entityBackendURL({ NEXTBROWSER_API_BASE_URL: "http://127.0.0.1:18098/" }),
    "http://127.0.0.1:18098",
  );
  assert.equal(
    entityBackendURL({ CLAWBROWSER_API_BASE_URL: "https://staging-api.nextbrowser.test/" }),
    "https://staging-api.nextbrowser.test",
  );
  assert.equal(
    entityBackendURL({
      NEXTBROWSER_API_BASE_URL: "http://127.0.0.1:18098",
      CLAWCTL_SKILL_SERVICE: "https://entities.test/",
    }),
    "https://entities.test",
  );
});

test("stores and resolves personal proxies through the authenticated entity backend", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-proxy-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify({ api_key: "secret" }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/credentials")) {
      return { ok: true, text: async () => JSON.stringify({ scheme: "http", host: "proxy.example", port: 8080, username: "agent", password: "secret" }) };
    }
    if (options.method === "DELETE") return { ok: true, text: async () => "" };
    const item = { id: "proxy-id", name: "Office", scheme: "http", host: "proxy.example", port: 8080, username: "agent", has_password: true };
    return { ok: true, text: async () => JSON.stringify(options.method === "POST" ? item : { proxies: [item] }) };
  };
  const deps = { env: { NEXTBROWSER_CONFIG_DIR: configDir, CLAWCTL_SKILL_SERVICE: "https://core.test" }, fetchImpl };

  const listed = await listPersonalProxies(deps);
  assert.deepEqual(listed, [{ id: "proxy-id", name: "Office", scheme: "http", host: "proxy.example", port: 8080, username: "agent", hasPassword: true }]);
  const created = await createPersonalProxy({ name: "Office", scheme: "http", host: "proxy.example", port: 8080, password: "secret" }, deps);
  assert.equal(created.hasPassword, true);
  assert.equal(JSON.parse(calls[1].options.body).password, "secret");
  assert.equal("password" in created, false);
  assert.equal((await resolvePersonalProxy("proxy-id", deps)).password, "secret");
  await deletePersonalProxy("proxy-id", deps);

  assert.deepEqual(calls.map((call) => call.url), [
    "https://core.test/v1/personal-proxies",
    "https://core.test/v1/personal-proxies",
    "https://core.test/v1/personal-proxies/proxy-id/credentials",
    "https://core.test/v1/personal-proxies/proxy-id",
  ]);
  assert.ok(calls.every((call) => call.options.headers.authorization === "Bearer secret"));
});

test("preserves personal proxy backend errors without returning submitted credentials", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-proxy-error-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify({ api_key: "secret" }));
  const deps = {
    env: { NEXTBROWSER_CONFIG_DIR: configDir, CLAWCTL_SKILL_SERVICE: "https://core.test" },
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ error: "Proxy credentials were rejected." }),
    }),
  };

  await assert.rejects(
    createPersonalProxy({ name: "Broken", scheme: "http", host: "proxy.test", port: 8080, password: "do-not-return" }, deps),
    (error) => error.status === 422
      && error.message === "Proxy credentials were rejected."
      && !error.message.includes("do-not-return"),
  );
});
