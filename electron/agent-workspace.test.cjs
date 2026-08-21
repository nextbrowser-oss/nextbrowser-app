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
  assert.match(main, /CLAWBROWSER_BIN: clawbrowserBin/);
  assert.match(main, /default_tools_approval_mode = "approve"/);
  assert.match(main, /\[plugins\."browser@openai-bundled"\][\s\S]*enabled = false/);
  assert.match(main, /ensureCodexTerminalProfile\(\)/);
  assert.match(main, /const nextctlBin = await resolveOrInstallNextctl\(\)/);
  assert.match(main, /plugins\."clawbrowser@clawctl-local"\.enabled=false/);
  assert.match(main, /mcp_servers\.nextbrowser\.command=/);
  assert.match(main, /mcp_servers\.nextbrowser\.args=/);
  assert.match(main, /mcp_servers\.nextbrowser\.env=/);
  assert.match(main, /mcp_servers\.nextbrowser\.env_vars=.*MULTILOGIN_TOKEN/);
  assert.doesNotMatch(main, /mcpEnvKeys\.push\("MULTILOGIN_TOKEN"\)/);
  assert.match(main, /plugins\."clawbrowser@clawctl-local"\.mcp_servers\.clawbrowser\.enabled=false/);
  assert.match(main, /plugins\."clawbrowser@nbc-local"\.enabled=false/);
  assert.match(main, /mcp_servers\.nextbrowser\.default_tools_approval_mode=approve/);
  assert.match(main, /"--add-dir", dir/);
  assert.match(main, /\.cache", "clawbrowser"/);
  assert.match(main, /\.local", "share", "clawbrowser"/);
  assert.match(main, /\.local", "state", "clawbrowser"/);
  assert.match(main, /"Application Support", "Dasbrowser"/);
  assert.doesNotMatch(main, /path\.join\(home\(\), "Library", "Application Support"\),/);
  assert.match(main, /path\.join\(home\(\), "\.nextbrowser", "runtime"\)/);
  assert.match(main, /managedNextctlRoot\(\), \.\.\.searchDirs\(\)/);
  assert.doesNotMatch(main, /dangerously-bypass-approvals-and-sandbox/);
});

test("Codex chat uses the managed Clawbrowser MCP configuration", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /case "agent_run":[\s\S]*args\.agentId === "codex"/);
  assert.match(main, /case "agent_run":[\s\S]*resolveOrInstallNextctl\(\)/);
  assert.match(main, /case "agent_run":[\s\S]*codexClawbrowserMCPArgs\(nextctlBin\)/);
});

test("terminal chat is isolated by conversation", () => {
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AgentTerminal.tsx"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "src", "components", "ChatView.tsx"), "utf8");
  assert.match(terminal, /\[agentId, conversationId, workingDir, restartNonce\]/);
  assert.match(chat, /conversationId=\{conv\?\.id\}/);
  assert.match(terminal, /terminal_context_menu/);
});

test("terminal attachments are staged inside the sandboxed workspace", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AgentTerminal.tsx"), "utf8");
  assert.match(main, /case "select_terminal_files"/);
  assert.match(main, /agentWorkspaceDir\(home\(\)\), "\.attachments", conversation/);
  assert.match(main, /stat\.size > 30 \* 1024 \* 1024/);
  assert.match(main, /totalSize > 600 \* 1024 \* 1024/);
  assert.match(main, /COPYFILE_FICLONE/);
  assert.match(main, /case "remove_terminal_file"/);
  assert.match(terminal, /terminalAttachmentContext\(attachmentsRef\.current\)/);
  assert.match(terminal, /select_terminal_files/);
  assert.match(terminal, /setAttachmentError/);
  assert.match(terminal, /Please inspect the attached file\(s\)\./);
});

test("automation artifacts are persisted only in local app storage", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /case "artifact_list"/);
  assert.match(main, /localAutomationArtifacts\(\)\.list/);
  assert.match(main, /case "artifact_import"/);
  assert.match(main, /localAutomationArtifacts\(\)\.importFile/);
  assert.match(main, /case "artifact_open"/);
  assert.match(main, /localAutomationArtifacts\(\)\.resolvePath/);
  assert.match(main, /case "artifact_delete"/);
  assert.match(main, /localAutomationArtifacts\(\)\.delete/);
  assert.doesNotMatch(main, /listAutomationArtifacts|uploadAutomationArtifact|downloadAutomationArtifact|deleteAutomationArtifact/);
});

test("automation recordings support backend deletion", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /case "automation_recording_delete"/);
  assert.match(main, /deleteAutomationRecording/);
});

test("unfinished recording attempts are never persisted as library entities", () => {
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.join(__dirname, "..", "src", "components", "Sidebar.tsx"), "utf8");
  assert.doesNotMatch(studio, /status: "recording"/);
  assert.doesNotMatch(sidebar, /automation_recording_delete/);
  assert.doesNotMatch(studio, /RecordingFilter|Clear stopped|STOPPED|No recordings in this view/);
  assert.match(studio, /items\.filter\(\(item\) => !!item\.document\.run\)/);
  assert.match(studio, /Start recording/);
  assert.match(studio, /Stop recording/);
  assert.doesNotMatch(studio, />Pause recording</);
});

test("recordings and workflows replay deterministically with explicit AI repair", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "..", "src", "store.ts"), "utf8");

  assert.match(main, /case "automation_recipe_execute"/);
  assert.match(main, /case "automation_recipe_cancel"/);
  assert.match(store, /runAutomationRecipe: async/);
  assert.match(store, /invoke<AutomationRecipeResult>\("automation_recipe_execute"/);
  assert.match(studio, /s\.runAutomationRecipe\(/);
  assert.match(studio, /Repair & run with AI/);
  assert.match(studio, /runLocalSkill\(repairWorkflow, repairTask\)/);
});

test("workflow builder selects page elements visually without exposing CSS inputs", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  assert.match(main, /case "automation_element_pick"/);
  assert.match(main, /case "automation_element_pick_cancel"/);
  assert.match(studio, /Select on page/);
  assert.match(studio, /Select row on page/);
  assert.match(studio, /no HTML or CSS knowledge required/i);
  assert.doesNotMatch(studio, /placeholder="css=/);
});
