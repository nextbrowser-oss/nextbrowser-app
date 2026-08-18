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

test("finishes after exit when a detached descendant keeps stdout open", async () => {
  const startedAt = Date.now();
  const result = await runCommand(
    process.execPath,
    ["-e", "const {spawn}=require('child_process'); spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{detached:true,stdio:['ignore',1,2]}).unref(); process.stdout.write('ready');"],
    { timeoutMs: 2_000 },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ready");
  assert.ok(Date.now() - startedAt < 1_000, "runner waited for the detached descendant");
});
