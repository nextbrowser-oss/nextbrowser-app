const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");
const {
  OPENROUTER_FREE_ROUTER,
  createProviderClient,
  defaultModelFor,
  describeModel,
  normalizeBaseURL,
  offeredModels,
  redactSecrets,
  resolveProviderSettings,
  testProvider,
} = require("./builtin-agent-providers.cjs");
const { BUILTIN_AGENT_TOOLS, coerceArguments, createMCPToolset, selectTools, toOpenAIParameters, toolResultForModel } = require("./builtin-agent-tools.cjs");
const { fitContext, messageText, parseToolCalls } = require("./builtin-agent.cjs");
const { parseBuiltinAgentSettings, runBuiltinAgentTurn } = require("./builtin-agent-run.cjs");
const { describeBuiltinAgentResult } = require("./agent-failure-report.cjs");

// The fake provider's sockets and the loop's timers do not all keep Node's
// event loop alive; Node 22's test runner (CI) would cancel a waiting test.
const keepAlive = setInterval(() => {}, 1_000);
test.after(() => clearInterval(keepAlive));

const SECRET = "nvapi-TOPSECRETkey0123456789abcdef";

// ---- A fake OpenAI-compatible provider on 127.0.0.1 ------------------------

/**
 * `handle(body, request, index)` answers each chat request with
 * { status, body, headers } or a promise of it; it sees the parsed request.
 */
async function fakeProvider(handle, { models } = {}) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", async () => {
      if (request.method === "GET" && request.url.endsWith("/models")) {
        requests.push({ url: request.url, headers: request.headers });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: models || [] }));
        return;
      }
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ url: request.url, headers: request.headers, body: JSON.parse(JSON.stringify(body)) });
      try {
        const answer = await handle(body, request, requests.length - 1);
        if (!answer) return; // left hanging on purpose
        response.writeHead(answer.status || 200, { "content-type": "application/json", ...(answer.headers || {}) });
        response.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
      } catch (error) {
        response.writeHead(500);
        response.end(String(error));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    baseURL,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

function reply(message, finishReason = "stop") {
  return { status: 200, body: { choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }] } };
}

function toolCall(name, args, id = `call_${name}`) {
  return { id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } };
}

// ---- A fake `nbc mcp` -------------------------------------------------------

const MCP_TOOLS = [
  { name: "doctor", description: "Check.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "start", description: "Start.", inputSchema: { type: "object", properties: { profile: { type: "string" }, url: { type: "string" }, cdp: { type: "string" }, timeout: { type: "number", exclusiveMinimum: 0 }, return_state: { type: "boolean" } }, additionalProperties: false } },
  { name: "open", description: "Open.", inputSchema: { type: "object", properties: { profile: { type: "string" }, url: { type: "string" }, cdp: { type: "string" } }, required: ["url"], additionalProperties: false } },
  { name: "state", description: "State.", inputSchema: { type: "object", properties: { profile: { type: "string" } }, additionalProperties: false } },
  { name: "click", description: "Click.", inputSchema: { type: "object", properties: { profile: { type: "string" }, element_id: { type: "integer" }, return_state: { type: "boolean" } }, required: ["element_id"], additionalProperties: false } },
  { name: "screenshot", description: "Shot.", inputSchema: { type: "object", properties: { profile: { type: "string" } }, additionalProperties: false } },
  { name: "evaluate", description: "Eval.", inputSchema: { type: "object", properties: { expression: { type: "string" } }, additionalProperties: false } },
];

function fakeMCP(handler = () => ({ content: [{ type: "text", text: "ok" }] })) {
  const calls = [];
  const spawned = [];
  const children = [];
  const spawnImpl = (binary, args, options) => {
    spawned.push({ binary, args, env: options?.env });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
          const message = JSON.parse(line);
          if (!message.id) continue;
          calls.push(message);
          const answer = message.method === "initialize"
            ? { protocolVersion: "2025-11-25", capabilities: {} }
            : message.method === "tools/list"
              ? { tools: MCP_TOOLS }
              : handler(message.params.name, message.params.arguments);
          Promise.resolve(answer).then((result) => {
            if (result === undefined) return; // never answers
            child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
          });
        }
        callback();
      },
    });
    child.killed = false;
    child.kill = () => { child.killed = true; child.stdin.destroy(); queueMicrotask(() => child.emit("close", 0)); return true; };
    children.push(child);
    return child;
  };
  return {
    calls,
    spawned,
    children,
    spawnImpl,
    toolCalls: () => calls.filter((call) => call.method === "tools/call").map((call) => call.params),
  };
}

