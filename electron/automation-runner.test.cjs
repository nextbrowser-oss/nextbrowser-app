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
  assert.equal(calls[1].name, "state");
  assert.equal(calls[2].name, "__semantic_action");
  assert.deepEqual(resolveSemanticAction(calls[2].arguments, { elements: [{ id: 7, role: "button", name: "Search products" }] }), { name: "click", arguments: { element_id: 7 } });
  assert.deepEqual(resolveSemanticAction(calls[2].arguments, { elements: [] }, { tag: "a", href: "https://example.com/results?page=2" }), { name: "open", arguments: { url: "https://example.com/results?page=2" } });
  assert.deepEqual(calls[3], { name: "wait", arguments: { selector: ".results" } });
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
  assert.equal(progress.at(-1).phase, "completed");
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
