const assert = require("node:assert/strict");
const test = require("node:test");
const { describeInvokeFailure, describeMainFailure } = require("./invoke-failure-report.cjs");
const { userError } = require("./user-error.cjs");

function fsError(code, syscall, file) {
  const error = new Error(`${code}: no such file or directory, ${syscall} '${file}'`);
  Object.assign(error, { code, syscall, path: file });
  return error;
}

test("a command that throws is reported with its name, code and stack frames", () => {
  const error = fsError("ENOENT", "open", "/Users/alice/Library/Application Support/Nextbrowser/automation-artifacts/Alice Shop/index.json");
  const { event } = describeInvokeFailure({ command: "artifact_list", error });
  assert.equal(event.source, "main");
  assert.equal(event.kind, "command_failed");
  assert.equal(event.name, "ENOENT");
  assert.equal(event.message, "artifact_list: ENOENT: no such file or directory, open '<path>'");
  assert.deepEqual(event.context, { command: "artifact_list", code: "ENOENT" });
  assert.equal(event.fingerprintExtra, "artifact_list");
  assert.match(event.stack, /^Error\n\s+at /);
  assert.ok(!JSON.stringify(event).includes("Alice"), "the file path names the user's workspace");
});

test("the event name is the error's code, else IPC_FAILED", () => {
  const terminal = new Error("Terminal support for “codex-next” is unavailable in the running Nextbrowser 0.2.68 build. [TERMINAL_AGENT_UNAVAILABLE]");
  assert.equal(describeInvokeFailure({ command: "terminal_start", error: terminal }).event.name, "TERMINAL_AGENT_UNAVAILABLE");
  const cli = new Error("VERIFY_REQUIRED: Update the Nextbrowser CLI. This version cannot enforce mandatory browser verification.");
  assert.equal(describeInvokeFailure({ command: "nextctl_run", error: cli }).event.name, "VERIFY_REQUIRED");
  assert.equal(describeInvokeFailure({ command: "remote_signal_open", error: new Error("Remote signaling failed.") }).event.name, "IPC_FAILED");
  assert.equal(describeInvokeFailure({ command: "x", error: "a thrown string" }).event.message, "x: a thrown string");
});

test("a backend 4xx is an api_error with its status", () => {
  const error = Object.assign(new Error("Project sync failed (409)."), { status: 409 });
  const { event } = describeInvokeFailure({ command: "workspace_put", error });
  assert.equal(event.kind, "api_error");
  assert.equal(event.name, "HTTP 409");
  assert.equal(event.message, "workspace_put: Project sync failed (409).");
  assert.deepEqual(event.context, { command: "workspace_put", status: "409" });
  const multilogin = Object.assign(new Error("Multilogin token request failed (502)."), { status: 502 });
  assert.equal(describeInvokeFailure({ command: "multilogin_connect", error: multilogin }).event.name, "HTTP 502", "a third-party 5xx nobody traced");
});

test("user errors, judged errors, cancellations, sign-in and an offline machine are not reported", () => {
  const skipped = {
    "user error": userError("Zoom factor out of range."),
    "already reported": Object.assign(new Error("Nextbrowser could not connect to the service."), { reported: true }),
    "abort": Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
    "cancel": new Error("Command cancelled."),
    "automation cancel": new Error("Automation execution was cancelled."),
    "401": Object.assign(new Error("Project sync failed (401). The account token is not valid for this backend."), { status: 401 }),
    "403": Object.assign(new Error("forbidden"), { status: 403 }),
    "offline fetch": Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" }) }),
    "offline updater": new Error("net::ERR_INTERNET_DISCONNECTED"),
  };
  for (const [label, error] of Object.entries(skipped)) {
    assert.equal(describeInvokeFailure({ command: "workspace_put", error }).event, null, label);
    assert.equal(describeMainFailure({ name: "APP_UPDATE_FAILED", error, context: { phase: "check" } }).event, null, label);
  }
});

test("commands whose errors can echo secrets or contents send no message", () => {
  const proxy = new Error("Proxy socks5://bob:hunter2@10.0.0.7:1080 rejected the credentials for bob");
  const { event } = describeInvokeFailure({ command: "manual_proxy_save", error: proxy });
  assert.equal(event.message, "manual_proxy_save: IPC_FAILED");
  assert.ok(!JSON.stringify(event).includes("bob"));
  assert.ok(!JSON.stringify(event).includes("hunter2"));
  for (const command of ["pairing_poll", "app_data_write", "write_local_skill", "feedback_submit", "read_file", "workspace_file_read", "agent_run", "workflow_author_run", "terminal_input", "multilogin_connect"]) {
    assert.equal(describeInvokeFailure({ command, error: new Error("secret text") }).event.message.includes("secret"), false, command);
  }
});