function turn(provider, mcp, overrides = {}) {
  const steps = [];
  const promise = runBuiltinAgentTurn({
    settings: { provider: "custom", baseURL: provider.baseURL, model: "test-model" },
    loadKey: async () => SECRET,
    prompt: "Open example.com and tell me the title.",
    mcp: { binary: "/fake/nbc", args: ["--verify-on-start-only", "mcp"], env: { NEXTBROWSER_CONTROL_TOKEN: "t" }, spawnImpl: mcp?.spawnImpl },
    defaultProfile: "Work",
    onStep: (step) => steps.push(step),
    sleep: async () => {},
    ...overrides,
  });
  return { promise, steps };
}

// ---- The loop ----------------------------------------------------------------

test("a two-step tool loop ends in the model's final answer", async () => {
  const provider = await fakeProvider((body, _request, index) => {
    if (index === 0) return reply({ content: null, tool_calls: [toolCall("open", { url: "https://example.com" })] });
    if (index === 1) return reply({ content: "Reading the page.", tool_calls: [toolCall("state", {})] });
    return reply({ content: "The title is Example Domain." });
  });
  const mcp = fakeMCP((name) => ({ content: [{ type: "text", text: name === "state" ? "Title: Example Domain" : "opened" }] }));
  try {
    const { promise, steps } = turn(provider, mcp);
    const result = await promise;
    assert.equal(result.status, "completed");
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "The title is Example Domain.");
    assert.equal(mcp.spawned[0].binary, "/fake/nbc");
    assert.deepEqual(mcp.spawned[0].args, ["--verify-on-start-only", "mcp"]);
    // The chat's profile fills the missing argument; the hidden cdp is never offered.
    assert.deepEqual(mcp.toolCalls(), [
      { name: "open", arguments: { url: "https://example.com", profile: "Work" } },
      { name: "state", arguments: { profile: "Work" } },
    ]);
    const first = provider.requests[0].body;
    assert.equal(first.model, "test-model");
    assert.equal(first.tool_choice, "auto");
    assert.equal(first.messages[0].role, "system");
    assert.match(first.messages[0].content, /Nextbrowser agent/);
    assert.equal(first.messages[1].content, "Open example.com and tell me the title.");
    // Only allowlisted tools, without the CDP endpoint argument.
    assert.deepEqual(first.tools.map((tool) => tool.function.name), ["start", "open", "state", "click"]);
    assert.ok(!JSON.stringify(first.tools).includes("cdp"));
    assert.ok(!JSON.stringify(first.tools).includes("exclusiveMinimum"));
    // The tool results go back with their call IDs.
    const third = provider.requests[2].body.messages;
    assert.deepEqual(third.filter((message) => message.role === "tool").map((message) => [message.tool_call_id, message.content]), [
      ["call_open", "opened"],
      ["call_state", "Title: Example Domain"],
    ]);
    assert.equal(provider.requests[0].headers.authorization, `Bearer ${SECRET}`);
    assert.ok(steps.includes("nextbrowser: open https://example.com"));
    assert.ok(steps.includes("Reading the page."));
    assert.ok(mcp.children[0].killed, "the browser tools are closed after the turn");
  } finally {
    await provider.close();
  }
});

test("invalid tool arguments and an unknown tool become tool errors the model recovers from", async () => {
  const provider = await fakeProvider((body, _request, index) => {
    if (index === 0) return reply({ tool_calls: [toolCall("click", "{element_id: 3"), toolCall("navigate_to", { url: "x" }, "call_unknown")] });
    if (index === 1) return reply({ tool_calls: [toolCall("click", { element_id: "3" }, "call_retry")] });
    return reply({ content: "Clicked the button." });
  });
  const mcp = fakeMCP();
  try {
    const result = await turn(provider, mcp).promise;
    assert.equal(result.status, "completed");
    assert.equal(result.stdout, "Clicked the button.");
    const second = provider.requests[1].body.messages;
    const toolMessages = second.filter((message) => message.role === "tool");
    assert.match(toolMessages[0].content, /^Error: the arguments are not valid JSON/);
    assert.match(toolMessages[1].content, /no tool named "navigate_to"/);
    // The broken call goes back as {} so the provider accepts the history.
    const assistant = second.find((message) => message.role === "assistant");
    assert.equal(assistant.tool_calls[0].function.arguments, "{}");
    // Only the corrected call reached the browser, with its ID as a number.
    assert.deepEqual(mcp.toolCalls(), [{ name: "click", arguments: { element_id: 3, profile: "Work", return_state: true } }]);
  } finally {
    await provider.close();
  }
});

