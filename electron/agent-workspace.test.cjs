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
  assert.match(main, /"--profile", CODEX_TERMINAL_PROFILE/);
  assert.match(main, /"--sandbox", "workspace-write"/);
  assert.match(main, /sandbox_workspace_write\.network_access=true/);
  assert.match(main, /default_tools_approval_mode = "approve"/);
  assert.match(main, /\[plugins\."browser@openai-bundled"\][\s\S]*enabled = false/);
  assert.match(main, /ensureCodexTerminalProfile\(\)/);
  assert.match(main, /"--add-dir", dir/);
  assert.match(main, /\.cache", "clawbrowser"/);
  assert.match(main, /\.local", "share", "clawbrowser"/);
  assert.match(main, /\.local", "state", "clawbrowser"/);
  assert.doesNotMatch(main, /dangerously-bypass-approvals-and-sandbox/);
});

test("terminal chat is isolated by conversation", () => {
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AgentTerminal.tsx"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "src", "components", "ChatView.tsx"), "utf8");
  assert.match(terminal, /\[agentId, browserEngine, conversationId, selectedProfile, workingDir\]/);
  assert.match(chat, /conversationId=\{conv\?\.id\}/);
});