test("user content leaves the message and the stack", () => {
  const quoted = new Error("Step 2 needs a value for “alice@shop.example” before this automation can run.");
  assert.equal(describeInvokeFailure({ command: "automation_recipe_execute", error: quoted }).event.message, "automation_recipe_execute: Step 2 needs a value for “…” before this automation can run.");
  const url = describeInvokeFailure({ command: "open_external", error: new Error("Failed to open https://shop.example/orders/alice-1234?token=x") }).event;
  assert.equal(url.message, "open_external: Failed to open <url>");
  let parse;
  try { JSON.parse("{\"profile\": \"Alice private\""); } catch (error) { parse = error; }
  const json = describeInvokeFailure({ command: "agent /project/create", error: parse }).event;
  assert.equal(json.message, "agent /project/create: SyntaxError: Expected ',' or '}' after property value in JSON at position 27 (line 1 column 28)");
  assert.ok(!JSON.stringify(json).includes("Alice"), "the stack's first line repeats the message");
  assert.equal(describeInvokeFailure({ command: "Alice's command", error: new Error("x") }).event.context.command, "unknown");
});

test("a failure seen only as a status is reported with its phase", () => {
  const error = new Error("Cannot find latest-mac.yml in the latest release artifacts (https://github.com/nextbrowser-oss/releases/download/v0.2.69/latest-mac.yml): HttpError: 404");
  const { event } = describeMainFailure({ name: "APP_UPDATE_FAILED", error, context: { phase: "check" } });
  assert.equal(event.kind, "command_failed");
  assert.equal(event.name, "APP_UPDATE_FAILED");
  assert.equal(event.message, "APP_UPDATE_FAILED: Cannot find latest-mac.yml in the latest release artifacts (<url>): HttpError: 404");
  assert.deepEqual(event.context, { phase: "check" });
  assert.equal(event.fingerprintExtra, "check");
  const install = describeMainFailure({ name: "BROWSER_RUNTIME_INSTALL_FAILED", error: fsError("EACCES", "mkdir", "/home/alice/x"), context: { runtime: "dasbrowser" } }).event;
  assert.deepEqual(install.context, { runtime: "dasbrowser", code: "EACCES" });
  assert.ok(!install.message.includes("alice"));
});

test("a JavaScript error is reported by class and message, without the values it quotes", () => {
  const thrown = (body) => { try { body(); } catch (error) { return error; } return undefined; };
  const message = (error) => describeInvokeFailure({ command: "agent /profile/start", error }).event.message;
  // What reached the app when Windows PowerShell stripped the quotes of the start command.
  assert.equal(message(thrown(() => JSON.parse("{profile:Clawbrowser"))), "agent /profile/start: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)");
  // JSON.parse quotes the start of its input; only the token it stopped at stays, an invisible one by code point.
  assert.equal(message(thrown(() => JSON.parse("Alice private notes for the agent"))), "agent /profile/start: SyntaxError: Unexpected token 'A', \"…\" is not valid JSON");
  assert.equal(message(thrown(() => JSON.parse("\uFEFF{\"profile\":\"Alice\"}"))), "agent /profile/start: SyntaxError: Unexpected token 'U+FEFF', \"…\" is not valid JSON");
  assert.equal(message(thrown(() => JSON.parse(""))), "agent /profile/start: SyntaxError: Unexpected end of JSON input");
  // A property name the runtime could not read stays; a quoted value goes.
  assert.equal(message(thrown(() => null.rows)), "agent /profile/start: TypeError: Cannot read properties of null (reading 'rows')");
  assert.equal(message(thrown(() => { "use strict"; const name = "Alice"; (function () { "use strict"; name.owner = 1; })(); })), "agent /profile/start: TypeError: Cannot create property 'owner' on string '…'");
  assert.equal(message(Object.assign(new TypeError("fetch failed"), { cause: new Error("socket hang up") })), "agent /profile/start: TypeError: fetch failed");
  const long = message(new RangeError(`Invalid ${"x".repeat(400)}`));
  assert.ok(long.length <= "agent /profile/start: RangeError: ".length + 200, long);
  assert.ok(long.endsWith("…"));
  // An app error keeps its own wording.
  assert.equal(message(new Error("Profile “Alice” is busy")), "agent /profile/start: Profile “…” is busy");
});
