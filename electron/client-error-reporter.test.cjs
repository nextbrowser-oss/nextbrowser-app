const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createClientErrorReporter, errorReportingAllowed, parseRetryAfter } = require("./client-error-reporter.cjs");

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bytes = (value) => Buffer.byteLength(String(value), "utf8");

function onlyKeys(object, allowed, where) {
  for (const key of Object.keys(object)) assert.ok(allowed.includes(key), `${where}: unknown field ${key}`);
}

// Mirrors POST /v1/client-errors: unknown fields are rejected, so the payload
// must carry exactly these fields within these limits.
function assertContract(body) {
  onlyKeys(body, ["client", "events"], "body");
  const { client, events } = body;
  onlyKeys(client, ["app", "version", "platform", "arch", "os_version", "nbc_version", "session_id", "install_id"], "client");
  assert.equal(client.app, "nextbrowser-app");
  for (const key of ["version", "platform", "arch", "os_version"]) assert.equal(typeof client[key], "string", `client.${key}`);
  assert.match(client.session_id, UUID);
  assert.match(client.install_id, UUID);
  assert.ok(Array.isArray(events) && events.length >= 1 && events.length <= 20, "1..20 events");
  for (const event of events) {
    onlyKeys(event, ["id", "occurred_at", "source", "kind", "name", "message", "stack", "fingerprint", "count", "view", "action", "trace_id", "request_id", "breadcrumbs", "context"], "event");
    assert.match(event.id, UUID);
    assert.match(event.occurred_at, RFC3339);
    assert.ok(["renderer", "main", "nbc", "agent"].includes(event.source));
    // "network" needs a backend that lists it in ClientErrorEvent.kind; an
    // older one refuses such a batch, which therefore never mixes kinds.
    assert.ok(["exception", "unhandled_rejection", "react_render", "api_error", "process_gone", "command_failed", "network"].includes(event.kind));
    assert.ok(event.name && bytes(event.name) <= 200);
    assert.ok(event.message && bytes(event.message) <= 2000);
    if (event.stack !== undefined) assert.ok(bytes(event.stack) <= 16000);
    if (event.fingerprint !== undefined) assert.ok(bytes(event.fingerprint) <= 128);
    assert.ok(Number.isInteger(event.count) && event.count >= 1 && event.count <= 10000);
    if (event.view !== undefined) assert.ok(bytes(event.view) <= 200);
    if (event.action !== undefined) assert.ok(bytes(event.action) <= 200);
    if (event.trace_id !== undefined) assert.match(event.trace_id, /^[0-9a-f]{32}$/);
    if (event.breadcrumbs !== undefined) {
      assert.ok(event.breadcrumbs.length <= 30);
      for (const crumb of event.breadcrumbs) {
        onlyKeys(crumb, ["at", "category", "message"], "breadcrumb");
        assert.match(crumb.at, RFC3339);
        assert.ok(["navigation", "ipc", "api", "ui", "nbc"].includes(crumb.category));
        assert.ok(bytes(crumb.message) <= 300);
      }
    }
    if (event.context !== undefined) {
      assert.ok(Object.keys(event.context).length <= 30);
      for (const [key, value] of Object.entries(event.context)) {
        assert.ok(bytes(key) <= 64);
        assert.equal(typeof value, "string");
        assert.ok(bytes(value) <= 500);
      }
    }
  }
}

function harness(t, overrides = {}) {
  const dir = overrides.dir || fs.mkdtempSync(path.join(os.tmpdir(), "client-errors-"));
  if (!overrides.dir) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = overrides.start ?? Date.parse("2026-10-20T10:00:00.000Z");
  const timers = [];
  const requests = [];
  const responses = [...(overrides.responses || [])];
  const reporter = createClientErrorReporter({
    dir,
    allowed: overrides.allowed ?? true,
    client: { version: "0.2.68", platform: "win32", arch: "x64", os_version: "10.0.22631" },
    homeDir: overrides.homeDir ?? "C:\\Users\\Alice",
    platform: overrides.platform ?? "win32",
    resolveEndpoint: overrides.resolveEndpoint || (async () => ({ baseURL: "https://api.test", apiKey: overrides.apiKey ?? "" })),
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      const next = responses.length ? responses.shift() : { status: 202 };
      if (next instanceof Error) throw next;
      return { status: next.status, headers: { get: (name) => next.headers?.[name.toLowerCase()] ?? null } };
    },
    now: () => clock,
    random: () => 0.5,
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    options: overrides.options,
  });
  return {
    dir,
    reporter,
    requests,
    timers,
    advance: (ms) => { clock += ms; },
    queueFile: () => path.join(dir, "queue.json"),
  };
}

