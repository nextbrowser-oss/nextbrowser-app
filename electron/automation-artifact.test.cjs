const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { asCSV, saveAutomationArtifact } = require("./automation-artifact.cjs");
const { createLocalArtifactStore } = require("./local-artifacts.cjs");

test("serializes extracted rows as a quoted CSV table", () => {
  assert.equal(asCSV({ rows: [{ title: "One, two", price: 12 }, { title: 'A "quote"', price: 15 }] }), 'title,price\n"One, two",12\n"A ""quote""",15\n');
});

test("saves the previous result to the local artifact store", async () => {
  const calls = [];
  const artifact = await saveAutomationArtifact({
    action: { tool: "save_artifact", arguments: { source: "last_result", format: "csv", name: "products.csv" } },
    results: [{ index: 0, tool: "extract", ok: true, output: { rows: [{ title: "Book", price: "$10" }] } }],
    workspaceId: "workspace-1",
    runId: "run-1",
    store: { addBytes: async (...args) => { calls.push(args); return { id: "artifact-1", name: args[1] }; } },
  });
  assert.equal(artifact.saved, true);
  assert.equal(calls[0][0], "workspace-1");
  assert.equal(calls[0][1], "products.csv");
  assert.equal(calls[0][2].toString(), "title,price\nBook,$10\n");
  assert.deepEqual(calls[0][3], { contentType: "text/csv; charset=utf-8", runId: "run-1" });
});

test("refuses to create an artifact before a workflow has a result", async () => {
  await assert.rejects(() => saveAutomationArtifact({
    action: { tool: "save_artifact", arguments: {} }, results: [], workspaceId: "workspace-1", store: {},
  }), /no completed workflow result/i);
});

test("persists JSON, CSV, and text through the real local artifact store", async (context) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-artifact-run-"));
  context.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const store = createLocalArtifactStore({ rootDir });
  const previous = { index: 0, tool: "extract", ok: true, output: { rows: [{ title: "Book", price: 10 }] } };
  for (const format of ["json", "csv", "txt"]) {
    const result = await saveAutomationArtifact({
      action: { tool: "save_artifact", arguments: { source: "last_result", format, name: `result.${format}` } },
      results: [previous], workspaceId: "workspace", runId: "run", store,
    });
    const file = await store.resolvePath("workspace", result.artifact.id);
    const contents = await fs.readFile(file, "utf8");
    assert.match(contents, /Book/);
  }
  assert.deepEqual((await store.list("workspace")).map((item) => item.extension).sort(), ["csv", "json", "txt"]);
});
