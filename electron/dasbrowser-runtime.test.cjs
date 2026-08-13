const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  adaptDasbrowserArgs,
  requestedBrowserRuntime,
  resolveDasbrowserRuntime,
} = require("./dasbrowser-runtime.cjs");

test("detects the managed macOS DasBrowser executable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-dasbrowser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "runtime", "data", "Dasbrowser.app", "Contents", "MacOS", "Dasbrowser");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "#!/bin/sh\n");
  fs.chmodSync(executable, 0o755);
  assert.equal(resolveDasbrowserRuntime({ platform: "darwin", homeDir: root, env: {}, runtimeRoot: path.join(root, "runtime") }), executable);
});

test("adapts the app toolset to nextctl's chromium CDP runtime", () => {
  const args = ["start", "--profile", "work", "--runtime", "dasbrowser", "--format", "json"];
  assert.equal(requestedBrowserRuntime(args), "dasbrowser");
  assert.deepEqual(adaptDasbrowserArgs(args, "/browser"), [
    "start", "--profile", "work", "--runtime", "chromium", "--format", "json", "--runtime-bin", "/browser",
  ]);
});
