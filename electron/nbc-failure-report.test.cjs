const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createClientErrorReporter } = require("./client-error-reporter.cjs");
const { describeNbcResult, expectsJSON, isNextctlBinary, nbcCommandName } = require("./nbc-failure-report.cjs");

const envelope = (code, message = "failed") => JSON.stringify({ ok: false, command: "x", error: { code, message, hint: "" } });

test("recognizes the nbc binary on every platform", () => {
  assert.equal(isNextctlBinary("/Users/a/.nextbrowser/managed-nextctl/nextctl"), true);
  assert.equal(isNextctlBinary("C:\\Users\\a\\AppData\\Roaming\\Nextbrowser\\managed-nextctl\\nextctl.exe"), true);
  assert.equal(isNextctlBinary("/usr/local/bin/nbc"), true);
  assert.equal(isNextctlBinary("tar"), false);
  assert.equal(isNextctlBinary("/usr/bin/claude"), false);
});

test("command names keep the command words and never the arguments", () => {
  assert.equal(nbcCommandName(["--verify-on-start-only", "start", "--profile", "My Shop", "--runtime", "clawbrowser", "--format", "json"]), "start");
  assert.equal(nbcCommandName(["--verify-on-start-only", "profiles", "create", "secret-name", "--manual-proxy", "--proxy-host", "h"]), "profiles create");
  assert.equal(nbcCommandName(["--runtime", "multilogin", "--multilogin-folder-id", "f1", "mobile", "profiles", "create", "phone", "--json"]), "mobile profiles create");
  assert.equal(nbcCommandName(["profiles", "requests", "approve", "req-123", "--format", "json"]), "profiles requests approve");
  assert.equal(nbcCommandName(["eval", "--profile", "p", "document.cookie"]), "eval");
  assert.equal(nbcCommandName(["https://example.com/?q=1"]), "unknown");
  assert.equal(nbcCommandName(["--version"]), "--version");
  assert.equal(nbcCommandName([]), "(none)");
  assert.equal(expectsJSON(["status", "--format", "json"]), true);
  assert.equal(expectsJSON(["profiles", "list", "--json"]), true);
  assert.equal(expectsJSON(["--help"]), false);
});

test("a successful JSON command is a breadcrumb only", () => {
  const { breadcrumb, event } = describeNbcResult({ args: ["status", "--profile", "p", "--format", "json"], result: { code: 0, stdout: "{\"ok\":true,\"data\":{}}", stderr: "" }, durationMs: 1234 });
  assert.equal(breadcrumb, "status → exit 0 1.2s");
  assert.equal(event, null);
});

test("expected outcomes the UI explains are not reported", () => {
  for (const code of ["VERIFY_BUSY", "PROFILE_NOT_FOUND", "API_KEY_REQUIRED", "PROXY_TRAFFIC_EXHAUSTED", "MULTILOGIN_AUTH_INVALID", "REDDIT_LOGIN_REQUIRED", "MOBILE_UI_NODE_NOT_FOUND"]) {
    const { breadcrumb, event } = describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: envelope(code), stderr: "" } });
    assert.equal(event, null, code);
    assert.ok(breadcrumb.endsWith(code));
  }
  const proxyLaunch = describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: envelope("LAUNCH_FAILED", "net::ERR_TUNNEL_CONNECTION_FAILED"), stderr: "" } });
  assert.equal(proxyLaunch.event, null, "a proxy that refuses the launch is the profile's configuration");
  const signedOut = describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: envelope("REMOTE_BACKEND_ERROR", "backend returned 401 Unauthorized"), stderr: "" } });
  assert.equal(signedOut.event, null);
  const offline = describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: envelope("VERIFY_UNAVAILABLE", "dial tcp: lookup api.nextbrowser.com: no such host"), stderr: "" } });
  assert.equal(offline.event, null, "an offline machine is not an nbc defect");
  const closedBrowser = describeNbcResult({ args: ["tabs", "--profile", "p", "--format", "json"], result: { code: 1, stdout: envelope("CDP_UNREACHABLE"), stderr: "" } });
  assert.equal(closedBrowser.event, null, "a browser the user closed");
  const startUnreachable = describeNbcResult({ args: ["start", "--profile", "p", "--format", "json"], result: { code: 1, stdout: envelope("CDP_UNREACHABLE"), stderr: "" } });
  assert.equal(startUnreachable.event.name, "CDP_UNREACHABLE", "a start that cannot reach its own browser is reported");
});