test("a model that never calls tools still returns its text", async () => {
  const provider = await fakeProvider(() => reply({ content: "I cannot browse, but example.com is a test domain." }));
  try {
    const result = await turn(provider, fakeMCP()).promise;
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "I cannot browse, but example.com is a test domain.");
  } finally {
    await provider.close();
  }
});

test("an empty final message is asked for an answer once", async () => {
  const provider = await fakeProvider((_body, _request, index) => reply({ content: index === 0 ? "" : "<think>done?</think>Done: nothing to report." }));
  try {
    const result = await turn(provider, fakeMCP()).promise;
    assert.equal(result.stdout, "Done: nothing to report.");
    assert.equal(provider.requests.length, 2);
    assert.match(provider.requests[1].body.messages.at(-1).content, /Answer the user now/);
  } finally {
    await provider.close();
  }
});

test("the run stops after its step limit", async () => {
  const provider = await fakeProvider((_body, _request, index) => reply({ tool_calls: [toolCall("state", {}, `call_${index}`)] }));
  try {
    const result = await turn(provider, fakeMCP(), { limits: { maxSteps: 3 } }).promise;
    assert.equal(result.status, "max_steps");
    assert.equal(result.code, 1);
    assert.equal(provider.requests.length, 3);
    assert.match(result.reason, /stopped after 3 steps without finishing/);
    assert.deepEqual(result.failure, { code: "max_steps", expected: true });
  } finally {
    await provider.close();
  }
});

test("Stop cancels a request the provider has not answered", async () => {
  const provider = await fakeProvider(() => undefined);
  const controller = new AbortController();
  try {
    const mcp = fakeMCP();
    const { promise } = turn(provider, mcp, { signal: controller.signal });
    while (!provider.requests.length) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const result = await promise;
    assert.equal(result.status, "cancelled");
    assert.equal(result.code, 130);
    assert.equal(result.reason, "");
    assert.ok(mcp.children[0].killed);
  } finally {
    await provider.close();
  }
});

test("Stop cancels a running browser tool", async () => {
  const provider = await fakeProvider(() => reply({ tool_calls: [toolCall("state", {})] }));
  const controller = new AbortController();
  const mcp = fakeMCP(() => undefined);
  try {
    const { promise } = turn(provider, mcp, { signal: controller.signal });
    while (!mcp.toolCalls().length) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const result = await promise;
    assert.equal(result.status, "cancelled");
    assert.equal(provider.requests.length, 1);
  } finally {
    await provider.close();
  }
});

test("a plain run sends no tools and starts no browser", async () => {
  const provider = await fakeProvider(() => reply({ content: "{\"reply\":\"hi\"}" }));
  const mcp = fakeMCP();
  try {
    const result = await turn(provider, mcp, { plain: true }).promise;
    assert.equal(result.stdout, "{\"reply\":\"hi\"}");
    assert.equal(mcp.spawned.length, 0);
    assert.equal(provider.requests[0].body.tools, undefined);
    assert.match(provider.requests[0].body.messages[0].content, /text only/);
  } finally {
    await provider.close();
  }
});

test("browser tools that cannot start end the run with a reason", async () => {
  const provider = await fakeProvider(() => reply({ content: "never" }));
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.kill = () => true;
    queueMicrotask(() => child.emit("error", new Error("spawn /fake/nbc ENOENT")));
    return child;
  };
  try {
    const result = await turn(provider, { spawnImpl }).promise;
    assert.equal(result.code, 1);
    assert.match(result.reason, /could not start its browser tools\. spawn \/fake\/nbc ENOENT/);
    assert.deepEqual(result.failure, { code: "internal", expected: false });
    assert.equal(provider.requests.length, 0);
  } finally {
    await provider.close();
  }
});

// ---- Provider errors -----------------------------------------------------------

for (const [status, code, pattern] of [
  [401, "auth", /rejected the API key/],
  [403, "auth", /rejected the API key/],
  [429, "rate_limit", /free limit is reached/],
  [404, "model_not_found", /has no model “test-model”/],
  [402, "payment", /needs credits/],
]) {
  test(`HTTP ${status} becomes a ${code} failure the user can act on`, async () => {
    const provider = await fakeProvider(() => ({ status, headers: { "retry-after": "3600" }, body: { error: { message: `Invalid key ${SECRET}` } } }));
    try {
      const result = await turn(provider, fakeMCP()).promise;
      assert.equal(result.code, 1);
      assert.match(result.reason, pattern);
      assert.equal(result.failure.code, code);
      assert.equal(result.failure.expected, true);
      assert.equal(result.failure.status, status);
      assert.ok(!JSON.stringify(result).includes(SECRET), "the key never reaches the result");
      assert.equal(describeBuiltinAgentResult({ result, provider: "nvidia", model: "m" }).event, null, "the user fixes it; no report");
    } finally {
      await provider.close();
    }
  });
}

