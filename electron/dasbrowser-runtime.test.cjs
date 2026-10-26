const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  adaptDasbrowserArgs,
  dasbrowserAppCopyOptions,
  dasbrowserNotFoundMessage,
  dasbrowserReleaseVersion,
  dasbrowserSetupFailureMessage,
  installedDasbrowserReleaseVersion,
  officialDasbrowserURLFromHTML,
  requestedBrowserRuntime,
  resolveDasbrowserRuntime,
  writeDasbrowserReleaseMarker,
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

test("detects DasBrowser installed by the current Windows setup as chrome.exe", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-dasbrowser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, "AppData", "Local");
  const executable = path.join(local, "Dasbrowser", "Application", "chrome.exe");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, "binary");
  assert.equal(
    resolveDasbrowserRuntime({ platform: "win32", homeDir: root, env: { LOCALAPPDATA: local }, runtimeRoot: path.join(root, "runtime") }),
    path.resolve(executable),
  );
});

test("says what the Windows setup reported and where the app looked when no browser appears", () => {
  const home = path.join(path.sep, "Users", "tomasz");
  const local = path.join(home, "AppData", "Local");
  const env = { LOCALAPPDATA: local, ProgramFiles: path.join(path.sep, "Program Files"), "ProgramFiles(x86)": path.join(path.sep, "Program Files (x86)") };
  const runtimeRoot = path.join(home, "AppData", "Roaming", "NextBrowser", "runtime");
  const message = dasbrowserNotFoundMessage({ platform: "win32", homeDir: home, env, runtimeRoot, setup: { exitCode: 0, durationMs: 14_187 } });
  assert.match(message, /^DasBrowser setup finished with exit code 0 after 14 s, but its browser was not found\./);
  assert.ok(message.includes(path.join("Dasbrowser", "Application", "chrome.exe")), message);
  for (const root of [local, env.ProgramFiles, env["ProgramFiles(x86)"], path.join(runtimeRoot, "data")]) assert.ok(message.includes(root), `${root} missing from: ${message}`);
  assert.ok(message.includes(path.join(local, "Dasbrowser", "DasbrowserUpdater", "updater.log")), message);
  // The exit code and the verdict lead, so the 240-character Settings summary keeps them.
  assert.ok(message.indexOf("not found") < 120);

  const pinned = dasbrowserNotFoundMessage({ platform: "win32", homeDir: home, env: { ...env, DASBROWSER_BIN: path.join(path.sep, "tools", "das.exe") }, runtimeRoot });
  assert.match(pinned, /^DasBrowser was installed, but its browser was not found\./);
  assert.ok(pinned.includes(`DASBROWSER_BIN points to ${path.resolve(path.sep, "tools", "das.exe")}`), pinned);
});

test("lists the macOS locations the app checked", () => {
  // The message names paths the way the host spells them, so the expected
  // locations are built with the host's path module, as the Windows test does.
  const home = path.join(path.sep, "Users", "tomasz");
  const runtimeRoot = path.join(home, ".nextbrowser");
  const message = dasbrowserNotFoundMessage({ platform: "darwin", homeDir: home, env: {}, runtimeRoot });
  assert.ok(message.includes(path.resolve(runtimeRoot, "data", "Dasbrowser.app", "Contents", "MacOS", "Dasbrowser")), message);
  assert.ok(message.includes(path.resolve(path.sep, "Applications", "Dasbrowser.app", "Contents", "MacOS", "Dasbrowser")), message);
});

