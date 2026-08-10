const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  browserInstallArgs,
  requiresBrowserRuntime,
  resolveBrowserRuntime,
} = require("./browser-runtime.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-browser-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("detects a managed macOS Clawbrowser app", (t) => {
  const root = fixture(t);
  const executable = path.join(root, "runtime", "data", "Clawbrowser.app", "Contents", "MacOS", "Clawbrowser");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "#!/bin/sh\n");
  fs.chmodSync(executable, 0o755);
  assert.equal(resolveBrowserRuntime({ platform: "darwin", homeDir: root, env: {}, runtimeRoot: path.join(root, "runtime") }), executable);
});

test("detects a managed Windows Clawbrowser executable", (t) => {
  const root = fixture(t);
  const executable = path.join(root, "runtime", "data", "Application", "clawbrowser.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "binary");
  assert.equal(resolveBrowserRuntime({ platform: "win32", homeDir: root, env: {}, runtimeRoot: path.join(root, "runtime") }), executable);
});

test("uses isolated install paths and never overwrites managed nextctl", () => {
  const args = browserInstallArgs(path.join("tmp", "runtime"));
  assert.deepEqual(args.slice(0, 2), ["install", "generic"]);
  assert.ok(args.includes("--no-api-key-prompt"));
  assert.equal(args[args.indexOf("--bin-dir") + 1], path.join("tmp", "runtime", "installer-bin"));
  assert.equal(args[args.indexOf("--install-root") + 1], path.join("tmp", "runtime", "data"));
});

test("installs lazily only for profile launch operations", () => {
  for (const command of ["start", "setup", "launch", "rotate"]) assert.equal(requiresBrowserRuntime([command]), true);
  for (const command of ["profiles", "status", "stop", "verify"]) assert.equal(requiresBrowserRuntime([command]), false);
});
