const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertRuntimeReleaseVersion,
  checkBrowserRuntimeUpdates,
  clawbrowserReleaseAsset,
  classifyRuntimeUpdateFailure,
  compareVersions,
  installedCamoufoxVersion,
  installSelectedRuntimeUpdates,
  installRuntimeUpdateWithVerification,
  runtimeResult,
  selectAvailableRuntimeUpdates,
} = require("./browser-runtime-updates.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-runtime-updates-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("compares release versions numerically", () => {
  assert.equal(compareVersions("v1.0.4", "1.0.3"), 1);
  assert.equal(compareVersions("0.5.4", "0.5.5"), -1);
  assert.equal(compareVersions("144.32", "144.32.0"), 0);
  assert.equal(compareVersions("1.0.4-beta.1", "1.0.4"), -1);
  assert.equal(compareVersions("1.0.4-rc.2", "1.0.4-rc.10"), -1);
  assert.equal(compareVersions("1.0.4+mac.1", "1.0.4+mac.2"), 0);
});

test("accepts release versions but rejects command-like package values", () => {
  assert.equal(assertRuntimeReleaseVersion("v0.5.5"), "0.5.5");
  assert.equal(assertRuntimeReleaseVersion("1.0.4-beta.1"), "1.0.4-beta.1");
  assert.throws(() => assertRuntimeReleaseVersion("0.5.5; rm -rf /"), /invalid version/);
});

test("builds official platform release URLs without using the GitHub API", () => {
  assert.deepEqual(clawbrowserReleaseAsset("darwin", "arm64", "1.0.4"), {
    assetName: "clawbrowser-macos-arm64.tar.gz",
    kind: "tar",
    url: "https://github.com/clawbrowser/clawbrowser/releases/download/1.0.4/clawbrowser-macos-arm64.tar.gz",
    version: "1.0.4",
  });
  assert.equal(clawbrowserReleaseAsset("win32", "x64", "1.0.4").assetName, "clawbrowser-win-amd64.zip");
  assert.throws(() => clawbrowserReleaseAsset("darwin", "x64", "1.0.4"), /not available/);
});

test("installs only explicitly confirmed updates that are still available", () => {
  const status = {
    runtimes: [
      { runtime: "clawbrowser", status: "available" },
      { runtime: "camoufox", status: "not-installed" },
      { runtime: "dasbrowser", status: "up-to-date" },
    ],
  };
  assert.deepEqual(selectAvailableRuntimeUpdates(status, ["clawbrowser", "camoufox", "invented"]), [status.runtimes[0]]);
  assert.deepEqual(selectAvailableRuntimeUpdates(status, []), []);
});

