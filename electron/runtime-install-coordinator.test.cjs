const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntimeInstallCoordinator } = require("./runtime-install-coordinator.cjs");

const entries = ["clawbrowser", "camoufox", "dasbrowser"].map((runtime) => ({ runtime, name: runtime, status: "not-installed", latestVersion: "1.0.0" }));
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const started = [];
  const controls = new Map();
  const statuses = [];
  const state = { runtimes: structuredClone(entries), status: "ready" };
  const coordinator = createRuntimeInstallCoordinator({
    checkForUpdates: async () => structuredClone(state),
    installRuntime: (update, report, signal) => new Promise((resolve, reject) => {
      started.push(update.runtime);
      controls.set(update.runtime, { report, resolve, reject });
      signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { name: "AbortError" })), { once: true });
    }),
    onStatus: (status) => statuses.push(status),
  });
  return { coordinator, started, controls, statuses, state };
}

test("Download all starts both browsers concurrently and keeps their progress independent", async () => {
  const { coordinator, started, controls, statuses } = fixture();
  const pending = coordinator.install(["clawbrowser", "camoufox"]);
  await tick();
  assert.deepEqual(started, ["clawbrowser", "camoufox"]);
  controls.get("clawbrowser").report({ phase: "downloading", percent: 23, receivedBytes: 23, totalBytes: 100, canCancel: true });
  controls.get("camoufox").report({ phase: "downloading", percent: 68, receivedBytes: 68, totalBytes: 100, canCancel: false });
  assert.deepEqual(coordinator.snapshot().items.map((item) => item.percent), [23, 68]);
  assert.equal(coordinator.snapshot().percent, undefined, "do not combine percentages from different downloads");
  controls.get("clawbrowser").resolve();
  await tick();
  assert.equal(coordinator.isActive(), true);
  assert.deepEqual(coordinator.snapshot().completed, ["clawbrowser"]);
  assert.equal(coordinator.snapshot().items[1].percent, 68);
  controls.get("camoufox").resolve();
  const result = await pending;
  assert.equal(result.status, "ready");
  assert.deepEqual(result.completed, ["clawbrowser", "camoufox"]);
  assert.ok(statuses.every((status, i) => !i || status.updatedAt > statuses[i - 1].updatedAt));
});

test("a second request joins the live batch and duplicate requests reuse the installer", async () => {
  const { coordinator, started, controls } = fixture();
  const first = coordinator.install(["clawbrowser"]);
  await tick();
  const duplicate = coordinator.install(["clawbrowser"]);
  const second = coordinator.install(["camoufox"]);
  await tick();
  assert.deepEqual(started, ["clawbrowser", "camoufox"]);
  controls.get("clawbrowser").resolve();
  assert.equal((await first).status, "installing");
  await duplicate;
  controls.get("camoufox").resolve();
  assert.equal((await second).status, "ready");
});

test("one failed browser can retry while the other download continues", async () => {
  const { coordinator, started, controls } = fixture();
  const first = coordinator.install(["clawbrowser", "camoufox"]);
  await tick();
  controls.get("clawbrowser").reject(new Error("fetch failed"));
  await tick();
  assert.equal(coordinator.snapshot().status, "installing");
  assert.equal(coordinator.snapshot().errors[0].runtime, "clawbrowser");
  const retry = coordinator.install(["clawbrowser"]);
  await tick();
  assert.deepEqual(started, ["clawbrowser", "camoufox", "clawbrowser"]);
  controls.get("clawbrowser").resolve();
  await retry;
  controls.get("camoufox").resolve();
  const result = await first;
  assert.equal(result.status, "ready");
  assert.deepEqual(result.errors, []);
});

test("cancelling one browser leaves the other running and completed installs survive", async () => {
  const { coordinator, controls } = fixture();
  const pending = coordinator.install(["clawbrowser", "camoufox"]);
  await tick();
  coordinator.cancel("clawbrowser");
  await tick();
  assert.equal(coordinator.snapshot().items[0].status, "cancelled");
  assert.equal(coordinator.snapshot().items[1].status, "installing");
  controls.get("camoufox").resolve();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.deepEqual(result.completed, ["camoufox"]);
});

test("already installed browsers are not installed again and check failures stay visible", async () => {
  const { coordinator, state, started } = fixture();
  state.runtimes[0].status = "up-to-date";
  state.runtimes[1].status = "unavailable";
  const result = await coordinator.install(["clawbrowser", "camoufox", "invalid"]);
  assert.deepEqual(started, []);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.completed, ["clawbrowser"]);
  assert.equal(result.errors[0].runtime, "camoufox");
});

test("a network failure in the check is reported without blocking future installs", async () => {
  const coordinator = createRuntimeInstallCoordinator({ checkForUpdates: async () => { throw new Error("Network timeout"); } });
  assert.equal((await coordinator.install(["clawbrowser", "camoufox"])).status, "failed");
  assert.equal(coordinator.isActive(), false);
  assert.equal((await coordinator.install(["camoufox"])).errors.length, 1);
});