test("a model without tool support says so and suggests another model", async () => {
  const provider = await fakeProvider(() => ({ status: 400, body: { error: { message: "This model does not support tools." } } }));
  try {
    const result = await turn(provider, fakeMCP()).promise;
    assert.equal(result.failure.code, "no_tools");
    assert.match(result.reason, /cannot call tools.*Pick another model/);
  } finally {
    await provider.close();
  }
});

test("OpenRouter's 404 for a model without tool endpoints is a missing tool support", async () => {
  const provider = await fakeProvider(() => ({ status: 404, body: { error: { message: "No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs" } } }));
  try {
    const result = await turn(provider, fakeMCP()).promise;
    assert.equal(result.failure.code, "no_tools");
  } finally {
    await provider.close();
  }
});

test("a per-minute rate limit is waited out, a daily one is not", async () => {
  let calls = 0;
  const provider = await fakeProvider(() => (++calls === 1 ? { status: 429, headers: { "retry-after": "2" }, body: {} } : reply({ content: "done" })));
  const waits = [];
  try {
    const { promise, steps } = turn(provider, fakeMCP(), { sleep: async (ms) => { waits.push(ms); } });
    const result = await promise;
    assert.equal(result.stdout, "done");
    assert.deepEqual(waits, [2000]);
    assert.ok(steps.some((step) => /rate limit reached; waiting 2 s/.test(step)));
  } finally {
    await provider.close();
  }
});

test("an unreachable provider is a network failure, reported as kind network", async () => {
  const provider = await fakeProvider(() => reply({ content: "x" }));
  const { baseURL } = provider;
  await provider.close();
  const result = await turn({ baseURL }, fakeMCP()).promise;
  assert.equal(result.failure.code, "network");
  assert.equal(result.failure.expected, false);
  assert.match(result.reason, /could not reach Custom provider/);
  assert.equal(result.failure.networkCode, "ECONNREFUSED");
  const { event } = describeBuiltinAgentResult({ result, provider: "custom", model: "private-model", durationMs: 12 });
  assert.equal(event.kind, "network");
  assert.equal(event.name, "BUILTIN_AGENT_NETWORK");
  assert.equal(event.context.network_error, "ECONNREFUSED");
  assert.equal(event.context.model, undefined, "a custom model name is not reported");
  assert.ok(!JSON.stringify(event).includes(baseURL));
});

test("a missing key or setting fails before anything is sent", async () => {
  const provider = await fakeProvider(() => reply({ content: "x" }));
  try {
    const noKey = await turn(provider, fakeMCP(), { settings: { provider: "nvidia", model: "m" }, loadKey: async () => "" }).promise;
    assert.match(noKey.reason, /Add your NVIDIA API key in Settings → Agent/);
    assert.deepEqual(noKey.failure, { code: "not_configured", expected: true });
    const noModel = await turn(provider, fakeMCP(), { settings: { provider: "nvidia" } }).promise;
    assert.match(noModel.reason, /Pick a model/);
    const noURL = await turn(provider, fakeMCP(), { settings: { provider: "custom", model: "m" } }).promise;
    assert.match(noURL.reason, /base URL/);
    assert.equal(provider.requests.length, 0);
  } finally {
    await provider.close();
  }
});

test("a local provider without a key sends no Authorization header", async () => {
  const provider = await fakeProvider(() => reply({ content: "ok" }));
  try {
    const result = await turn(provider, fakeMCP(), { loadKey: async () => "" }).promise;
    assert.equal(result.code, 0);
    assert.equal(provider.requests[0].headers.authorization, undefined);
  } finally {
    await provider.close();
  }
});

// ---- The key stays out of everything but the request ---------------------------

