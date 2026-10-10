const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verificationFailureDialogOptions, verificationFailureDialogChoice } = require("./verification-policy.cjs");
const { requireVerificationCapableCLI } = require("./verification-policy.cjs");
test("an old CLI is rejected using only a mandatory-verification capability probe", async () => {
  const calls = [];
  const run = async (...args) => { calls.push(args); return { code: 1, stderr: "unknown flag" }; };
  await assert.rejects(requireVerificationCapableCLI("/candidate/nbc", run), /VERIFY_REQUIRED/);
  assert.deepEqual(calls[0], ["/candidate/nbc", ["--verify-on-start-only", "--proxy-safety-file", "", "version", "--help"], {}, { timeoutMs: 5000 }]);
  assert.equal(calls.length, 1);
  await requireVerificationCapableCLI("/candidate/nbc", async () => ({ code: 0 }));
});
test("only the direct button after three proxy failures grants consent", () => {
  for (const proxyExpected of [true, false]) {
    for (const attempts of [undefined, 0, 1, 2, 3, 4]) {
      const options = verificationFailureDialogOptions({ proxyExpected, attempts });
      assert.equal(options.defaultId, 0);
      assert.equal(options.cancelId, 0);
      const offerDirect = proxyExpected && attempts === 3;
      assert.deepEqual(options.buttons, offerDirect ? ["Cancel", "Continue without proxy", "Get help in Discord"] : ["Cancel", "Get help in Discord"]);
      for (const response of [0, 1, -1, 2, 3, undefined, null]) {
        const choice = verificationFailureDialogChoice(proxyExpected, response, attempts);
        assert.equal(choice === "direct", offerDirect && response === 1);
        assert.equal(choice, options.buttons[response] === "Get help in Discord" ? "support" : options.buttons[response] === "Continue without proxy" ? "direct" : "cancel");
      }
    }
  }
  assert.match(verificationFailureDialogOptions({ proxyExpected: true, attempts: 3 }).detail, /real IP/);
});
test("a stopped profile is reported as our problem with the failed checks for support", () => {
  const options = verificationFailureDialogOptions({ failedSurfaces: ["proxy"], proxyExpected: true, attempts: 1 });
  assert.match(options.detail, /problem on our side/);
  assert.match(options.detail, /Failed checks: proxy\./);
  assert.doesNotMatch(options.detail, /Resolve the verification failure/);
});
