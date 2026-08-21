const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");
const { cancelAutomationElementPick, pickAutomationElement, pickerPageScript } = require("./automation-element-picker.cjs");

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
          Promise.resolve(handler(message)).then((result) => {
            if (!child.stdout.destroyed) child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
          });
        }
        callback();
      },
    });
    child.kill = () => { child.stdin.destroy(); child.stdout.destroy(); queueMicrotask(() => child.emit("close", 0)); return true; };
    return child;
  };
  return { calls, spawnImpl, get spawnArgs() { return spawnArgs; } };
}

const toolResult = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

test("picker page script contains visual selection, Escape cancellation, and relative field support", () => {
  const source = pickerPageScript.toString();
  assert.match(source, /mousemove/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /element\.closest\(rootSelector\)/);
  assert.match(source, /data-testid/);
  assert.match(source, /HTMLAnchorElement/);
});

test("returns a browser-selected semantic locator through one MCP session", async () => {
  let polls = 0;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "open") return toolResult({ ok: true });
    if (message.params.name === "wait") return toolResult({ ok: true });
    if (message.params.name === "state") return toolResult({ page: { url: "https://example.com" }, elements: [] });
    const expression = message.params.arguments.expression;
    if (expression.includes("function pickerPageScript")) return toolResult({ result: { installed: true }, session: { name: "Work" } });
    if (expression.includes("state?.result")) {
      polls += 1;
      return toolResult({ result: polls > 1 ? { selector: "button.buy", locator: { role: "button", name: "Buy" }, label: "Buy" } : null, session: { name: "Work" } });
    }
    return toolResult(true);
  });

  const ready = [];
  const result = await pickAutomationElement({
    pickId: "pick-one", profile: "Work", runtime: "camoufox", mode: "target", openUrl: "https://example.com/products",
  }, { binary: "/tmp/nextctl", env: {}, spawnImpl: server.spawnImpl, onReady: () => ready.push(true) });

  assert.deepEqual(result, { selector: "button.buy", locator: { role: "button", name: "Buy" }, label: "Buy" });
  assert.deepEqual(server.spawnArgs, { binary: "/tmp/nextctl", args: ["--profile", "Work", "--runtime", "camoufox", "mcp"] });
  assert.deepEqual(server.calls.filter((call) => call.method === "tools/call").map((call) => call.params.name).slice(0, 3), ["open", "wait", "state"]);
  assert.equal(ready.length, 1);
});

test("cancels an active visual picker", async () => {
  let polling = false;
  const server = fakeMCP((message) => {
    if (message.method === "initialize") return { protocolVersion: "2025-03-26", capabilities: {} };
    if (message.params.name === "state") return toolResult({ page: { url: "https://example.com" }, elements: [] });
    const expression = message.params.arguments.expression;
    if (expression.includes("function pickerPageScript")) return toolResult({ installed: true });
    polling = true;
    return new Promise(() => {});
  });
  const pending = pickAutomationElement({ pickId: "pick-cancel", runtime: "clawbrowser", mode: "target" }, {
    binary: "nextctl", env: {}, spawnImpl: server.spawnImpl,
  });
  while (!polling) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cancelAutomationElementPick("pick-cancel"), true);
  assert.deepEqual(await pending, { cancelled: true });
});
