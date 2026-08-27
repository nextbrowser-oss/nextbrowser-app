const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");
const { cancelAutomationRecipe, executeAutomationRecipe, expandTemplates, resolveSemanticAction, toolCalls, validateRecipe } = require("./automation-runner.cjs");

function fakeMCP(handler) {
  const calls = [];
  let spawnArgs;
  const spawnImpl = (binary, args) => {
    spawnArgs = { binary, args };
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
  return { calls, spawnImpl, get spawnArgs() { return spawnArgs; } };
}

test("validates recipe bounds and expands parameters without evaluating code", () => {
  assert.throws(() => validateRecipe({ version: 1, actions: [] }), /no browser steps/i);
  assert.deepEqual(expandTemplates({ text: "Find {{query}}", exact: "{{limit}}" }, { query: "books", limit: 5 }), { text: "Find books", exact: 5 });
});

test("maps recorded navigation and accessible-name actions to deterministic MCP calls", () => {
  assert.deepEqual(toolCalls({ tool: "navigate", arguments: { url: "https://example.com", profile: "ignored" } }), [{ name: "open", arguments: { url: "https://example.com" } }]);
  const calls = toolCalls({ tool: "click", arguments: { locator: { role: "button", name: "Search" }, wait_for: { selector: ".results" } } });
  assert.equal(calls[0].name, "evaluate");
  assert.deepEqual(calls[1], { name: "wait", arguments: { selector: ".results" } });
  assert.match(calls[0].arguments.expression, /element\.click\(\)/);
  assert.match(calls[0].arguments.expression, /element\.labels/);
  assert.match(calls[0].arguments.expression, /aria-labelledby/);
});

test("clicks semantic form controls directly instead of relying on a stale state element id", () => {
  for (const role of ["button", "checkbox", "radio"]) {
    const calls = toolCalls({ tool: "click", arguments: { locator: { role, name: "Control" } } });
    assert.deepEqual(calls.map((call) => call.name), ["evaluate"]);
    assert.match(calls[0].arguments.expression, /element\.click\(\)/);
    assert.match(calls[0].arguments.expression, /checked/);
  }
});

test("replays recorded focus-aware key presses and absolute scrolling deterministically", () => {
  const semanticPress = toolCalls({ tool: "press", arguments: { locator: { role: "textbox", name: "Search" }, key: "Enter" } });
  assert.deepEqual(semanticPress.map((call) => call.name), ["evaluate", "press"]);
  assert.match(semanticPress[0].arguments.expression, /element\.focus\(\)/);
  assert.deepEqual(semanticPress[1].arguments, { key: "Enter" });

  const cssPress = toolCalls({ tool: "press", arguments: { selector: "input.search", key: "Escape" } });
  assert.deepEqual(cssPress.map((call) => call.name), ["evaluate", "press"]);
  assert.match(cssPress[0].arguments.expression, /input\.search/);

  const scroll = toolCalls({ tool: "scroll", arguments: { x: 10, y: 420 } });
  assert.deepEqual(scroll.map((call) => call.name), ["evaluate"]);
  assert.match(scroll[0].arguments.expression, /scrollTo\(10,420\)/);
});

test("uses a wrapped DOM descriptor before ambiguous semantic state matches", () => {
  const calls = toolCalls({ tool: "click", arguments: { locator: { role: "link", name: "Love" } } });
  const wrapped = { result: { tag: "a", href: "https://example.com/tag/love/" } };
  const descriptor = wrapped.result ?? wrapped;
  assert.deepEqual(resolveSemanticAction(calls[2].arguments, {
    elements: [
      { id: 1, role: "link", name: "Love" },
      { id: 2, role: "link", name: "love" },
    ],
  }, descriptor), { name: "open", arguments: { url: "https://example.com/tag/love/" } });
});

test("unwraps the MCP evaluate envelope during semantic click replay", async () => {
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "evaluate") return { content: [{ type: "text", text: JSON.stringify({ result: { tag: "a", href: "https://example.com/tag/love/" } }) }] };
    if (message.params.name === "state") return { content: [{ type: "text", text: JSON.stringify({ elements: [{ id: 1, role: "link", name: "Love" }, { id: 2, role: "link", name: "love" }] }) }] };
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  });
  const result = await executeAutomationRecipe({
    executionId: "semantic-envelope",
    profile: "Work",
    recipe: { version: 1, actions: [{ tool: "click", arguments: { locator: { role: "link", name: "Love" } } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });

  assert.equal(result.status, "completed");
  assert.deepEqual(server.calls.filter((call) => call.method === "tools/call").map((call) => call.params.name), ["evaluate", "state", "open"]);
});

test("executes every recipe step through one persistent MCP process", async () => {
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake", version: "1" } };
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, tool: message.params.name }) }] };
  });
  const progress = [];
  const result = await executeAutomationRecipe({
    executionId: "run-one",
    profile: "Work",
    runtime: "camoufox",
    parameters: { query: "quotes" },
    recipe: { version: 1, actions: [
      { tool: "navigate", arguments: { url: "https://example.com/{{query}}" } },
      { tool: "wait", arguments: { selector: ".ready" } },
    ] },
  }, { binary: "/tmp/nbc", env: {}, spawnImpl: server.spawnImpl, onProgress: (update) => progress.push(update) });

  assert.equal(result.status, "completed");
  assert.equal(result.results.length, 2);
  assert.deepEqual(server.spawnArgs, { binary: "/tmp/nbc", args: ["--profile", "Work", "--runtime", "camoufox", "mcp"] });
  assert.equal(server.calls.filter((call) => call.method === "initialize").length, 1);
  assert.deepEqual(server.calls.filter((call) => call.method === "tools/call").map((call) => call.params.name), ["open", "wait"]);
  assert.equal(server.calls.find((call) => call.params?.name === "open").params.arguments.url, "https://example.com/quotes");
  assert.deepEqual(server.calls.filter((call) => call.method === "tools/call").map((call) => call.params.arguments.profile), ["Work", "Work"]);
  assert.equal(progress.at(-1).phase, "completed");
});