test("the key never appears in steps, results, or error reports", async () => {
  const provider = await fakeProvider((_body, _request, index) => (index === 0
    ? reply({ content: "Opening the page.", tool_calls: [toolCall("open", { url: "https://example.com" })] })
    : { status: 500, body: { error: { message: `upstream failed for Bearer ${SECRET}` } } }));
  try {
    const { promise, steps } = turn(provider, fakeMCP(), { limits: { rateLimitRetries: 0 } });
    const result = await promise;
    assert.equal(result.failure.code, "server");
    const { event } = describeBuiltinAgentResult({ result, provider: "nvidia", model: "nvidia/some-model" });
    assert.equal(event.name, "BUILTIN_AGENT_SERVER");
    assert.equal(event.context.status, "500");
    assert.equal(event.context.model, "nvidia/some-model");
    for (const text of [JSON.stringify(result), JSON.stringify(event), JSON.stringify(steps)]) assert.ok(!text.includes("TOPSECRET"), text);
  } finally {
    await provider.close();
  }
});

test("a provider message shown to the user loses the key it echoes", async () => {
  const provider = await fakeProvider(() => ({ status: 400, body: { error: { message: `Malformed request for key ${SECRET}` } } }));
  try {
    const result = await turn(provider, fakeMCP()).promise;
    assert.equal(result.failure.code, "bad_request");
    assert.match(result.reason, /refused the request \(HTTP 400\): Malformed request for key \*\*\*/);
    assert.ok(!JSON.stringify(result).includes("TOPSECRET"));
  } finally {
    await provider.close();
  }
});

test("redaction removes provider keys and the key in use", () => {
  const text = redactSecrets(`bad key ${SECRET}; also sk-or-v1-abcdef0123456789 and AIzaSyA1234567890abcdefghij and Bearer abc.def`, "plainsecret123");
  for (const secret of ["TOPSECRET", "abcdef0123456789", "AIzaSyA1234567890", "abc.def"]) assert.ok(!text.includes(secret), text);
  assert.equal(redactSecrets("key plainsecret123 here", "plainsecret123"), "key *** here");
});

// ---- Schemas, results and context ----------------------------------------------

test("MCP schemas become OpenAI parameters without the keywords providers reject", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    oneOf: [{ required: ["name"] }, { required: ["profile_id"] }],
    properties: {
      profile: { type: "string", description: "Profile." },
      timeout: { type: "number", exclusiveMinimum: 0 },
      fingerprint: { type: ["boolean", "string"] },
      fields: {
        type: "object",
        description: "Named fields.",
        additionalProperties: { type: "object", properties: { selector: { type: "string" }, attribute: { type: "string" } }, additionalProperties: false },
      },
      content: { description: "Anything." },
      actions: { type: "array", minItems: 1, maxItems: 16, items: { type: "object", properties: { type: { type: "string" } }, required: ["type", "gone"] } },
    },
    required: ["profile", "missing"],
  };
  const loose = toOpenAIParameters(schema);
  assert.deepEqual(loose, {
    type: "object",
    properties: {
      profile: { type: "string", description: "Profile." },
      timeout: { type: "number" },
      fingerprint: { type: "boolean" },
      fields: {
        type: "object",
        description: "Named fields.",
        additionalProperties: { type: "object", properties: { selector: { type: "string" }, attribute: { type: "string" } } },
      },
      content: { description: "Anything." },
      actions: { type: "array", items: { type: "object", properties: { type: { type: "string" } }, required: ["type"] } },
    },
    required: ["profile"],
  });
  const strict = toOpenAIParameters(schema, { strict: true });
  assert.equal(strict.properties.fields.type, "string");
  assert.match(strict.properties.fields.description, /JSON object whose keys you choose; each value is an object with selector, attribute/);
  assert.equal(strict.properties.content.type, "string");
  assert.ok(!JSON.stringify(strict).includes("additionalProperties"));
  const kept = toOpenAIParameters(schema, { keep: ["profile", "timeout"] });
  assert.deepEqual(Object.keys(kept.properties), ["profile", "timeout"]);
  assert.deepEqual(kept.required, ["profile"]);
});

test("only the allowlist is offered, screenshot only to vision models", () => {
  const plain = selectTools(MCP_TOOLS).map((tool) => tool.function.name);
  assert.deepEqual(plain, ["start", "open", "state", "click"]);
  assert.ok(!plain.includes("evaluate") && !plain.includes("doctor"));
  assert.deepEqual(selectTools(MCP_TOOLS, { vision: true }).map((tool) => tool.function.name), ["start", "open", "state", "click", "screenshot"]);
  assert.ok(BUILTIN_AGENT_TOOLS.length <= 16);
});

test("weak models' arguments are coerced to the schema", () => {
  const schema = { properties: { element_id: { type: "integer" }, settle: { type: "boolean" }, fields: { type: "object" }, text: { type: "string" } } };
  assert.deepEqual(coerceArguments({ element_id: "12", settle: "TRUE", fields: "{\"title\":{\"selector\":\"h2\"}}", text: "42" }, schema), {
    element_id: 12, settle: true, fields: { title: { selector: "h2" } }, text: "42",
  });
});

