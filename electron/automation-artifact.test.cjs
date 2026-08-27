const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AGENT_ARTIFACT_BODY_LIMIT, normalizeAgentContent, saveAgentArtifact } = require("./agent-artifact.cjs");
const { asCSV, assertArtifactDataContract, buildArtifactDataContract, saveAutomationArtifact } = require("./automation-artifact.cjs");
const { createLocalArtifactStore } = require("./local-artifacts.cjs");

test("serializes extracted rows as a quoted CSV table", () => {
  assert.equal(asCSV({ rows: [{ title: "One, two", price: 12 }, { title: 'A "quote"', price: 15 }] }), 'title,price\n"One, two",12\n"A ""quote""",15\n');
});

test("captures and enforces the saved JSON dataset shape without retaining values", () => {
  const contract = buildArtifactDataContract([
    { rank: 1, name: "Solana", url: "https://coinmarketcap.com/currencies/solana/" },
    { rank: 2, name: "VeChain", url: "https://coinmarketcap.com/currencies/vechain/" },
  ], "json");
  assert.deepEqual(contract, {
    kind: "rows",
    min_rows: 2,
    fields: { rank: "number", name: "non_empty", url: "url" },
  });
  assert.doesNotThrow(() => assertArtifactDataContract({ rows: [
    { rank: 1, name: "Bitcoin", url: "https://example.com/bitcoin" },
    { rank: 2, name: "Ether", url: "https://example.com/ether" },
  ] }, contract));
  assert.throws(() => assertArtifactDataContract({ rows: [
    { rank: 1, name: "Bitcoin", url: "1 Bitcoin BTC $1" },
    { rank: 2, name: "Ether", url: "2 Ether ETH $2" },
  ] }, contract), /valid HTTP or HTTPS URL/);
  assert.equal(JSON.stringify(contract).includes("Solana"), false);
});

test("captures and enforces every named dataset in a combined JSON artifact", () => {
  const contract = buildArtifactDataContract({
    bitcoin: [{ price: "$80,000", url: "https://coinmarketcap.com/currencies/bitcoin/" }],
    trending: [{ name: "Coin", price: "$1" }, { name: "Other", price: "$2" }],
  }, "json");
  assert.deepEqual(contract, {
    kind: "object",
    fields: {
      bitcoin: { kind: "rows", min_rows: 1, fields: { price: "non_empty", url: "url" } },
      trending: { kind: "rows", min_rows: 2, fields: { name: "non_empty", price: "non_empty" } },
    },
  });
  assert.throws(() => assertArtifactDataContract({ bitcoin: [{ price: "$1", url: "https://example.com" }], trending: [] }, contract), /trending/i);
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

test("removes browser session diagnostics from a saved evaluate result", async () => {
  let saved;
  await saveAutomationArtifact({
    action: { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "coins.json" } },
    results: [{ index: 0, tool: "evaluate", ok: true, output: {
      result: [{ rank: 1, name: "Solana" }],
      session: { name: "Worker", endpoint: "http://127.0.0.1:1234" },
    } }],
    workspaceId: "workspace-1",
    store: { addBytes: async (_workspaceId, _name, bytes) => { saved = JSON.parse(bytes.toString()); return { id: "artifact-1" }; } },
  });
  assert.deepEqual(saved, [{ rank: 1, name: "Solana" }]);
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

test("assembles named collected datasets and validates their object contract", async () => {
  let saved;
  const action = { tool: "save_artifact", arguments: {
    source: "data_results", format: "json", name: "combined.json",
    contract: { kind: "object", fields: {
      bitcoin_price_usd: "non_empty",
      trending_coins: { kind: "rows", min_rows: 2, fields: { rank: "number", name: "non_empty" } },
    } },
  } };
  await saveAutomationArtifact({
    action,
    results: [
      { index: 0, tool: "extract", resultKey: "bitcoin_price_usd", ok: true, output: { rows: [{ bitcoin_price_usd: "$80,000" }] } },
      { index: 1, tool: "extract", resultKey: "trending_coins", ok: true, output: { rows: [{ rank: 1, name: "One" }, { rank: 2, name: "Two" }] } },
    ],
    workspaceId: "workspace-1",
    store: { addBytes: async (_workspaceId, _name, bytes) => { saved = JSON.parse(bytes.toString()); return { id: "artifact-1" }; } },
  });
  assert.deepEqual(saved, {
    bitcoin_price_usd: "$80,000",
    trending_coins: [{ rank: 1, name: "One" }, { rank: 2, name: "Two" }],
  });
  await assert.rejects(() => saveAutomationArtifact({
    action,
    results: [{ index: 0, tool: "extract", resultKey: "bitcoin_price_usd", ok: true, output: { rows: [{ bitcoin_price_usd: "$80,000" }] } }],
    workspaceId: "workspace-1", store: {},
  }), /named datasets|trending_coins/i);
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
