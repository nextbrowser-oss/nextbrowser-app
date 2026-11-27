const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createJourneyReporter } = require("./journey.cjs");

test("bounded retries keep one ID and the original account; payload has no action contents", async () => {
  const calls = []; let resolveCount = 0;
  const reporter = createJourneyReporter({ allowed: true, wait: async () => {},
    resolveEndpoint: async () => { resolveCount++; return { apiKey: "test-only", baseURL: "https://api.example.test/" }; },
    fetchImpl: async (url, options) => { calls.push({ url, ...options }); if (calls.length === 1) throw Error("network"); return { ok: calls.length === 3, status: 503 }; },
  });
  await reporter.report("agent_action_succeeded");
  assert.equal(resolveCount, 1); assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://api.example.test/v1/telemetry/journey");
  assert.equal(new Set(calls.map((call) => call.body)).size, 1);
  const payload = JSON.parse(calls[0].body);
  assert.deepEqual(Object.keys(payload).sort(), ["event", "event_id"]);
  assert.match(payload.event_id, /^[a-f0-9-]{36}$/);
  await reporter.report("login_succeeded");
  assert.notEqual(JSON.parse(calls[3].body).event_id, payload.event_id);
});

test("development, unknown actions, signed-out accounts and authorization errors do not send/retry", async () => {
  let calls = 0;
  const options = { allowed: true, wait: async () => {}, resolveEndpoint: async () => ({ apiKey: "test-only", baseURL: "https://api.example.test" }), fetchImpl: async () => { calls++; return { ok: false, status: 401 }; } };
  await createJourneyReporter({ ...options, allowed: false }).report("login_succeeded");
  await createJourneyReporter(options).report("chat text");
  await createJourneyReporter({ ...options, resolveEndpoint: async () => ({}) }).report("login_succeeded");
  assert.equal(calls, 0);
  await createJourneyReporter(options).report("login_succeeded");
  assert.equal(calls, 1);
});
