const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  adaptDasbrowserArgs,
  dasbrowserAppCopyOptions,
  dasbrowserReleaseVersion,
  officialDasbrowserURLFromHTML,
  requestedBrowserRuntime,
  resolveDasbrowserRuntime,
} = require("./dasbrowser-runtime.cjs");

test("derives the macOS download from the official Windows release channel", () => {
  const html = '<a href="https://cdn.dasbrowser.com/144.32/DasbrowserSetup.exe">Download</a>';
  assert.equal(officialDasbrowserURLFromHTML(html, "darwin"), "https://cdn.dasbrowser.com/144.32/dasbrowser.dmg");
  assert.equal(dasbrowserReleaseVersion(officialDasbrowserURLFromHTML(html, "darwin")), "144.32");
});

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

test("copies macOS app bundles without resolving their relative framework symlinks", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-dasbrowser-copy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source", "Dasbrowser.app", "Contents", "Frameworks", "Browser.framework");
  const target = path.join(root, "target", "Dasbrowser.app");
  fs.mkdirSync(path.join(source, "Versions", "1"), { recursive: true });
  fs.symlinkSync("1", path.join(source, "Versions", "Current"));

  await fs.promises.cp(path.join(root, "source", "Dasbrowser.app"), target, dasbrowserAppCopyOptions());

  assert.equal(
    fs.readlinkSync(path.join(target, "Contents", "Frameworks", "Browser.framework", "Versions", "Current")),
    "1",
  );
});
