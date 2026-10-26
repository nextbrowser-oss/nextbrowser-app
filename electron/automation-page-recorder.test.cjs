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
  assert.match(source, /url: location\.href/);
});

test("page actions keep the page they happened on, so replay can start there", async () => {
  let drained = false;
  const repo = "https://github.com/nextbrowser-oss/nextbrowser-app";
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: "clawbrowser://verify/" } });
    const expression = message.params.arguments.expression;
    if (expression.includes("function recorderPageScript")) return toolResult({ installed: true, url: "clawbrowser://verify/", title: "Verification" });
    if (expression.includes("state?.cleanup")) return toolResult(true);
    // The click navigated away before this poll drained it.
    const actions = drained ? [] : [
      { tool: "click", arguments: { locator: { role: "link", name: "Commits" } }, at: Date.now(), url: repo },
      { tool: "scroll", arguments: { x: 0, y: 1 }, at: Date.now(), url: "javascript:void(0)" },
    ];
    drained = true;
    return toolResult({ missing: false, url: "clawbrowser://verify/", title: "Verification", actions });
  });

  await startAutomationPageRecording({ recordingId: "manual-page-url", profile: "Work", runtime: "clawbrowser" }, {
    binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
  });
  const result = await stopAutomationPageRecording("manual-page-url");

  assert.deepEqual(result.actions.map(({ tool, url }) => ({ tool, url })), [
    { tool: "click", url: repo },
    { tool: "scroll", url: undefined },
  ]);
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

test("a page opened in a new tab during recording gets its open step even when another tab cannot be recorded", async () => {
  const repo = "https://github.com/nextbrowser-oss/nextbrowser-app";
  const verify = { id: "verify", type: "page", url: "clawbrowser://verify/", title: "Verification", webSocketDebuggerUrl: "ws://127.0.0.1:47123/devtools/page/verify" };
  const broken = { id: "closing", type: "page", url: "https://example.com/", title: "Closing", webSocketDebuggerUrl: "ws://127.0.0.1:47123/devtools/page/closing" };
  const github = { id: "github", type: "page", url: repo, title: "GitHub", webSocketDebuggerUrl: "ws://127.0.0.1:47123/devtools/page/github" };
  let targets = [verify, broken];
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.closed = false;
      sockets.push(this);
      queueMicrotask(() => this.emit("open"));
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    emit(type, event) { for (const listener of this.listeners[type] || []) listener(event); }
    send(text) {
      const message = JSON.parse(text);
      if (this.url.endsWith("/verify")) throw new Error("the internal page must not be attached");
      const reply = this.url.endsWith("/closing") && message.method === "Runtime.evaluate"
        ? { id: message.id, error: { message: "Target closed." } }
        : { id: message.id, result: {} };
      queueMicrotask(() => this.emit("message", { data: JSON.stringify(reply) }));
    }
    close() { this.closed = true; }
  }
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: verify.url } });
    if (message.params.arguments.expression.includes("state?.cleanup")) return toolResult(true);
    return { content: [{ type: "text", text: JSON.stringify({
      result: { missing: false, url: verify.url, title: verify.title, actions: [] },
      session: { name: "Work", endpoint: "http://127.0.0.1:47123" },
    }) }] };
  });
  const previous = { fetch: global.fetch, WebSocket: global.WebSocket };
  global.fetch = async () => ({ ok: true, json: async () => targets });
  global.WebSocket = FakeSocket;
  const until = async (condition) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(condition());
  };
  try {
    await startAutomationPageRecording({ recordingId: "cdp-new-tab", profile: "Work", runtime: "clawbrowser" }, {
      binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
    });
    // The first pass over the tabs open at Start; the closing tab fails.
    await until(() => sockets.some((socket) => socket.url.endsWith("/closing") && socket.closed));
    targets = [github, verify];
    await until(() => sockets.some((socket) => socket.url.endsWith("/github") && socket.listeners.message));
    const tab = sockets.find((socket) => socket.url.endsWith("/github"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    tab.emit("message", { data: JSON.stringify({ method: "Runtime.bindingCalled", params: { name: "__nextbrowserRecorderEmit", payload: JSON.stringify({
      tool: "click", arguments: { locator: { role: "link", name: "Commits" } }, at: Date.now(), url: repo, eventId: "click-1",
    }) } }) });
    const result = await stopAutomationPageRecording("cdp-new-tab");

    assert.deepEqual(result.actions.map(({ tool, arguments: args }) => ({ tool, args })), [
      { tool: "open", args: { url: repo } },
      { tool: "click", args: { locator: { role: "link", name: "Commits" } } },
    ]);
    assert.ok(sockets.every((socket) => !socket.url.endsWith("/verify")), "the internal page is never attached");
    assert.ok(sockets.filter((socket) => socket.url.endsWith("/closing")).every((socket) => socket.closed), "a failed tab leaves no connection open");
  } finally {
    // A failed assertion must not leave the recorder polling.
    await stopAutomationPageRecording("cdp-new-tab").catch(() => undefined);
    global.fetch = previous.fetch;
    global.WebSocket = previous.WebSocket;
  }
});
