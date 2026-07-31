const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeManagedInstructions, START, END } = require("./workspace-instructions.cjs");

test("adds browser and secret-handling guidance", () => {
  const result = mergeManagedInstructions("");
  assert.match(result, /use the connected Clawbrowser MCP tools immediately/);
  assert.match(result, /Read only its browser skill/);
  assert.match(result, /use one `paginate_extract` call/);
  assert.match(result, /same MCP `start` call/);
  assert.match(result, /Do not wait for `load` after a plain scroll/);
  assert.match(result, /Never search for, read, print, copy/);
  assert.match(result, /`999\.md` as a website/);
  assert.match(result, /"открой браузер".*mean Clawbrowser/);
});

test("preserves user-authored instructions", () => {
  const result = mergeManagedInstructions("# My rules\n\nKeep this.");
  assert.match(result, /# My rules/);
  assert.match(result, /Keep this\./);
});

test("updates the managed block without duplicating it", () => {
  const result = mergeManagedInstructions(`${START}\nold\n${END}\n\nCustom`);
  assert.equal(result.split(START).length - 1, 1);
  assert.match(result, /Custom/);
  assert.doesNotMatch(result, /\nold\n/);
});
