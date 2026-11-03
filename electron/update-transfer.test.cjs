const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { downloadUpdateFile } = require("./update-transfer.cjs");
const { checkBrowserRuntimeUpdates, installSelectedRuntimeUpdates } = require("./browser-runtime-updates.cjs");

async function target(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nb-update-transfer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, "staged-download");
}

test("reports measured download progress and writes the complete archive", async (t) => {
  const file = await target(t);
  const progress = [];
  await downloadUpdateFile({ target: file, url: "https://example.test/archive", fetchImpl: async () => new Response(new Uint8Array(100), { headers: { "content-length": "100" } }), onProgress: (p) => progress.push(p) });
  assert.equal((await fs.stat(file)).size, 100);
  assert.equal(progress[0].percent, 0);
  assert.equal(progress.at(-1).percent, 100);
});

test("does not invent percentages for unknown or HTTP-compressed download sizes", async (t) => {
  const file = await target(t);
  for (const headers of [{}, { "content-length": "3", "content-encoding": "gzip" }]) {
    const progress = [];
    await downloadUpdateFile({ target: file, url: "https://example.test/archive", fetchImpl: async () => new Response("decoded body", { headers }), onProgress: (p) => progress.push(p) });
    assert.ok(progress.every((p) => p.percent === undefined));
  }
});

test("aborts a download instead of reporting a partial file as installed", async (t) => {
  const file = await target(t);
  const controller = new AbortController();
  await assert.rejects(downloadUpdateFile({ target: file, url: "https://example.test/archive", signal: controller.signal, fetchImpl: async () => new Response("archive", { headers: { "content-length": "7" } }), onProgress: (p) => { if (p.receivedBytes) controller.abort(); } }), { name: "AbortError" });
});

const updates = {
  status: "ready",
  runtimes: [
    { runtime: "clawbrowser", name: "Clawbrowser", status: "available", latestVersion: "1.0.6" },
    { runtime: "dasbrowser", name: "DasBrowser", status: "available", latestVersion: "150.4" },
  ],
};

test("cancel during a download skips installation and queued components, then refreshes versions", async () => {
  const controller = new AbortController();
  const calls = [];
  let checks = 0;
  const result = await installSelectedRuntimeUpdates({
    requestedRuntimes: ["clawbrowser", "dasbrowser"], signal: controller.signal,
    checkForUpdates: async () => { checks++; return updates; },
    installRuntime: async (runtime, report) => { calls.push(runtime.runtime); report({ phase: "downloading", percent: 25, canCancel: true }); controller.abort(); controller.signal.throwIfAborted(); },
  });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(calls, ["clawbrowser"]);
  assert.equal(checks, 2);
});

test("stop after an unsafe installation keeps the completed component and skips the rest", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await installSelectedRuntimeUpdates({ requestedRuntimes: ["clawbrowser", "dasbrowser"], signal: controller.signal, checkForUpdates: async () => updates, installRuntime: async (runtime, report) => { calls.push(runtime.runtime); report({ phase: "installing", canCancel: false }); controller.abort(); } });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(result.completed, ["clawbrowser"]);
  assert.deepEqual(calls, ["clawbrowser"]);
});

test("a failed component check is preserved when another selected component updates", async () => {
  const result = await installSelectedRuntimeUpdates({ requestedRuntimes: ["clawbrowser", "dasbrowser"], checkForUpdates: async () => ({ ...updates, runtimes: [{ ...updates.runtimes[0], status: "error", error: "Network timeout" }, updates.runtimes[1]] }), installRuntime: async () => {} });
  assert.equal(result.status, "partial");
  assert.equal(result.errors[0].runtime, "clawbrowser");
  assert.deepEqual(result.completed, ["dasbrowser"]);
});

test("retries a failed package/browser installation even if its package version already advanced", async () => {
  const calls = [];
  const result = await installSelectedRuntimeUpdates({ requestedRuntimes: ["camoufox"], retryRuntimes: ["camoufox"], checkForUpdates: async () => ({ status: "ready", runtimes: [{ runtime: "camoufox", name: "Camoufox", status: "up-to-date", currentVersion: "0.5.9", latestVersion: "0.5.9" }] }), installRuntime: async (runtime) => { calls.push(runtime.runtime); } });
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["camoufox"]);
});

test("finds the macOS build in an earlier stable release and preserves the exact tag", async (t) => {
  const file = await target(t);
  const latest = { tag_name: "1.0.11", assets: [{ name: "clawbrowser-win-amd64.zip" }] };
  const older = { tag_name: "v1.0.6", assets: [{ name: "clawbrowser-macos-arm64.tar.gz" }] };
  const fetchImpl = async (url) => {
    if (url.endsWith("/releases/latest")) return Response.json(latest);
    if (url.includes("?per_page=")) return Response.json([{ ...older, tag_name: "1.0.12", prerelease: true }, latest, older]);
    if (url.includes("pypi.org")) return Response.json({ info: { version: "0.5.9" } });
    return new Response('<a href="https://cdn.dasbrowser.com/150.4/setup.exe">Download</a>');
  };
  const result = await checkBrowserRuntimeUpdates({ fetchImpl, runtimeRoot: path.dirname(file), platform: "darwin", arch: "arm64" });
  assert.equal(result.runtimes[0].status, "not-installed");
  assert.equal(result.runtimes[0].latestVersion, "1.0.6");
  assert.match(result.runtimes[0].downloadUrl, /\/v1\.0\.6\/clawbrowser-macos-arm64\.tar\.gz$/);
  assert.match(result.runtimes[0].availabilityMessage, /1.0.11 does not include this platform/);
});

test("a failed release history request stays a check failure, not an unsupported-platform claim", async (t) => {
  const file = await target(t);
  const fetchImpl = async (url) => {
    if (url.endsWith("/releases/latest")) return Response.json({ tag_name: "1.0.11", assets: [] });
    if (url.includes("?per_page=")) return new Response("rate limited", { status: 403 });
    if (url.includes("pypi.org")) return Response.json({ info: { version: "0.5.9" } });
    return new Response('<a href="https://cdn.dasbrowser.com/150.4/setup.exe">Download</a>');
  };
  const result = await checkBrowserRuntimeUpdates({ fetchImpl, runtimeRoot: path.dirname(file), platform: "darwin", arch: "arm64" });
  assert.equal(result.runtimes[0].status, "error");
  assert.equal(result.status, "partial");
});
