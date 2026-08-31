const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensurePtyHelpersExecutable } = require("./ensure-pty-helper.cjs");

test("restores execute permissions for packaged macOS PTY helpers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-pty-"));
  const helper = path.join(root, "node_modules", "node-pty", "prebuilds", "darwin-arm64", "spawn-helper");
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(helper, "helper");
  fs.chmodSync(helper, 0o644);

  assert.deepEqual(ensurePtyHelpersExecutable(root, "darwin"), [helper]);
  assert.equal(fs.statSync(helper).mode & 0o777, 0o755);

  fs.rmSync(root, { recursive: true, force: true });
});

test("does not alter helpers on other platforms", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-pty-"));
  assert.deepEqual(ensurePtyHelpersExecutable(root, "win32"), []);
  fs.rmSync(root, { recursive: true, force: true });
});