test("cancellations, timeouts of commands nobody waits on and usage probes are not reported", () => {
  assert.equal(describeNbcResult({ args: ["start", "--format", "json"], result: { code: -1, stdout: "", stderr: "Command cancelled." }, outcome: { cancelled: true } }).event, null);
  for (const args of [["status", "--profile", "p", "--format", "json"], ["tabs", "--format", "json"], ["proxy-traffic", "--format", "json"], ["--version"]]) {
    assert.equal(describeNbcResult({ args, result: { code: -1, stdout: "", stderr: "Command timed out after 15 seconds." }, outcome: { timedOut: true, signal: "SIGTERM" } }).event, null, args.join(" "));
  }
  assert.equal(describeNbcResult({ args: ["update", "--browser-only", "--format", "json"], result: { code: 1, stdout: "", stderr: "Error: unknown flag: --browser-only" } }).event, null);
  assert.equal(describeNbcResult({ args: ["mcp", "--automation-trace-file", "rel"], result: { code: 1, stdout: "", stderr: "automation trace file must be an absolute path" } }).event, null, "text-mode exit 1 is nbc's ordinary error");
});

test("nbc defects and unknown codes are reported with the code and command", () => {
  const { event } = describeNbcResult({
    args: ["--verify-on-start-only", "start", "--profile", "Shop", "--runtime", "clawbrowser", "--format", "json"],
    result: { code: 1, stdout: envelope("INTERNAL_ERROR", "session state corrupt"), stderr: "" },
    durationMs: 5000,
  });
  assert.equal(event.source, "nbc");
  assert.equal(event.kind, "command_failed");
  assert.equal(event.name, "INTERNAL_ERROR");
  assert.equal(event.message, "nbc start: session state corrupt");
  assert.deepEqual(event.context, { command: "start", exit_code: "1", runtime: "clawbrowser", duration_ms: "5000", nbc_code: "INTERNAL_ERROR" });
  assert.ok(!JSON.stringify(event).includes("Shop"), "arguments never reach the report");
  assert.equal(describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: envelope("BRAND_NEW_CODE"), stderr: "" } }).event.name, "BRAND_NEW_CODE");
});

test("crashes, spawn failures and missing JSON are reported", () => {
  const panic = describeNbcResult({
    args: ["profiles", "list", "--format", "json"],
    result: { code: 2, stdout: "", stderr: "panic: runtime error: index out of range [3] with length 3\n\ngoroutine 1 [running]:\nmain.listProfiles(...)\n\t/build/cmd/nbc/profiles.go:120 +0x1d" },
  }).event;
  assert.equal(panic.name, "NBC_CRASH");
  assert.match(panic.message, /index out of range/);
  assert.match(panic.stack, /goroutine 1/);

  const windowsCrash = describeNbcResult({ args: ["status"], result: { code: 3221225477, stdout: "", stderr: "" } }).event;
  assert.equal(windowsCrash.name, "NBC_ABNORMAL_EXIT");
  const killed = describeNbcResult({ args: ["start", "--format", "json"], result: { code: -1, stdout: "", stderr: "" }, outcome: { signal: "SIGKILL" } }).event;
  assert.equal(killed.context.signal, "SIGKILL");

  const spawn = describeNbcResult({ args: ["status"], result: { code: -1, stdout: "", stderr: "spawn ~/nextctl EACCES" }, outcome: { spawnError: true } }).event;
  assert.equal(spawn.name, "NBC_SPAWN_FAILED");

  const garbled = describeNbcResult({ args: ["profiles", "list", "--format", "json"], result: { code: 0, stdout: "<html>page data</html>", stderr: "warning: slow disk" } }).event;
  assert.equal(garbled.name, "NBC_NON_JSON_OUTPUT");
  assert.ok(!garbled.message.includes("page data"), "standard output is never copied into a report");
  assert.match(garbled.message, /warning: slow disk/);
});

