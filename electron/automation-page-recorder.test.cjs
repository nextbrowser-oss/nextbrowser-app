const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const fs = require("node:fs/promises");
const test = require("node:test");
const { activeAutomationRecordingHasDataAction, activeAutomationTraceFile, attachAutomationPageRecording, recorderPageScript, startAutomationPageRecording, stopAutomationPageRecording } = require("./automation-page-recorder.cjs");

function fakeMCP(handler) {
  const calls = [];
  const spawnImpl = (_binary, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        const message = JSON.parse(chunk.toString());
        if (message.id) {
          calls.push(message);
          Promise.resolve(handler(message)).then((result) => {
            if (!child.stdout.destroyed) child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
          });
        }
        callback();
      },
    });
    child.kill = () => { child.stdin.destroy(); child.stdout.destroy(); queueMicrotask(() => child.emit("close", 0)); return true; };
    child.spawnArgs = args;
    return child;
  };
  return { calls, spawnImpl };
}

const toolResult = (value) => ({ content: [{ type: "text", text: JSON.stringify({ result: value, session: { name: "Work" } }) }] });

test("page recorder captures manual page interactions without blocking them", () => {
  const source = recorderPageScript.toString();
  assert.match(source, /document\.addEventListener\("click", onClick, true\)/);
  assert.match(source, /document\.addEventListener\("input", onChange, true\)/);
  assert.match(source, /document\.addEventListener\("change", onChange, true\)/);
  assert.match(source, /push\("input"/);
  assert.match(source, /push\("select"/);
  assert.match(source, /push\("press"/);
  assert.doesNotMatch(source, /preventDefault/);
  assert.match(source, /sensitive \? "\{\{redacted\}\}"/);
  assert.match(source, /sessionStorage\.setItem\(storageKey/);
  assert.match(source, /sessionStorage\.removeItem\(storageKey/);
});

test("manual recording returns an initial navigation and collected deterministic actions", async () => {
  let drained = false;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: "https://example.com/form" } });
    const expression = message.params.arguments.expression;
    if (expression.includes("function recorderPageScript")) return toolResult({ installed: true, url: "https://example.com/form", title: "Form" });
    if (expression.includes("state?.cleanup")) return toolResult(true);
    const actions = drained ? [] : [{ tool: "input", arguments: { selector: "input[name=q]", text: "hello" }, at: Date.now() }];
    drained = true;
    return toolResult({ missing: false, url: "https://example.com/form", title: "Form", actions });
  });

  await startAutomationPageRecording({ recordingId: "manual-one", profile: "Work", runtime: "clawbrowser" }, {
    binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
  });
  const result = await stopAutomationPageRecording("manual-one");

  assert.equal(result.title, "Form");
  assert.deepEqual(result.actions.map(({ tool, arguments }) => ({ tool, arguments })), [
    { tool: "open", arguments: { url: "https://example.com/form" } },
    { tool: "input", arguments: { selector: "input[name=q]", text: "hello" } },
  ]);
  assert.ok(server.calls.some((call) => call.params?.name === "evaluate"));
  assert.ok(server.calls.filter((call) => call.params?.name).every((call) => call.params.arguments.profile === "Work"));
  assert.ok(server.calls.filter((call) => call.params?.name).every((call) => call.params.arguments.runtime === "clawbrowser"));
});

test("Camoufox manual recording uses MCP evaluate instead of probing a Chromium CDP endpoint", async () => {
  let drained = false;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: "https://example.com/" } });
    const expression = message.params.arguments.expression;
    if (expression.includes("function recorderPageScript")) return toolResult({ installed: true, url: "https://example.com/", title: "Example" });
    if (expression.includes("state?.cleanup")) return toolResult(true);
    const actions = drained ? [] : [{ tool: "click", arguments: { locator: { role: "link", name: "More" } }, at: Date.now() }];
    drained = true;
    return { content: [{ type: "text", text: JSON.stringify({
      result: { missing: false, url: "https://example.com/", title: "Example", actions },
      session: { name: "Cam", endpoint: "http://127.0.0.1:12345" },
    }) }] };
  });
  const previousFetch = global.fetch;
  global.fetch = () => { throw new Error("Chromium CDP must not be queried for Camoufox"); };
  try {
    await startAutomationPageRecording({ recordingId: "camoufox-mcp", profile: "Cam", runtime: "camoufox" }, {
      binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
    });
    const result = await stopAutomationPageRecording("camoufox-mcp");
    assert.equal(result.error, undefined);
    assert.deepEqual(result.actions.map(({ tool }) => tool), ["open", "click"]);
  } finally {
    global.fetch = previousFetch;
  }
});

