const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  describeProfileFailureEvent,
  describeProfileRequestRejection,
  describeProfileStartFailure,
  logProfileStartFailure,
  parseNextctlEnvelope,
} = require("./profile-start-failure.cjs");

// Exactly what nextctl printed for a refused start: exit 1, the error
// envelope on stdout, nothing on stderr. The host used to answer the agent
// with {"ok":false,"code":1,"stderr":""} for this.
const verifyRequiredStdout = JSON.stringify({
  ok: false,
  command: "start",
  error: {
    code: "VERIFY_REQUIRED",
    message: "VERIFY_REQUIRED: custom browser arguments are not allowed during diagnostic startup",
    hint: "No direct or skip-verify fallback is permitted.",
  },
  warnings: ["Warning: VERIFY_REQUIRED: custom browser arguments are not allowed during diagnostic startup"],
}, null, 2);

function envelope(code, message, hint = "") {
  return JSON.stringify({ ok: false, command: "start", error: { code, message, hint }, warnings: [] });
}

test("reports nextctl's error envelope instead of the raw process result", () => {
  const failure = describeProfileStartFailure({
    profile: "pixelscan-de",
    runtime: "clawbrowser",
    result: { code: 1, stdout: verifyRequiredStdout, stderr: "" },
    durationMs: 1234.4,
    ref: "NB-0000ABCD",
  });

  assert.equal(failure.ok, false);
  assert.equal(failure.profile, "pixelscan-de");
  assert.equal(failure.error.code, "VERIFY_REQUIRED");
  assert.equal(failure.error.category, "configuration");
  assert.equal(failure.error.retryable, false);
  assert.match(failure.error.message, /^The ClawBrowser profile “pixelscan-de” couldn't start: /);
  assert.match(failure.error.message, /Ref: NB-0000ABCD$/);
  assert.doesNotMatch(failure.error.message, /[{}"]|"ok"|code":/);
  assert.deepEqual(failure.diagnostics, {
    exitCode: 1,
    nextctlCode: "VERIFY_REQUIRED",
    nextctlMessage: "VERIFY_REQUIRED: custom browser arguments are not allowed during diagnostic startup",
    nextctlHint: "No direct or skip-verify fallback is permitted.",
    stderr: "",
    durationMs: 1234,
    log: "profile-start.log",
  });
});

test("maps a silent exit code to a useful fallback and keeps the raw output", () => {
  const failure = describeProfileStartFailure({
    profile: "pixelscan-fr",
    runtime: "clawbrowser",
    result: { code: 1, stdout: "", stderr: "" },
  });

  assert.equal(failure.error.code, "EXIT_1");
  assert.equal(failure.error.retryable, true);
  assert.match(failure.error.message, /“pixelscan-fr” couldn't start: the Nextbrowser CLI exited with code 1 without reporting a reason\. Retry once\./);
  assert.match(failure.error.ref, /^NB-[0-9A-F]{8}$/);
  assert.equal(failure.diagnostics.exitCode, 1);
  assert.equal(failure.diagnostics.stdout, "");
  assert.equal(failure.diagnostics.stderr, "");
});

test("separates retryable failures from configuration and installation problems", () => {
  const cases = [
    [{ code: 1, stdout: envelope("CDP_UNREACHABLE", "CDP endpoint did not become reachable before timeout") }, "CDP_UNREACHABLE", "retryable"],
    [{ code: 1, stdout: envelope("SESSION_NOT_FOUND", "managed session was not created before timeout") }, "SESSION_NOT_FOUND", "retryable"],
    [{ code: 1, stdout: envelope("VERIFY_BUSY", "verification is already running") }, "VERIFY_BUSY", "retryable"],
    [{ code: -1, stdout: "", stderr: "Command timed out after 240 seconds." }, "START_TIMEOUT", "retryable"],
    [{ code: 1, stdout: envelope("LAUNCH_FAILED", "launch failed", "context canceled while waiting for DevTools") }, "LAUNCH_FAILED", "retryable"],
    [{ code: 1, stdout: envelope("PROFILE_NOT_FOUND", "profile \"x\" not found") }, "PROFILE_NOT_FOUND", "configuration"],
    [{ code: 1, stdout: envelope("API_KEY_INVALID", "Clawbrowser API key is invalid") }, "API_KEY_INVALID", "configuration"],
    [{ code: 1, stdout: envelope("PROXY_TRAFFIC_EXHAUSTED", "proxy traffic exhausted") }, "PROXY_TRAFFIC_EXHAUSTED", "configuration"],
    [{ code: 1, stdout: envelope("LAUNCH_FAILED", "launch failed", "net::ERR_TUNNEL_CONNECTION_FAILED") }, "PROXY_UNREACHABLE", "configuration"],
    [{ code: 1, stdout: envelope("BROWSER_BIN_NOT_FOUND", "discover clawbrowser launcher: not found") }, "BROWSER_BIN_NOT_FOUND", "installation"],
    [{ code: 1, stdout: envelope("LAUNCH_FAILED", "launch failed", "fork/exec /Users/me/.nextbrowser/runtime/bin/clawbrowser: no such file or directory") }, "LAUNCH_FAILED", "installation"],
    [{ code: 1, stdout: envelope("VERIFY_FAILED", "profile needs the managed-proxy privacy capability") }, "CLAWBROWSER_OUTDATED", "installation"],
    [{ code: 127, stdout: "", stderr: "" }, "EXIT_127", "installation"],
    [{ code: 1, stdout: envelope("VERIFY_FAILED", "VERIFY_FAILED: browser stopped: CAMOUFOX_PYTHON_MISSING: Camoufox needs Python 3.11–3.13, and it could not be downloaded automatically (install Python 3.13 from https://www.python.org/downloads/ (not the Microsoft Store version) (prepare Camoufox runtime: Python 3.11–3.13 is not installed))") }, "CAMOUFOX_PYTHON_MISSING", "installation"],
  ];
  for (const [result, code, category] of cases) {
    const failure = describeProfileStartFailure({ profile: "p", runtime: "clawbrowser", result });
    assert.equal(failure.error.code, code, JSON.stringify(result));
    assert.equal(failure.error.category, category, code);
    assert.equal(failure.error.retryable, category === "retryable", code);
    assert.ok(failure.error.nextAction.length > 10, code);
  }
});

test("names the actual and expected country when the proxy check fails", () => {
  const failure = describeProfileStartFailure({
    profile: "pixelscan-de",
    runtime: "clawbrowser",
    result: { code: 1, stdout: envelope("VERIFY_FAILED", "Proxy country is fr, expected de", "Retry the same proxy."), stderr: "" },
  });
  assert.equal(failure.error.code, "PROXY_COUNTRY_MISMATCH");
  assert.equal(failure.error.reason, "its proxy connected from FR instead of DE");
  assert.equal(failure.error.retryable, true);
});

test("describes a host error thrown before nextctl ran", () => {
  const failure = describeProfileStartFailure({
    profile: "pixelscan-de",
    runtime: "clawbrowser",
    error: new Error("Clawbrowser cannot start while its runtime update is being installed. Retry after the update finishes."),
  });
  assert.equal(failure.error.code, "RUNTIME_UPDATING");
  assert.equal(failure.error.retryable, true);
  assert.equal(failure.diagnostics.exitCode, null);
  assert.match(failure.diagnostics.stderr, /runtime update is being installed/);
});

test("uses an unknown nextctl code's own message without its code prefix", () => {
  const failure = describeProfileStartFailure({
    profile: "p",
    runtime: "camoufox",
    result: { code: 1, stdout: envelope("NEW_FAILURE", "NEW_FAILURE: Camoufox refused the requested window size"), stderr: "" },
  });
  assert.equal(failure.error.code, "NEW_FAILURE");
  assert.match(failure.error.message, /^The Camoufox profile “p” couldn't start: camoufox refused the requested window size\. Retry once\./);
});

test("keeps proxy credentials, account keys and local paths out of the message and diagnostics", () => {
  const failure = describeProfileStartFailure({
    profile: "p",
    runtime: "clawbrowser",
    result: {
      code: 2,
      stdout: "",
      stderr: "dial http://alice:s3cret@proxy.example:8080 failed for key nb_live_abc123 in /Users/alice/.nextbrowser/runtime",
    },
  });
  const serialized = JSON.stringify(failure);
  assert.doesNotMatch(serialized, /s3cret|alice:|nb_live_abc123/);
  assert.match(failure.error.message, /a local file/);
});

test("parses an envelope printed after a progress line", () => {
  assert.deepEqual(parseNextctlEnvelope("[nbc] preparing runtime\n{\"ok\":false,\"error\":{\"code\":\"X\"}}"), { ok: false, error: { code: "X" } });
  assert.equal(parseNextctlEnvelope("not json"), undefined);
  assert.equal(parseNextctlEnvelope(""), undefined);
});

test("rejections before nextctl runs are never retryable", () => {
  for (const code of ["profile_outside_workspace", "profile_in_use_by_another_chat"]) {
    const rejection = describeProfileRequestRejection(code, "pixelscan-de");
    assert.equal(rejection.error.code, code);
    assert.equal(rejection.error.retryable, false);
    assert.match(rejection.error.message, /“pixelscan-de”/);
  }
});

test("logs each failure as one JSON line keyed by its Ref and rotates a large log", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-start-log-"));
  try {
    const failure = describeProfileStartFailure({
      profile: "pixelscan-de",
      runtime: "clawbrowser",
      result: { code: 1, stdout: verifyRequiredStdout, stderr: "" },
      ref: "NB-00000001",
    });
    const file = logProfileStartFailure(dir, failure, { appVersion: "0.0.0-test" });
    const entry = JSON.parse(fs.readFileSync(file, "utf8").trim());
    assert.equal(entry.ref, "NB-00000001");
    assert.equal(entry.profile, "pixelscan-de");
    assert.equal(entry.exitCode, 1);
    assert.equal(entry.nextctlCode, "VERIFY_REQUIRED");
    assert.equal(entry.appVersion, "0.0.0-test");
    assert.equal(entry.log, undefined);

    fs.writeFileSync(file, "x".repeat(1024 * 1024 + 1));
    logProfileStartFailure(dir, failure);
    assert.ok(fs.existsSync(`${file}.1`));
    assert.equal(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a host start failure is reported with its Ref and without the profile or nextctl output", () => {
  const failure = describeProfileStartFailure({
    profile: "Alice private shop",
    runtime: "clawbrowser",
    result: { code: 1, stdout: envelope("LAUNCH_FAILED", "launch Alice private shop: fork/exec /Users/alice/x: exec format error"), stderr: "" },
    ref: "NB-1234ABCD",
  });
  const { event } = describeProfileFailureEvent(failure);
  assert.deepEqual(event, {
    source: "main",
    kind: "command_failed",
    name: "HOST_PROFILE_START_FAILED",
    message: "agent profile start failed: LAUNCH_FAILED (retryable)",
    context: { code: "LAUNCH_FAILED", category: "retryable", ref: "NB-1234ABCD", runtime: "clawbrowser", exit_code: "1", nbc_code: "LAUNCH_FAILED" },
    fingerprintExtra: "LAUNCH_FAILED",
  });
  assert.ok(!JSON.stringify(event).includes("Alice"));
});

test("a host stop that threw before nextctl ran is reported as a stop", () => {
  const failure = describeProfileStartFailure({ action: "stop", profile: "p", runtime: "dasbrowser", error: new Error("Could not mount DasBrowser installer."), ref: "NB-00000001" });
  const { event } = describeProfileFailureEvent(failure);
  assert.equal(event.name, "HOST_PROFILE_STOP_FAILED");
  assert.equal(event.context.code, "HOST_ERROR");
  assert.equal(event.context.ref, "NB-00000001");
  assert.equal(event.context.runtime, "dasbrowser");
});

test("a host failure of the user's own setup is not reported", () => {
  for (const code of ["API_KEY_REQUIRED", "PROXY_TRAFFIC_EXHAUSTED", "PROFILE_NOT_FOUND"]) {
    const failure = describeProfileStartFailure({ profile: "p", runtime: "clawbrowser", result: { code: 1, stdout: envelope(code, "x"), stderr: "" } });
    assert.equal(describeProfileFailureEvent(failure).event, null, code);
  }
  const proxy = describeProfileStartFailure({ profile: "p", runtime: "clawbrowser", result: { code: 1, stdout: envelope("LAUNCH_FAILED", "net::ERR_PROXY_CONNECTION_FAILED"), stderr: "" } });
  assert.equal(describeProfileFailureEvent(proxy).event, null);
  assert.equal(describeProfileFailureEvent(undefined).event, null);
});

test("a proxy failure with a VPN in system-proxy mode says what to change, and is still reported", () => {
  const { VPN_SYSTEM_PROXY_HINT } = require("./profile-start-failure.cjs");
  const { wantsNetworkDiagnostics } = require("./network-diagnostics.cjs");
  const tunnel = { code: 1, stdout: envelope("LAUNCH_FAILED", "LAUNCH_FAILED: page load failed: net::ERR_TUNNEL_CONNECTION_FAILED"), stderr: "" };
  const hinted = describeProfileStartFailure({ profile: "Shop", runtime: "clawbrowser", result: tunnel, ref: "NB-00000001", loopbackSystemProxy: true });
  assert.equal(hinted.error.code, "PROXY_UNREACHABLE");
  assert.equal(hinted.error.hint, "vpn_system_proxy");
  assert.ok(hinted.error.nextAction.endsWith(VPN_SYSTEM_PROXY_HINT));
  assert.equal(
    hinted.error.message,
    `The ClawBrowser profile “Shop” couldn't start: its proxy didn't accept the connection. Check or change this profile's proxy in Nextbrowser, then retry. ${VPN_SYSTEM_PROXY_HINT} Ref: NB-00000001`,
  );
  const { event } = describeProfileFailureEvent(hinted);
  assert.ok(event, "reported although the category is configuration");
  assert.equal(event.context.hint, "vpn_system_proxy");
  assert.equal(event.context.code, "PROXY_UNREACHABLE");
  assert.equal(wantsNetworkDiagnostics(event), true, "with the network diagnostics");

  const plain = describeProfileStartFailure({ profile: "Shop", runtime: "clawbrowser", result: tunnel, ref: "NB-00000002" });
  assert.equal(plain.error.hint, undefined, "no system proxy on this computer: no hint");
  assert.ok(!plain.error.message.includes("VPN"));
  assert.equal(describeProfileFailureEvent(plain).event, null, "the profile's own proxy stays unreported");

  const timeout = describeProfileStartFailure({ profile: "Shop", runtime: "camoufox", result: { code: -1, stdout: "", stderr: "Command timed out after 240 seconds." }, loopbackSystemProxy: true });
  assert.equal(timeout.error.code, "START_TIMEOUT");
  assert.equal(timeout.error.hint, "vpn_system_proxy");
  const verify = describeProfileStartFailure({ profile: "Shop", runtime: "clawbrowser", result: { code: 1, stdout: envelope("VERIFY_FAILED", "VERIFY_FAILED: failed browser checks: proxy; proxy profile cannot continue without its proxy"), stderr: "" }, loopbackSystemProxy: true });
  assert.equal(verify.error.hint, "vpn_system_proxy");

  const missing = describeProfileStartFailure({ profile: "Shop", runtime: "clawbrowser", result: { code: 1, stdout: envelope("PROFILE_NOT_FOUND", "profile not found"), stderr: "" }, loopbackSystemProxy: true });
  assert.equal(missing.error.hint, undefined, "unrelated failures get no hint");
  const stop = describeProfileStartFailure({ action: "stop", profile: "Shop", runtime: "clawbrowser", result: tunnel, loopbackSystemProxy: true });
  assert.equal(stop.error.hint, undefined, "only a start");
});