test("continues all confirmed toolset updates when one of three fails", async () => {
  const available = {
    runtimes: [
      { runtime: "clawbrowser", name: "ClawBrowser", latestVersion: "1.0.4", status: "available" },
      { runtime: "camoufox", name: "Camoufox", latestVersion: "0.5.5", status: "available" },
      { runtime: "dasbrowser", name: "DasBrowser", latestVersion: "144.32", status: "available" },
    ],
  };
  const calls = [];
  const statuses = [];
  let checks = 0;
  const result = await installSelectedRuntimeUpdates({
    requestedRuntimes: ["clawbrowser", "camoufox", "dasbrowser"],
    checkForUpdates: async () => { checks += 1; return available; },
    installRuntime: async (runtime) => {
      calls.push(runtime.runtime);
      if (runtime.runtime === "camoufox") throw new Error("Package mirror timed out");
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(calls, ["clawbrowser", "camoufox", "dasbrowser"]);
  assert.equal(checks, 2);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.completed, ["clawbrowser", "dasbrowser"]);
  assert.deepEqual(result.errors, [{
    runtime: "camoufox",
    name: "Camoufox",
    releasePage: undefined,
    code: "UPDATE_NETWORK",
    category: "Connection problem",
    retryable: true,
    message: "Package mirror timed out",
    recovery: "Keep NextBrowser open and check your internet connection, then retry.",
  }]);
  assert.equal(result.progress, 100);
  assert.equal(statuses.at(-1).message, "Some browser toolsets were updated, but others need attention.");
});

test("classifies recovery guidance without exposing an opaque raw failure", () => {
  assert.equal(classifyRuntimeUpdateFailure(new Error("ENOSPC: no space left on device")).code, "UPDATE_DISK_SPACE");
  assert.equal(classifyRuntimeUpdateFailure(new Error("EACCES permission denied")).code, "UPDATE_PERMISSION");
  assert.equal(classifyRuntimeUpdateFailure(new Error("runtime is locked by a running browser")).code, "UPDATE_RUNTIME_IN_USE");
  assert.equal(classifyRuntimeUpdateFailure(new Error("fetch failed: ETIMEDOUT")).code, "UPDATE_NETWORK");
  assert.equal(classifyRuntimeUpdateFailure(new Error("bad release payload")).code, "UPDATE_UNKNOWN");
});

test("retries once when a CLI self-update completes before the browser runtime changes", async () => {
  let installs = 0;
  const installed = await installRuntimeUpdateWithVerification({
    label: "ClawBrowser",
    expectedVersion: "1.0.4",
    attempts: 2,
    install: async () => { installs += 1; },
    readInstalledVersion: async () => installs === 1 ? "1.0.3" : "1.0.4",
  });
  assert.equal(installed, "1.0.4");
  assert.equal(installs, 2);
});

test("does not report success when the installed runtime version stays stale", async () => {
  await assert.rejects(installRuntimeUpdateWithVerification({
    label: "ClawBrowser",
    expectedVersion: "1.0.4",
    attempts: 2,
    install: async () => undefined,
    readInstalledVersion: async () => "1.0.3",
  }), /installed runtime version is still 1\.0\.3/);
});

test("detects a Camoufox package in Unix site-packages", async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "sessions", "_camoufox", "venv", "lib", "python3.13", "site-packages", "camoufox-0.5.4.dist-info"), { recursive: true });
  assert.equal(await installedCamoufoxVersion(root), "0.5.4");
});

test("marks only older installed runtimes as updateable", () => {
  const source = { runtime: "clawbrowser", name: "ClawBrowser", releasePage: "https://example.com" };
  assert.equal(runtimeResult(source, "1.0.3", "1.0.4").status, "available");
  assert.equal(runtimeResult(source, "1.0.4", "1.0.4").status, "up-to-date");
  assert.equal(runtimeResult(source, "", "1.0.4").status, "not-installed");
  assert.equal(runtimeResult(source, "", "1.0.4", "", true).status, "unknown");
});

test("checks every runtime independently and preserves partial results", async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", ".clawbrowser-browser-release.json"), JSON.stringify({ version: "1.0.3" }));
  const fetchImpl = async (url) => {
    if (url.includes("api.github.com")) return { ok: true, json: async () => ({ tag_name: "1.0.4" }) };
    if (url.includes("pypi.org")) return { ok: false, status: 503 };
    return { ok: true, text: async () => '<a href="https://cdn.dasbrowser.com/144.32/DasbrowserSetup.exe">Download</a>' };
  };
  const result = await checkBrowserRuntimeUpdates({ fetchImpl, runtimeRoot: root, readDasbrowserVersion: async () => "144.31" });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.runtimes.map(({ runtime, status }) => [runtime, status]), [
    ["clawbrowser", "available"],
    ["camoufox", "error"],
    ["dasbrowser", "available"],
  ]);
});

test("falls back to the official latest-release redirect when GitHub API is rate limited", async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", ".clawbrowser-browser-release.json"), JSON.stringify({ version: "1.0.4" }));
  const fetchImpl = async (url) => {
    if (url.includes("api.github.com")) return { ok: false, status: 403 };
    if (url.includes("github.com/clawbrowser/clawbrowser/releases/latest")) {
      return { ok: true, url: "https://github.com/clawbrowser/clawbrowser/releases/tag/1.0.4", text: async () => "" };
    }
    if (url.includes("pypi.org")) return { ok: true, json: async () => ({ info: { version: "0.5.5" } }) };
    return { ok: true, text: async () => '<a href="https://cdn.dasbrowser.com/144.32/DasbrowserSetup.exe">Download</a>' };
  };
  const result = await checkBrowserRuntimeUpdates({ fetchImpl, runtimeRoot: root, readDasbrowserVersion: async () => "144.32" });
  assert.equal(result.runtimes[0].status, "up-to-date");
  assert.equal(result.runtimes[0].latestVersion, "1.0.4");
});