test("the toolset fills defaults and drops arguments it never offered", () => {
  const toolset = createMCPToolset({ client: {}, mcpTools: MCP_TOOLS, defaultProfile: "Work" });
  assert.deepEqual(toolset.prepare("click", { element_id: 4, cdp: "ws://x" }), { element_id: 4, profile: "Work", return_state: true });
  assert.deepEqual(toolset.prepare("start", { url: "https://a.test" }), { url: "https://a.test", profile: "Work", return_state: true });
  assert.deepEqual(toolset.prepare("click", { element_id: 1, profile: "Other", return_state: false }), { element_id: 1, profile: "Other", return_state: false });
});

test("a profile start gets more time than a page action", async () => {
  const timeouts = {};
  const toolset = createMCPToolset({
    client: { callTool: async (name, _args, timeoutMs) => { timeouts[name] = timeoutMs; return { content: [{ type: "text", text: "ok" }] }; } },
    mcpTools: MCP_TOOLS,
  });
  await toolset.call("start", {});
  await toolset.call("click", { element_id: 1 });
  assert.deepEqual(timeouts, { start: 180_000, click: 120_000 });
});

test("long tool results are cut and images reach vision models only", () => {
  const long = toolResultForModel({ content: [{ type: "text", text: "x".repeat(20_000) }] }, { limit: 1_000 });
  assert.equal(long.text.length, 1_000);
  assert.match(long.text, /cut here to save space/);
  const shot = { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] };
  assert.deepEqual(toolResultForModel(shot, { vision: false }).images, []);
  assert.match(toolResultForModel(shot, { vision: false }).text, /cannot see images/);
  assert.equal(toolResultForModel(shot, { vision: true }).images.length, 1);
  assert.equal(toolResultForModel({ isError: true, content: [{ type: "text", text: "no element 9" }] }).text, "Error: no element 9");
});

test("the context drops old tool results and screenshots first, never the user's message", () => {
  const messages = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "the user's task ".repeat(50) },
    ...Array.from({ length: 6 }, (_, index) => [
      { role: "assistant", content: null, tool_calls: [{ id: `c${index}`, type: "function", function: { name: "state", arguments: "{}" } }] },
      { role: "tool", tool_call_id: `c${index}`, content: `page ${index} `.repeat(400) },
    ]).flat(),
    { role: "user", content: [{ type: "text", text: "shot" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(5_000)}` } }] },
    { role: "user", content: [{ type: "text", text: "shot" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"B".repeat(5_000)}` } }] },
  ];
  fitContext(messages, { contextChars: 20_000, keepRecentToolResults: 2 });
  assert.equal(messages[0].content, "system prompt");
  assert.match(messages[1].content, /^the user's task/);
  const tools = messages.filter((message) => message.role === "tool");
  assert.match(tools[0].content, /Earlier tool result removed/);
  assert.match(tools.at(-1).content, /^page 5/);
  assert.equal(messages.at(-2).content, "[Earlier screenshot removed to save space.]");
  assert.ok(Array.isArray(messages.at(-1).content), "the newest screenshot stays while it fits");
  assert.equal(tools.length, 6, "every tool call keeps its result message");
});

test("tool calls are parsed from strings and objects, with IDs when a provider leaves them out", () => {
  const calls = parseToolCalls([
    { function: { name: "open", arguments: "{\"url\":\"https://a.test\"}" } },
    { id: "x", function: { name: "state", arguments: { profile: "W" } } },
    { id: "y", function: { name: "click", arguments: "[1]" } },
    { id: "z", function: { name: "state", arguments: "" } },
  ], 7);
  assert.deepEqual(calls.map(({ id, name, args, argumentError }) => ({ id, name, args, argumentError })), [
    { id: "call_7_0", name: "open", args: { url: "https://a.test" }, argumentError: undefined },
    { id: "x", name: "state", args: { profile: "W" }, argumentError: undefined },
    { id: "y", name: "click", args: {}, argumentError: "the arguments must be a JSON object" },
    { id: "z", name: "state", args: {}, argumentError: undefined },
  ]);
  assert.equal(messageText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "ab");
});

// ---- Providers, models and the Test button --------------------------------------