const exception = (message = "boom", extra = {}) => ({
  source: "main",
  kind: "exception",
  name: "TypeError",
  message,
  stack: `TypeError: ${message}\n    at handler (C:\\Users\\Alice\\AppData\\Local\\Programs\\nextbrowser\\resources\\app.asar\\electron\\main.cjs:10:5)\n    at run (node:internal/x:1:1)`,
  ...extra,
});

test("reporting is off in development builds unless forced, and can be forced off", () => {
  assert.equal(errorReportingAllowed({ isDevBuild: false, env: {} }), true);
  assert.equal(errorReportingAllowed({ isDevBuild: true, env: {} }), false);
  assert.equal(errorReportingAllowed({ isDevBuild: true, env: { NEXTBROWSER_ERROR_REPORTING: "1" } }), true);
  assert.equal(errorReportingAllowed({ isDevBuild: false, env: { NEXTBROWSER_ERROR_REPORTING: "0" } }), false);
});

test("sends a payload that matches the backend contract", async (t) => {
  const h = harness(t, { apiKey: "nb_live_secret" });
  h.reporter.setNbcVersion("nbc 1.2.37 (abc123)");
  h.reporter.breadcrumbFromRenderer({ category: "navigation", message: "chat" });
  h.reporter.breadcrumb("ipc", "projects_list");
  h.reporter.breadcrumb("api", "GET core.test/v1/projects → 503");
  assert.equal(h.reporter.capture(exception("cannot read properties of undefined", {
    trace_id: "4BF92F3577B34DA6A3CE929D0E0E4736",
    request_id: "req-1",
    context: { status: 503, ok: false, nested: { no: true }, "weird key!": "x" },
  })), true);
  await h.reporter.flush();
  assert.equal(h.requests.length, 1);
  const { url, init, body } = h.requests[0];
  assert.equal(url, "https://api.test/v1/client-errors");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer nb_live_secret");
  assertContract(body);
  assert.equal(body.client.nbc_version, "1.2.37");
  const [event] = body.events;
  assert.equal(event.view, "chat");
  assert.equal(event.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.deepEqual(event.context, { status: "503", ok: "false", weird_key_: "x" });
  assert.deepEqual(event.breadcrumbs.map((crumb) => crumb.category), ["navigation", "ipc", "api"]);
  assert.ok(event.stack.includes("~\\AppData"), "home directory is scrubbed from the stack");
  assert.ok(!JSON.stringify(body).includes("Alice"));
  assert.deepEqual(h.reporter.queued, [], "a 202 empties the queue");
});

test("sends anonymously without a key and falls back to anonymous when the key is refused", async (t) => {
  const h = harness(t, { apiKey: "nb_live_stale", responses: [{ status: 401 }, { status: 202 }] });
  h.reporter.capture(exception());
  await h.reporter.flush();
  assert.equal(h.requests[0].init.headers.authorization, "Bearer nb_live_stale");
  await h.reporter.flush();
  assert.equal(h.requests[1].init.headers.authorization, undefined);
  assert.equal(h.reporter.queued.length, 0);
});

test("enforces field limits in UTF-8 bytes and rejects unknown kinds", async (t) => {
  const h = harness(t);
  assert.equal(h.reporter.capture({ source: "main", kind: "made_up", name: "x", message: "y" }), false);
  assert.equal(h.reporter.capture({ source: "elsewhere", kind: "exception", name: "x", message: "y" }), false);
  const context = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key_${index}_${"k".repeat(80)}`, "ж".repeat(400)]));
  h.reporter.capture({
    source: "main",
    kind: "exception",
    name: "Ошибка".repeat(100),
    message: "сообщение".repeat(500),
    stack: "x".repeat(20_000),
    view: "v".repeat(300),
    trace_id: "not-a-trace",
    context,
  });
  for (let index = 0; index < 40; index += 1) h.reporter.breadcrumb("ui", `action_${index}_${"й".repeat(200)}`);
  h.reporter.capture(exception("second"));
  await h.reporter.flush();
  assertContract(h.requests[0].body);
  const [first, second] = h.requests[0].body.events;
  assert.equal(first.trace_id, undefined);
  assert.equal(Object.keys(first.context).length, 30);
  assert.equal(second.breadcrumbs.length, 30, "the trail keeps the last 30 breadcrumbs");
});

test("folds duplicates into count and caps volume per fingerprint and per run", async (t) => {
  const h = harness(t, { options: { maxEventsPerFingerprint: 3, maxEventsPerRun: 5, foldWindowMs: 60_000 } });
  for (let index = 0; index < 5; index += 1) h.reporter.capture(exception("same failure"));
  assert.equal(h.reporter.queued.length, 1);
  assert.equal(h.reporter.queued[0].count, 5);
  assert.ok(h.reporter.queued[0].context.last_occurred_at);
  // Different line numbers and paths are still the same failure.
  h.reporter.capture({ ...exception("same failure"), stack: "TypeError: same failure\n    at handler (/opt/other/main.cjs:99:1)\n    at run (node:internal/x:7:7)" });
  assert.equal(h.reporter.queued[0].count, 6);
  // Outside the fold window a repeat becomes a new event, up to the cap.
  for (let index = 0; index < 4; index += 1) {
    h.advance(61_000);
    h.reporter.capture(exception("same failure"));
  }
  assert.equal(h.reporter.queued.length, 3, "per-fingerprint cap");
  for (let index = 0; index < 5; index += 1) h.reporter.capture(exception(`distinct ${"x".repeat(index + 1)}`, { stack: undefined, name: `E${index}` }));
  assert.equal(h.reporter.queued.length, 5, "per-run cap");
  assert.ok(fs.readFileSync(path.join(h.dir, "reporter.log"), "utf8").includes("limit reached"));
});

test("persists the queue in userData, bounded, and resends it on the next run", async (t) => {
  const first = harness(t, { options: { maxQueue: 3 }, responses: [{ status: 404 }] });
  for (let index = 0; index < 5; index += 1) first.reporter.capture(exception(`n${index}`, { name: `E${index}`, stack: undefined }));
  first.reporter.persistSync();
  const stored = JSON.parse(fs.readFileSync(first.queueFile(), "utf8"));
  assert.deepEqual(stored.map((entry) => entry.event.name), ["E2", "E3", "E4"], "oldest events are dropped first");
  assert.ok(stored.every((entry) => entry.sending === undefined));
  await first.reporter.flush();
  assert.equal(first.requests.length, 1);
  assert.equal(first.reporter.queued.length, 3, "a missing endpoint keeps the queue");
  await first.reporter.flush();
  assert.equal(first.requests.length, 1, "404 stops sending for this run");
  const sessionOne = first.reporter.sessionId;
  const installId = first.reporter.installId;

  const second = harness(t, { dir: first.dir });
  assert.equal(second.reporter.installId, installId, "install id is persisted");
  assert.notEqual(second.reporter.sessionId, sessionOne);
  assert.equal(second.reporter.queued.length, 3);
  assert.ok(second.timers.length > 0, "a flush is scheduled for the restored queue");
  second.reporter.capture(exception("new run"));
  await second.reporter.flush();
  assert.equal(second.requests[0].body.client.session_id, sessionOne, "restored events keep the run they happened in");
  assert.equal(second.requests[0].body.events.length, 3);
  await second.reporter.flush();
  assert.equal(second.requests[1].body.client.session_id, second.reporter.sessionId);
  assert.equal(fs.existsSync(second.queueFile()), false, "an empty queue leaves no file");
});

test("drops stale persisted events", (t) => {
  const first = harness(t, { responses: [] });
  first.reporter.capture(exception());
  first.reporter.persistSync();
  const later = harness(t, { dir: first.dir, start: Date.parse("2026-11-20T10:00:00.000Z") });
  assert.equal(later.reporter.queued.length, 0);
});

test("backs off with jitter on network errors and 5xx, honours Retry-After", async (t) => {
  const h = harness(t, { responses: [new TypeError("fetch failed"), { status: 503 }, { status: 429, headers: { "retry-after": "120" } }, { status: 202 }] });
  h.reporter.capture(exception());
  await h.reporter.flush();
  assert.equal(h.requests.length, 1);
  await h.reporter.flush();
  assert.equal(h.requests.length, 1, "no retry before the backoff elapses");
  h.advance(30_000);
  await h.reporter.flush();
  assert.equal(h.requests.length, 2);
  h.advance(30_000);
  await h.reporter.flush();
  assert.equal(h.requests.length, 2, "the second backoff is twice as long");
  h.advance(30_000);
  await h.reporter.flush();
  assert.equal(h.requests.length, 3, "429");
  h.advance(119_000);
  await h.reporter.flush();
  assert.equal(h.requests.length, 3, "Retry-After is honoured");
  h.advance(1_000);
  await h.reporter.flush();
  assert.equal(h.requests.length, 4);
  assert.equal(h.reporter.queued.length, 0);
});

test("splits a batch the backend finds too large and drops other 4xx", async (t) => {
  const h = harness(t, { responses: [{ status: 413 }, { status: 202 }, { status: 400 }] });
  for (let index = 0; index < 4; index += 1) h.reporter.capture(exception(`m${index}`, { name: `E${index}`, stack: undefined }));
  await h.reporter.flush();
  await h.reporter.flush();
  assert.equal(h.requests[0].body.events.length, 4);
  assert.equal(h.requests[1].body.events.length, 2);
  await h.reporter.flush();
  assert.equal(h.reporter.queued.length, 0, "a 400 drops the batch");
  assert.ok(fs.readFileSync(path.join(h.dir, "reporter.log"), "utf8").includes("HTTP 400"));
});

test("network failures travel in batches of their own, so a backend that refuses the kind keeps the rest", async (t) => {
  const h = harness(t, { responses: [{ status: 202 }, { status: 400 }, { status: 202 }] });
  const network = (name) => ({ source: "nbc", kind: "network", name, message: `nbc status: ${name}`, context: { network_error: "timeout" } });
  h.reporter.capture(exception("first", { name: "E1", stack: undefined }));
  h.reporter.capture(network("REMOTE_BACKEND_ERROR"));
  h.reporter.capture(exception("second", { name: "E2", stack: undefined }));
  h.reporter.capture(network("ECONNRESET GET /v1/projects"));
  await h.reporter.flush();
  await h.reporter.flush();
  assert.deepEqual(h.requests.map((request) => request.body.events.map((event) => event.kind)), [
    ["exception", "exception"],
    ["network", "network"],
  ]);
  for (const request of h.requests) assertContract(request.body);
  assert.equal(h.reporter.queued.length, 0, "the refused network batch is dropped alone");
  h.reporter.capture(exception("third", { name: "E3", stack: undefined }));
  await h.reporter.flush();
  assert.equal(h.requests[2].body.events[0].message, "third");
});

test("flushes every 30 seconds, or within a second once 10 events wait", (t) => {
  const h = harness(t);
  const flushDelay = () => Math.min(...h.timers.filter((timer) => timer.ms >= 1_000).map((timer) => timer.ms));
  for (let index = 0; index < 9; index += 1) h.reporter.capture(exception(`m${index}`, { name: `E${index}`, stack: undefined }));
  assert.equal(flushDelay(), 30_000);
  h.reporter.capture(exception("tenth", { name: "E10", stack: undefined }));
  assert.equal(flushDelay(), 1_000);
});

test("batches never exceed 20 events", async (t) => {
  const h = harness(t);
  for (let index = 0; index < 25; index += 1) h.reporter.capture(exception(`m${index}`, { name: `E${index}`, stack: undefined }));
  await h.reporter.flush();
  assert.equal(h.requests[0].body.events.length, 20);
  assertContract(h.requests[0].body);
});

test("the quit flush is bounded and never rejects", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-errors-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const reporter = createClientErrorReporter({
    dir,
    client: { version: "1" },
    resolveEndpoint: async () => ({ baseURL: "https://api.test" }),
    fetchImpl: () => new Promise(() => {}),
  });
  reporter.capture(exception());
  const started = Date.now();
  await reporter.flushBeforeQuit(100);
  assert.ok(Date.now() - started < 1_000);
  assert.ok(fs.existsSync(path.join(dir, "queue.json")), "the queue survives for the next launch");
});

test("turning reports off discards the queue and stops capturing", async (t) => {
  const h = harness(t);
  h.reporter.capture(exception());
  h.reporter.persistSync();
  assert.deepEqual(h.reporter.setUserEnabled(false), { enabled: false, available: true });
  assert.equal(h.reporter.queued.length, 0);
  assert.equal(fs.existsSync(h.queueFile()), false);
  assert.equal(h.reporter.capture(exception()), false);
  const restarted = harness(t, { dir: h.dir });
  assert.deepEqual(restarted.reporter.status(), { enabled: false, available: true }, "the choice persists");
  restarted.reporter.setUserEnabled(true);
  assert.equal(restarted.reporter.capture(exception()), true);
});

test("a build that does not allow reporting captures nothing", (t) => {
  const h = harness(t, { allowed: false });
  assert.equal(h.reporter.capture(exception()), false);
  assert.equal(h.reporter.status().available, false);
  assert.equal(fs.existsSync(h.queueFile()), false);
});

test("reporter failures stay local and never throw", async (t) => {
  const h = harness(t, { resolveEndpoint: async () => { throw new Error("no config"); } });
  h.reporter.capture(exception());
  await assert.doesNotReject(h.reporter.flush());
  assert.equal(h.reporter.capture(null), false);
  assert.doesNotThrow(() => h.reporter.breadcrumb("nope", "x"));
  assert.doesNotThrow(() => h.reporter.captureFromRenderer("garbage"));
  assert.ok(fs.readFileSync(path.join(h.dir, "reporter.log"), "utf8").includes("endpoint unavailable"));
});

test("renderer reports are validated: renderer kinds only, identifiers only, no unknown fields", async (t) => {
  const h = harness(t);
  assert.equal(h.reporter.captureFromRenderer({ kind: "api_error", name: "x", message: "y" }), false);
  h.reporter.breadcrumbFromRenderer({ category: "navigation", message: "automation" });
  h.reporter.breadcrumbFromRenderer({ category: "ui", message: "typed text with spaces" });
  h.reporter.breadcrumbFromRenderer({ category: "api", message: "GET /forged" });
  h.reporter.breadcrumbFromRenderer({ category: "ui", message: "profile_start_requested" });
  assert.equal(h.reporter.captureFromRenderer({
    kind: "react_render",
    source: "main",
    name: "Error",
    message: "Render failed for alice@example.com",
    stack: "Error\n    at ChatView (file:///C:/Users/Alice/app/dist/assets/index-AbC123xy.js:1:2)",
    view: "chat with spaces",
    action: "profile_start_requested",
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    extra: "not allowed",
    context: { ref: "NB-1234ABCD" },
  }), true);
  await h.reporter.flush();
  const body = h.requests[0].body;
  assertContract(body);
  const [event] = body.events;
  assert.equal(event.source, "renderer");
  assert.equal(event.view, "automation", "an invalid view falls back to the last navigation");
  assert.equal(event.action, "profile_start_requested");
  assert.equal(event.trace_id, undefined, "the renderer cannot set backend trace ids");
  assert.equal(event.message, "Render failed for <email>");
  assert.ok(event.stack.includes("file:///~/app"));
  assert.deepEqual(event.breadcrumbs.map((crumb) => crumb.message), ["automation", "profile_start_requested"]);
});

test("the renderer reports an error the user saw with identifiers only", async (t) => {
  const h = harness(t);
  h.reporter.breadcrumbFromRenderer({ category: "navigation", message: "chat" });
  assert.equal(h.reporter.captureFromRenderer({
    kind: "command_failed",
    name: "AGENT_START_FAILED",
    message: "agent-turn: AGENT_START_FAILED",
    action: "chat_request_submitted",
    context: { surface: "agent-turn", code: "AGENT_START_FAILED", ref: "NB-6F2C1A9B-04D2" },
  }), true);
  assert.equal(h.reporter.captureFromRenderer({
    kind: "command_failed",
    name: "STARTUP_ACCOUNT_TIMED_OUT",
    message: "startup: STARTUP_ACCOUNT_TIMED_OUT",
    context: { surface: "startup", code: "STARTUP_ACCOUNT_TIMED_OUT", elapsed_ms: "180000", stage: "cli_download" },
  }), true);
  await h.reporter.flush();
  const body = h.requests[0].body;
  assertContract(body);
  const [shown, startup] = body.events;
  assert.equal(shown.source, "renderer");
  assert.equal(shown.kind, "command_failed");
  assert.equal(shown.name, "AGENT_START_FAILED");
  assert.equal(shown.message, "agent-turn: AGENT_START_FAILED");
  assert.equal(shown.view, "chat");
  assert.equal(shown.action, "chat_request_submitted");
  assert.equal(shown.stack, undefined);
  assert.deepEqual(shown.context, { surface: "agent-turn", code: "AGENT_START_FAILED", ref: "NB-6F2C1A9B-04D2" });
  assert.deepEqual(startup.context, { surface: "startup", code: "STARTUP_ACCOUNT_TIMED_OUT", elapsed_ms: "180000", stage: "cli_download" });
});

test("a user-facing failure from the renderer carrying any free text is refused", (t) => {
  const h = harness(t);
  const valid = {
    kind: "command_failed",
    name: "LIVE_VIEW_CONNECT_FAILED",
    message: "live-view: LIVE_VIEW_CONNECT_FAILED",
    context: { surface: "live-view", code: "LIVE_VIEW_CONNECT_FAILED", ref: "NB-1234ABCD-00FF" },
  };
  const refused = [
    { ...valid, message: "We couldn't connect Live View. Ref: NB-1234ABCD-00FF" },
    { ...valid, name: "Error" },
    { ...valid, stack: "Error: reply text\n    at x (index.js:1:1)" },
    { ...valid, context: { ...valid.context, text: "the agent's reply" } },
    { ...valid, context: { ...valid.context, surface: "Live View" }, message: "Live View: LIVE_VIEW_CONNECT_FAILED" },
    { ...valid, context: { ...valid.context, code: "connect failed" }, name: "connect failed", message: "live-view: connect failed" },
    { ...valid, context: { ...valid.context, ref: "NB-1234ABCD see chat" } },
    { ...valid, context: { ...valid.context, elapsed_ms: "12 s" } },
    { ...valid, context: { ...valid.context, elapsed_ms: 12000 } },
    { ...valid, context: { ...valid.context, stage: "downloading C:\\Users\\alice" } },
    { ...valid, context: undefined },
    { ...valid, context: ["live-view", "LIVE_VIEW_CONNECT_FAILED"] },
  ];
  for (const payload of refused) assert.equal(h.reporter.captureFromRenderer(payload), false, JSON.stringify(payload));
  assert.equal(h.reporter.queued.length, 0);
  assert.equal(h.reporter.captureFromRenderer(valid), true);
  assert.equal(h.reporter.queued.length, 1);
});

test("a folded report keeps the latest Ref beside the first", (t) => {
  const h = harness(t);
  const shown = (ref) => ({
    kind: "command_failed",
    name: "SKILL_INSTALL_FAILED",
    message: "skill-apply: SKILL_INSTALL_FAILED",
    context: { surface: "skill-apply", code: "SKILL_INSTALL_FAILED", ref },
  });
  h.reporter.captureFromRenderer(shown("NB-AAAAAAAA-0001"));
  h.reporter.captureFromRenderer(shown("NB-AAAAAAAA-0002"));
  assert.equal(h.reporter.queued.length, 1);
  assert.equal(h.reporter.queued[0].count, 2);
  assert.equal(h.reporter.queued[0].context.ref, "NB-AAAAAAAA-0001");
  assert.equal(h.reporter.queued[0].context.last_ref, "NB-AAAAAAAA-0002");
});

test("Retry-After accepts seconds and HTTP dates", () => {
  const now = Date.parse("2026-10-20T10:00:00Z");
  assert.equal(parseRetryAfter("30", now), 30_000);
  assert.equal(parseRetryAfter("Tue, 20 Oct 2026 10:01:00 GMT", now), 60_000);
  assert.equal(parseRetryAfter("", now), undefined);
});

test("a runaway message is bounded before it is scrubbed", async (t) => {
  const h = harness(t);
  const started = Date.now();
  h.reporter.capture({ source: "main", kind: "exception", name: "Error", message: `${"a".repeat(5_000_000)} token=secret`, stack: "x@y".repeat(2_000_000) });
  assert.ok(Date.now() - started < 2_000, "capture stays fast");
  await h.reporter.flush();
  assertContract(h.requests[0].body);
});