test("a verified start is classified by the code nextctl wrapped in VERIFY_FAILED", () => {
  const wrapped = (inner) => envelope("VERIFY_FAILED", `VERIFY_FAILED: browser stopped: ${inner}`);
  const vendor = describeNbcResult({ args: ["--verify-on-start-only", "start", "--profile", "p", "--format", "json"], result: { code: 1, stdout: wrapped("VENDOR_UNAVAILABLE: External browser runtime operation did not complete before timeout (context deadline exceeded)"), stderr: "" } });
  assert.equal(vendor.event.name, "VENDOR_UNAVAILABLE");
  assert.equal(vendor.event.context.nbc_code, "VERIFY_FAILED");
  assert.equal(vendor.event.context.cause_code, "VENDOR_UNAVAILABLE");
  assert.ok(vendor.breadcrumb.endsWith("VERIFY_FAILED(VENDOR_UNAVAILABLE)"));
  assert.equal(describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: wrapped("LAUNCH_FAILED: net::ERR_TUNNEL_CONNECTION_FAILED"), stderr: "" } }).event, null, "the profile's own proxy");
  assert.equal(describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: wrapped("PROXY_TRAFFIC_EXHAUSTED: traffic used up"), stderr: "" } }).event, null, "an expected inner code stays expected");
  assert.equal(describeNbcResult({ args: ["start", "--format", "json"], result: { code: 1, stdout: wrapped("VERIFY_REQUIRED: failed browser checks: webrtc; the profile cannot be used"), stderr: "" } }).event.name, "NBC_VERIFY_FAILED", "VERIFY_REQUIRED is the check itself");
});

test("a failed browser verification is reported unless the profile's own proxy failed", () => {
  const verify = describeNbcResult({ args: ["verify", "--profile", "Shop", "--format", "json"], result: { code: 1, stdout: envelope("VERIFY_FAILED", "Browser verification did not pass"), stderr: "" } });
  assert.equal(verify.event.name, "NBC_VERIFY_FAILED");
  assert.equal(verify.event.context.nbc_code, "VERIFY_FAILED");
  assert.equal(describeNbcResult({ args: ["eval", "--format", "json"], result: { code: 1, stdout: envelope("VERIFY_REQUIRED", "VERIFY_REQUIRED: verification is failed, incomplete, or missing"), stderr: "" } }).event.name, "NBC_VERIFY_FAILED");
  assert.equal(describeNbcResult({ args: ["rotate", "--verify", "--format", "json"], result: { code: 1, stdout: envelope("VERIFY_FAILED", "Proxy country is DE, expected US"), stderr: "" } }).event, null);
  assert.equal(describeNbcResult({ args: ["verify", "--format", "json"], result: { code: 1, stdout: envelope("VERIFY_FAILED", "lookup verify.nextbrowser.com: no such host"), stderr: "" } }).event, null, "offline");
});

test("timeouts of commands the user waits on are reported", () => {
  const timedOut = (args) => describeNbcResult({ args, result: { code: -1, stdout: "", stderr: "Command timed out after 60 seconds." }, outcome: { timedOut: true, signal: "SIGTERM" }, durationMs: 60_012 }).event;
  const start = timedOut(["--verify-on-start-only", "start", "--profile", "Shop", "--runtime", "camoufox", "--format", "json"]);
  assert.equal(start.name, "NBC_TIMEOUT");
  assert.equal(start.message, "nbc start timed out");
  assert.deepEqual(start.context, { command: "start", exit_code: "-1", runtime: "camoufox", signal: "SIGTERM", duration_ms: "60012" });
  assert.ok(!JSON.stringify(start).includes("Shop"));
  for (const args of [["stop", "--format", "json"], ["profiles", "create", "p", "--format", "json"], ["--runtime", "multilogin", "mobile", "profiles", "create", "p", "--json"], ["remote", "--profile", "p", "--format", "json"], ["remote", "close", "id"], ["update"], ["install", "generic", "--format", "json"]]) {
    assert.equal(timedOut(args)?.name, "NBC_TIMEOUT", args.join(" "));
  }
  assert.equal(timedOut(["--verify-on-start-only", "--proxy-safety-file", "", "version", "--help"]).message, "nbc compatibility probe timed out");
});

