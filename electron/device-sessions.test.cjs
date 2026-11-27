const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDeviceSessions } = require("./device-sessions.cjs");

test("orders device contact before logout and keeps credentials in the main process", async () => {
  const calls = [];
  let apiKey = "test";
  const devices = createDeviceSessions({
    installId: () => "local-install", name: () => "Test desktop", platform: "linux",
    resolveEndpoint: async () => ({ baseURL: "https://example.test", apiKey }),
    fetchImpl: async (url, init) => {
      calls.push([init.method, url, init.headers.authorization]);
      return { ok: true, json: async () => [{ id: "other-install" }] };
    },
  });
  const data = await devices.list();
  assert.deepEqual(data, { current: "local-install", sessions: [{ id: "other-install" }] });
  await Promise.all([devices.heartbeat(), devices.logout(async () => { apiKey = ""; }), devices.heartbeat()]);
  assert.deepEqual(calls.map(([method]) => method), ["PUT", "GET", "DELETE"]);
  assert.ok(calls.every(([,url,auth]) => url.startsWith("https://example.test/v1/device-sessions") && auth === "Bearer test"));
  await assert.rejects(devices.list(), /Sign in/);
});
