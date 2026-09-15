const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verificationFailureDialogOptions, verificationFailureDialogChoice } = require("./verification-policy.cjs");
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
