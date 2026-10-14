const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { openLinuxTerminal } = require("./terminal-launch.cjs");

function fakeSpawn(available) {
  const calls = [];
  const spawn = (terminal, args) => {
    calls.push([terminal, args]);
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => available.includes(terminal)
      ? child.emit("spawn")
      : child.emit("error", Object.assign(new Error(`spawn ${terminal} ENOENT`), { code: "ENOENT" })));
    return child;
  };
  return { spawn, calls };
}

test("falls through missing terminals without an unhandled error", async () => {
  const { spawn, calls } = fakeSpawn(["xterm"]);
  const terminal = await openLinuxTerminal("codex login", { spawn });
  assert.equal(terminal, "xterm");
  assert.deepEqual(calls.map(([name]) => name), ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]);
  assert.deepEqual(calls.at(-1)[1], ["-e", "sh", "-lc", "codex login"]);
});

test("explains what to run when no terminal exists", async () => {
  const { spawn } = fakeSpawn([]);
  await assert.rejects(openLinuxTerminal("codex logout", { spawn }), /Run this command in a terminal instead: codex logout/);
});