test("recording can be armed before a stopped browser profile is launched", async () => {
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: "https://example.com/" } });
    const expression = message.params.arguments.expression;
    if (expression.includes("function recorderPageScript")) return toolResult({ installed: true, url: "https://example.com/", title: "Example" });
    if (expression.includes("state?.cleanup")) return toolResult(true);
    return toolResult({ missing: false, url: "https://example.com/", title: "Example", actions: [] });
  });

  await startAutomationPageRecording({ recordingId: "armed-first", profile: "Stopped", runtime: "clawbrowser", attach: false }, {
    binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
  });
  assert.equal(server.calls.length, 0);
  assert.ok(activeAutomationTraceFile());

  await attachAutomationPageRecording("armed-first");
  assert.ok(server.calls.some((call) => call.method === "initialize"));
  const result = await stopAutomationPageRecording("armed-first");
  assert.equal(result.title, "Example");
});

test("Multilogin recording binds the selected browser and folder", async () => {
  let spawnArgs;
  await startAutomationPageRecording({
    recordingId: "multilogin-browser", profile: "mlx-browser-browser-1", runtime: "multilogin",
    multiloginProfileId: "browser-1", multiloginFolderId: "folder-1", attach: false,
  }, { binary: "nextctl", env: {}, spawnImpl: (_binary, args) => { spawnArgs = args; throw new Error("unexpected spawn"); } });
  await assert.rejects(attachAutomationPageRecording("multilogin-browser"), /unexpected spawn/);
  assert.deepEqual(spawnArgs, [
    "--profile", "mlx-browser-browser-1", "--runtime", "multilogin",
    "--multilogin-profile-id", "browser-1", "--multilogin-folder-id", "folder-1", "mcp",
  ]);
  await stopAutomationPageRecording("multilogin-browser");
});

test("recording merges successful nextctl MCP extraction calls from the local trace", async () => {
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: "https://coinmarketcap.com/trending-cryptocurrencies/" } });
    const expression = message.params.arguments.expression;
    if (expression.includes("function recorderPageScript")) return toolResult({ installed: true, url: "https://coinmarketcap.com/trending-cryptocurrencies/", title: "Trending" });
    if (expression.includes("state?.cleanup")) return toolResult(true);
    return toolResult({ missing: false, url: "https://coinmarketcap.com/trending-cryptocurrencies/", title: "Trending", actions: [] });
  });

  await startAutomationPageRecording({ recordingId: "agent-trace", profile: "Work", runtime: "clawbrowser" }, {
    binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
  });
  const traceFile = activeAutomationTraceFile();
  assert.ok(traceFile);
  assert.equal(await activeAutomationRecordingHasDataAction(), false);
  await fs.appendFile(traceFile, `${JSON.stringify({
    tool: "extract",
    arguments: { container: "tbody tr", fields: { name: { selector: "td:nth-child(2)" }, price: { selector: "td:nth-child(4)" } } },
    at: Date.now(),
  })}\n`);
  assert.equal(await activeAutomationRecordingHasDataAction(), true);
  const result = await stopAutomationPageRecording("agent-trace");

  assert.deepEqual(result.actions.map(({ tool }) => tool), ["open", "extract"]);
  await assert.rejects(fs.stat(traceFile), { code: "ENOENT" });
});

test("a successful one-shot navigate and extract call satisfies Recorder data capture", async () => {
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: "https://example.com/results" } });
    const expression = message.params.arguments.expression;
    if (expression.includes("function recorderPageScript")) return toolResult({ installed: true, url: "https://example.com/results", title: "Results" });
    if (expression.includes("state?.cleanup")) return toolResult(true);
    return toolResult({ missing: false, url: "https://example.com/results", title: "Results", actions: [] });
  });

  await startAutomationPageRecording({ recordingId: "navigate-extract", profile: "Work", runtime: "clawbrowser" }, {
    binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
  });
  await fs.appendFile(activeAutomationTraceFile(), `${JSON.stringify({
    tool: "navigate_extract",
    arguments: { url: "https://example.com/results", container: "article", fields: { title: { selector: "h2" } } },
    at: Date.now(),
  })}\n`);

  assert.equal(await activeAutomationRecordingHasDataAction(), true);
  const result = await stopAutomationPageRecording("navigate-extract");
  assert.ok(result.actions.some(({ tool }) => tool === "navigate_extract"));
});
