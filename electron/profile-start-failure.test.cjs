const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
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
  assert.match(failure.error.message, /“pixelscan-fr” couldn't start: the NextBrowser CLI exited with code 1 without reporting a reason\. Retry once\./);
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
