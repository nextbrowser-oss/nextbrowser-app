const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { runAgentProcess } = require("./agent-process.cjs");

function fakeChild() {
  return {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { end: () => {} },
    events: new EventEmitter(),
    once(event, listener) { this.events.once(event, listener); },
  };
}

test("agent process returns captured output when the child closes", async () => {
  const child = fakeChild();
  const done = [];
  const resultPromise = runAgentProcess({
    spawnProcess: () => child,
    file: "agent",
    args: [],
    env: {},
    onSpawn: () => {},
    onStdout: () => {},
    onStderr: () => {},
    onDone: (result) => done.push(result),
  });

  child.stdout.emit("data", Buffer.from("finished"));
  child.stderr.emit("data", Buffer.from("activity"));
  child.events.emit("close", 0);

  assert.deepEqual(await resultPromise, { code: 0, stdout: "finished", stderr: "activity" });
  assert.equal(done.length, 1);
});

test("agent process settles only once when error is followed by close", async () => {
  const child = fakeChild();
  const done = [];
  const resultPromise = runAgentProcess({
    spawnProcess: () => child,
    file: "agent",
    args: [],
    env: {},
    onSpawn: () => {},
    onStdout: () => {},
    onStderr: () => {},
    onDone: (result) => done.push(result),
  });

  child.events.emit("error", new Error("spawn failed"));
  child.events.emit("close", 1);

  assert.deepEqual(await resultPromise, { code: -1, stdout: "", stderr: "spawn failed" });
  assert.equal(done.length, 1);
});

test("agent process finishes after exit when an inherited MCP pipe prevents close", async () => {
  const child = fakeChild();
  const done = [];
  const resultPromise = runAgentProcess({
    spawnProcess: () => child,
    file: "agent",
    args: [],
    env: {},
    onSpawn: () => {},
    onStdout: () => {},
    onStderr: () => {},
    onDone: (result) => done.push(result),
  });

  child.stdout.emit("data", Buffer.from("finished"));
  child.events.emit("exit", 0);

  assert.deepEqual(await resultPromise, { code: 0, stdout: "finished", stderr: "" });
  assert.equal(done.length, 1);
});

test("agent process result still resolves when the done event cannot be delivered", async () => {
  const child = fakeChild();
  const resultPromise = runAgentProcess({
    spawnProcess: () => child,
    file: "agent",
    args: [],
    env: {},
    onSpawn: () => {},
    onStdout: () => {},
    onStderr: () => {},
    onDone: () => { throw new Error("renderer unavailable"); },
  });

  child.stdout.emit("data", Buffer.from("finished"));
  child.events.emit("close", 0);

  assert.deepEqual(await resultPromise, { code: 0, stdout: "finished", stderr: "" });
});
