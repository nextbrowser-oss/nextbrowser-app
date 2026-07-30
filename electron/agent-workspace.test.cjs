const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { agentWorkspaceDir } = require("./agent-workspace.cjs");

test("agent workspace stays outside macOS Library and protected user folders", () => {
  const workspace = agentWorkspaceDir("/Users/alice");

  assert.equal(workspace, path.join("/Users/alice", ".nextbrowser", "workspace"));
  assert.equal(workspace.includes(`${path.sep}Library${path.sep}`), false);
  for (const protectedFolder of ["Documents", "Downloads", "Desktop", "Music", "Pictures"]) {
    assert.equal(workspace.includes(`${path.sep}${protectedFolder}${path.sep}`), false);
  }
});

test("agent workspace requires an explicit home directory", () => {
  assert.throws(() => agentWorkspaceDir(""), /home directory/i);
});

test("terminal Codex keeps workspace isolation while allowing Clawbrowser network calls", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /"--sandbox", "workspace-write"/);
  assert.match(main, /sandbox_workspace_write\.network_access=true/);
  assert.doesNotMatch(main, /dangerously-bypass-approvals-and-sandbox/);
});
