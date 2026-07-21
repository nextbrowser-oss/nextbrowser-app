const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { configPath, loadBackendConfig, normalizeAPIBaseURL, topUpProxyTraffic } = require("./proxy-traffic.cjs");

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

async function startServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("loads the backend key without exposing it to the renderer", async (t) => {
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "private-key", api_base_url: "https://api.example.test/" });

  assert.deepEqual(await loadBackendConfig({ homeDir, platform: "darwin", env: {} }), {
    apiKey: "private-key",
    baseURL: "https://api.example.test",
  });
});

test("normalizes the legacy dashboard host and rejects non-http URLs", () => {
  assert.equal(normalizeAPIBaseURL("https://app.clawbrowser.ai/"), "https://api.clawbrowser.ai");
  assert.throws(() => normalizeAPIBaseURL("file:///tmp/config.json"), /Unsupported NextBrowser API URL/);
  assert.throws(() => normalizeAPIBaseURL("https://user:password@api.example.test"), /Unsupported NextBrowser API URL/);
});

test("tops up proxy traffic through the authenticated backend endpoint", async (t) => {
  let authorization = "";
  let requestPath = "";
  const baseURL = await startServer(t, (request, response) => {
    authorization = request.headers.authorization || "";
    requestPath = request.url || "";
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      limited: true,
      used_bytes: 1_073_741_824,
      limit_bytes: 2_147_483_648,
      remaining_bytes: 1_073_741_824,
      percent_used: 50,
      state: "ok",
      top_up_bytes: 1_073_741_824,
    }));
  });
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "traffic-key", api_base_url: baseURL });

  const traffic = await topUpProxyTraffic({ homeDir, platform: "darwin", env: {} });

  assert.equal(requestPath, "/v1/proxy/traffic/top-up");
  assert.equal(authorization, "Bearer traffic-key");
  assert.equal(traffic.limit_bytes, 2_147_483_648);
});

test("does not expose backend error bodies", async (t) => {
  const baseURL = await startServer(t, (_request, response) => {
    response.statusCode = 503;
    response.end("private upstream failure");
  });
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "traffic-key", api_base_url: baseURL });

  await assert.rejects(
    topUpProxyTraffic({ homeDir, platform: "darwin", env: {} }),
    (error) => error.message === "NextBrowser proxy traffic request failed (503).",
  );
});
