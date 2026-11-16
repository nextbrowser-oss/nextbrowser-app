const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { RESET_MARKER, deleteCloudWorkspaces, finishPendingWorkspaceReset } = require("./workspace-reset.cjs");

test("deletes the complete cloud list and checks that no workspace remains", async () => {
  const workspaces = [{ id: "known" }, { id: "cloud-only" }, { id: "already-deleted" }];
  const removed = [];
  await deleteCloudWorkspaces({
    list: async () => ({ workspaces: [...workspaces] }),
    remove: async id => {
      removed.push(id);
      workspaces.splice(workspaces.findIndex(item => item.id === id), 1);
      if (id === "already-deleted") throw Object.assign(new Error("Not found"), { status: 404 });
    },
  });
  assert.deepEqual(removed, ["known", "cloud-only", "already-deleted"]);
  await assert.rejects(deleteCloudWorkspaces({ list: async () => ({ workspaces: [{ id: "still-present" }] }), remove: async () => {} }), /remain/);
});

test("clears only Nextbrowser roots and leaves a signed-out config after restart", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-reset-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const userData = path.join(root, "app");
  const runtime = path.join(root, "runtime");
  const nextctl = path.join(root, "cli");
  const workspace = path.join(root, "workspace");
  for (const dir of [userData, runtime, nextctl, workspace]) {
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "sample"), "test");
  }
  await fs.writeFile(path.join(root, "unrelated"), "keep");
  await fs.writeFile(path.join(userData, RESET_MARKER), "pending");
  const paths = { userData, sessionData: userData, runtime, nextctl, workspace, protectedRoots: [root] };
  await assert.rejects(finishPendingWorkspaceReset({ ...paths, workspace: root }), /shared directory/);
  assert.equal(await fs.readFile(path.join(workspace, "sample"), "utf8"), "test");
  await finishPendingWorkspaceReset(paths);
  assert.deepEqual(await fs.readdir(userData), []);
  assert.deepEqual(await fs.readdir(workspace), []);
  assert.deepEqual(await fs.readdir(nextctl), []);
  assert.deepEqual(await fs.readdir(runtime), ["config"]);
  assert.equal(await fs.readFile(path.join(runtime, "config", "config.json"), "utf8"), "{}");
  assert.equal(await fs.readFile(path.join(root, "unrelated"), "utf8"), "keep");
});
