const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAppSettings, writeFileAtomic } = require("./app-settings.cjs");

const dirs = [];
after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-app-settings-"));
  dirs.push(dir);
  return { dir, file: path.join(dir, "app-settings.json") };
}

test("a missing file reads as empty settings with nothing migrated yet", () => {
  const { file } = tempFile();
  assert.deepEqual(createAppSettings({ file }).snapshot(), {
    migrated: [], values: {}, localStorageProbe: { confirmed: 0, lossReported: false },
  });
});

test("updates merge key by key and survive a restart", async () => {
  const { file } = tempFile();
  const first = createAppSettings({ file });
  await first.update({ values: { theme: "light", activeWorkspaceId: "work" }, migrated: ["theme", "activeWorkspaceId"] });
  // Another window only names the key it changed; the others stay.
  await first.update({ values: { theme: "dark", activeWorkspaceId: null } });
  const restarted = createAppSettings({ file }).snapshot();
  assert.deepEqual(restarted.values, { theme: "dark" });
  assert.deepEqual(restarted.migrated, ["theme", "activeWorkspaceId"]);
});

test("updates that arrive during a write go out together, in order", async () => {
  const { file } = tempFile();
  const settings = createAppSettings({ file });
  const writes = [
    settings.update({ values: { sidebarWidth: "300" } }),
    settings.update({ values: { sidebarWidth: "310" } }),
    settings.update({ values: { sidebarWidth: "320" } }),
  ];
  await Promise.all(writes);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).values.sidebarWidth, "320");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["app-settings.json"], "no temporary files left behind");
});

test("invalid keys and values are ignored, the probe keeps only well-formed fields", async () => {
  const { file } = tempFile();
  const settings = createAppSettings({ file });
  await settings.update({
    values: { "": "x", ["__proto__"]: "y", ok: "1", count: 3, big: "x".repeat(1024 * 1024 + 1) },
    migrated: ["ok", 5, "ok"],
    localStorageProbe: { confirmed: -1, lossReported: true },
  });
  const snapshot = createAppSettings({ file }).snapshot();
  assert.deepEqual(snapshot.values, { ok: "1" });
  assert.deepEqual(snapshot.migrated, ["ok"]);
  assert.deepEqual(snapshot.localStorageProbe, { confirmed: 0, lossReported: true });
});

test("a corrupt file is reported and replaced by the next update instead of breaking the app", async () => {
  const { file } = tempFile();
  fs.writeFileSync(file, "{\"values\": {\"theme\": ");
  const errors = [];
  const settings = createAppSettings({ file, onError: (error) => errors.push(error) });
  assert.deepEqual(settings.snapshot().values, {});
  assert.equal(errors.length, 1);
  await settings.update({ values: { theme: "light" } });
  assert.deepEqual(createAppSettings({ file }).snapshot().values, { theme: "light" });
});

test("an atomic write replaces the file whole and leaves no temporary file", async () => {
  const { dir, file } = tempFile();
  await writeFileAtomic(file, "old");
  await writeFileAtomic(file, "new", { durable: true });
  assert.equal(fs.readFileSync(file, "utf8"), "new");
  assert.deepEqual(fs.readdirSync(dir), ["app-settings.json"]);
});