test("base URLs are normalized and keys in URLs are refused", () => {
  assert.equal(normalizeBaseURL(" http://localhost:11434/v1/ "), "http://localhost:11434/v1");
  assert.equal(normalizeBaseURL("https://api.groq.com/openai/v1/chat/completions"), "https://api.groq.com/openai/v1");
  assert.equal(normalizeBaseURL("https://user:pass@api.example.com/v1"), "");
  assert.equal(normalizeBaseURL("https://api.example.com/v1?key=abc"), "");
  assert.equal(normalizeBaseURL("file:///etc/passwd"), "");
  assert.equal(resolveProviderSettings({ provider: "nvidia", baseURL: "http://evil.test", model: "m" }).baseURL, "https://integrate.api.nvidia.com/v1");
  assert.deepEqual(parseBuiltinAgentSettings("{\"provider\":\"gemini\",\"model\":\"gemini-2.5-flash\",\"apiKey\":\"never\"}"), { provider: "gemini", baseURL: "", model: "gemini-2.5-flash" });
  assert.deepEqual(parseBuiltinAgentSettings("not json"), {});
});

test("NVIDIA preselects a chat Nemotron model: Super, then Ultra, then Nano", () => {
  const models = ["meta/llama-3.1-8b-instruct", "nvidia/nemotron-4-340b-reward", "nvidia/llama-3.2-nemoretriever-300m-embed-v1", "nvidia/nvidia-nemotron-nano-9b-v2", "nvidia/llama-3.1-nemotron-ultra-253b-v1", "nvidia/llama-3.3-nemotron-super-49b-v1", "nvidia/llama-3.3-nemotron-super-49b-v1.5", "nvidia/nemotron-nano-12b-v2-vl"]
    .map((id) => describeModel("nvidia", { id }));
  assert.equal(defaultModelFor("nvidia", models), "nvidia/llama-3.3-nemotron-super-49b-v1.5");
  assert.equal(defaultModelFor("nvidia", models.filter((model) => !/super/.test(model.id))), "nvidia/llama-3.1-nemotron-ultra-253b-v1");
  assert.equal(defaultModelFor("nvidia", models.filter((model) => /nano/.test(model.id))), "nvidia/nvidia-nemotron-nano-9b-v2");
  assert.equal(defaultModelFor("nvidia", []), "nvidia/llama-3.3-nemotron-super-49b-v1.5");
  assert.ok(!offeredModels("nvidia", models).some((model) => /embed|reward/.test(model.id)));
  assert.equal(models.find((model) => model.id.endsWith("-vl")).vision, true);
});

test("OpenRouter offers its free router and free tool models; Gemini a Flash model", () => {
  const openrouter = [
    { id: "openai/gpt-4o", supported_parameters: ["tools"] },
    { id: "meta-llama/llama-3.3-70b-instruct:free", supported_parameters: ["tools", "temperature"] },
    { id: "some/model:free", supported_parameters: ["temperature"], architecture: { input_modalities: ["text", "image"] } },
  ].map((item) => describeModel("openrouter", item));
  assert.equal(defaultModelFor("openrouter", openrouter), "meta-llama/llama-3.3-70b-instruct:free");
  assert.deepEqual(offeredModels("openrouter", openrouter).map((model) => model.id), [OPENROUTER_FREE_ROUTER, "meta-llama/llama-3.3-70b-instruct:free"]);
  assert.equal(openrouter[2].vision, true);
  assert.equal(defaultModelFor("openrouter", []), OPENROUTER_FREE_ROUTER);
  const gemini = ["models/gemini-2.0-flash", "models/gemini-2.5-flash", "models/gemini-2.5-flash-lite", "models/text-embedding-004"].map((id) => describeModel("gemini", { id }));
  assert.equal(defaultModelFor("gemini", gemini), "gemini-2.5-flash");
  assert.ok(!offeredModels("gemini", gemini).some((model) => /embedding/.test(model.id)));
});

test("models are listed from the provider with the key", async () => {
  const provider = await fakeProvider(() => reply({}), { models: [{ id: "a" }, { id: "b" }] });
  try {
    const client = createProviderClient({ provider: "custom", baseURL: provider.baseURL, apiKey: SECRET });
    assert.deepEqual((await client.listModels()).map((model) => model.id), ["a", "b"]);
    assert.equal(provider.requests[0].headers.authorization, `Bearer ${SECRET}`);
  } finally {
    await provider.close();
  }
});

