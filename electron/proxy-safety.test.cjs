const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createProxySafety, parseCommand } = require("./proxy-safety.cjs");
const ok = (data) => ({ code: 0, stdout: JSON.stringify({ ok: true, data }) });
const green = { verify: { finalized: true, status: "pass", checks: [{ pass: true }] } };
function fixture(t, { verifies = [false, true, true], stopFails = false, discovery = false, onCommand } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-safety-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "block.json"), calls = [], events = [];
  let paused = 0;
  const manager = createProxySafety({ file,
    run: async (args) => {
      const p = parseCommand(args); calls.push(p.command);
      const override = await onCommand?.(p.command);
      if (override) return override;
      assert.equal(p.profile, "work"); assert.equal(p.runtime, "clawbrowser");
      if (p.command === "status") return ok({ status: "running" });
      if (p.command === "verify") return ok(verifies.shift() ? green : { verify: { finalized: true, status: "fail", checks: [{ pass: false }] } });
      if (p.command === "stop" && stopFails) return { code: 1, stdout: "" };
      return ok({});
    },
    pause: async () => { paused++; assert.equal(fs.existsSync(file), true, "persist block BEFORE stopping tasks"); },
    publish: (state) => events.push(state),
    discover: discovery ? async () => [{ profile: "work", runtime: "clawbrowser" }] : undefined,
  });
  if (!discovery) manager.begin(["status", "--profile", "work"])(ok({ status: "running" }));
  return { manager, file, calls, events, paused: () => paused };
}
test("loss persists an interlock, stops tasks, restores same proxy and requires explicit fresh resume", async (t) => {
  const f = fixture(t);
  await f.manager.poll();
  assert.equal(f.paused(), 1);
  assert.deepEqual(f.calls, ["status", "verify", "stop", "start", "verify"]);
  assert.equal(f.manager.state().phase, "recovered");
  assert.throws(() => f.manager.begin(["open", "https://example.invalid"]), /PROXY_CONNECTION_LOST/);
  await f.manager.resume();
  assert.equal(f.manager.state(), null);
  assert.equal(f.calls.at(-1), "verify");
});
test("three recovery failures leave browser stopped without any direct fallback", async (t) => {
  const f = fixture(t, { verifies: [] }); await f.manager.poll();
  assert.equal(f.manager.state().phase, "failed");
  assert.equal(f.calls.filter((c) => c === "start").length, 3);
  assert.equal(f.calls.at(-1), "stop");
  assert.ok(!f.calls.includes("profiles"));
  await assert.rejects(f.manager.resume(), /Restore/);
});
test("cleanup failure blocks recovery instead of launching another browser", async (t) => {
  const f = fixture(t, { stopFails: true }); await f.manager.poll();
  assert.equal(f.manager.state().phase, "blocked");
  assert.ok(!f.calls.includes("start"));
});
test("a persisted CLI fault is handled even without a renderer or registered session", async (t) => {
  const f = fixture(t, { verifies: [true] });
  fs.writeFileSync(f.file, JSON.stringify({ phase: "blocked", profile: "work", runtime: "clawbrowser" }));
  await f.manager.poll();
  assert.equal(f.manager.state().phase, "recovered");
  assert.equal(f.paused(), 1);
});
test("monitor discovers sessions independently of renderer focus", async (t) => {
  const f = fixture(t, { discovery: true }); await f.manager.poll();
  assert.equal(f.manager.state().phase, "recovered");
});
test("healthy sessions never stop or restart", async (t) => {
  const f = fixture(t, { verifies: [true] }); await f.manager.poll();
  assert.equal(f.manager.state(), null); assert.equal(f.paused(), 0);
  assert.deepEqual(f.calls, ["status", "verify"]);
});

test("manual stop during recovery prevents another launch", async (t) => {
  let release, started;
  const reached = new Promise((resolve) => { started = resolve; });
  const pendingStart = new Promise((resolve) => { release = resolve; });
  const f = fixture(t, { onCommand: async (command) => {
    if (command === "start") { started(); await pendingStart; }
  } });
  const poll = f.manager.poll();
  await reached;
  assert.throws(() => f.manager.begin(["start", "--profile", "work"]), /already running/);
  f.manager.begin(["stop", "--profile", "work"])(ok({}));
  release(); await poll;
  assert.equal(f.calls.filter((c) => c === "start").length, 1);
  assert.equal(f.calls.at(-1), "stop");
  assert.equal(f.manager.state().phase, "blocked");
});
test("failed fresh check on resume never clears the interlock", async (t) => {
  const f = fixture(t, { verifies: [false, true, false] });
  await f.manager.poll();
  await assert.rejects(f.manager.resume(), /remains paused/);
  assert.equal(fs.existsSync(f.file), true);
  assert.equal(f.manager.state().phase, "failed");
});
test("another verifier being busy is not classified as proxy loss", async (t) => {
  const f = fixture(t, { onCommand: async (command) => command === "verify" ? { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "VERIFY_BUSY" } }) } : undefined });
  await f.manager.poll();
  assert.equal(f.paused(), 0);
  assert.equal(f.manager.state(), null);
});
