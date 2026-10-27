const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { describeBackendRequest, newTraceContext, setBackendClientInfo, setBackendRequestObserver, tracedBackendFetch } = require("./backend-fetch.cjs");
const { listProjects } = require("./project-sync.cjs");

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;

function response(status, headers = {}) {
  return { status, ok: status < 400, headers: new Headers(headers), text: async () => "{}" };
}

test("adds a W3C traceparent and reports the request to the observer", async (t) => {
  const seen = [];
  setBackendRequestObserver((info) => seen.push(info));
  t.after(() => setBackendRequestObserver(null));
  const calls = [];
  const traced = tracedBackendFetch(async (url, init) => {
    calls.push({ url, init });
    return response(200, { "x-request-id": "req-9" });
  });
  await traced("https://core.test/v1/projects?x=1", { method: "get", headers: { authorization: "Bearer k" } });
  const [, traceId] = calls[0].init.headers.traceparent.match(TRACEPARENT);
  assert.equal(calls[0].init.headers.authorization, "Bearer k", "existing headers are kept");
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].status, 200);
  assert.equal(seen[0].traceId, traceId);
  assert.equal(seen[0].requestId, "req-9");
});

test("supports Headers instances and rethrows network errors unchanged", async (t) => {
  const seen = [];
  setBackendRequestObserver((info) => seen.push(info));
  t.after(() => setBackendRequestObserver(null));
  let sent;
  await tracedBackendFetch(async (_url, init) => { sent = init.headers; return response(204); })("https://api.test/x", { headers: new Headers({ accept: "application/json" }) });
  assert.match(sent.get("traceparent"), TRACEPARENT);
  assert.equal(sent.get("accept"), "application/json");
  const failure = new TypeError("fetch failed");
  await assert.rejects(tracedBackendFetch(async () => { throw failure; })("https://api.test/x"), (error) => error === failure);
  assert.equal(seen[1].error, failure);
});

test("an observer that throws cannot break the request", async (t) => {
  setBackendRequestObserver(() => { throw new Error("observer"); });
  t.after(() => setBackendRequestObserver(null));
  const result = await tracedBackendFetch(async () => response(200))("https://api.test/x");
  assert.equal(result.status, 200);
});

test("trace ids are random and never all zero", () => {
  const a = newTraceContext();
  const b = newTraceContext();
  assert.notEqual(a.traceId, b.traceId);
  const zero = newTraceContext((size) => Buffer.alloc(size));
  assert.match(zero.traceparent, TRACEPARENT);
  assert.notEqual(zero.traceId, "0".repeat(32));
});

test("5xx responses become api_error events with the backend trace id", () => {
  const { breadcrumb, event } = describeBackendRequest({
    url: "https://core.nextbrowser.com/v1/projects/3f2b1c9e-1d2c-4b5a-9e8f-0123456789ab?token=t",
    method: "PUT",
    status: 503,
    traceId: "a".repeat(32),
    responseTraceId: "B".repeat(32),
    requestId: "req-1",
    durationMs: 812.4,
  });
  assert.equal(breadcrumb, "PUT core.nextbrowser.com/v1/projects/:id → 503");
  assert.equal(event.kind, "api_error");
  assert.equal(event.name, "HTTP 503 PUT /v1/projects/:id");
  assert.equal(event.trace_id, "b".repeat(32));
  assert.equal(event.request_id, "req-1");
  assert.deepEqual(event.context, { method: "PUT", host: "core.nextbrowser.com", path: "/v1/projects/:id", duration_ms: "812", status: "503" });
  assert.ok(!JSON.stringify(event).includes("token"));
});

test("without X-Trace-Id the trace id sent in traceparent links the event", () => {
  const { event } = describeBackendRequest({ url: "https://api.test/v1/x", method: "GET", status: 500, traceId: "c".repeat(32), responseTraceId: "" });
  assert.equal(event.trace_id, "c".repeat(32));
});

