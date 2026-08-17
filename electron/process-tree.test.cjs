const assert = require("node:assert/strict");
const test = require("node:test");
const { descendants, isNextctlProcess, nextctlSubtree } = require("./process-tree.cjs");

const processes = [
  { pid: 10, ppid: 1, command: "codex" },
  { pid: 11, ppid: 10, command: "/managed/nextctl" },
  { pid: 12, ppid: 11, command: "browser-helper" },
  { pid: 13, ppid: 10, command: "unrelated-agent-helper" },
  { pid: 14, ppid: 13, command: "nbc" },
  { pid: 20, ppid: 1, command: "nextctl" },
];

test("walks descendants deepest-first without leaving the requested root", () => {
  assert.deepEqual(descendants(processes, 10).map((item) => item.pid), [12, 11, 14, 13]);
});

test("recognizes both nextctl executable names on macOS and Windows", () => {
  assert.equal(isNextctlProcess("/tmp/nextctl"), true);
  assert.equal(isNextctlProcess("C:\\runtime\\nbc.exe"), true);
  assert.equal(isNextctlProcess("clawbrowser"), false);
});

test("selects nextctl processes and their children but preserves the terminal agent", () => {
  assert.deepEqual(nextctlSubtree(processes, 10).map((item) => item.pid), [14]);
});
