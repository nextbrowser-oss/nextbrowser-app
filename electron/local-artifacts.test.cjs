const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MAX_ARTIFACT_BYTES, createLocalArtifactStore, workspaceKey } = require("./local-artifacts.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-artifacts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let sequence = 0;
  return {
    root,
    store: createLocalArtifactStore({
      rootDir: path.join(root, "store"),
      now: () => Date.UTC(2026, 7, 21, 12, 0, sequence++),
      makeId: () => `artifact-${sequence++}`,
    }),
  };
}

test("imports a durable local copy instead of retaining the source path", async (t) => {
  const { root, store } = await fixture(t);
  const source = path.join(root, "report.txt");
  await fs.writeFile(source, "local report");
  const imported = await store.importFile("workspace-one", source);
  await fs.rm(source);

  assert.equal(imported.name, "report.txt");
  assert.equal(imported.extension, "txt");
  assert.equal(imported.size, 12);
  assert.equal(imported.expiresAt, undefined);
  assert.equal((await store.list("workspace-one")).length, 1);
  assert.equal(await fs.readFile(await store.resolvePath("workspace-one", imported.id), "utf8"), "local report");
});

test("keeps artifacts isolated by workspace and deletes both bytes and metadata", async (t) => {
  const { store } = await fixture(t);
  const first = await store.addBytes("workspace-one", "result.json", "one");
  await store.addBytes("workspace-two", "result.json", "two");

  assert.deepEqual((await store.list("workspace-one")).map((item) => item.name), ["result.json"]);
  assert.equal(await fs.readFile(await store.resolvePath("workspace-one", first.id), "utf8"), "one");
  assert.deepEqual(await store.delete("workspace-one", first.id), { deleted: true });
  assert.deepEqual(await store.list("workspace-one"), []);
  await assert.rejects(store.resolvePath("workspace-one", first.id), /no longer exists/);
  assert.equal((await store.list("workspace-two")).length, 1);
});

test("removes stale metadata when an artifact file is deleted outside the app", async (t) => {
  const { store } = await fixture(t);
  const artifact = await store.addBytes("workspace", "external-delete.json", "{}");
  await fs.rm(await store.resolvePath("workspace", artifact.id));

  assert.deepEqual(await store.list("workspace"), []);
  await assert.rejects(store.resolvePath("workspace", artifact.id), /no longer exists/);
});

test("delete remains successful when the artifact bytes are already missing", async (t) => {
  const { store } = await fixture(t);
  const artifact = await store.addBytes("workspace", "already-gone.json", "{}");
  await fs.rm(await store.resolvePath("workspace", artifact.id));

  assert.deepEqual(await store.delete("workspace", artifact.id), { deleted: true });
  assert.deepEqual(await store.list("workspace"), []);
});

test("seeds two local examples once even when calls overlap", async (t) => {
  const { store } = await fixture(t);
  const [first, second] = await Promise.all([store.seedExamples("workspace"), store.seedExamples("workspace")]);
  assert.deepEqual([first, second], [2, 0]);
  assert.deepEqual((await store.list("workspace")).map((item) => item.name).sort(), ["automation-run-demo.json", "product-research-demo.csv"]);
});

test("rejects files above 1 GiB before copying them", async (t) => {
  const { root, store } = await fixture(t);
  const source = path.join(root, "large.bin");
  await fs.writeFile(source, "x");
  await fs.truncate(source, MAX_ARTIFACT_BYTES + 1);
  await assert.rejects(store.importFile("workspace", source), /larger than 1 GiB/);
  assert.deepEqual(await store.list("workspace"), []);
});

test("sanitizes names and does not expose workspace identifiers in directory names", async (t) => {
  const { root, store } = await fixture(t);
  const artifact = await store.addBytes("private/workspace", "../unsafe?.txt", "safe");
  const resolved = await store.resolvePath("private/workspace", artifact.id);
  assert.equal(artifact.name, "unsafe-.txt");
  assert.ok(resolved.startsWith(path.join(root, "store", workspaceKey("private/workspace"))));
  assert.equal(resolved.includes("private/workspace"), false);
});

test("validates saved JSON data instead of accepting null-only artifacts", async (t) => {
  const { store } = await fixture(t);
  const empty = await store.addBytes("workspace", "empty.json", JSON.stringify({ result: [
    { name: null, price: null },
    { name: null, price: null },
  ], session: { name: "default" } }));
  const complete = await store.addBytes("workspace", "complete.json", JSON.stringify([
    { name: "Alpha", price: "$1" },
    { name: "Beta", price: "$2" },
  ]));
  const malformed = await store.addBytes("workspace", "broken.json", "{not-json");

  assert.deepEqual(await store.validate("workspace", empty.id), {
    valid: false,
    reason: "The JSON artifact contains only empty or null values.",
  });
  assert.deepEqual(await store.validate("workspace", complete.id), { valid: true });
  assert.deepEqual(await store.validate("workspace", malformed.id), {
    valid: false,
    reason: "The artifact is not valid JSON.",
  });
});