test("retries only transient navigation failures", async () => {
  let opens = 0;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "open" && opens++ === 0) {
      return { isError: true, content: [{ type: "text", text: "navigation failed: net::ERR_SSL_PROTOCOL_ERROR" }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  });
  const progress = [];
  const result = await executeAutomationRecipe({
    executionId: "retry-navigation",
    recipe: { version: 1, actions: [{ tool: "open", arguments: { url: "https://example.com" } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {}, onProgress: (update) => progress.push(update) });

  assert.equal(result.status, "completed");
  assert.equal(opens, 2);
  assert.ok(progress.some((update) => /Retrying navigation/.test(update.detail)));
});

test("does not retry permanent navigation failures", async () => {
  let opens = 0;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    opens += 1;
    return { isError: true, content: [{ type: "text", text: "navigation failed: invalid URL" }] };
  });
  const result = await executeAutomationRecipe({
    executionId: "no-retry-invalid-url",
    recipe: { version: 1, actions: [{ tool: "open", arguments: { url: "not-a-url" } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });

  assert.equal(result.status, "failed");
  assert.equal(opens, 1);
});

test("runs artifact steps locally with access to earlier results", async () => {
  const server = fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { content: [{ type: "text", text: JSON.stringify({ rows: [{ title: "Book" }] }) }] });
  const local = [];
  const result = await executeAutomationRecipe({
    executionId: "local-artifact",
    recipe: { version: 1, actions: [
      { tool: "extract", arguments: { container: ".card", fields: { title: { selector: "h2" } } } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "csv", name: "books.csv" } },
    ] },
  }, {
    binary: "nbc", env: {}, spawnImpl: server.spawnImpl,
    onLocalAction: async (action, context) => { local.push({ action, context }); return { saved: true, artifact: { name: "books.csv" } }; },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(server.calls.filter((call) => call.method === "tools/call").map((call) => call.params.name), ["extract"]);
  assert.equal(local[0].context.results[0].output.rows[0].title, "Book");
  assert.equal(result.results[1].output.artifact.name, "books.csv");
});

test("rejects extraction rows that contain only empty field values", async () => {
  const server = fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { content: [{ type: "text", text: JSON.stringify({ rows: [{ name: "", symbol: "", rank: "", price: "" }], count: 1 }) }] });
  const result = await executeAutomationRecipe({
    executionId: "empty-extraction",
    recipe: { version: 1, actions: [{ tool: "extract", arguments: { container: "tr", fields: { name: { selector: "td" } } } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });
  assert.equal(result.status, "failed");
  assert.match(result.error, /returned only empty rows/);
});

test("does not treat rank-only evaluate rows as extracted data", async () => {
  const server = fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { content: [{ type: "text", text: JSON.stringify({
      result: Array.from({ length: 5 }, (_, index) => ({ rank: index + 1, name: null, symbol: null, price: null })),
      session: { name: "default" },
    }) }] });
  const result = await executeAutomationRecipe({
    executionId: "rank-only-evaluate",
    recipe: { version: 1, actions: [{ tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("tr"))' } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });
  assert.equal(result.status, "failed");
  assert.match(result.error, /returned only empty values/);
  assert.equal(server.calls.filter((call) => call.method === "tools/call").length, 21);
});

test("rejects partially empty evaluate row sets instead of saving incomplete data", async () => {
  const server = fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { content: [{ type: "text", text: JSON.stringify({ result: [
      { rank: 1, name: "Bitcoin", price: "$1" },
      { rank: 2, name: null, price: null },
    ] }) }] });
  const local = [];
  const result = await executeAutomationRecipe({
    executionId: "partially-empty-evaluate",
    recipe: { version: 1, actions: [
      { tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("tr"))' } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "coins.json" } },
    ] },
  }, {
    binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {},
    onLocalAction: async () => { local.push(true); return { saved: true }; },
  });
  assert.equal(result.status, "failed");
  assert.equal(local.length, 0);
});

test("waits for dynamic extraction rows to become populated", async () => {
  let extracts = 0;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    extracts += 1;
    return { content: [{ type: "text", text: JSON.stringify(extracts < 3
      ? { rows: [{ name: "" }], count: 1 }
      : { rows: [{ name: "Bitcoin" }], count: 1 }) }] };
  });
  const result = await executeAutomationRecipe({
    executionId: "dynamic-extraction",
    recipe: { version: 1, actions: [{ tool: "extract", arguments: { container: "tr", fields: { name: { selector: "td" } } } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });
  assert.equal(result.status, "completed");
  assert.equal(extracts, 3);
  assert.equal(result.results[0].output.rows[0].name, "Bitcoin");
});

test("retries a page script that reports temporarily incomplete dynamic data", async () => {
  let evaluations = 0;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    evaluations += 1;
    return evaluations < 3
      ? { isError: true, content: [{ type: "text", text: "Trending table did not return exactly 10 complete rows" }] }
      : { content: [{ type: "text", text: JSON.stringify({ result: [{ rank: 1, name: "Bitcoin" }] }) }] };
  });
  const result = await executeAutomationRecipe({
    executionId: "dynamic-evaluate-error",
    recipe: { version: 1, actions: [{ tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("tr"))' } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });
  assert.equal(result.status, "completed");
  assert.equal(evaluations, 3);
});

test("retries a page script that expects a populated top-N result", async () => {
  let evaluations = 0;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    evaluations += 1;
    return evaluations < 3
      ? { isError: true, content: [{ type: "text", text: "Error: Expected 5 populated trending rows" }] }
      : { content: [{ type: "text", text: JSON.stringify({ result: Array.from({ length: 5 }, (_, index) => ({ rank: index + 1, name: `Coin ${index + 1}`, price: "$1" })) }) }] };
  });
  const result = await executeAutomationRecipe({
    executionId: "dynamic-populated-top-n",
    recipe: { version: 1, actions: [{ tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("tbody tr"))' } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });
  assert.equal(result.status, "completed");
  assert.equal(evaluations, 3);
});

test("retries a page script that expects at least a populated top-N result", async () => {
  let evaluations = 0;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    evaluations += 1;
    return evaluations < 2
      ? { isError: true, content: [{ type: "text", text: "runtime evaluation failed: Error: Expected at least 5 populated trending rows" }] }
      : { content: [{ type: "text", text: JSON.stringify({ result: Array.from({ length: 5 }, (_, index) => ({ rank: index + 1, name: `Coin ${index + 1}`, price: "$1" })) }) }] };
  });
  const result = await executeAutomationRecipe({
    executionId: "dynamic-at-least-top-n",
    recipe: { version: 1, actions: [{ tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("tbody tr"))' } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl, sleep: async () => {} });
  assert.equal(result.status, "completed");
  assert.equal(evaluations, 2);
});

test("replays read-only page extraction scripts and rejects unsafe scripts", async () => {
  const server = fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { content: [{ type: "text", text: JSON.stringify([{ name: "Bitcoin" }]) }] });
  const safe = await executeAutomationRecipe({
    executionId: "safe-page-script",
    recipe: { version: 1, actions: [{ tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("tr")).map(row => row.innerText)' } }] },
  }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl });
  assert.equal(safe.status, "completed");
  assert.equal(server.calls.find((call) => call.method === "tools/call")?.params.name, "evaluate");

  const unsafe = await executeAutomationRecipe({
    executionId: "unsafe-page-script",
    recipe: { version: 1, actions: [{ tool: "evaluate", arguments: { expression: "document.cookie" } }] },
  }, { binary: "nbc", env: {}, spawnImpl: fakeMCP(() => ({ protocolVersion: "2025-03-26", capabilities: {} })).spawnImpl });
  assert.equal(unsafe.status, "failed");
  assert.match(unsafe.error, /cannot be replayed safely/);

  const empty = await executeAutomationRecipe({
    executionId: "empty-page-script",
    recipe: { version: 1, actions: [{ tool: "evaluate", arguments: { expression: 'Array.from(document.querySelectorAll("tr")).map(() => ({ name: "", rank: 0 }))' } }] },
  }, { binary: "nbc", env: {}, sleep: async () => {}, spawnImpl: fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { content: [{ type: "text", text: JSON.stringify({ result: [{ name: "", rank: 0 }], session: { name: "default" } }) }] }).spawnImpl });
  assert.equal(empty.status, "failed");
  assert.match(empty.error, /returned only empty values/);
});

test("keeps the full previous result for a local artifact while bounding run history", async () => {
  const large = "x".repeat(1_600_000);
  const server = fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { content: [{ type: "text", text: JSON.stringify({ rows: [{ value: large }] }) }] });
  let savedLength = 0;
  const result = await executeAutomationRecipe({
    executionId: "full-local-artifact",
    recipe: { version: 1, actions: [
      { tool: "extract", arguments: { container: ".row", fields: { value: { selector: ".value" } } } },
      { tool: "save_artifact", arguments: { source: "last_result", format: "json", name: "large.json" } },
    ] },
  }, {
    binary: "nbc", env: {}, spawnImpl: server.spawnImpl,
    onLocalAction: async (_action, context) => { savedLength = context.results[0].output.rows[0].value.length; return { saved: true }; },
  });
  assert.equal(result.status, "completed");
  assert.equal(savedLength, large.length);
  assert.equal(result.results[0].output.truncated, true);
});

test("returns a failed step and stops instead of asking an agent implicitly", async () => {
  const server = fakeMCP((message) => message.method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {} }
    : { isError: true, content: [{ type: "text", text: "selector did not match" }] });
  const result = await executeAutomationRecipe({ executionId: "run-fail", recipe: { version: 1, actions: [{ tool: "wait", arguments: { selector: ".missing" } }] } }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl });
  assert.equal(result.status, "failed");
  assert.equal(result.failedStep, 0);
  assert.match(result.error, /selector did not match/);
  assert.equal(server.calls.filter((call) => call.method === "tools/call").length, 1);
});

test("cancels an in-flight MCP action", async () => {
  let hold;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    return new Promise((resolve) => { hold = resolve; });
  });
  const execution = executeAutomationRecipe({ executionId: "run-cancel", recipe: { version: 1, actions: [{ tool: "wait", arguments: { selector: ".slow" } }] } }, { binary: "nbc", env: {}, spawnImpl: server.spawnImpl });
  while (!hold) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelAutomationRecipe("run-cancel"), true);
  const result = await execution;
  assert.equal(result.status, "cancelled");
  hold({ content: [] });
});