test("text-mode failures of commands whose failure the user sees are reported", () => {
  const failed = (args, stderr, code = 1) => describeNbcResult({ args, result: { code, stdout: "Downloading nbc 0.2.68…\n", stderr } }).event;
  const update = failed(["update"], "Error: install nbc: unexpected EOF");
  assert.equal(update.name, "NBC_COMMAND_FAILED");
  assert.equal(update.message, "nbc update failed (exit 1): Error: install nbc: unexpected EOF");
  assert.ok(!update.message.includes("Downloading"), "standard output is never copied into a report");
  assert.equal(failed(["profiles", "requests", "reject", "req-1", "--reason", "not my shop"], "Error: request is already approved").context.command, "profiles requests reject");
  assert.equal(failed(["remote", "close", "a1b2"], "Error: remote session close failed: 500").context.command, "remote close");
  assert.equal(failed(["install", "--agent", "codex", "--no-api-key-prompt"], "Error: write skill: permission denied").context.command, "install");
  const probe = failed(["--verify-on-start-only", "--proxy-safety-file", "", "version", "--help"], "Error: unknown flag: --verify-on-start-only");
  assert.equal(probe.name, "NBC_INCOMPATIBLE", "an old nbc is what the probe detects, so its usage error counts");
  assert.match(probe.message, /^nbc compatibility probe failed \(exit 1\): Error: unknown flag/);

  assert.equal(failed(["update"], "Error: Get \"https://github.com/x\": dial tcp: lookup github.com: no such host"), null, "offline");
  assert.equal(failed(["remote", "close", "a1b2"], "Error: unexpected status 401 Unauthorized"), null, "signed out");
  assert.equal(failed(["update", "--browser-only"], "Error: unknown flag: --browser-only"), null, "a probe for an older nbc");
  const busy = "Warning: ClawBrowser is still running in: Clawbrowser profile, Work. Stop these profiles before updating ClawBrowser — updating while a session is live leaves it on the old build.";
  assert.equal(failed(["update"], busy), null, "the update waits for open profiles");
  const busyJSON = describeNbcResult({ args: ["update", "--browser-only", "--format", "json"], result: { code: 1, stdout: JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: busy } }), stderr: "" } });
  assert.equal(busyJSON.event, null);
  assert.equal(busyJSON.breadcrumb, "update → exit 1 INTERNAL_ERROR");
  assert.equal(failed(["skill", "list"], "Error: boom"), null, "other text-mode commands keep exit 1 as nbc's ordinary error");
});

test("text-mode failures never carry the command's arguments", () => {
  const key = describeNbcResult({ args: ["config", "set", "--api-key", "nb_live_SECRETKEY123"], result: { code: 1, stdout: "", stderr: "Error: write config: permission denied" } }).event;
  assert.equal(key.context.command, "config set");
  assert.ok(!JSON.stringify(key).includes("SECRETKEY"));
  const reject = describeNbcResult({ args: ["profiles", "requests", "reject", "req-1", "--reason", "Alice's private shop"], result: { code: 1, stdout: "", stderr: "Error: boom" } }).event;
  assert.ok(!JSON.stringify(reject).includes("Alice"));
});

test("the proxy countries 401 is reported and folds into one report per launch", (t) => {
  const result = { code: 1, stdout: envelope("INTERNAL_ERROR", "unexpected status 401 Unauthorized: {\"code\":\"invalid_auth\",\"message\":\"Invalid JWT\"}"), stderr: "" };
  const first = describeNbcResult({ args: ["proxy", "countries", "--format", "json"], result, durationMs: 412 }).event;
  const second = describeNbcResult({ args: ["proxy", "countries", "--format", "json"], result, durationMs: 388 }).event;
  assert.equal(first.name, "INTERNAL_ERROR");
  assert.equal(first.context.command, "proxy countries");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nbc-fold-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const reporter = createClientErrorReporter({ dir, resolveEndpoint: async () => ({ baseURL: "https://api.test", apiKey: "" }), setTimer: () => null, clearTimer: () => {} });
  assert.equal(reporter.capture(first), true);
  assert.equal(reporter.capture(second), true);
  assert.equal(reporter.queued.length, 1);
  assert.equal(reporter.queued[0].count, 2);
});