test("Test reports a working key and tool support, a key that fails, and a model that ignores tools", async () => {
  let mode = "tool";
  const provider = await fakeProvider((body) => {
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].function.name, "ping");
    if (mode === "tool") return reply({ tool_calls: [toolCall("ping", { text: "ok" })] });
    if (mode === "text") return reply({ content: "ok" });
    return { status: 401, body: { error: { message: "bad key" } } };
  });
  try {
    const client = createProviderClient({ provider: "custom", baseURL: provider.baseURL, apiKey: SECRET, providerName: "NVIDIA" });
    assert.deepEqual(await testProvider({ client, model: "m", providerName: "NVIDIA" }), { ok: true, key: "ok", tools: "ok", message: "NVIDIA accepted the key, and “m” can call tools." });
    mode = "text";
    const ignored = await testProvider({ client, model: "m", providerName: "NVIDIA" });
    assert.equal(ignored.tools, "unknown");
    assert.match(ignored.message, /answered without calling the test tool/);
    mode = "auth";
    const rejected = await testProvider({ client, model: "m", providerName: "NVIDIA" });
    assert.deepEqual({ ok: rejected.ok, key: rejected.key, code: rejected.code }, { ok: false, key: "failed", code: "auth" });
  } finally {
    await provider.close();
  }
});

test("Test tells a rate limit and an unreachable provider apart", async () => {
  const provider = await fakeProvider(() => ({ status: 429, body: {} }));
  try {
    const client = createProviderClient({ provider: "custom", baseURL: provider.baseURL, providerName: "OpenRouter" });
    const limited = await testProvider({ client, model: "m", providerName: "OpenRouter" });
    assert.deepEqual({ ok: limited.ok, code: limited.code, key: limited.key }, { ok: false, code: "rate_limit", key: "ok" });
  } finally {
    await provider.close();
  }
  const offline = createProviderClient({ provider: "custom", baseURL: provider.baseURL, providerName: "OpenRouter" });
  const unreachable = await testProvider({ client: offline, model: "m", providerName: "OpenRouter" });
  assert.equal(unreachable.code, "network");
  assert.equal(unreachable.key, "unknown");
});

test("the setup's provider list matches the providers the main process calls", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { PROVIDERS } = require("./builtin-agent-providers.cjs");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "builtinAgent.ts"), "utf8");
  for (const provider of Object.values(PROVIDERS)) {
    assert.match(source, new RegExp(`id: "${provider.id}",\\s+name: "[^"]+",\\s+baseURL: "${provider.baseURL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`), provider.id);
  }
});

test("the main process runs the built-in agent in-process, stops it, and keeps its key to itself", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const agentRun = main.slice(main.indexOf('case "agent_run": {'), main.indexOf('case "workflow_author_run": {'));
  // No CLI to resolve, the same events as an agent CLI, and the same scope cleanup.
  assert.match(agentRun, /const builtin = args\.agentId === BUILTIN_AGENT_ID;\s+const bin = builtin \? "" : resolveBinary/);
  assert.match(agentRun, /emit\("agent:done", \[args\.replyId, result\.code, result\.stderr, result\.stdout, result\.reason, result\.failure\]\)/);
  assert.ok(agentRun.indexOf("if (builtin) {") < agentRun.indexOf("} finally {"), "the built-in run shares the CLI run's finally block");
  const terminate = main.slice(main.indexOf('case "agent_terminate": {'), main.indexOf('case "terminal_start": {'));
  assert.match(terminate, /builtinAgentRuns\.get\(args\.replyId\)[\s\S]*builtinRun\.abort\(\)/);
  assert.match(main, /for \(const run of builtinAgentRuns\.values\(\)\) run\.abort\(\);/);
  assert.match(main, /case "workflow_author_run": \{\s+if \(args\.agentId === BUILTIN_AGENT_ID\)/);
  for (const command of ["builtin_agent_status", "builtin_agent_settings_save", "builtin_agent_key_save", "builtin_agent_key_clear", "builtin_agent_models", "builtin_agent_test"]) {
    assert.ok(main.includes(`case "${command}":`), command);
  }
  // The status the window gets says which providers have a key, never the key.
  const status = main.slice(main.indexOf("async function builtinAgentStatus()"), main.indexOf("async function builtinAgentSetupClient"));
  assert.ok(!status.includes(".load("), "the status never decrypts a key");
  assert.ok(!/console\.\w+\([^)]*(?:apiKey|builtinAgentKeys)/.test(main), "no key is logged");
  const { describeInvokeFailure } = require("./invoke-failure-report.cjs");
  assert.equal(describeInvokeFailure({ command: "builtin_agent_key_save", error: new Error(`bad ${SECRET}`) }).event.message.includes("TOPSECRET"), false);
});
