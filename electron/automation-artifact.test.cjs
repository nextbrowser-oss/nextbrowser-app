const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AGENT_ARTIFACT_BODY_LIMIT, normalizeAgentContent, saveAgentArtifact } = require("./agent-artifact.cjs");
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

test("saves only collected datasets without navigation and wait diagnostics", async () => {
  let saved;
  await saveAutomationArtifact({
    action: { tool: "save_artifact", arguments: { source: "data_results", format: "json", name: "research.json" } },
    results: [
      { index: 0, tool: "open", ok: true, output: { url: "https://example.com" } },
      { index: 1, tool: "evaluate", ok: true, output: { result: { name: "Bitcoin", price: "$1" }, session: { name: "default" } } },
      { index: 2, tool: "wait", ok: true, output: { matched: true } },
      { index: 3, tool: "extract", ok: true, output: { rows: [{ rank: 1, name: "Coin" }], count: 1 } },
    ],
    workspaceId: "workspace-1",
    store: { addBytes: async (_workspaceId, _name, bytes) => { saved = JSON.parse(bytes.toString()); return { id: "artifact-1" }; } },
  });
  assert.deepEqual(saved, [{ name: "Bitcoin", price: "$1" }, [{ rank: 1, name: "Coin" }]]);
});

test("refuses to create an artifact before a workflow has a result", async () => {
  await assert.rejects(() => saveAutomationArtifact({
    action: { tool: "save_artifact", arguments: {} }, results: [], workspaceId: "workspace-1", store: {},
  }), /no completed workflow result/i);
});

test("saves chat agent output through the workspace-scoped artifact store", async () => {
  let saved;
  const result = await saveAgentArtifact({
    workspaceId: "workspace-1",
    payload: { name: "cmc-top-trending-coin", format: "json", content: { coin: "Bubblemaps", price: 0.02633 } },
    store: { addBytes: async (workspaceId, name, bytes, options) => {
      saved = { workspaceId, name, text: bytes.toString("utf8"), contentType: options.contentType };
      return { id: "artifact-1", name, size: bytes.length };
    } },
  });
  assert.equal(result.saved, true);
  assert.equal(saved.workspaceId, "workspace-1");
  assert.equal(saved.name, "cmc-top-trending-coin.json");
  assert.deepEqual(JSON.parse(saved.text), { coin: "Bubblemaps", price: 0.02633 });
  assert.equal(saved.contentType, "application/json");
  assert.equal(AGENT_ARTIFACT_BODY_LIMIT, 8 * 1024 * 1024);
});

test("normalizes JSON text from terminal agents into structured JSON", async () => {
  assert.deepEqual(normalizeAgentContent('[{"rank":1,"coin":"Bitlayer"}]', "json"), [{ rank: 1, coin: "Bitlayer" }]);
  assert.equal(normalizeAgentContent("plain text", "json"), "plain text");
  assert.equal(normalizeAgentContent('[{"rank":1}]', "txt"), '[{"rank":1}]');

  let savedText = "";
  await saveAgentArtifact({
    workspaceId: "workspace-1",
    payload: { name: "top-five", format: "json", content: '[{"rank":1,"coin":"Bitlayer"}]' },
    store: { addBytes: async (_workspaceId, name, bytes) => {
      savedText = bytes.toString("utf8");
      return { id: "artifact-1", name, size: bytes.length };
    } },
  });
  assert.deepEqual(JSON.parse(savedText), [{ rank: 1, coin: "Bitlayer" }]);
});

test("requires actual agent content instead of allowing a false saved claim", async () => {
  await assert.rejects(
    saveAgentArtifact({ workspaceId: "workspace-1", payload: { name: "empty" }, store: {} }),
    /content is required/i,
  );
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
