const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const {
  cancelAutomationRecipe,
  executeAutomationRecipe,
  expandTemplates,
  resolveSemanticAction,
  toolCalls,
  validateRecipe,
} = require("./automation-runner.cjs");
const {
  asCSV,
  assertArtifactDataContract,
  buildArtifactDataContract,
  saveAutomationArtifact,
  serializeArtifact,
} = require("./automation-artifact.cjs");

function fakeMCP(handler) {
  const calls = [];
  let processes = 0;
  const spawnImpl = () => {
    processes += 1;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const message = JSON.parse(chunk.toString());
        if (message.id) {
          calls.push(message);
          Promise.resolve(handler(message)).then((result) => child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`));
        }
        callback();
      },
    });
    child.kill = () => { child.stdin.destroy(); queueMicrotask(() => child.emit("close", 0)); return true; };
    return child;
  };
  return { calls, spawnImpl, get processes() { return processes; } };
}

const ok = (value = { ok: true }) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const initializeOr = (message, value) => message.method === "initialize"
  ? { protocolVersion: "2025-03-26", capabilities: {} }
  : value;
const oneStep = (id, action, server, extra = {}) => executeAutomationRecipe({ executionId: id, recipe: { version: 1, actions: [action] } }, {
  binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {}, ...extra,
});

const cases = [
  ["QA-011 rejects an empty recipe", () => assert.throws(() => validateRecipe({ version: 1, actions: [] }), /no browser steps/i)],
  ["QA-012 rejects more than one hundred steps", () => assert.throws(() => validateRecipe({ version: 1, actions: Array.from({ length: 101 }, () => ({ tool: "wait", arguments: {} })) }), /at most 100/i)],
  ["QA-013 rejects malformed actions", () => assert.throws(() => validateRecipe({ version: 1, actions: [{ tool: "open" }] }), /not a valid browser action/i)],
  ["QA-014 expands an exact numeric parameter without stringifying it", () => assert.equal(expandTemplates("{{limit}}", { limit: 5 }), 5)],
  ["QA-015 expands embedded parameters inside nested arguments", () => assert.deepEqual(expandTemplates({ query: "top {{count}} {{kind}}", nested: ["{{count}}"] }, { count: 5, kind: "coins" }), { query: "top 5 coins", nested: [5] })],
  ["QA-016 strips sender profile bindings from replay calls", () => assert.deepEqual(toolCalls({ tool: "open", arguments: { url: "https://example.com", profile: "Sender" } }), [{ name: "open", arguments: { url: "https://example.com" } }])],
  ["QA-017 maps the recorded navigate alias to open", () => assert.equal(toolCalls({ tool: "navigate", arguments: { url: "https://example.com" } })[0].name, "open")],
  ["QA-018 converts a generic recorded fill action to deterministic input", () => assert.equal(toolCalls({ tool: "act", arguments: { tool: "fill", selector: "input", text: "hello" } })[0].name, "evaluate")],
  ["QA-019 rejects an unsupported deterministic tool", () => assert.throws(() => toolCalls({ tool: "unknown", arguments: {} }), /not supported/i)],
  ["QA-020 requires a deterministic pagination strategy", () => assert.throws(() => toolCalls({ tool: "paginate_extract", arguments: { container: ".row", fields: { title: { selector: ".title" } } } }), /Next button selector or scrolling/i)],

  ["QA-021 allows a read-only title evaluation", () => assert.equal(toolCalls({ tool: "evaluate", arguments: { expression: "document.title" } })[0].name, "evaluate")],
  ["QA-022 rejects cookie access in a saved page script", () => assert.throws(() => toolCalls({ tool: "evaluate", arguments: { expression: "document.cookie" } }), /cannot be replayed safely/i)],
  ["QA-023 rejects local storage access in a saved page script", () => assert.throws(() => toolCalls({ tool: "evaluate", arguments: { expression: "localStorage.getItem('x')" } }), /cannot be replayed safely/i)],
  ["QA-024 rejects arbitrary network fetches in a saved page script", () => assert.throws(() => toolCalls({ tool: "evaluate", arguments: { expression: "fetch('https://other.example')" } }), /cannot be replayed safely/i)],
  ["QA-025 allows an explicit same-page read-only fetch", () => assert.equal(toolCalls({ tool: "evaluate", arguments: { expression: "fetch(location.href,{cache:'no-store'}).then(r=>r.text())" } })[0].name, "evaluate")],
  ["QA-026 repairs an omitted URL selector to a relative anchor", () => assert.deepEqual(toolCalls({ tool: "extract", arguments: { container: ".row", fields: { url: {} }, transform: { url: "url" } } })[0].arguments.fields.url, { selector: "a[href]", attribute: "href" })],
  ["QA-027 keeps the required row contract local to NextBrowser", () => assert.equal(Object.hasOwn(toolCalls({ tool: "extract", arguments: { container: ".row", fields: { title: {} }, required_rows: 5 } })[0].arguments, "required_rows"), false)],
  ["QA-028 accepts populated HTTPS URLs", () => assert.doesNotThrow(() => assertArtifactDataContract([{ title: "One", url: "https://example.com/one" }], { kind: "rows", min_rows: 1, fields: { title: "non_empty", url: "url" } }))],
  ["QA-029 rejects javascript URLs in artifacts", () => assert.throws(() => assertArtifactDataContract([{ title: "One", url: "javascript:alert(1)" }], { kind: "rows", min_rows: 1, fields: { title: "non_empty", url: "url" } }), /valid HTTP or HTTPS URL/i)],
  ["QA-030 rejects null-only replay datasets", () => assert.throws(() => assertArtifactDataContract([{ title: null }], { kind: "rows", min_rows: 1, fields: { title: "non_empty" } }), /missing a populated/i)],

  ["QA-031 quotes commas and quotes in CSV artifacts", () => assert.equal(asCSV([{ value: 'one,"two"' }]), 'value\n"one,""two"""\n')],
  ["QA-032 derives a reusable row contract without retaining values", () => assert.deepEqual(buildArtifactDataContract(JSON.stringify([{ rank: 1, name: "BTC", url: "https://example.com" }]), "json"), { kind: "rows", min_rows: 1, fields: { rank: "number", name: "non_empty", url: "url" } })],
  ["QA-033 derives nested named-dataset contracts", () => { const contract = buildArtifactDataContract(JSON.stringify({ bitcoin: [{ price: "$1" }], trending: [{ name: "Coin" }] }), "json"); assert.equal(contract.kind, "object"); assert.equal(contract.fields.bitcoin.kind, "rows"); }],
  ["QA-034 serializes JSON with the correct content type", () => assert.equal(serializeArtifact([{ ok: true }], "json").contentType, "application/json")],
  ["QA-035 serializes text without JSON quoting", () => assert.equal(serializeArtifact("hello", "txt").bytes.toString(), "hello")],
  ["QA-036 serializes CSV as a real table", () => assert.match(serializeArtifact([{ name: "BTC" }], "csv").bytes.toString(), /^name\nBTC\n$/)],
  ["QA-037 saves only the last successful result by default", async () => { let saved; await saveAutomationArtifact({ action: { arguments: { name: "last.json", format: "json" } }, results: [{ index: 0, tool: "evaluate", ok: true, output: [{ value: 1 }] }, { index: 1, tool: "evaluate", ok: true, output: [{ value: 2 }] }], workspaceId: "w", store: { addBytes: async (_w, _n, bytes) => { saved = JSON.parse(bytes); return { name: "last.json" }; } } }); assert.deepEqual(saved, [{ value: 2 }]); }],
  ["QA-038 assembles named data results for multi-source workflows", async () => { let saved; await saveAutomationArtifact({ action: { arguments: { name: "all.json", format: "json", source: "data_results" } }, results: [{ index: 0, tool: "evaluate", ok: true, resultKey: "bitcoin", output: [{ bitcoin: "$1" }] }, { index: 1, tool: "extract", ok: true, resultKey: "trending", output: { rows: [{ name: "Coin" }] } }], workspaceId: "w", store: { addBytes: async (_w, _n, bytes) => { saved = JSON.parse(bytes); return { name: "all.json" }; } } }); assert.deepEqual(saved, { bitcoin: "$1", trending: [{ name: "Coin" }] }); }],
  ["QA-039 preserves step provenance for run_results artifacts", async () => { let saved; await saveAutomationArtifact({ action: { arguments: { name: "run.json", format: "json", source: "run_results" } }, results: [{ index: 4, tool: "evaluate", ok: true, output: { value: 1 } }], workspaceId: "w", store: { addBytes: async (_w, _n, bytes) => { saved = JSON.parse(bytes); return { name: "run.json" }; } } }); assert.deepEqual(saved, [{ step: 5, tool: "evaluate", output: { value: 1 } }]); }],
  ["QA-040 refuses an artifact step before any successful result", async () => assert.rejects(saveAutomationArtifact({ action: { arguments: {} }, results: [], workspaceId: "w", store: {} }), /no completed workflow result/i)],

  ["QA-041 retries a transient SSL navigation error", async () => { let opens = 0; const server = fakeMCP((m) => initializeOr(m, m.params.name === "open" && opens++ === 0 ? { isError: true, content: [{ type: "text", text: "ERR_SSL_PROTOCOL_ERROR" }] } : ok())); assert.equal((await oneStep("matrix-ssl", { tool: "open", arguments: { url: "https://example.com" } }, server)).status, "completed"); assert.equal(opens, 2); }],
  ["QA-042 retries a temporary navigation deadline", async () => { let opens = 0; const server = fakeMCP((m) => initializeOr(m, m.params.name === "open" && opens++ === 0 ? { isError: true, content: [{ type: "text", text: "context deadline exceeded" }] } : ok())); assert.equal((await oneStep("matrix-deadline", { tool: "open", arguments: { url: "https://example.com" } }, server)).status, "completed"); assert.equal(opens, 2); }],
  ["QA-043 continues after a readiness hint races with navigation", async () => { const server = fakeMCP((m) => initializeOr(m, m.params.name === "wait" ? { isError: true, content: [{ type: "text", text: "Inspected target navigated or closed" }] } : ok({ result: [{ title: "Ready" }] }))); const result = await executeAutomationRecipe({ executionId: "matrix-race", recipe: { version: 1, actions: [{ tool: "wait", arguments: { selector: ".ready" } }, { tool: "evaluate", arguments: { expression: "[{title:document.title}]" } }] } }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} }); assert.equal(result.status, "completed"); }],
  ["QA-044 waits for temporarily incomplete dynamic page data", async () => { let reads = 0; const server = fakeMCP((m) => initializeOr(m, m.params.name === "evaluate" && reads++ === 0 ? { isError: true, content: [{ type: "text", text: "Expected at least 5 populated rows" }] } : ok({ result: [{ title: "Ready" }] }))); assert.equal((await oneStep("matrix-data-retry", { tool: "evaluate", arguments: { expression: "[{title:document.title}]" } }, server)).status, "completed"); assert.equal(reads, 2); }],
  ["QA-045 does not retry a permanent DNS navigation failure", async () => { let opens = 0; const server = fakeMCP((m) => initializeOr(m, m.params.name === "open" ? (opens++, { isError: true, content: [{ type: "text", text: "ERR_NAME_NOT_RESOLVED" }] }) : ok())); assert.equal((await oneStep("matrix-permanent", { tool: "open", arguments: { url: "https://invalid.example" } }, server)).status, "failed"); assert.equal(opens, 1); }],
  ["QA-046 honors Stop before the browser process starts", async () => { cancelAutomationRecipe("matrix-stop-before"); let spawned = false; const result = await executeAutomationRecipe({ executionId: "matrix-stop-before", recipe: { version: 1, actions: [{ tool: "open", arguments: { url: "https://example.com" } }] } }, { binary: "nbc", env: {}, spawnImpl: () => { spawned = true; } }); assert.equal(result.status, "cancelled"); assert.equal(spawned, false); }],
  ["QA-047 uses one persistent browser process for a multi-step workflow", async () => { const server = fakeMCP((m) => initializeOr(m, ok({ result: [{ title: "Ready" }] }))); const result = await executeAutomationRecipe({ executionId: "matrix-persistent", recipe: { version: 1, actions: [{ tool: "open", arguments: { url: "https://example.com" } }, { tool: "evaluate", arguments: { expression: "[{title:document.title}]" } }] } }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} }); assert.equal(result.status, "completed"); assert.equal(server.processes, 1); }],
  ["QA-048 binds every browser call to the selected recipient profile", async () => { const server = fakeMCP((m) => initializeOr(m, ok())); await executeAutomationRecipe({ executionId: "matrix-profile", profile: "Recipient", recipe: { version: 1, actions: [{ tool: "open", arguments: { url: "https://example.com" } }] } }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} }); assert.equal(server.calls.find((m) => m.params?.name === "open").params.arguments.profile, "Recipient"); }],
  ["QA-049 resolves a semantic link to its current canonical href", () => assert.deepEqual(resolveSemanticAction({ tool: "click", locator: { role: "link", name: "Result" }, original: {} }, { elements: [] }, { tag: "a", href: "https://example.com/current" }), { name: "open", arguments: { url: "https://example.com/current" } })],
  ["QA-050 fails closed when a semantic locator becomes ambiguous", () => assert.throws(() => resolveSemanticAction({ tool: "click", locator: { role: "link", name: "Result" }, original: {} }, { elements: [{ id: 1, role: "link", name: "Result" }, { id: 2, role: "link", name: "Result" }] }, {}), /matches 2 elements/i)],
];

if (cases.length !== 40) throw new Error(`Automation QA matrix must contain exactly 40 deterministic scenarios; found ${cases.length}.`);
for (const [name, run] of cases) test(name, run);
