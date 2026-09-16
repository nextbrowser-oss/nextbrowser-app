const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verificationFailureDialogOptions, verificationFailureDialogChoice } = require("./verification-policy.cjs");
const { requireVerificationCapableCLI } = require("./verification-policy.cjs");
test("an old CLI is rejected using only a mandatory-verification capability probe", async () => {
  const calls = [];
  const run = async (...args) => { calls.push(args); return { code: 1, stderr: "unknown flag" }; };
  await assert.rejects(requireVerificationCapableCLI("/candidate/nbc", run), /VERIFY_REQUIRED/);
  assert.deepEqual(calls[0], ["/candidate/nbc", ["--require-verify", "--proxy-safety-file", "", "version", "--help"], {}, { timeoutMs: 5000 }]);
  assert.equal(calls.length, 1);
  await requireVerificationCapableCLI("/candidate/nbc", async () => ({ code: 0 }));
});
test("only the direct button after three proxy failures grants consent", () => {
  for (const proxyExpected of [true, false]) {
    for (const attempts of [undefined, 0, 1, 2, 3, 4]) {
      const options = verificationFailureDialogOptions({ proxyExpected, attempts });
      assert.equal(options.defaultId, 0);
      assert.equal(options.cancelId, 0);
      assert.deepEqual(options.buttons, proxyExpected && attempts === 3 ? ["Cancel", "Continue without proxy"] : ["Cancel"]);
      for (const response of [0, 1, -1, 2, undefined, null]) {
        assert.equal(verificationFailureDialogChoice(proxyExpected, response, attempts), proxyExpected && attempts === 3 && response === 1 ? "direct" : "cancel");
      }
    }
  }
  assert.match(verificationFailureDialogOptions({ proxyExpected: true, attempts: 3 }).detail, /real IP/);
});