test("network failures, failed lookups included, are reported as kind network; no route, 4xx and caller aborts are breadcrumbs only", () => {
  // Reported from 0.2.68 on macOS: a TLS-intercepting network reset the connection.
  const reset = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("Client network socket disconnected before secure TLS connection was established"), { code: "ECONNRESET" }),
  });
  const failed = describeBackendRequest({ url: "https://api.nextbrowser.com/v1/client-environment/policy", method: "GET", error: reset, traceId: "d".repeat(32) });
  assert.equal(failed.breadcrumb, "GET api.nextbrowser.com/v1/client-environment/policy → ECONNRESET");
  assert.equal(failed.event.kind, "network");
  assert.equal(failed.event.name, "ECONNRESET GET /v1/client-environment/policy");
  assert.equal(failed.event.context.network_error, "ECONNRESET");
  const timeout = describeBackendRequest({ url: "https://core.test/v1/workspaces", method: "GET", error: new DOMException("timed out", "TimeoutError"), traceId: "d".repeat(32) });
  assert.equal(timeout.event.kind, "network");
  assert.equal(timeout.event.context.network_error, "TimeoutError");
  const malformed = describeBackendRequest({ url: "https://core.test/v1/x", method: "GET", error: new TypeError("Failed to parse URL from core.test/v1/x") });
  assert.equal(malformed.event.kind, "api_error", "a request fetch could not even send is the app's failure");
  // Reported from Macs with a VPN: our domain does not resolve while the
  // internet works. It is reported, with the network diagnostics.
  const lookupFailed = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.nextbrowser.com"), { code: "ENOTFOUND" }) });
  const unresolved = describeBackendRequest({ url: "https://api.nextbrowser.com/v1/client-environment/policy", method: "GET", error: lookupFailed, traceId: "d".repeat(32) });
  assert.equal(unresolved.breadcrumb, "GET api.nextbrowser.com/v1/client-environment/policy → ENOTFOUND");
  assert.equal(unresolved.event.kind, "network");
  assert.equal(unresolved.event.name, "ENOTFOUND GET /v1/client-environment/policy");
  assert.equal(unresolved.event.context.network_error, "ENOTFOUND");
  const again = describeBackendRequest({ url: "https://core.test/v1/x", method: "GET", error: Object.assign(new TypeError("fetch failed"), { cause: { code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN core.test" } }) });
  assert.equal(again.event.kind, "network");
  assert.equal(again.event.context.network_error, "EAI_AGAIN");
  const noRoute = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ENETUNREACH 1.2.3.4:443"), { code: "ENETUNREACH" }) });
  assert.equal(describeBackendRequest({ url: "https://core.test/v1/x", method: "GET", error: noRoute }).event, null, "no network route: the computer is offline");
  assert.equal(describeBackendRequest({ url: "https://core.test/v1/x", method: "GET", status: 401 }).event, null);
  assert.equal(describeBackendRequest({ url: "https://core.test/v1/x", method: "GET", status: 404 }).event, null);
  assert.equal(describeBackendRequest({ url: "https://core.test/v1/x", method: "GET", error: new DOMException("aborted", "AbortError") }).event, null);
});

test("project sync requests carry a traceparent", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "backend-fetch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "config.json"), JSON.stringify({ api_key: "secret" }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(options);
    return { ok: true, status: 200, headers: new Headers(), text: async () => "{\"projects\":[]}" };
  };
  await listProjects({ env: { NEXTBROWSER_CONFIG_DIR: root, CLAWCTL_SKILL_SERVICE: "https://core.test" }, fetchImpl });
  assert.match(calls[0].headers.traceparent, TRACEPARENT);
  assert.equal(calls[0].headers.authorization, "Bearer secret");
});

test("names the app and its version unless the caller already did", async (t) => {
  setBackendClientInfo({ name: "nextbrowser-app", version: "0.2.68" });
  t.after(() => setBackendClientInfo({}));
  const calls = [];
  const traced = tracedBackendFetch(async (url, init) => {
    calls.push(init.headers);
    return response(200);
  });
  await traced("https://core.test/v1/projects", { headers: { authorization: "Bearer k" } });
  await traced("https://core.test/v1/projects", { headers: new Headers({ "x-client-name": "nbc" }) });
  assert.equal(calls[0]["x-client-name"], "nextbrowser-app");
  assert.equal(calls[0]["x-client-version"], "0.2.68");
  assert.equal(calls[0].authorization, "Bearer k");
  assert.equal(calls[1].get("x-client-name"), "nbc");
  assert.equal(calls[1].get("x-client-version"), "0.2.68");
  assert.match(calls[1].get("traceparent"), TRACEPARENT);
});
