const assert = require("node:assert/strict");
const test = require("node:test");
const {
  cancelAllCommands,
  cancelCommand,
  runCommand,
} = require("./command-runner.cjs");

test.afterEach(() => cancelAllCommands());

test("streams progress before exit while preserving buffered output and isolating observer failures", async () => {
  const stdout = [];
  const stderr = [];
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write('download');process.stderr.write('50%');setTimeout(()=>process.stdout.write('done'),30)"], {
    onStdout: (chunk) => { stdout.push(chunk); throw new Error("ignored observer failure"); },
    onStderr: (chunk) => stderr.push(chunk),
  });
  assert.equal(stdout.join(""), "downloaddone");
  assert.equal(stderr.join(""), "50%");
  assert.deepEqual(result, { stdout: "downloaddone", stderr: "50%", code: 0 });
});

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

test("tells an observer how the command ended without changing the result", async () => {
  const outcomes = [];
  const onSettled = (outcome) => outcomes.push(outcome);
  const ok = await runCommand(process.execPath, ["-e", "process.stdout.write('ok')"], { timeoutMs: 2_000, onSettled });
  assert.deepEqual(ok, { stdout: "ok", stderr: "", code: 0 });
  await runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 1_000, onSettled });
  const cancelled = runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { requestId: "observed-cancel", timeoutMs: 5_000, onSettled });
  cancelCommand("observed-cancel");
  await cancelled;
  const missing = await runCommand("/definitely/not/a/binary", [], { onSettled: () => { throw new Error("observer"); } });
  await runCommand("/definitely/not/a/binary", [], { onSettled });

  assert.deepEqual(outcomes[0], { cancelled: false, timedOut: false, spawnError: false, signal: null });
  assert.equal(outcomes[1].timedOut, true);
  assert.equal(outcomes[1].cancelled, false);
  assert.equal(outcomes[2].cancelled, true);
  assert.equal(missing.code, -1, "a throwing observer does not affect the command");
  assert.equal(outcomes[3].spawnError, true);
});