test("reports the Windows setup exit code instead of a bare installation failure", () => {
  const home = path.join(path.sep, "Users", "tomasz");
  const env = { LOCALAPPDATA: path.join(home, "AppData", "Local") };
  const log = path.join(env.LOCALAPPDATA, "Dasbrowser", "DasbrowserUpdater", "updater.log");
  assert.equal(
    dasbrowserSetupFailureMessage({ exitCode: 2147942405, durationMs: 3_400, output: "", homeDir: home, env }),
    `DasBrowser setup failed with exit code 2147942405 (0x80070005) after 3 s. DasBrowser's setup log: ${log}`,
  );
  assert.match(dasbrowserSetupFailureMessage({ exitCode: -2147024891, durationMs: 0, homeDir: home, env }), /exit code -2147024891 \(0x80070005\)/);
  assert.match(dasbrowserSetupFailureMessage({ exitCode: 1, durationMs: 61_000, output: "\n  Unexpected error\nmore\n", homeDir: home, env }), /^DasBrowser setup failed with exit code 1 after 61 s\. Unexpected error DasBrowser's/);
  assert.match(
    dasbrowserSetupFailureMessage({ exitCode: -1, durationMs: 600_000, output: "Command timed out after 600 seconds.", homeDir: home, env }),
    /^DasBrowser setup did not finish after 600 s: Command timed out after 600 seconds\. /,
  );
  // Without LOCALAPPDATA the log is still named from the home folder.
  assert.ok(dasbrowserSetupFailureMessage({ exitCode: 3, homeDir: home, env: {} }).endsWith(log));
});

test("reads the installed DasBrowser release next to the Windows launcher", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-dasbrowser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const application = path.join(root, "Dasbrowser", "Application");
  const executable = path.join(application, "chrome.exe");
  fs.mkdirSync(path.join(application, "9.0.100.1"), { recursive: true });
  fs.mkdirSync(path.join(application, "151.0.7922.113"), { recursive: true });
  fs.mkdirSync(path.join(application, "150.0.7871.125"), { recursive: true });
  fs.writeFileSync(executable, "binary");
  fs.writeFileSync(path.join(application, "9.0.100.1", "dasbrowser_version.txt"), "9.1");
  fs.writeFileSync(path.join(application, "150.0.7871.125", "dasbrowser_version.txt"), "150.4");
  // A self-update leaves the previous Chromium folder beside the new one.
  fs.writeFileSync(path.join(application, "151.0.7922.113", "dasbrowser_version.txt"), "151.4\r\n");
  assert.equal(await installedDasbrowserReleaseVersion(executable), "151.4");

  fs.writeFileSync(path.join(application, "151.0.7922.113", "dasbrowser_version.txt"), "unknown");
  assert.equal(await installedDasbrowserReleaseVersion(executable), "150.4");
});

test("reports no DasBrowser release when the install has no release file", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-dasbrowser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const application = path.join(root, "Dasbrowser", "Application");
  fs.mkdirSync(path.join(application, "151.0.7922.113"), { recursive: true });
  fs.writeFileSync(path.join(application, "chrome.exe"), "binary");
  assert.equal(await installedDasbrowserReleaseVersion(path.join(application, "chrome.exe")), "");
  assert.equal(await installedDasbrowserReleaseVersion(path.join(root, "missing", "chrome.exe")), "");
  assert.equal(await installedDasbrowserReleaseVersion(""), "");
});

test("adapts the app toolset to nextctl's chromium CDP runtime", () => {
  const args = ["start", "--profile", "work", "--runtime", "dasbrowser", "--format", "json"];
  assert.equal(requestedBrowserRuntime(args), "dasbrowser");
  assert.deepEqual(adaptDasbrowserArgs(args, "/browser"), [
    "start", "--profile", "work", "--runtime", "chromium", "--format", "json", "--runtime-bin", "/browser",
  ]);
  assert.deepEqual(adaptDasbrowserArgs(["status", "--profile", "work", "--runtime", "dasbrowser"], null), [
    "status", "--profile", "work", "--runtime", "chromium",
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

test("records the installed release even when DasBrowser is the first browser installed", async () => {
  // On Windows the setup installs outside the runtime root, so nothing has
  // created <runtimeRoot>/data yet; writing into it used to fail with ENOENT.
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-runtime-"));
  try {
    const file = await writeDasbrowserReleaseMarker(runtimeRoot, {
      version: "144.31",
      url: "https://cdn.dasbrowser.com/144.31/DasbrowserSetup.exe",
      now: new Date("2026-10-23T14:31:45Z"),
    });
    assert.equal(file, path.join(runtimeRoot, "data", ".dasbrowser-browser-release.json"));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      version: "144.31",
      download_url: "https://cdn.dasbrowser.com/144.31/DasbrowserSetup.exe",
      updated_at: "2026-10-23T14:31:45.000Z",
    });
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
