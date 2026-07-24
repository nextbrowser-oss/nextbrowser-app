const assert = require("node:assert/strict");
const test = require("node:test");
const {
  cancelAllCommands,
  cancelCommand,
  runCommand,
} = require("./command-runner.cjs");

test.afterEach(() => cancelAllCommands());

test("returns stdout for a completed command", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write('ok')"],
    { timeoutMs: 2_000 },
  );

  assert.deepEqual(result, { stdout: "ok", stderr: "", code: 0 });
});

test("stops a command when its timeout expires", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { timeoutMs: 1_000 },
  );

  assert.equal(result.code, -1);
  assert.match(result.stderr, /timed out after 1 seconds/i);
});

test("cancels a running command by request id", async () => {
  const resultPromise = runCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { requestId: "profile-create-test", timeoutMs: 5_000 },
  );

  assert.equal(cancelCommand("profile-create-test"), true);
  const result = await resultPromise;

  assert.equal(result.code, -1);
  assert.match(result.stderr, /command cancelled/i);
  assert.equal(cancelCommand("profile-create-test"), false);
});
