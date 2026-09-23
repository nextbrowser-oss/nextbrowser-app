const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readCLIVersion } = require("./cli-version.cjs");
test("uses offline version flag first", async () => {
  const calls = [];
  assert.equal(await readCLIVersion("cli", async (...args) => {
    calls.push(args); return { code: 0, stdout: "nbc dev\n" };
  }), "nbc dev");
  assert.deepEqual(calls, [["cli", ["--version"], {}, { timeoutMs: 5000 }]]);
});
test("supports legacy version command without weakening compatibility checks", async () => {
  assert.equal(await readCLIVersion("cli", async (_, args) => args[0] === "--version"
    ? { code: 1 } : { code: 0, stdout: "nextctl 1.2.3" }), "nextctl 1.2.3");
});
test("missing auth or malformed metadata is explicit, never a spinner or install failure", async () => {
  for (const result of [{ code: 1, stdout: "nbc rejected" }, { code: 0, stdout: "" }, { code: 0, stdout: "Usage:\nnbc" }]) {
    assert.equal(await readCLIVersion("cli", async () => result), "version unavailable");
  }
});
