const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAppUpdateDownload } = require("./app-update-download.cjs");

function fixture(download) {
  let status = { status: "available", version: "2.0.0" };
  let calls = 0;
  const start = createAppUpdateDownload({
    supported: () => true,
    getStatus: () => status,
    setStatus: (value, patch) => { status = { status: value, ...patch }; },
    check: async () => { status = { status: "available", version: "2.0.0" }; },
    download: async () => { calls++; await download(); status = { status: "downloaded", version: "2.0.0" }; },
    reportError: (error) => { status = { status: "error", message: error.message }; },
  });
  return { start, status: () => status, calls: () => calls };
}
test("shows progress while the network is silent and coalesces repeated clicks", async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const first = f.start();
  assert.equal(f.start(), first);
  await Promise.resolve();
  assert.deepEqual(f.status(), { status: "downloading", version: "2.0.0", percent: 0 });
  assert.equal(f.calls(), 1);
  finish();
  assert.equal((await first).status, "downloaded");
  await f.start();
  assert.equal(f.calls(), 1);
});
test("reports a download error and permits a fresh retry", async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error("offline"); });
  assert.deepEqual(await f.start(), { status: "error", message: "offline" });
  fail = false;
  assert.equal((await f.start()).status, "downloaded");
  assert.equal(f.calls(), 2);
});
