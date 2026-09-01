const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { configPath, loadBackendConfig, normalizeAPIBaseURL } = require("./proxy-traffic.cjs");

async function tempHome(t) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-proxy-traffic-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, ".config", "clawbrowser"), { recursive: true });
  return homeDir;
}

async function writeConfig(homeDir, payload) {
  await fs.writeFile(
    configPath({ homeDir, platform: "darwin", env: {} }),
    JSON.stringify(payload),
    { mode: 0o600 },
  );
}

test("loads the backend key without exposing it to the renderer", async (t) => {
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "private-key", api_base_url: "https://api.example.test/" });

  assert.deepEqual(await loadBackendConfig({ homeDir, platform: "darwin", env: {} }), {
    apiKey: "private-key",
    baseURL: "https://api.example.test",
  });
});

test("loads the key from the isolated NextBrowser config directory", async (t) => {
  const homeDir = await tempHome(t);
  const nextbrowserConfigDir = path.join(homeDir, "NextBrowser", "runtime", "config");
  await fs.mkdir(nextbrowserConfigDir, { recursive: true });
  await fs.writeFile(
    path.join(nextbrowserConfigDir, "config.json"),
    JSON.stringify({ api_key: "nextbrowser-key" }),
    { mode: 0o600 },
  );

  const config = await loadBackendConfig({
    homeDir,
    platform: "darwin",
    env: { NEXTBROWSER_CONFIG_DIR: nextbrowserConfigDir },
  });

  assert.equal(config.apiKey, "nextbrowser-key");
  assert.equal(config.baseURL, "https://api.nextbrowser.com");
});

test("normalizes the legacy dashboard host and rejects non-http URLs", () => {
  assert.equal(normalizeAPIBaseURL("https://app.nextbrowser.com/"), "https://api.nextbrowser.com");
  assert.throws(() => normalizeAPIBaseURL("file:///tmp/config.json"), /Unsupported NextBrowser API URL/);
  assert.throws(() => normalizeAPIBaseURL("https://user:password@api.example.test"), /Unsupported NextBrowser API URL/);
});
