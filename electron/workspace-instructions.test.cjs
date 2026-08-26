const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeManagedInstructions, START, END } = require("./workspace-instructions.cjs");

test("adds browser and secret-handling guidance", () => {
  const result = mergeManagedInstructions("");
  assert.match(result, /use the connected NextBrowser MCP tools immediately/);
  assert.match(result, /Playwright for Camoufox/);
  assert.match(result, /authoritative NextBrowser profile runtime context/);
  assert.match(result, /use one `paginate_extract` call/);
  assert.match(result, /short read-only top-N request/);
  assert.match(result, /finish immediately/);
  assert.match(result, /same MCP `start` call/);
  assert.match(result, /Do not wait for `load` after a plain scroll/);
  assert.match(result, /Never search for, read, print, copy/);
  assert.match(result, /`999\.md` as a website/);
  assert.match(result, /"открой браузер".*use the selected profile/);
  assert.match(result, /exactly one profile is listed, use that sole profile/);
  assert.match(result, /Fall back to ClawBrowser only when no workspace profile context exists/);
  assert.match(result, /Existing profiles in the current workspace always take priority/);
  assert.match(result, /Never invent, clone, or create a profile merely from a site name or task/);
  assert.match(result, /Do not read or invoke Chrome, browser-control/);
});

test("updates terminal profile runtime context without retaining stale mappings", () => {
  const first = mergeManagedInstructions("", "- HEY!: DasBrowser");
  const second = mergeManagedInstructions(first, "- HEY!: ClawBrowser");
  assert.match(second, /HEY!: ClawBrowser/);
  assert.doesNotMatch(second, /HEY!: DasBrowser/);
  assert.equal(second.split(START).length - 1, 1);
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
